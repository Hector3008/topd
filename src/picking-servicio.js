import { ErrorDocumento } from "core";
import { TIPO_PROFORMA, ESTACIONES } from "./tipos.js";
import {
  ErrorPicking, PUNTAJES_PISO, lineasDelDocumento, aplicarMarca, combinarAvance, resumenAvance,
} from "./picking.js";

const ESTADO_PICKING = "orden_salida"; // la proforma que el almacén tiene delante

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

  async function registrarEvento(tipo, { code, usuarioId, datos }) {
    // El evento no debe romper la marca ya guardada
    try {
      await modelos.Evento.create({
        usuarioId, documentoCode: code, tipoDocumento: TIPO_PROFORMA.tipo, estacion: "produccion",
        tipo, origen: "servidor", ts: new Date(), recibidoTs: new Date(), datos,
      });
    } catch (e) {
      console.error("topd: no se pudo guardar el evento de picking", e);
    }
  }

  return {
    /** Proformas activas para el almacén, con el avance de cada línea. */
    async activas({ limite = 100 } = {}) {
      const docs = await documentos.listar({ tipo: TIPO_PROFORMA.tipo, estado: ESTADO_PICKING, limite });
      if (!docs.length) return [];
      const filas = await Picking.find({ code: { $in: docs.map((d) => d.code) } }).lean();
      return docs
        .reverse() // la más antigua primero: es la que lleva más tiempo esperando
        .map((d) => {
          const lineas = combinarAvance(lineasDelDocumento(d), filas.filter((f) => f.code === d.code));
          return {
            code: d.code, estado: d.estado, version: d.version, creadaTs: d.createdAt,
            cabecera: d.payload?.doc?.cabecera ?? {}, lineas, avance: resumenAvance(lineas),
          };
        });
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

    /** Crea la proforma ya lista para picking (mínimo hasta 5.72 y el OCR). Requiere el permiso de creación. */
    async crearOrden({ cabecera = {}, lineas, usuarioId, permisos, origen = "manual" }) {
      if (!Array.isArray(lineas) || lineas.length === 0)
        throw new ErrorPicking("LINEAS_REQUERIDAS", "La proforma necesita al menos una línea");
      const limpias = lineas.map((l, i) => {
        const cantidad = Number(l?.cantidad);
        const descripcion = typeof l?.descripcion === "string" ? l.descripcion.trim() : "";
        if (!Number.isInteger(cantidad) || cantidad < 1 || !descripcion)
          throw new ErrorPicking("LINEA_INVALIDA", `La línea ${i + 1} necesita cantidad entera y descripción`);
        const precioUnitario = l.precioUnitario == null ? null : Number(l.precioUnitario);
        return {
          id: `L${i + 1}`, cantidad, descripcion, precioUnitario,
          importe: precioUnitario == null ? null : Math.round(cantidad * precioUnitario * 100) / 100,
          origen: "libre", anulada: l.anulada === true,
        };
      });
      const doc = await documentos.crear({
        tipo: TIPO_PROFORMA.tipo, usuarioId, doc: { cabecera, lineas: limpias, origenCarga: origen },
      });
      await documentos.transicionar({ code: doc.code, a: "orden_salida", usuarioId, permisos });
      return doc.code;
    },
  };
}

// Traduce los errores conocidos a respuestas HTTP
export function responderError(e, res, next) {
  if (e instanceof ErrorPicking) {
    const http = e.codigo.endsWith("NO_ENCONTRADA") ? 404 : e.codigo === "PICKING_INCOMPLETO" || e.codigo === "ESTADO_NO_PICKING" ? 409 : 400;
    return res.status(http).json({ error: e.message, codigo: e.codigo, detalle: e.detalle });
  }
  if (e instanceof ErrorDocumento) {
    const http = { DOCUMENTO_NO_ENCONTRADO: 404, CONFLICTO_VERSION: 409, PERMISO_INSUFICIENTE: 403 }[e.codigo] ?? 400;
    return res.status(http).json({ error: e.message, codigo: e.codigo, detalle: e.detalle });
  }
  next(e);
}

export { ESTACIONES };
