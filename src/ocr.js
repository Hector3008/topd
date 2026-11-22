// Lectura de proformas en papel (corte B). El OCR es SOLO una herramienta para cargar proformas: lee la foto y
// devuelve un JSON que la estación de creación muestra para revisar. Nunca crea nada por sí solo.
//
// Dos modos con el MISMO contrato de salida:
//   impreso     proforma con texto impreso / llenada a máquina
//   manuscrito  proforma escrita a mano (como la de Max Importaciones)
// Hoy ambos usan un modelo de visión (Claude) con instrucciones distintas; cada modo tiene su propio motor, así que
// el modo impreso se puede cambiar por un OCR gratuito (Tesseract + reglas) si las fotos de muestra lo justifican,
// sin tocar rutas ni pantalla.

export const MODOS_OCR = Object.freeze(["impreso", "manuscrito"]);
export const TIPOS_IMAGEN = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
export const MAX_BYTES_IMAGEN = 5 * 1024 * 1024; // el front reduce la foto antes de enviarla

export class ErrorOcr extends Error {
  constructor(codigo, mensaje, detalle) {
    super(mensaje);
    this.name = "ErrorOcr";
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

const REGLAS_COMUNES = `Eres un transcriptor de proformas de venta de repuestos (Perú, soles). Transcribe EXACTAMENTE lo que ves, sin corregir ni inventar.
- Cada fila de la tabla (cantidad, descripción, P. unit., importe) es una línea. Respeta el orden.
- Una línea TACHADA o anulada (rayada, con marcador encima) va con anulada=true; transcríbela igual.
- Si un dato no se lee con seguridad, pon tu mejor lectura y márcalo en "dudosos" (por ejemplo "linea 2 descripcion", "cabecera.fecha").
- Si un dato no existe en el papel, déjalo null. No calcules importes que no estén escritos.
- Números con punto decimal. "total" es el total escrito en el papel (null si no hay).
- La fecha va como AAAA-MM-DD si se puede deducir; si no, null.
- forma_pago: "efectivo", "deposito" o "credito" según la casilla marcada; null si ninguna.`;

const INSTRUCCIONES = {
  impreso: `${REGLAS_COMUNES}
La proforma es mayormente impresa o llenada a máquina: la letra es regular y clara.`,
  manuscrito: `${REGLAS_COMUNES}
La proforma está escrita a mano: la letra puede ser irregular, con abreviaturas del rubro (alternador, arrancador, bendix, portadiodo, relay…). Los números de cantidad y precio suelen estar remarcados con lapicero o marcador. Ante la duda entre dos lecturas, elige la más plausible para un repuesto automotriz y márcala como dudosa.`,
};

const FILA = {
  type: "object",
  properties: {
    cantidad: { type: ["number", "null"] },
    descripcion: { type: "string" },
    precio_unitario: { type: ["number", "null"] },
    importe: { type: ["number", "null"] },
    anulada: { type: "boolean" },
  },
  required: ["cantidad", "descripcion", "precio_unitario", "importe", "anulada"],
};

export const ESQUEMA_LECTURA = {
  type: "object",
  properties: {
    cabecera: {
      type: "object",
      properties: {
        numero: { type: ["string", "null"], description: "N.º preimpreso de la proforma" },
        agencia: { type: ["string", "null"] },
        cliente: { type: ["string", "null"] },
        direccion: { type: ["string", "null"] },
        ciudad: { type: ["string", "null"] },
        fecha: { type: ["string", "null"] },
        forma_pago: { type: ["string", "null"], enum: ["efectivo", "deposito", "credito", null] },
        vendedor: { type: ["string", "null"] },
        despachador: { type: ["string", "null"] },
      },
    },
    lineas: { type: "array", items: FILA },
    total: { type: ["number", "null"] },
    dudosos: { type: "array", items: { type: "string" } },
  },
  required: ["cabecera", "lineas", "total", "dudosos"],
};

const num = (v) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const txt = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
const redondear = (n) => Math.round(n * 100) / 100;

/**
 * Convierte lo que devuelve el motor en el JSON del contrato y lo revisa. Pura.
 *   → { cabecera, lineas:[{ cantidad, descripcion, precioUnitario, importe, anulada, dudoso }], total, avisos:[{codigo, mensaje}] }
 * Los avisos NO bloquean: guían la pantalla de revisión (suma distinta del total, importe que no cuadra, etc.).
 */
export function normalizarLectura(crudo) {
  const c = crudo?.cabecera ?? {};
  const dudosos = new Set((Array.isArray(crudo?.dudosos) ? crudo.dudosos : []).map((d) => String(d).toLowerCase()));
  const lineas = (Array.isArray(crudo?.lineas) ? crudo.lineas : []).map((l, i) => {
    const cantidad = num(l?.cantidad);
    const precioUnitario = num(l?.precio_unitario ?? l?.precioUnitario);
    const importe = num(l?.importe);
    const clave = `linea ${i + 1}`;
    return {
      cantidad,
      descripcion: txt(l?.descripcion) ?? "",
      precioUnitario,
      importe,
      anulada: l?.anulada === true,
      dudoso: [...dudosos].some((d) => d.startsWith(clave)) || cantidad == null || !txt(l?.descripcion),
    };
  });
  const total = num(crudo?.total);
  const fecha = typeof c.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.fecha) ? c.fecha : null;
  const cabecera = {
    numero: txt(c.numero), agencia: txt(c.agencia), cliente: txt(c.cliente), direccion: txt(c.direccion),
    ciudad: txt(c.ciudad), fecha, formaPago: ["efectivo", "deposito", "credito"].includes(c.forma_pago ?? c.formaPago) ? (c.forma_pago ?? c.formaPago) : null,
    vendedor: txt(c.vendedor), despachador: txt(c.despachador),
  };

  const avisos = [];
  if (!lineas.length) avisos.push({ codigo: "SIN_LINEAS", mensaje: "No se pudo leer ninguna línea." });
  lineas.forEach((l, i) => {
    if (l.anulada) return;
    if (l.cantidad == null || !Number.isInteger(l.cantidad) || l.cantidad < 1)
      avisos.push({ codigo: "CANTIDAD_DUDOSA", mensaje: `Línea ${i + 1}: la cantidad no es un entero válido.`, linea: i });
    if (l.cantidad && l.precioUnitario != null && l.importe != null && Math.abs(redondear(l.cantidad * l.precioUnitario) - l.importe) > 0.011)
      avisos.push({ codigo: "IMPORTE_NO_CUADRA", mensaje: `Línea ${i + 1}: ${l.cantidad} × ${l.precioUnitario} no da ${l.importe}.`, linea: i });
  });
  const suma = redondear(
    lineas.filter((l) => !l.anulada).reduce((s, l) => s + (l.importe ?? (l.cantidad && l.precioUnitario != null ? l.cantidad * l.precioUnitario : 0)), 0),
  );
  if (total != null && Math.abs(suma - total) > 0.011)
    avisos.push({ codigo: "TOTAL_NO_CUADRA", mensaje: `La suma de las líneas (${suma.toFixed(2)}) no coincide con el total del papel (${total.toFixed(2)}).`, suma, total });
  if (lineas.some((l) => l.anulada))
    avisos.push({ codigo: "HAY_TACHADAS", mensaje: "Hay líneas tachadas: quedan marcadas y no se buscarán en el almacén." });

  return { cabecera, lineas, total, suma, avisos };
}

/** Quita el prefijo `data:image/...;base64,` si viene y valida tipo y tamaño. */
export function prepararImagen({ imagen, mediaType } = {}) {
  if (typeof imagen !== "string" || !imagen) throw new ErrorOcr("IMAGEN_REQUERIDA", "Falta la foto de la proforma.");
  let base64 = imagen;
  let tipo = mediaType;
  const m = /^data:([\w/+.-]+);base64,/.exec(imagen);
  if (m) { tipo ??= m[1]; base64 = imagen.slice(m[0].length); }
  if (!TIPOS_IMAGEN.includes(tipo)) throw new ErrorOcr("IMAGEN_INVALIDA", "La foto debe ser JPG, PNG o WebP.", { validos: TIPOS_IMAGEN });
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw new ErrorOcr("IMAGEN_INVALIDA", "La foto no es válida.");
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > MAX_BYTES_IMAGEN) throw new ErrorOcr("IMAGEN_GRANDE", "La foto pesa demasiado (máximo 5 MB).");
  return { base64: base64.replace(/\s/g, ""), mediaType: tipo };
}

