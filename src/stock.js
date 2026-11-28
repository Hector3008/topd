// Sincronización de stock (5.74): convierte las filas de la hoja de cálculo (pestaña RESULT, la que leía el siscore con
// su cron) en productos del catálogo común. Lógica pura, sin red ni base de datos.
//
// Columnas de la hoja: DICTIONARY (código mostrado), CODE, LV, SJL, TOTAL, EQUIVALENTE + STOCK, NOMBRE COMERCIAL,
// FAMILIA, SUBFAMILIA, PROVEEDOR, MARCA, UBICACION, PRECIO SUGERIDO, PUNTAJE (o PUNTAJE PICKING: puntos del picking de ese ítem; vacío =
// rige el puntaje del piso). Solo se necesita DICTIONARY; las demás son opcionales.
import { createHash } from "node:crypto";
import { normalizar } from "./guia.js";

export const COLUMNAS = Object.freeze({
  DICTIONARY: "codigo", CODE: "code", LV: "lv", SJL: "sjl", TOTAL: "total", "EQUIVALENTE + STOCK": "equivalentes",
  "NOMBRE COMERCIAL": "nombre", FAMILIA: "familia", SUBFAMILIA: "subfamilia", PROVEEDOR: "proveedor", MARCA: "marca",
  UBICACION: "ubicacion", "PRECIO SUGERIDO": "precio", PUNTAJE: "puntaje", "PUNTAJE PICKING": "puntaje",
});
const CODIGO_VALIDO = /^[A-Za-z0-9._\-/]{1,40}$/;
export const ORIGEN = "hoja"; // marca de los productos que administra la hoja (los creados a mano no se desactivan solos)

const clave = (s) => normalizar(s).trim().replace(/\s+/g, " ").toUpperCase();
const COLUMNAS_CLAVE = Object.fromEntries(Object.keys(COLUMNAS).map((k) => [clave(k), COLUMNAS[k]]));

/** «1,234.50», «S/ 59.90», «59,9» → número; vacío o ilegible → null. */
export function numero(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let t = String(v ?? "").replace(/[^\d.,-]/g, "");
  if (!/\d/.test(t)) return null;
  if (t.includes(".")) t = t.replace(/,/g, "");
  else if (/,\d{1,2}$/.test(t) && (t.match(/,/g) ?? []).length === 1) t = t.replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const texto = (v, max) => { const t = String(v ?? "").trim().slice(0, max); return t === "" ? null : t; };

/** Resumen corto de lo que importa de la fila: si cambia, el producto se vuelve a enviar. */
export const huellaDe = (p) =>
  createHash("sha1").update(JSON.stringify([p.nombre, p.categoria, p.precio, p.atributos])).digest("hex").slice(0, 12);

/**
 * Filas de la hoja (primera fila = encabezados) → productos listos para `core.catalogo.importar`.
 * Devuelve { productos, descartadas: [{ fila, codigo, error }] }; `fila` es el número de fila de la hoja (1 = encabezado).
 * Lanza si falta la columna DICTIONARY (la hoja no es la esperada).
 */
export function productosDeHoja(valores) {
  if (!Array.isArray(valores) || valores.length < 1) throw new Error("La hoja no devolvió filas");
  const [encabezados, ...filas] = valores;
  const indice = {};
  encabezados.forEach((h, i) => { const c = COLUMNAS_CLAVE[clave(h)]; if (c && indice[c] === undefined) indice[c] = i; });
  if (indice.codigo === undefined) throw new Error("La hoja no tiene la columna DICTIONARY (el código del producto)");
  const dato = (fila, c) => (indice[c] === undefined ? "" : fila[indice[c]] ?? "");

  const productos = [];
  const descartadas = [];
  const vistos = new Map();
  filas.forEach((fila, n) => {
    const nFila = n + 2;
    const codigo = String(dato(fila, "codigo")).trim();
    if (!codigo) return; // filas sin código (vacías) se ignoran, como en el siscore
    if (!CODIGO_VALIDO.test(codigo)) return descartadas.push({ fila: nFila, codigo, error: "código inválido (1 a 40 caracteres: letras, números, punto, guion, guion bajo o barra)" });
    const k = codigo.toLowerCase();
    if (vistos.has(k)) return descartadas.push({ fila: nFila, codigo, error: `código repetido (ya está en la fila ${vistos.get(k)})` });
    vistos.set(k, nFila);

    const precio = numero(dato(fila, "precio"));
    const pun = numero(dato(fila, "puntaje"));
    const equivalentes = texto(dato(fila, "equivalentes"), 500);
    const p = {
      codigo,
      nombre: texto(dato(fila, "nombre"), 200) ?? codigo,
      categoria: texto(dato(fila, "familia"), 60),
      precio: precio === null || precio < 0 ? null : Math.round(precio * 100) / 100,
      atributos: {
        CODIGO_FORMATEADO: codigo,
        CODIGO: texto(dato(fila, "code"), 100),
        STOCK_LV: numero(dato(fila, "lv")),
        STOCK_SJL: numero(dato(fila, "sjl")),
        STOCK: numero(dato(fila, "total")),
        EQUIVALENTES_STOCK: equivalentes === null ? null : [equivalentes],
        FAMILIA: texto(dato(fila, "familia"), 200),
        SUBFAMILIA: texto(dato(fila, "subfamilia"), 200),
        PROVEEDOR: texto(dato(fila, "proveedor"), 200),
        MARCA: texto(dato(fila, "marca"), 200),
        UBICACION: texto(dato(fila, "ubicacion"), 200),
        PUNTAJE: pun === null || pun < 0 || pun > 1000 ? null : Math.round(pun * 100) / 100, // vacío o fuera de 0–1000: rige el del piso
        ORIGEN,
      },
    };
    p.huella = huellaDe(p);
    p.atributos.HUELLA = p.huella;
    productos.push(p);
  });
  return { productos, descartadas };
}
