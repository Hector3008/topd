import { buscarOpciones, indexar, MAX_OPCIONES } from "./guia.js";
import { ErrorPicking } from "./picking.js";

const TTL_MS = 5 * 60 * 1000; // el catálogo se vuelve a leer cada 5 minutos (cambia con la sincronización de stock)
const PAGINA = 200;           // máximo que entrega core.catalogo.listar por llamada
const MAX_ITEMS = 20000;      // tope de seguridad al leer el catálogo
const MAX_LINEAS = 100;

/** Busca en el catálogo común (core.catalogo) las opciones de cada línea. Guarda el catálogo en memoria por empresa. */
export function crearServicioGuia({ core, ahora = () => Date.now() }) {
  const cache = new Map(); // empresaId → { ts, indice }

  async function indice(empresaId) {
    const c = cache.get(empresaId);
    if (c && ahora() - c.ts < TTL_MS) return c;
    const items = [];
    for (let saltar = 0; items.length < MAX_ITEMS; saltar += PAGINA) {
      const pag = await core.catalogo.listar({ empresaId, limite: PAGINA, saltar });
      items.push(...pag);
      if (pag.length < PAGINA) break;
    }
    const nuevo = { ts: ahora(), indice: indexar(items), total: items.length };
    cache.set(empresaId, nuevo);
    return nuevo;
  }

  return {
    /** lineas: [{ k, descripcion, codMax, excluir? }] → { catalogo: { total }, lineas: { [k]: { opciones, total, por } } } */
    async opciones({ empresaId, lineas, max = MAX_OPCIONES }) {
      if (!Array.isArray(lineas) || lineas.length > MAX_LINEAS) throw new ErrorPicking("LINEAS_INVALIDAS", `Envía hasta ${MAX_LINEAS} líneas`);
      const { indice: idx, total } = await indice(empresaId);
      const salida = {};
      for (const l of lineas) {
        if (l == null || typeof l.k !== "string" || l.k.length > 40) throw new ErrorPicking("LINEAS_INVALIDAS", "Cada línea necesita una clave `k`");
        const excluir = (Array.isArray(l.excluir) ? l.excluir : []).filter((c) => typeof c === "string").slice(0, 50).map((c) => c.slice(0, 40));
        salida[l.k] = buscarOpciones(idx, { descripcion: String(l.descripcion ?? "").slice(0, 200), codMax: String(l.codMax ?? "").slice(0, 80), excluir }, { max });
      }
      return { catalogo: { total }, lineas: salida };
    },
    /** Puntos propios de picking de los ítems con esos códigos (columnas PUNTAJE y ACUMULA de la hoja): { codigo: { puntaje, acumula } }; los que no tienen ninguno no salen. */
    async puntajesDe({ empresaId, codigos }) {
      const quiero = new Set((Array.isArray(codigos) ? codigos : []).filter((c) => typeof c === "string").map((c) => c.trim().slice(0, 40)));
      const salida = {};
      if (!quiero.size) return salida;
      const { indice: idx } = await indice(empresaId);
      for (const { item } of idx) {
        const p = item.atributos?.PUNTAJE;
        const a = item.atributos?.PUNTAJE_ACUMULA;
        if (!Number.isFinite(p) && typeof a !== "boolean") continue;
        const info = { puntaje: Number.isFinite(p) ? p : null, acumula: typeof a === "boolean" ? a : null };
        for (const c of [item.atributos?.CODIGO_FORMATEADO, item.codigo]) if (c && quiero.has(c)) salida[c] = info;
      }
      return salida;
    },
    /** Olvida el catálogo guardado (para probar o tras una importación). */
    olvidar(empresaId) { empresaId === undefined ? cache.clear() : cache.delete(empresaId); },
  };
}
