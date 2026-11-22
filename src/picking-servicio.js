import { ErrorDocumento } from "core";
import { TIPO_PROFORMA, ESTACIONES } from "./tipos.js";
import {
  ErrorPicking, PUNTAJES_PISO, lineasDelDocumento, aplicarMarca, combinarAvance, resumenAvance,
} from "./picking.js";

const ESTADO_PICKING = "orden_salida"; // la proforma que el almacén tiene delante
// Estados en que la estación de creación puede corregir la proforma. En orden_revision el almacén ya terminó:
// cambiar líneas ahí invalidaría lo que se juntó, y el flujo no vuelve atrás.
export const ESTADOS_EDITABLES = ["borrador", "cotizacion", "orden_salida"];

/**
 * Servicio de picking. Todas las operaciones corren dentro de la empresa activa (conEmpresa),
 * que deja el middleware de permisos del núcleo.
 */
export function crearServicioPicking({ core, Picking, puntajesPiso = PUNTAJES_PISO }) {
  const { documentos, modelos } = core;

  async function cargarProforma(code) {
    const doc = await documentos.obtener({ code });
    if (!doc || doc.tipo !== TIPO_PROFORMA.tipo)
      throw new ErrorPicking("PROFORMA_NO_ENCONTRADA", `No existe la proforma ${code}`);
    return doc;
  }

  async function registrarEvento(tipo, { code, usuarioId, datos, estacion = "produccion" }) {
    // El evento no debe romper la marca ya guardada
    try {
      await modelos.Evento.create({
        usuarioId, documentoCode: code, tipoDocumento: TIPO_PROFORMA.tipo, estacion,
        tipo, origen: "servidor", ts: new Date(), recibidoTs: new Date(), datos,
      });
    } catch (e) {
      console.error("topd: no se pudo guardar el evento", e);
    }
  }

  const servicio = {
    /** Proformas en uno o más estados, con el avance de cada línea (la más antigua primero, salvo `recientes`). */
    async listar({ estados = [ESTADO_PICKING], limite = 100, recientes = false, conPagos = false } = {}) {
      const docs = await documentos.listar({ tipo: TIPO_PROFORMA.tipo, estado: estados, limite });
      if (!docs.length) return [];
      const filas = await Picking.find({ code: { $in: docs.map((d) => d.code) } }).lean();
      return (recientes ? docs : docs.reverse()).map((d) => {
        const lineas = combinarAvance(lineasDelDocumento(d), filas.filter((f) => f.code === d.code));
        return {
          code: d.code, estado: d.estado, version: d.version, editable: ESTADOS_EDITABLES.includes(d.estado), creadaTs: d.createdAt, actualizadaTs: d.updatedAt,
          cabecera: d.payload?.doc?.cabecera ?? {}, origenCarga: d.payload?.doc?.origenCarga ?? "manual",
          lineas, avance: resumenAvance(lineas),
          // Los pagos solo salen donde hace falta (bandeja): el almacén no los necesita
          ...(conPagos && { pagos: d.payload?.doc?.pagos ?? [] }),
        };
      });
    },

    /** Proformas activas para el almacén (en orden_salida). */
    activas: (opciones) => servicio.listar({ ...opciones, estados: [ESTADO_PICKING] }),

    /** Despacho: «revisé y validé el pedido». Cierra la proforma (orden_revision → cerrada). */
    async cerrar({ code, usuarioId, permisos }) {
      const doc = await cargarProforma(code);
      if (doc.estado !== "orden_revision")
        throw new ErrorPicking("ESTADO_NO_REVISION", `La proforma ${code} está en '${doc.estado}': no está para revisar`);
      const nuevo = await documentos.transicionar({ code, a: "cerrada", usuarioId, permisos, esperaVersion: doc.version });
      return { code, estado: nuevo.estado };
    },

    /** Marca una línea (parcial: solo cambia lo que llega). */
    async marcar({ code, lineaId, cambio, usuarioId }) {
      const doc = await cargarProforma(code);
      if (doc.estado !== ESTADO_PICKING)
        throw new ErrorPicking("ESTADO_NO_PICKING", `La proforma ${code} está en '${doc.estado}': no se está buscando`);
      const linea = lineasDelDocumento(doc).find((l) => l.id === lineaId);
      if (!linea) throw new ErrorPicking("LINEA_NO_ENCONTRADA", `La proforma ${code} no tiene la línea ${lineaId} (o está anulada)`);

      const actual = await Picking.findOne({ code, lineaId }).lean();
      const fila = aplicarMarca(actual, cambio, { linea, puntajesPiso });
      const guardada = await Picking.findOneAndUpdate(
        { code, lineaId },
        { $set: { ...fila, porId: usuarioId } },
        { upsert: true, returnDocument: "after", lean: true },
      );
      await registrarEvento("picking.marca", {
        code, usuarioId,
        datos: {
          lineaId, de: actual?.estado ?? "pendiente", a: fila.estado, piso: fila.piso, taller: fila.taller,
          reconocido: fila.reconocido, cantidadEncontrada: fila.cantidadEncontrada, puntaje: fila.puntaje,
          msDesdeInicio: fila.iniciadoTs ? fila.resueltoTs ? fila.resueltoTs - fila.iniciadoTs : null : null,
        },
      });
      return guardada;
    },

    /** «Ya junté el pedido»: pasa la proforma a orden_revision si todas las líneas están resueltas. */
    async listoParaRevision({ code, usuarioId, permisos }) {
      const doc = await cargarProforma(code);
      if (doc.estado !== ESTADO_PICKING)
        throw new ErrorPicking("ESTADO_NO_PICKING", `La proforma ${code} está en '${doc.estado}'`);
      const filas = await Picking.find({ code }).lean();
      const avance = resumenAvance(combinarAvance(lineasDelDocumento(doc), filas));
      if (!avance.completo)
        throw new ErrorPicking("PICKING_INCOMPLETO", "Quedan líneas sin resolver", { pendientes: avance.pendientes });
      const nuevo = await documentos.transicionar({
        code, a: "orden_revision", usuarioId, permisos, esperaVersion: doc.version,
      });
      return { code, estado: nuevo.estado, avance };
    },

    /** Una proforma completa, tal como se cargó (con líneas tachadas), para volver a abrirla en el formulario. */
    async obtener({ code }) {
      const doc = await cargarProforma(code);
      const d = doc.payload?.doc ?? {};
      return {
        code: doc.code, estado: doc.estado, version: doc.version, editable: ESTADOS_EDITABLES.includes(doc.estado),
        cabecera: d.cabecera ?? {}, origenCarga: d.origenCarga ?? "manual", pagos: d.pagos ?? [],
        lineas: (d.lineas ?? []).map((l, i) => ({ ...l, id: l.id ?? `L${i + 1}` })),
      };
    },

    /**
     * Corrige una proforma (nueva versión; la anterior queda guardada en el núcleo). Las líneas que vienen con su `id`
     * se conservan; las sin id son nuevas. El avance del almacén se reinicia solo en las líneas cuyo fondo cambió
     * (cantidad, descripción, tachada) o que se quitaron: precio y comentario no obligan a buscar de nuevo.
     */
    async editar({ code, cabecera = {}, lineas, pagos, esperaVersion, usuarioId }) {
      if (!Number.isInteger(esperaVersion))
        throw new ErrorPicking("VERSION_REQUERIDA", "Falta la versión que se está editando");
      const doc = await cargarProforma(code);
      if (!ESTADOS_EDITABLES.includes(doc.estado))
        throw new ErrorPicking("ESTADO_NO_EDITABLE", `La proforma ${code} está en '${doc.estado}' y ya no se puede editar`);
      const d = doc.payload?.doc ?? {};
      const anteriores = (d.lineas ?? []).map((l, i) => ({ ...l, id: l.id ?? `L${i + 1}` }));
      const ahora = new Date();
      const nuevas = limpiarLineas(lineas, anteriores, ahora);
      const cabeceraNueva = limpiarCabecera(cabecera);
      const pagosNuevos = limpiarPagos(pagos);

      const porId = new Map(anteriores.map((l) => [l.id, l]));
      const quedan = new Set(nuevas.map((l) => l.id));
      const reiniciar = anteriores.filter((l) => !quedan.has(l.id)).map((l) => l.id);
      let modificadas = 0, agregadas = 0;
      for (const l of nuevas) {
        const antes = porId.get(l.id);
        if (!antes) { agregadas++; continue; }
        if (antes.cantidad !== l.cantidad || antes.descripcion !== l.descripcion || Boolean(antes.anulada) !== l.anulada) reiniciar.push(l.id);
        if (l.modificadaTs === ahora) modificadas++;
      }
      const camposCambiados = [...new Set([...Object.keys(d.cabecera ?? {}), ...Object.keys(cabeceraNueva)])]
        .filter((k) => (d.cabecera ?? {})[k] !== cabeceraNueva[k]);
      const sinCambios = !camposCambiados.length && !modificadas && !agregadas && !reiniciar.some((id) => !quedan.has(id))
        && JSON.stringify(d.pagos ?? []) === JSON.stringify(pagosNuevos);
      if (sinCambios) return { code, estado: doc.estado, version: doc.version, sinCambios: true, reiniciadas: [] };

      const nuevo = await documentos.nuevaVersion({
        code, usuarioId, esperaVersion,
        doc: { ...d, cabecera: cabeceraNueva, lineas: nuevas, pagos: pagosNuevos },
      });
      if (reiniciar.length) await Picking.deleteMany({ code, lineaId: { $in: reiniciar } });
      await registrarEvento("proforma.editada", {
        code, usuarioId, estacion: "creacion",
        datos: { version: nuevo.version, campos: camposCambiados, lineasNuevas: agregadas, lineasModificadas: modificadas, lineasQuitadas: reiniciar.filter((id) => !quedan.has(id)).length, reiniciadas: reiniciar },
      });
      return { code, estado: nuevo.estado, version: nuevo.version, reiniciadas: reiniciar };
    },

    /** Crea la proforma ya lista para picking (mínimo hasta 5.72 y el OCR). Requiere el permiso de creación. */
    async crearOrden({ cabecera = {}, lineas, pagos, usuarioId, permisos, origen = "manual" }) {
      if (!["manual", "ocr:impreso", "ocr:manuscrito"].includes(origen))
        throw new ErrorPicking("ORIGEN_INVALIDO", "Origen de carga no válido");
      const limpias = limpiarLineas(lineas);
      const doc = await documentos.crear({
        tipo: TIPO_PROFORMA.tipo, usuarioId, doc: { cabecera: limpiarCabecera(cabecera), lineas: limpias, pagos: limpiarPagos(pagos), origenCarga: origen },
      });
      await documentos.transicionar({ code: doc.code, a: "orden_salida", usuarioId, permisos });
      return doc.code;
    },
  };
  return servicio;
}

