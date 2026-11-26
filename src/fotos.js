// Fotos de las líneas: se suben a Drive y la base guarda solo la URL. Lógica de validación y límites; sin red propia.
import { ErrorPicking } from "./picking.js";
import { crearDrive, urlDeArchivo } from "./drive.js";

export const MAX_FOTOS_LINEA = 5;       // fotos que ventas adjunta a una línea (referencia: producto o muestra del cliente)
export const MAX_FOTOS_EVIDENCIA = 10;  // fotos del almacén o de la revisión por línea
export const MAX_BYTES_FOTO = 4 * 1024 * 1024;
const POR_HORA = 150;                   // subidas por persona y hora

const PREFIJO_URL = "https://drive.google.com/uc?export=view&id=";
/** ¿Es una URL que generó este servicio? (evita que se guarde cualquier enlace). */
export const urlDeFotoValida = (u) => typeof u === "string" && u.length <= 200 && u.startsWith(PREFIJO_URL) && /^[A-Za-z0-9_-]{10,100}$/.test(u.slice(PREFIJO_URL.length));

/** Lista de URLs limpia: válidas, sin repetir y con tope. */
export const limpiarFotos = (lista, max = MAX_FOTOS_LINEA) =>
  [...new Set((Array.isArray(lista) ? lista : []).filter(urlDeFotoValida))].slice(0, max);

const FIRMAS = [
  { mime: "image/jpeg", ext: "jpg", ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", ok: (b) => b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG" },
  { mime: "image/webp", ext: "webp", ok: (b) => b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" },
];

/** data URL (o base64 pelado) → { mime, ext, bytes }, comprobando que de verdad es una imagen. */
export function leerImagen(entrada) {
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(String(entrada ?? "")) ?? [null, null, String(entrada ?? "")];
  const bytes = Buffer.from(m[2].replace(/\s/g, ""), "base64");
  if (bytes.length < 12) throw new ErrorPicking("FOTO_INVALIDA", "La foto está vacía o no se pudo leer");
  if (bytes.length > MAX_BYTES_FOTO) throw new ErrorPicking("FOTO_GRANDE", "La foto pesa demasiado (máximo 4 MB)");
  const tipo = FIRMAS.find((f) => f.ok(bytes));
  if (!tipo) throw new ErrorPicking("FOTO_INVALIDA", "El archivo no es una imagen JPG, PNG o WebP");
  return { mime: tipo.mime, ext: tipo.ext, bytes };
}

/** Configuración desde variables de entorno. Sin carpeta o sin credenciales las fotos quedan apagadas. */
export function fotosDeEntorno(env = process.env) {
  const carpetaId = env.TOPD_FOTOS_CARPETA_ID || "";
  if (!carpetaId || env.TOPD_FOTOS_APAGADO === "1") return null;
  const { GOOGLE_OAUTH_CLIENT_ID: clientId, GOOGLE_OAUTH_CLIENT_SECRET: clientSecret, GOOGLE_OAUTH_REFRESH_TOKEN: refreshToken } = env;
  if (clientId && clientSecret && refreshToken) return { carpetaId, oauth: { clientId, clientSecret, refreshToken } };
  if (env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_PRIVATE_KEY) return { carpetaId, servicio: { email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, clave: env.GOOGLE_PRIVATE_KEY } };
  return null;
}

export function crearServicioFotos({ drive = null, config = null, ahora = () => Date.now(), azar = () => Math.random().toString(36).slice(2, 8) } = {}) {
  const cliente = drive ?? (config ? crearDrive(config) : null);
  const subidas = new Map(); // usuarioId → marcas de tiempo de la última hora
  const dos = (n) => String(n).padStart(2, "0");

  return {
    activo: Boolean(cliente),
    /** Valida la imagen, la sube a Drive y devuelve la URL. */
    async subir({ usuarioId, imagen }) {
      if (!cliente) throw new ErrorPicking("FOTOS_NO_CONFIGURADAS", "Las fotos no están configuradas en el servidor");
      const k = String(usuarioId ?? "");
      const desde = ahora() - 3600000;
      const recientes = (subidas.get(k) ?? []).filter((t) => t > desde);
      if (recientes.length >= POR_HORA) throw new ErrorPicking("LIMITE_FOTOS", "Subiste muchas fotos en la última hora; espera un momento");
      const { mime, ext, bytes } = leerImagen(imagen);
      const d = new Date(ahora());
      const nombre = `topd-${d.getUTCFullYear()}${dos(d.getUTCMonth() + 1)}${dos(d.getUTCDate())}-${dos(d.getUTCHours())}${dos(d.getUTCMinutes())}${dos(d.getUTCSeconds())}-${azar()}.${ext}`;
      const r = await cliente.subir({ nombre, mime, bytes });
      subidas.set(k, [...recientes, ahora()]);
      return { id: r.id, url: r.url ?? urlDeArchivo(r.id) };
    },
  };
}
