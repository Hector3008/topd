import { TIPO_PROFORMA } from "./tipos.js";
import { ErrorPicking, lineasDelDocumento } from "./picking.js";
import { rangoDeDias, diaDe } from "./reportes.js";
import { filasDeCierre, limpiarMotivo, crearExcelRelacionales, ESTADOS_RELACIONAL } from "./relacionales.js";

const MAX_FILAS = 5000;

/** Relacionales guardados en la colección `relacionales` (la empresa activa la pone el plugin de tenancy). */
export function crearServicioRelacionales({ core, Picking, Relacional, registrar = async () => {}, zona }) {
  const { documentos } = core;

  const servicio = {
    /** Guarda (o completa) las filas de una proforma cerrada. Repetirlo no duplica ni revive filas anuladas. */
    async generar({ code }) {
      const doc = await documentos.obtener({ code });
      if (!doc || doc.tipo !== TIPO_PROFORMA.tipo) throw new ErrorPicking("PROFORMA_NO_ENCONTRADA", `No existe la proforma ${code}`);
      if (doc.estado !== "cerrada") throw new ErrorPicking("ESTADO_NO_CERRADA", `La proforma ${code} está en '${doc.estado}': los relacionales salen al cerrarla`);
      const picks = await Picking.find({ code }).lean();
      const filas = filasDeCierre({
        code, lineas: lineasDelDocumento(doc), filas: picks, cabecera: doc.payload?.doc?.cabecera ?? {},
        cerradaTs: doc.updatedAt ?? new Date(), zona,
      });
      for (const f of filas) {
        const { code: c, lineaId, codigo, ...resto } = f;
        await Relacional.findOneAndUpdate(
          { code: c, lineaId, codigo },
          { $set: resto, $setOnInsert: { estado: "vigente" } },
          { upsert: true, returnDocument: "after", lean: true },
        );
      }
      return { code, filas: filas.length };
    },

    /** Proformas cerradas antes de existir este corte (o cuyo guardado falló): completa las que no tienen filas. */
    async generarFaltantes() {
      const cerradas = await documentos.listar({ tipo: TIPO_PROFORMA.tipo, estado: ["cerrada"], limite: 200 });
      const hechas = new Set((await Relacional.find({ code: { $in: cerradas.map((d) => d.code) } }).lean()).map((r) => r.code));
      let generadas = 0, filas = 0;
      for (const d of cerradas) {
        if (hechas.has(d.code)) continue;
        const r = await servicio.generar({ code: d.code });
        if (r.filas) { generadas += 1; filas += r.filas; }
      }
      return { revisadas: cerradas.length, generadas, filas };
    },

    /** Filas entre dos días (`AAAA-MM-DD`; sin datos, los últimos 7), o de una proforma si se da `code`. */
    async listar({ desde, hasta, estado, code } = {}) {
      if (estado && !ESTADOS_RELACIONAL.includes(estado)) throw new ErrorPicking("ESTADO_INVALIDO", "El estado es vigente o anulado");
      const filtro = {};
      let r = null;
      if (code) filtro.code = String(code).slice(0, 30);
      else { r = rangoDeDias({ desde, hasta }, { zona }); filtro.fecha = { $gte: r.desde, $lte: r.hasta }; }
      if (estado) filtro.estado = estado;
      const filas = await Relacional.find(filtro).sort({ fecha: 1, code: 1, codigo: 1 }).limit(MAX_FILAS).lean();
      const vigentes = filas.filter((f) => f.estado !== "anulado");
      const suma = (xs, k) => Math.round(xs.reduce((a, f) => a + (f[k] || 0), 0) * 100) / 100;
      return {
        desde: r?.desde ?? null, hasta: r?.hasta ?? null, filas,
        totales: { filas: filas.length, vigentes: vigentes.length, anuladas: filas.length - vigentes.length, unidades: suma(vigentes, "cantidad"), importe: suma(vigentes, "importeTotal") },
      };
    },

    /** Anula todas las filas vigentes de una proforma (la venta no se concretó o se devolvió): ya no salen en la descarga. */
    async anular({ code, motivo, usuarioId }) {
      const texto = limpiarMotivo(motivo);
      const existentes = await Relacional.find({ code }).lean();
      if (!existentes.length) throw new ErrorPicking("RELACIONALES_NO_ENCONTRADOS", `La proforma ${code} no tiene relacionales`);
      const r = await Relacional.updateMany({ code, estado: "vigente" }, { $set: { estado: "anulado", anuladoTs: new Date(), anuladoMotivo: texto, anuladoPorId: usuarioId } });
      const anuladas = r?.modifiedCount ?? r?.nModified ?? 0;
      await registrar("relacionales.anulados", { code, usuarioId, datos: { motivo: texto, filas: anuladas } });
      return { code, anuladas };
    },

    /** Excel para cargar en la hoja del stock: por defecto solo lo vigente. */
    async excel({ desde, hasta, estado = "vigente" }) {
      const { filas, ...r } = await servicio.listar({ desde, hasta, estado: estado || undefined });
      return { buffer: await crearExcelRelacionales(filas), desde: r.desde, hasta: r.hasta, filas: filas.length };
    },
  };
  return servicio;
}
export { diaDe };
