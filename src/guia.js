// Guía de almacén: para cada línea de la proforma, las opciones del catálogo donde aparecen las palabras de su
// descripción. Es la lógica del siscore anterior: se parte la descripción en palabras y sirve cada producto del catálogo
// cuyo texto (código, descripción, proveedor, marca, familia, subfamilia) contiene TODAS las palabras. Si sale uno,
// se muestra uno; si salen cuatro o cinco, las cuatro o cinco. Lógica pura: el servicio le pasa el catálogo.

export const MAX_OPCIONES = 20; // por línea; se informa el total real para decir «y N más»

/** Minúsculas y sin tildes: «Bujía» y «bujia» son lo mismo al buscar. */
export const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const atr = (i, k) => i.atributos?.[k] ?? "";

/** Lo que se puede encontrar de un producto: sus códigos y datos de clasificación, en un solo texto. */
export const textoDeBusqueda = (i) =>
  normalizar([i.codigo, atr(i, "CODIGO_FORMATEADO"), atr(i, "CODIGO"), i.nombre, atr(i, "PROVEEDOR"), atr(i, "MARCA"), atr(i, "SUBFAMILIA"), atr(i, "FAMILIA"), i.categoria].join(" "));

/** El producto como lo muestra la guía (los mismos datos que mostraba el siscore). */
export function opcionDeItem(i) {
  const eq = atr(i, "EQUIVALENTES_STOCK");
  return {
    id: i.id ?? null, codigo: atr(i, "CODIGO_FORMATEADO") || i.codigo, descripcion: i.nombre,
    familia: atr(i, "FAMILIA"), subfamilia: atr(i, "SUBFAMILIA"), proveedor: atr(i, "PROVEEDOR"), marca: atr(i, "MARCA"),
    stockLV: atr(i, "STOCK_LV"), stockSJL: atr(i, "STOCK_SJL"), ubicacion: atr(i, "UBICACION"),
    equivalentes: Array.isArray(eq) ? eq.join(", ") : String(eq ?? ""),
    precioSugerido: i.precio ?? (atr(i, "PRECIO_SUGERIDO") === "" ? null : atr(i, "PRECIO_SUGERIDO")),
  };
}

/** Prepara el catálogo para buscar muchas veces sin recalcular el texto de cada producto. */
export const indexar = (items) => items.filter((i) => i.activo !== false).map((item) => ({ item, texto: textoDeBusqueda(item) }));

function coincidencias(indice, texto) {
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
  if (!palabras.length) return [];
  return indice.filter(({ texto: t }) => palabras.every((p) => t.includes(p))).map((x) => x.item);
}

/**
 * Opciones de una línea. Si trae `codMax` (el código del catálogo, que viene de los archivos) se busca primero por él,
 * porque es exacto; si no da nada, o no hay código, se busca por la descripción como en el siscore.
 * Devuelve { opciones (hasta `max`), total, por: "codigo" | "descripcion" | null }; total 0 = «no encontrado».
 */
export function buscarOpciones(indice, { descripcion = "", codMax = "" } = {}, { max = MAX_OPCIONES } = {}) {
  for (const [por, texto] of [["codigo", codMax], ["descripcion", descripcion]]) {
    if (!String(texto ?? "").trim()) continue;
    const hallados = coincidencias(indice, texto);
    if (hallados.length) return { opciones: hallados.slice(0, max).map(opcionDeItem), total: hallados.length, por };
  }
  return { opciones: [], total: 0, por: null };
}
