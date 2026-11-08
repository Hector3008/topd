// Atributos del repuesto en el catálogo común (core.catalogo): lo que siscore guardaba en Producto y el
// núcleo no tiene como campo propio. Código, nombre, categoría y precio son del núcleo; esto va en `atributos`
// (máximo 4 KB por ítem). El stock se sincroniza desde la hoja de cálculo (5.74).
//   FAMILIA → categoría del núcleo si hace falta; se conserva también aquí para filtrar como antes.
export const CAMPOS_REPUESTO = Object.freeze({
  FAMILIA: "texto",
  SUBFAMILIA: "texto",
  PROVEEDOR: "texto",
  MARCA: "texto",
  UBICACION: "texto",
  STOCK_LV: "numero",
  STOCK_SJL: "numero",
  STOCK: "numero",
  EQUIVALENTES_STOCK: "lista",
  PRECIO_SUGERIDO: "numero",
});
