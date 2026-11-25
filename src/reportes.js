// Reporte del almacén: puntajes y tiempos del picking, calculados desde las marcas (colección Picking).
// Lógica pura, sin base de datos. Cuenta las líneas RESUELTAS (encontradas o no) dentro del rango pedido.
import { ErrorPicking } from "./picking.js";

export const ZONA_POR_DEFECTO = "America/Lima";
export const MAX_DIAS_REPORTE = 92;
const DIA_MS = 24 * 3600 * 1000;

const partes = (fecha, zona) =>
  Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(fecha).map((p) => [p.type, p.value]));

/** «2026-11-23» de un instante, en la hora de la empresa. */
export function diaDe(fecha, zona = ZONA_POR_DEFECTO) {
  const p = partes(new Date(fecha), zona);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Instante (UTC) en que empieza un día «AAAA-MM-DD» en la zona dada. */
export function inicioDeDia(dia, zona = ZONA_POR_DEFECTO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia ?? "")) throw new ErrorPicking("RANGO_INVALIDO", "Las fechas van como AAAA-MM-DD");
  const [y, m, d] = dia.split("-").map(Number);
  const nominal = Date.UTC(y, m - 1, d);
  if (Number.isNaN(nominal) || diaDe(new Date(nominal + 12 * 3600 * 1000), "UTC") !== dia) throw new ErrorPicking("RANGO_INVALIDO", `La fecha ${dia} no existe`);
  // Diferencia entre la hora local y la UTC en ese día (la zona puede tener horario de verano)
  const p = partes(new Date(nominal), zona);
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return new Date(nominal - (local - nominal));
}

/** Rango [desde, hasta] de días (ambos incluidos) → { desde, hasta, ini, fin } con `fin` exclusivo. Sin datos: los últimos 7 días. */
export function rangoDeDias({ desde, hasta } = {}, { zona = ZONA_POR_DEFECTO, ahora = new Date() } = {}) {
  const fHasta = hasta || diaDe(ahora, zona);
  const fDesde = desde || diaDe(new Date(inicioDeDia(fHasta, zona).getTime() - 6 * DIA_MS + 12 * 3600 * 1000), zona);
  const ini = inicioDeDia(fDesde, zona);
  const fin = new Date(inicioDeDia(fHasta, zona).getTime() + DIA_MS + 12 * 3600 * 1000); // tras el día siguiente a mediodía…
  const finExacto = inicioDeDia(diaDe(fin, zona), zona); // …y se vuelve a su medianoche local
  if (finExacto <= ini) throw new ErrorPicking("RANGO_INVALIDO", "«Hasta» no puede ser anterior a «desde»");
  if ((finExacto - ini) / DIA_MS > MAX_DIAS_REPORTE + 1) throw new ErrorPicking("RANGO_INVALIDO", `El rango máximo es de ${MAX_DIAS_REPORTE} días`);
  return { desde: fDesde, hasta: fHasta, ini, fin: finExacto };
}

const mediana = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};
const redondeo = (n) => Math.round(n * 100) / 100;

function resumir(filas) {
  const encontradas = filas.filter((f) => f.estado === "encontrado");
  // Tiempo por línea = de la primera marca a la resolución; la mediana no se deja torcer por una línea olvidada toda la noche
  const tiempos = filas.map((f) => (f.iniciadoTs && f.resueltoTs ? new Date(f.resueltoTs) - new Date(f.iniciadoTs) : null)).filter((x) => x != null && x >= 0);
  return {
    lineas: filas.length,
    encontradas: encontradas.length,
    noEncontradas: filas.length - encontradas.length,
    puntaje: redondeo(filas.reduce((s, f) => s + (f.puntaje ?? 0), 0)),
    medianaMs: mediana(tiempos),
  };
}

/**
 * Arma el reporte desde las filas del almacén ya resueltas en el rango. `nombres` traduce el id de la persona a su nombre.
 * Las filas pendientes o en búsqueda se ignoran: todavía no hay nada que medir.
 */