// Listas cerradas heredadas del siscore anterior (se guardan como clave, la pantalla pone el texto)
export const ENTREGAS = ["tienda", "agencia", "local"];
export const CANALES_VENTA = ["tienda", "online", "cartera"];
export const COMPROBANTES = ["factura", "boleta", "proforma"];
export const FORMAS_PAGO = ["efectivo", "deposito", "transferencia", "transferencia_y_caja", "tarjeta", "credito"];
const CERRADOS = { entrega: ENTREGAS, canalVenta: CANALES_VENTA, comprobante: COMPROBANTES, formaPago: FORMAS_PAGO };
const CAMPOS_CABECERA = [
  "referencia", "cliente", "ruc", "telefono", "email", "direccion", "provincia", "ciudad",
  "entrega", "destino", "agencia", "atencion", "canalVenta", "formaPago", "comprobante", "fecha", "vendedor", "despachador",
];

/**
 * Líneas de la proforma. Con `existentes` (edición) las que traen un `id` conocido lo conservan y las demás reciben
 * uno nuevo que no se repite; `modificadaTs` marca lo que cambió o se agregó para que el almacén lo note.
 */
export function limpiarLineas(lineas, existentes = null, ahora = new Date()) {
  if (!Array.isArray(lineas) || lineas.length === 0)
    throw new ErrorPicking("LINEAS_REQUERIDAS", "La proforma necesita al menos una línea");
  if (lineas.length > 200) throw new ErrorPicking("LINEAS_DEMASIADAS", "Hasta 200 líneas por proforma");
  const previas = new Map((existentes ?? []).map((l) => [l.id, l]));
  let siguiente = Math.max(0, ...(existentes ?? []).map((l) => Number(String(l.id).replace(/\D/g, "")) || 0));
  const usados = new Set();
  return lineas.map((l, i) => {
    const anulada = l?.anulada === true;
    const descripcion = typeof l?.descripcion === "string" ? l.descripcion.trim() : "";
    // Una línea tachada no se busca: su cantidad puede ser ilegible en el papel
    const cantidad = anulada && (l?.cantidad == null || l.cantidad === "") ? 1 : Number(l?.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || !descripcion)
      throw new ErrorPicking("LINEA_INVALIDA", `La línea ${i + 1} necesita cantidad entera y descripción`);
    const precioUnitario = l.precioUnitario == null ? null : Number(l.precioUnitario);
    if (precioUnitario != null && !(precioUnitario >= 0))
      throw new ErrorPicking("LINEA_INVALIDA", `El precio de la línea ${i + 1} no es válido`);
    const comentario = typeof l?.comentario === "string" ? l.comentario.trim().slice(0, 300) : "";
    const previa = typeof l?.id === "string" && previas.has(l.id) && !usados.has(l.id) ? previas.get(l.id) : null;
    const id = previa ? previa.id : existentes ? `L${++siguiente}` : `L${i + 1}`;
    usados.add(id);
    const base = {
      id, cantidad, descripcion, precioUnitario,
      importe: precioUnitario == null ? null : Math.round(cantidad * precioUnitario * 100) / 100,
      comentario, origen: previa?.origen ?? "libre", anulada,
    };
    if (!previa) return existentes ? { ...base, modificadaTs: ahora } : base;
    const cambio = previa.cantidad !== cantidad || previa.descripcion !== descripcion || (previa.precioUnitario ?? null) !== precioUnitario
      || (previa.comentario ?? "") !== comentario || Boolean(previa.anulada) !== anulada;
    // Si no cambió nada se conserva la marca anterior (si la tenía)
    return cambio ? { ...base, modificadaTs: ahora } : { ...base, ...(previa.modificadaTs && { modificadaTs: previa.modificadaTs }) };
  });
}

