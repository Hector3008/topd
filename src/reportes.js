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
    porPiso: [...agrupar((f) => f.piso)].filter(([p]) => p != null)
      .map(([piso, fs]) => ({ piso, lineas: fs.length, puntaje: redondeo(fs.reduce((s, f) => s + (f.puntaje ?? 0), 0)) }))
      .sort((a, b) => a.piso - b.piso),
    porDia: [...agrupar((f) => diaDe(f.resueltoTs, zona))]
      .map(([dia, fs]) => ({ dia, ...resumir(fs) }))
      .sort((a, b) => a.dia.localeCompare(b.dia)),
  };
}