/**
 * Hallazgos por piso. Una línea sacada de varias opciones cuenta un hallazgo por opción, en el piso de cada una; los puntos
 * extra de la línea (taller, muestra, foto) se atribuyen al piso de la primera opción.
 */
function porPisoDe(filas) {
  const m = new Map();
  const sumar = (piso, puntaje) => { const x = m.get(piso) ?? { piso, lineas: 0, puntaje: 0 }; x.lineas += 1; x.puntaje += puntaje; m.set(piso, x); };
  for (const f of filas) {
    if (f.sacados?.length) {
      const extras = (f.puntaje ?? 0) - f.sacados.reduce((s, x) => s + (x.puntaje ?? 0), 0);
      f.sacados.forEach((s, i) => sumar(s.piso, (s.puntaje ?? 0) + (i === 0 ? extras : 0)));
    } else if (f.piso != null) sumar(f.piso, f.puntaje ?? 0);
  }
  return [...m.values()].map((x) => ({ ...x, puntaje: redondeo(x.puntaje) })).sort((a, b) => a.piso - b.piso);
}

export function armarReporte(filas, nombres = {}, { zona = ZONA_POR_DEFECTO } = {}) {
  const hechas = (filas ?? []).filter((f) => ["encontrado", "no_encontrado"].includes(f.estado) && f.resueltoTs);
  const agrupar = (clave) => {
    const g = new Map();
    for (const f of hechas) { const k = clave(f); g.set(k, [...(g.get(k) ?? []), f]); }
    return g;
  };
  const encontradas = hechas.filter((f) => f.estado === "encontrado");
  return {
    totales: {
      ...resumir(hechas),
      taller: encontradas.filter((f) => f.taller).length,
      porMuestra: encontradas.filter((f) => f.reconocido === "muestra").length,
      porFoto: encontradas.filter((f) => f.reconocido === "foto").length,
      proformas: new Set(hechas.map((f) => f.code)).size,
    },
    porPersona: [...agrupar((f) => (f.porId ? String(f.porId) : ""))]
      .map(([id, fs]) => ({ id, nombre: nombres[id] ?? (id ? "Persona sin nombre" : "Sin registrar"), ...resumir(fs) }))
      .sort((a, b) => b.puntaje - a.puntaje || b.lineas - a.lineas),
    porPiso: porPisoDe(hechas),
    porDia: [...agrupar((f) => diaDe(f.resueltoTs, zona))]
      .map(([dia, fs]) => ({ dia, ...resumir(fs) }))
      .sort((a, b) => a.dia.localeCompare(b.dia)),
  };
}

const HECHA = ["encontrado", "no_encontrado"];

/**
 * Vista del supervisor: cómo va el día en el almacén. Mezcla lo ya resuelto hoy (`filasDia`, filas de Picking) con lo que
 * está en cola (`activas`, proformas en orden_salida con sus líneas y avance). Lógica pura; el servicio le pasa los datos.
 * `listasHoy`: proformas que hoy salieron del almacén (pasaron a revisión o se cerraron).
 */
