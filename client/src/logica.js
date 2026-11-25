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
export const puedeRevisar = (p) => permite(p, "estacion:revision");
export const puedeBandeja = (p) => permite(p, "estacion:bandeja");
export const puedeSupervisar = (p) => permite(p, "estacion:supervision");
export const puedeConfigurar = (p) => permite(p, "estacion:configuracion");

export const ESTADOS_PROFORMA = {
  borrador: "Borrador", cotizacion: "Cotización", orden_salida: "En almacén", orden_revision: "Por revisar",
  cerrada: "Cerrada", descartado: "Descartada", rechazada: "Rechazada", vencida: "Vencida",
};

/** Lo que pasó con una línea, en una frase: «Piso 3 · taller · por foto · trajo 1 de 2». */
export function resultadoDeLinea(l) {
  const p = l.picking ?? {};
  if (p.estado === "no_encontrado") return "No se encontró";
  if (p.estado !== "encontrado") return ESTADOS[p.estado] ?? "Pendiente";
  const partes = [`Piso ${p.piso}`];
  if (p.taller) partes.push("pasó por taller");
  if (p.reconocido) partes.push(p.reconocido === "foto" ? "reconocido por foto" : "reconocido por muestra");
  if (p.cantidadEncontrada !== l.cantidad) partes.push(`trajo ${p.cantidadEncontrada} de ${l.cantidad}`);
  return partes.join(" · ");
}

/** Líneas que merecen un vistazo del revisor: faltantes, cantidades distintas o notas. */
export const requiereAtencion = (l) =>
  l.picking?.estado === "no_encontrado" || (l.picking?.estado === "encontrado" && l.picking.cantidadEncontrada !== l.cantidad) || Boolean(l.picking?.nota);

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

