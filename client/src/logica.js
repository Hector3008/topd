// Lógica pura del front de topd (sin React ni red), para poder probarla con `node --test`.

export const ESTADOS = {
  pendiente: "Pendiente",
  buscando: "Buscando",
  encontrado: "Encontrado",
  no_encontrado: "No hay",
};

/** Mismo criterio que el servidor (core/permisos.js): "*" · "recurso:*" · exacto. */
export function permite(permisos, requerido) {
  const [recurso] = requerido.split(":");
  return (permisos ?? []).some((p) => p === "*" || p === requerido || p === `${recurso}:*`);
}

export const puedeAlmacen = (p) => permite(p, "estacion:produccion");
export const puedeCrear = (p) => permite(p, "estacion:creacion");

export const resuelta = (l) => ["encontrado", "no_encontrado"].includes(l.picking?.estado);

/** Pisos disponibles, de menor a mayor, desde la tabla { "1": 1, "2": 2 } que manda el servidor. */
export function pisosDe(puntajesPiso) {
  return Object.entries(puntajesPiso ?? {})
    .map(([piso, puntos]) => ({ piso: Number(piso), puntos }))
    .sort((a, b) => a.piso - b.piso);
}

export function haceCuanto(ts, ahora = Date.now()) {
  if (!ts) return "";
  const min = Math.max(0, Math.round((ahora - new Date(ts).getTime()) / 60000));
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
}

export const dinero = (n) => (n == null || Number.isNaN(Number(n)) ? "" : Number(n).toFixed(2));

/** Cambio parcial que se envía al servidor al tocar un botón de estado. */
export function cambioDeEstado(estado, piso) {
  if (estado === "encontrado") return { estado, piso };
  return { estado };
}

export const CAMPOS_CABECERA = [
  ["cliente", "Cliente"], ["direccion", "Dirección"], ["ciudad", "Ciudad"], ["agencia", "Agencia"],
  ["fecha", "Fecha"], ["numero", "N.º del papel"], ["vendedor", "Vendedor"], ["despachador", "Despachador"],
];
export const cabeceraVacia = () => ({ cliente: "", direccion: "", ciudad: "", agencia: "", fecha: "", numero: "", vendedor: "", despachador: "", formaPago: "" });

/** Tamaño al que se reduce la foto antes de enviarla (lado mayor `max`), sin agrandar nunca. */
export function reducirDimensiones(ancho, alto, max = 1600) {
  const escala = Math.min(1, max / Math.max(ancho, alto));
  return { ancho: Math.round(ancho * escala), alto: Math.round(alto * escala) };
}

/** Pasa la lectura del servidor al estado del formulario (todo texto, para poder editarlo). */
export function formularioDeLectura(lectura) {
  const cabecera = { ...cabeceraVacia() };
  for (const [k, v] of Object.entries(lectura?.cabecera ?? {})) if (k in cabecera && v != null) cabecera[k] = String(v);
  const lineas = (lectura?.lineas ?? []).map((l) => ({
    cantidad: l.cantidad == null ? "" : String(l.cantidad),
    descripcion: l.descripcion ?? "",
    precioUnitario: l.precioUnitario == null ? "" : String(l.precioUnitario),
    anulada: l.anulada === true,
    dudoso: l.dudoso === true,
  }));
  return { cabecera, lineas, total: lectura?.total ?? null, avisos: lectura?.avisos ?? [] };
}

/** Suma de las líneas no tachadas con lo que hay escrito en el formulario. */
export const sumaDelFormulario = (lineas) =>
  Math.round(lineas.filter((l) => !l.anulada).reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precioUnitario) || 0), 0) * 100) / 100;

/** Validación del formulario de nueva proforma; devuelve { cabecera, lineas } limpias o { error }. */
export function prepararProforma({ cabecera = {}, lineas }) {
  const limpias = [];
  for (const [i, l] of lineas.entries()) {
    const vacia = !String(l.cantidad ?? "").trim() && !String(l.descripcion ?? "").trim() && !String(l.precioUnitario ?? "").trim();
    if (vacia) continue;
    const descripcion = String(l.descripcion ?? "").trim();
    // Una línea tachada no se busca: basta con su descripción (la cantidad puede ser ilegible en el papel)
    const cantidad = l.anulada && !String(l.cantidad ?? "").trim() ? 1 : Number(l.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || !descripcion)
      return { error: `La línea ${i + 1} necesita cantidad entera y descripción.` };
    const precio = String(l.precioUnitario ?? "").trim();
    if (precio !== "" && !(Number(precio) >= 0)) return { error: `El precio de la línea ${i + 1} no es válido.` };
    limpias.push({ cantidad, descripcion, precioUnitario: precio === "" ? null : Number(precio), anulada: l.anulada === true });
  }
  if (!limpias.length) return { error: "Agrega al menos una línea." };
  const limpia = {};
  for (const [k, v] of Object.entries(cabecera)) if (typeof v === "string" && v.trim()) limpia[k] = v.trim();
  return { cabecera: limpia, lineas: limpias };
}