/** Motor de visión de Anthropic. `fetchFn` se inyecta para poder probarlo sin red. */
export function motorVision({ apiKey, modelo, fetchFn = fetch, url = "https://api.anthropic.com/v1/messages" } = {}) {
  return async function leer({ base64, mediaType, modo }) {
    if (!apiKey) throw new ErrorOcr("OCR_NO_CONFIGURADO", "La lectura de fotos no está activada en este servidor.");
    let r;
    try {
      r = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: modelo,
          max_tokens: 4096,
          system: INSTRUCCIONES[modo],
          tools: [{ name: "registrar_proforma", description: "Registra la proforma transcrita", input_schema: ESQUEMA_LECTURA }],
          tool_choice: { type: "tool", name: "registrar_proforma" },
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: "Transcribe esta proforma." },
            ],
          }],
        }),
      });
    } catch {
      throw new ErrorOcr("OCR_SIN_CONEXION", "No se pudo contactar al servicio de lectura. Intenta de nuevo.");
    }
    if (!r.ok) {
      const cuerpo = await r.json().catch(() => null);
      console.error("topd: el motor de OCR respondió", r.status, cuerpo?.error?.message);
      throw new ErrorOcr(r.status === 429 ? "OCR_OCUPADO" : "OCR_FALLO", "El servicio de lectura no pudo leer la foto. Intenta de nuevo o carga la proforma a mano.");
    }
    const d = await r.json();
    const bloque = d?.content?.find((b) => b.type === "tool_use" && b.name === "registrar_proforma");
    if (!bloque?.input) throw new ErrorOcr("OCR_FALLO", "El servicio de lectura no devolvió una proforma. Carga la proforma a mano.");
    return bloque.input;
  };
}

