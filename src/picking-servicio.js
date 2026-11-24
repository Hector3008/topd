import { ErrorDocumento } from "core";
import { TIPO_PROFORMA, ESTACIONES } from "./tipos.js";
import { armarReporte, rangoDeDias } from "./reportes.js";
import { configPorDefecto, limpiarConfig, puntajesDe, copiaDeEmisor } from "./config.js";
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
export function crearServicioPicking({ core, Picking, Config = null, puntajesPiso = PUNTAJES_PISO }) {
  const { documentos, modelos } = core;
  // Estados a los que se puede mandar una proforma desde la estación de creación (el motor valida el permiso y el motivo)
  const DESTINOS = ["cotizacion", "orden_salida", "descartado", "rechazada", "vencida"];

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
    /** Configuración vigente de la empresa (pisos, puntajes, emisores); si nunca se guardó, la de por defecto. */
    async config() {
      const base = configPorDefecto(puntajesPiso);
      if (!Config) return base;
      const fila = await Config.findOne({ clave: "topd" }).lean();
      return fila?.datos ? { ...base, ...fila.datos } : base;
    },

    /** Lo que necesita una pantalla del almacén para pintar los pisos: tabla { piso: puntaje } y extras. */
    async puntajes() {
      const c = await servicio.config();
      return { puntajesPiso: puntajesDe(c), extras: c.extras };
    },

    async guardarConfig({ entrada, usuarioId }) {
      if (!Config) throw new ErrorPicking("CONFIG_NO_DISPONIBLE", "La configuración no está disponible");
      const nueva = limpiarConfig(entrada, await servicio.config());
      await Config.findOneAndUpdate({ clave: "topd" }, { $set: { datos: nueva, porId: usuarioId } }, { upsert: true, returnDocument: "after", lean: true });
      await registrarEvento("config.guardada", { code: undefined, usuarioId, estacion: "configuracion", datos: { pisos: nueva.pisos.length, emisores: nueva.emisores.length, extras: nueva.extras } });
      return nueva;
    },

    /**
     * Puntajes y tiempos del almacén entre dos días (`AAAA-MM-DD`, ambos incluidos, en la hora de la empresa; sin datos,
     * los últimos 7 días). Cuenta las líneas resueltas en el rango.
     */
    async reportePicking({ desde, hasta, zona } = {}) {
      const r = rangoDeDias({ desde, hasta }, { zona });
      const filas = await Picking.find({ estado: { $in: ["encontrado", "no_encontrado"] }, resueltoTs: { $gte: r.ini, $lt: r.fin } }).lean();
      const ids = [...new Set(filas.map((f) => (f.porId ? String(f.porId) : "")).filter(Boolean))];
      let nombres = {};
      if (ids.length && modelos.Usuario) {
        try {
          const us = await modelos.Usuario.find({ _id: { $in: ids } }).select("nombre correo").lean();
          nombres = Object.fromEntries(us.map((u) => [String(u._id), u.nombre || u.correo]));
        } catch (e) { console.error("topd: no se pudieron leer los nombres del reporte", e); }
      }
      return { desde: r.desde, hasta: r.hasta, ...armarReporte(filas, nombres, { zona }) };
    },

    /** Proformas en uno o más estados, con el avance de cada línea (la más antigua primero, salvo `recientes`). */
    async listar({ estados = [ESTADO_PICKING], limite = 100, recientes = false, conPagos = false } = {}) {
      const docs = await documentos.listar({ tipo: TIPO_PROFORMA.tipo, estado: estados, limite });
      if (!docs.length) return [];
      const filas = await Picking.find({ code: { $in: docs.map((d) => d.code) } }).lean();
      return (recientes ? docs : docs.reverse()).map((d) => {
        const lineas = combinarAvance(lineasDelDocumento(d), filas.filter((f) => f.code === d.code));
        return {
          code: d.code, estado: d.estado, version: d.version, editable: ESTADOS_EDITABLES.includes(d.estado), creadaTs: d.createdAt, actualizadaTs: d.updatedAt,
          cabecera: d.payload?.doc?.cabecera ?? {}, origenCarga: d.payload?.doc?.origenCarga ?? "manual", emisor: d.payload?.doc?.emisor ?? null,
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
      const cfg = await servicio.config();
      const fila = aplicarMarca(actual, cambio, { linea, puntajesPiso: puntajesDe(cfg), extras: cfg.extras });
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
        cabecera: d.cabecera ?? {}, origenCarga: d.origenCarga ?? "manual", pagos: d.pagos ?? [], emisor: d.emisor ?? null,
        lineas: (d.lineas ?? []).map((l, i) => ({ ...l, id: l.id ?? `L${i + 1}` })),
      };
    },

    /**
     * Corrige una proforma (nueva versión; la anterior queda guardada en el núcleo). Las líneas que vienen con su `id`
     * se conservan; las sin id son nuevas. El avance del almacén se reinicia solo en las líneas cuyo fondo cambió
     * (cantidad, descripción, tachada) o que se quitaron: precio y comentario no obligan a buscar de nuevo.
     */
    async editar({ code, cabecera = {}, lineas, pagos, emisorId, esperaVersion, usuarioId }) {
      if (!Number.isInteger(esperaVersion))
        throw new ErrorPicking("VERSION_REQUERIDA", "Falta la versión que se está editando");
      const doc = await cargarProforma(code);
      if (!ESTADOS_EDITABLES.includes(doc.estado))
        throw new ErrorPicking("ESTADO_NO_EDITABLE", `La proforma ${code} está en '${doc.estado}' y ya no se puede editar`);
      const d = doc.payload?.doc ?? {};
      const anteriores = (d.lineas ?? []).map((l, i) => ({ ...l, id: l.id ?? `L${i + 1}` }));
      const ahora = new Date();
      const nuevas = limpiarLineas(lineas, anteriores, ahora, { permitirVacio: doc.estado === "borrador" });
      // emisorId sin definir conserva el emisor; "" lo quita; un id lo cambia (copia de sus datos de hoy)
      const emisorNuevo = emisorId === undefined ? (d.emisor ?? null) : copiaDeEmisor(await servicio.config(), emisorId);
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
        && JSON.stringify(d.pagos ?? []) === JSON.stringify(pagosNuevos) && JSON.stringify(d.emisor ?? null) === JSON.stringify(emisorNuevo);
      if (sinCambios) return { code, estado: doc.estado, version: doc.version, sinCambios: true, reiniciadas: [] };

      const nuevo = await documentos.nuevaVersion({
        code, usuarioId, esperaVersion,
        doc: { ...d, cabecera: cabeceraNueva, lineas: nuevas, pagos: pagosNuevos, emisor: emisorNuevo },
      });
      if (reiniciar.length) await Picking.deleteMany({ code, lineaId: { $in: reiniciar } });
      await registrarEvento("proforma.editada", {
        code, usuarioId, estacion: "creacion",
        datos: { version: nuevo.version, campos: camposCambiados, lineasNuevas: agregadas, lineasModificadas: modificadas, lineasQuitadas: reiniciar.filter((id) => !quedan.has(id)).length, reiniciadas: reiniciar },
      });
      return { code, estado: nuevo.estado, version: nuevo.version, reiniciadas: reiniciar };
    },

    /**
     * Crea la proforma. `destino` dice hasta dónde llega: «borrador» (se guarda sin mandar a nadie; puede ir incompleta),
     * «cotizacion» (se ofrece al cliente) u «orden_salida» (pasa al almacén; es lo de siempre). Requiere el permiso de creación.
     */
    async crearOrden({ cabecera = {}, lineas, pagos, emisorId, destino = "orden_salida", usuarioId, permisos, origen = "manual" }) {
      if (!["manual", "ocr:impreso", "ocr:manuscrito", "archivo:xlsx", "archivo:pdf"].includes(origen))
        throw new ErrorPicking("ORIGEN_INVALIDO", "Origen de carga no válido");
      if (!["borrador", "cotizacion", "orden_salida"].includes(destino))
        throw new ErrorPicking("DESTINO_INVALIDO", "El destino debe ser borrador, cotizacion u orden_salida");
      const limpias = limpiarLineas(lineas, null, undefined, { permitirVacio: destino === "borrador" });
      const emisor = copiaDeEmisor(await servicio.config(), emisorId);
      const doc = await documentos.crear({
        tipo: TIPO_PROFORMA.tipo, usuarioId,
        doc: { cabecera: limpiarCabecera(cabecera), lineas: limpias, pagos: limpiarPagos(pagos), emisor, origenCarga: origen },
      });
      if (destino !== "borrador") await documentos.transicionar({ code: doc.code, a: destino, usuarioId, permisos });
      return { code: doc.code, estado: destino };
    },

    /**
     * Mueve una proforma entre estados desde la estación de creación: mandar a cotización o al almacén, y cerrarla sin
     * vender (descartada, rechazada, vencida) con su motivo `{ codigo, detalle? }`. El motor valida la transición,
     * el permiso y el motivo; aquí se exige que haya líneas para ofrecerla o mandarla al almacén.
     */
    async cambiarEstado({ code, a, motivo, esperaVersion, usuarioId, permisos }) {
      if (!DESTINOS.includes(a)) throw new ErrorPicking("DESTINO_INVALIDO", `No se puede pasar a '${a}' desde aquí`, { validos: DESTINOS });
      const doc = await cargarProforma(code);
      if (!ESTADOS_EDITABLES.includes(doc.estado))
        throw new ErrorPicking("ESTADO_NO_EDITABLE", `La proforma ${code} está en '${doc.estado}': ya no se puede mover desde aquí`);
      if ((a === "cotizacion" || a === "orden_salida") && !lineasDelDocumento(doc).length)
        throw new ErrorPicking("LINEAS_REQUERIDAS", "Agrega al menos una línea antes de continuar");
      const nuevo = await documentos.transicionar({ code, a, ...(motivo && { motivo }), usuarioId, permisos, esperaVersion: esperaVersion ?? doc.version });
      return { code, estado: nuevo.estado, version: nuevo.version };
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
export function limpiarLineas(lineas, existentes = null, ahora = new Date(), { permitirVacio = false } = {}) {
  if (permitirVacio && (lineas == null || (Array.isArray(lineas) && lineas.length === 0))) return []; // un borrador puede ir sin líneas
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
    // Datos de catálogo que trae el archivo (modelo, código Max, proveedor, familia): texto corto, opcional
    const catalogo = Object.fromEntries(["modelo", "codMax", "proveedor", "familia"]
      .map((k) => [k, typeof l?.[k] === "string" ? l[k].trim().slice(0, 120) : ""]).filter(([, v]) => v));
    const base = {
      id, cantidad, descripcion, precioUnitario, ...catalogo,
      importe: precioUnitario == null ? null : Math.round(cantidad * precioUnitario * 100) / 100,
      comentario, origen: previa?.origen ?? "libre", anulada,
    };
    if (!previa) return existentes ? { ...base, modificadaTs: ahora } : base;
    const cambio = ["modelo", "codMax", "proveedor", "familia"].some((k) => (previa[k] ?? "") !== (catalogo[k] ?? "")) || previa.cantidad !== cantidad || previa.descripcion !== descripcion || (previa.precioUnitario ?? null) !== precioUnitario
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