/** Duración corta para tiempos del almacén: 45 s · 3 min 20 s · 1 h 05 min. Sin dato: «—». */
export function duracion(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export const dinero = (n) => (n == null || Number.isNaN(Number(n)) ? "" : Number(n).toFixed(2));

/** Cambio parcial que se envía al servidor al tocar un botón de estado. */
export function cambioDeEstado(estado, piso) {
  if (estado === "encontrado") return { estado, piso };
  return { estado };
}

// Campos de la cabecera por sección. Los de lista cerrada llevan sus opciones (clave que se guarda → texto que se ve).
// Vienen del siscore anterior; las claves coinciden con las que valida el servidor.
export const ENTREGAS = [["tienda", "Tienda"], ["agencia", "Agencia"], ["local", "Local"]];
export const CANALES_VENTA = [["tienda", "Tienda"], ["online", "Online"], ["cartera", "Cartera"]];
export const COMPROBANTES = [["factura", "Factura"], ["boleta", "Boleta"], ["proforma", "Proforma"]];
export const FORMAS_PAGO = [["efectivo", "Caja / efectivo"], ["deposito", "Depósito"], ["transferencia", "Transferencia"], ["transferencia_y_caja", "Transferencia y caja"], ["tarjeta", "Tarjeta"], ["credito", "Crédito"]];

export const SECCIONES_CABECERA = [
  { id: "cliente", titulo: "Cliente", abierta: true, campos: [
    { k: "cliente", n: "Cliente", ancho: "completo" }, { k: "ruc", n: "RUC / DNI" }, { k: "telefono", n: "Teléfono" },
    { k: "email", n: "E-mail" }, { k: "direccion", n: "Dirección", ancho: "completo" }, { k: "provincia", n: "Provincia" }, { k: "ciudad", n: "Ciudad" },
  ] },
  { id: "venta", titulo: "Venta y entrega", abierta: true, campos: [
    { k: "entrega", n: "Entrega", opciones: ENTREGAS }, { k: "destino", n: "Destino" }, { k: "agencia", n: "Agencia" },
    { k: "atencion", n: "Atención" }, { k: "canalVenta", n: "Canal de venta", opciones: CANALES_VENTA },
    { k: "formaPago", n: "Forma de pago", opciones: FORMAS_PAGO }, { k: "comprobante", n: "Comprobante", opciones: COMPROBANTES },
    { k: "fecha", n: "Fecha", tipo: "date" }, { k: "vendedor", n: "Vendedor" }, { k: "despachador", n: "Despachador" },
    { k: "referencia", n: "N.º de la proforma de papel (opcional)", ancho: "completo" },
  ] },
];
const TODOS = SECCIONES_CABECERA.flatMap((s) => s.campos.map((c) => c.k));
export const cabeceraVacia = () => Object.fromEntries(TODOS.map((k) => [k, ""]));
export const pagoVacio = () => ({ cuenta: "", monto: "", operacion: "" });

/** Texto de una opción cerrada: textoOpcion(ENTREGAS, "agencia") → «Agencia». */
export const textoOpcion = (lista, clave) => lista.find(([k]) => k === clave)?.[1] ?? clave ?? "";

/** Datos de entrega para el almacén en una línea: «Entrega: Agencia Flores · Destino: Arequipa · Atención: Sr. Luis». */
export function resumenEntrega(c = {}) {
  const partes = [];
  if (c.entrega) partes.push(`Entrega: ${textoOpcion(ENTREGAS, c.entrega)}${c.agencia ? ` ${c.agencia}` : ""}`);
  else if (c.agencia) partes.push(`Agencia: ${c.agencia}`);
  if (c.destino) partes.push(`Destino: ${c.destino}`);
  if (c.atencion) partes.push(`Atención: ${c.atencion}`);
  return partes.join(" · ");
}

/** Tamaño al que se reduce la foto antes de enviarla (lado mayor `max`), sin agrandar nunca. */
export function reducirDimensiones(ancho, alto, max = 1600) {
  const escala = Math.min(1, max / Math.max(ancho, alto));
  return { ancho: Math.round(ancho * escala), alto: Math.round(alto * escala) };
}

/** Pasa la lectura del servidor al estado del formulario (todo texto, para poder editarlo). */
/** Datos de catálogo que traen los archivos y que el almacén usa para ubicar la pieza. */
export const CAMPOS_CATALOGO = ["modelo", "codMax", "proveedor", "familia"];
const catalogoDe = (l) => Object.fromEntries(CAMPOS_CATALOGO.filter((k) => String(l?.[k] ?? "").trim()).map((k) => [k, String(l[k]).trim()]));
/** «LL-AMI61-001 · MX2-01-00-LU-875 · LU · ARMADURA»: lo que se muestra bajo la descripción. */
export const detalleLinea = (l) => CAMPOS_CATALOGO.map((k) => String(l?.[k] ?? "").trim()).filter(Boolean).join(" · ");

export function formularioDeLectura(lectura) {
  const cabecera = { ...cabeceraVacia() };
  for (const [k, v] of Object.entries(lectura?.cabecera ?? {})) if (k in cabecera && v != null) cabecera[k] = String(v);
  const lineas = (lectura?.lineas ?? []).map((l) => ({
    cantidad: l.cantidad == null ? "" : String(l.cantidad),
    descripcion: l.descripcion ?? "",
    precioUnitario: l.precioUnitario == null ? "" : String(l.precioUnitario),
    comentario: String(l.comentario ?? ""),
    anulada: l.anulada === true,
    dudoso: l.dudoso === true,
    ...catalogoDe(l),
  }));
  return { cabecera, lineas, total: lectura?.total ?? null, avisos: lectura?.avisos ?? [] };
}

/** Pasa una proforma guardada (GET /proformas/:code) al estado del formulario, conservando el id de cada línea. */
export function formularioDeProforma(p) {
  const cabecera = { ...cabeceraVacia() };
  for (const [k, v] of Object.entries(p?.cabecera ?? {})) if (k in cabecera && v != null) cabecera[k] = String(v);
  const lineas = (p?.lineas ?? []).map((l) => ({
    id: l.id,
    cantidad: l.cantidad == null ? "" : String(l.cantidad),
    descripcion: l.descripcion ?? "",
    precioUnitario: l.precioUnitario == null ? "" : String(l.precioUnitario),
    comentario: l.comentario ?? "",
    anulada: l.anulada === true,
    dudoso: false,
    ...catalogoDe(l),
  }));
  const pagos = (p?.pagos ?? []).map((x) => ({ cuenta: x.cuenta ?? "", monto: x.monto == null ? "" : String(x.monto), operacion: x.operacion ?? "" }));
  return { cabecera, lineas, pagos };
}

/** Suma de las líneas no tachadas con lo que hay escrito en el formulario. */
export const sumaDelFormulario = (lineas) =>
  Math.round(lineas.filter((l) => !l.anulada).reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precioUnitario) || 0), 0) * 100) / 100;

/**
 * Lo que dibuja la vista previa a partir del formulario tal como está (sin validar): sirve a medias, también con datos
 * incompletos. Las líneas tachadas y las vacías no salen. El precio incluye IGV: con factura o boleta se separa el 18 %.
 */