/** Solo los campos conocidos de la cabecera, como texto corto; los de lista cerrada se validan. */
export function limpiarCabecera(c) {
  const salida = {};
  for (const k of CAMPOS_CABECERA) {
    const v = c?.[k];
    if (typeof v !== "string" || !v.trim()) continue;
    const t = v.trim().slice(0, 200);
    if (CERRADOS[k] && !CERRADOS[k].includes(t))
      throw new ErrorPicking("CABECERA_INVALIDA", `Valor no válido en '${k}'`, { validos: CERRADOS[k] });
    salida[k] = t;
  }
  return salida;
}

/** Pagos recibidos al armar la proforma: { cuenta, monto, operacion }. Hasta 10. */
export function limpiarPagos(pagos) {
  if (pagos == null) return [];
  if (!Array.isArray(pagos) || pagos.length > 10) throw new ErrorPicking("PAGOS_INVALIDOS", "Los pagos deben ser una lista de hasta 10");
  return pagos.map((p, i) => {
    const monto = Number(p?.monto);
    const cuenta = typeof p?.cuenta === "string" ? p.cuenta.trim().slice(0, 60) : "";
    if (!cuenta || !(monto >= 0) || p?.monto === "" || p?.monto == null)
      throw new ErrorPicking("PAGOS_INVALIDOS", `El pago ${i + 1} necesita cuenta y monto`);
    return { cuenta, monto: Math.round(monto * 100) / 100, operacion: typeof p.operacion === "string" ? p.operacion.trim().slice(0, 40) : "" };
  });
}

// Traduce los errores conocidos a respuestas HTTP
export function responderError(e, res, next) {
  if (e instanceof ErrorPicking) {
    const http = e.codigo.endsWith("NO_ENCONTRADA") ? 404 : e.codigo === "PICKING_INCOMPLETO" || e.codigo === "ESTADO_NO_PICKING" || e.codigo === "ESTADO_NO_REVISION" || e.codigo === "ESTADO_NO_EDITABLE" ? 409 : 400;
    return res.status(http).json({ error: e.message, codigo: e.codigo, detalle: e.detalle });
  }
  if (e instanceof ErrorDocumento) {
    const http = { DOCUMENTO_NO_ENCONTRADO: 404, CONFLICTO_VERSION: 409, PERMISO_INSUFICIENTE: 403 }[e.codigo] ?? 400;
    return res.status(http).json({ error: e.message, codigo: e.codigo, detalle: e.detalle });
  }
  next(e);
}

export { ESTACIONES };