export function armarSupervisor({ activas = [], filasDia = [], listasHoy = 0, nombres = {}, ahora = new Date(), zona = ZONA_POR_DEFECTO } = {}) {
  const t0 = new Date(ahora).getTime();
  const nombre = (id) => (id ? nombres[String(id)] ?? "Persona sin nombre" : "Sin registrar");
  const dia = armarReporte(filasDia, nombres, { zona });

  const lineasActivas = activas.flatMap((p) => p.lineas.map((l) => ({ p, l })));
  const pendientes = lineasActivas.filter(({ l }) => !HECHA.includes(l.picking.estado));
  const enBusqueda = pendientes.filter(({ l }) => l.picking.estado === "buscando");

  // Qué se está buscando ahora y quién lo busca (lo más antiguo primero)
  const enCurso = enBusqueda
    .map(({ p, l }) => ({
      code: p.code, lineaId: l.id, cantidad: l.cantidad, descripcion: l.descripcion, cliente: p.cabecera?.cliente ?? "",
      personaId: l.picking.porId ? String(l.picking.porId) : "", persona: nombre(l.picking.porId),
      desdeMs: l.picking.iniciadoTs ? Math.max(0, t0 - new Date(l.picking.iniciadoTs).getTime()) : null,
    }))
    .sort((a, b) => (b.desdeMs ?? -1) - (a.desdeMs ?? -1));

  // Cada persona: qué tiene en la mano, qué resolvió hoy y cuándo fue su última marca
  const gente = new Map();
  const de = (id) => { const k = id ? String(id) : ""; if (!gente.has(k)) gente.set(k, { id: k, nombre: nombre(k), buscando: 0, resueltasHoy: 0, puntajeHoy: 0, ultimaTs: null }); return gente.get(k); };
  const ultima = (g, ts) => { if (ts && (!g.ultimaTs || new Date(ts) > new Date(g.ultimaTs))) g.ultimaTs = new Date(ts).toISOString(); };
  for (const x of dia.porPersona) { const g = de(x.id); g.resueltasHoy = x.lineas; g.puntajeHoy = x.puntaje; }
  for (const f of filasDia) if (HECHA.includes(f.estado)) ultima(de(f.porId), f.resueltoTs);
  for (const { l } of enBusqueda) { const g = de(l.picking.porId); g.buscando += 1; ultima(g, l.picking.iniciadoTs); }
  const personas = [...gente.values()].sort((a, b) => b.buscando - a.buscando || b.puntajeHoy - a.puntajeHoy);

  const proformas = activas.map((p) => {
    const hechas = p.lineas.filter((l) => HECHA.includes(l.picking.estado)).length;
    const buscando = p.lineas.filter((l) => l.picking.estado === "buscando").length;
    const quienes = [...new Set(p.lineas.filter((l) => l.picking.porId && l.picking.estado !== "pendiente").map((l) => nombre(l.picking.porId)))];
    return {
      code: p.code, cliente: p.cabecera?.cliente ?? "", entrega: p.cabecera?.entrega ?? "", creadaTs: p.creadaTs,
      esperaMs: p.creadaTs ? Math.max(0, t0 - new Date(p.creadaTs).getTime()) : null,
      total: p.lineas.length, resueltas: hechas, buscando, sinTocar: p.lineas.length - hechas - buscando,
      porcentaje: p.lineas.length ? Math.round((hechas / p.lineas.length) * 100) : 0, completa: p.avance?.completo ?? false, personas: quienes,
      lineas: p.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, descripcion: l.descripcion, estado: l.picking.estado, piso: l.picking.piso, puntaje: l.picking.puntaje, persona: l.picking.porId && l.picking.estado !== "pendiente" ? nombre(l.picking.porId) : "" })),
    };
  }).sort((a, b) => (b.esperaMs ?? -1) - (a.esperaMs ?? -1)); // la que más espera, primero

  // Ritmo de la última hora y cuánto tardaría lo que queda a ese ritmo (solo es un estimado)
  const ultimaHora = filasDia.filter((f) => HECHA.includes(f.estado) && f.resueltoTs && t0 - new Date(f.resueltoTs).getTime() <= 3600 * 1000).length;
  const porHora = Array.from({ length: 24 }, (_, h) => ({ hora: String(h).padStart(2, "0"), lineas: 0, puntaje: 0 }));
  for (const f of filasDia) if (HECHA.includes(f.estado) && f.resueltoTs) { const h = Number(partes(new Date(f.resueltoTs), zona).hour); porHora[h].lineas += 1; porHora[h].puntaje = redondeo(porHora[h].puntaje + (f.puntaje ?? 0)); }

  return {
    hoy: dia.totales, porPiso: dia.porPiso, porHora: porHora.filter((h) => h.lineas > 0),
    cola: {
      proformas: activas.length, listasParaPasar: proformas.filter((p) => p.completa).length,
      lineasPendientes: pendientes.length, enBusqueda: enBusqueda.length, sinTocar: pendientes.length - enBusqueda.length,
      listasHoy,
    },
    ritmo: { ultimaHora, restanteMin: ultimaHora > 0 && pendientes.length ? Math.round((pendientes.length / ultimaHora) * 60) : null },
    personas, enCurso, proformas,
  };
}