export function vistaDeProforma({ cabecera = {}, lineas = [], pagos = [] } = {}) {
  const items = lineas
    .filter((l) => !l.anulada && (String(l.descripcion ?? "").trim() || String(l.cantidad ?? "").trim() || String(l.precioUnitario ?? "").trim()))
    .map((l, i) => {
      const cantidad = Number(l.cantidad) || 0;
      const precio = String(l.precioUnitario ?? "").trim() === "" ? null : Number(l.precioUnitario) || 0;
      return {
        n: i + 1, cantidad: String(l.cantidad ?? "").trim(), descripcion: String(l.descripcion ?? "").trim(), detalle: detalleLinea(l),
        comentario: String(l.comentario ?? "").trim(), precio, importe: precio == null ? null : Math.round(cantidad * precio * 100) / 100,
        modelo: l.modelo ?? "", codMax: l.codMax ?? "", proveedor: l.proveedor ?? "", familia: l.familia ?? "",
      };
    })
    .map((it, i) => ({ ...it, n: i + 1 }));
  const total = Math.round(items.reduce((s, it) => s + (it.importe ?? 0), 0) * 100) / 100;
  const conIgv = ["factura", "boleta"].includes(cabecera.comprobante);
  const igv = conIgv ? Math.round((total - total / 1.18) * 100) / 100 : 0;
  const pagado = Math.round(pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0) * 100) / 100;
  return { items, total, conIgv, igv, subtotal: Math.round((total - igv) * 100) / 100, pagado, sinPrecios: items.some((it) => it.precio == null) };
}

/** Validación del formulario de nueva proforma; devuelve { cabecera, lineas } limpias o { error }. */
export function prepararProforma({ cabecera = {}, lineas, pagos = [] }, { permitirVacio = false } = {}) {
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
    limpias.push({ ...(l.id && { id: l.id }), cantidad, descripcion, precioUnitario: precio === "" ? null : Number(precio), ...catalogoDe(l), comentario: String(l.comentario ?? "").trim(), anulada: l.anulada === true });
  }
  if (!limpias.length && !permitirVacio) return { error: "Agrega al menos una línea." };
  const limpia = {};
  for (const [k, v] of Object.entries(cabecera)) if (typeof v === "string" && v.trim()) limpia[k] = v.trim();
  const pagosLimpios = [];
  for (const [i, p] of pagos.entries()) {
    if (!String(p.cuenta ?? "").trim() && !String(p.monto ?? "").trim() && !String(p.operacion ?? "").trim()) continue;
    const monto = Number(p.monto);
    if (!String(p.cuenta ?? "").trim() || String(p.monto ?? "").trim() === "" || !(monto >= 0))
      return { error: `El pago ${i + 1} necesita cuenta y monto.` };
    pagosLimpios.push({ cuenta: String(p.cuenta).trim(), monto, operacion: String(p.operacion ?? "").trim() });
  }
  return { cabecera: limpia, lineas: limpias, pagos: pagosLimpios };
}

/** Motivos para cerrar una proforma sin vender (clave que guarda el servidor → texto). */
export const MOTIVOS = {
  descartado: { titulo: "Descartar", motivos: [["error_de_carga", "Error de carga"], ["duplicada", "Duplicada"], ["cliente_desistio", "El cliente desistió"], ["otro", "Otro"]] },
  rechazada: { titulo: "Rechazada por el cliente", motivos: [["precio", "Precio"], ["plazo", "Plazo"], ["stock", "Stock"], ["eligio_otro_proveedor", "Eligió otro proveedor"], ["otro", "Otro"]] },
  vencida: { titulo: "Vencida", motivos: [["sin_respuesta", "Sin respuesta"], ["vigencia_agotada", "Vigencia agotada"], ["otro", "Otro"]] },
};
/** Cierres que admite cada estado (un borrador solo se descarta; una cotización se rechaza o vence). */
export const CIERRES_POR_ESTADO = { borrador: ["descartado"], cotizacion: ["rechazada", "vencida"], orden_salida: ["descartado"] };

/** Arma la configuración que se envía a partir del formulario (textos → números); el servidor vuelve a validar. */
export function configParaEnviar(f) {
  return {
    pisos: f.pisos.map((p) => ({ piso: Number(p.piso), puntaje: p.puntaje })),
    extras: { taller: f.extras.taller, muestra: f.extras.muestra, foto: f.extras.foto },
    emisores: f.emisores.filter((e) => String(e.nombre ?? "").trim() || e.id),
  };
}

/** Búsqueda de la bandeja: por código (DP-…), cliente, vendedor o la referencia del papel. */
export function coincideBusqueda(p, texto) {
  const q = String(texto ?? "").trim().toLowerCase();
  if (!q) return true;
  const c = p.cabecera ?? {};
  return [p.code, c.cliente, c.vendedor, c.referencia, c.ciudad].some((v) => String(v ?? "").toLowerCase().includes(q));
}