/**
 * Lector: elige el motor por modo, valida la foto y normaliza la salida.
 * `motores` permite cambiar el motor de un modo (p. ej. impreso → Tesseract) sin tocar nada más.
 */
export function crearLector({ apiKey = process.env.ANTHROPIC_API_KEY, modelo = process.env.TOPD_OCR_MODELO || "claude-sonnet-5-5", motores, fetchFn, limitePorHora = 30, ahora = () => Date.now() } = {}) {
  const vision = motorVision({ apiKey, modelo, fetchFn });
  const por = { impreso: vision, manuscrito: vision, ...motores };
  const usos = new Map(); // usuarioId → marcas de tiempo (tope de gasto por persona)

  return {
    activo: Boolean(apiKey) || Boolean(motores),
    modos: MODOS_OCR,
    async leerProforma({ imagen, mediaType, modo, usuarioId = "anon" }) {
      if (!MODOS_OCR.includes(modo)) throw new ErrorOcr("MODO_INVALIDO", "Indica si la proforma es impresa o manuscrita.", { validos: MODOS_OCR });
      const foto = prepararImagen({ imagen, mediaType });
      const t = ahora();
      const recientes = (usos.get(usuarioId) ?? []).filter((x) => t - x < 3600_000);
      if (recientes.length >= limitePorHora) throw new ErrorOcr("LIMITE_LECTURAS", `Llegaste al límite de ${limitePorHora} lecturas por hora. Carga la proforma a mano o espera un poco.`);
      recientes.push(t);
      usos.set(usuarioId, recientes);
      const crudo = await por[modo]({ ...foto, modo });
      return { modo, ...normalizarLectura(crudo) };
    },
  };
}
