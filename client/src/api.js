// Cliente HTTP del front de topd. El front se sirve en `<base>/topd/` y la API vive en `<base>/`; con "../"
// relativo al documento se obtiene `<base>/` sin conocer el BASE_PATH (mismo origen: la cookie de sesión funciona).
const BASE = new URL("../", document.baseURI).pathname;

/** Dónde iniciar sesión o elegir empresa (el front de `cuenta`). */
export const urlCuenta = BASE + "cuenta/";

export class ErrorApi extends Error {
  constructor(status, codigo, mensaje, datos) {
    super(mensaje || "Error inesperado");
    this.status = status;
    this.codigo = codigo;
    this.datos = datos;
  }
}

async function pedir(metodo, ruta, cuerpo) {
  const cabeceras = { Accept: "application/json" };
  const opciones = { method: metodo, credentials: "same-origin", headers: cabeceras };
  if (metodo !== "GET") cabeceras["x-requested-with"] = "topd"; // protección CSRF del núcleo
  if (cuerpo !== undefined) {
    cabeceras["Content-Type"] = "application/json";
    opciones.body = JSON.stringify(cuerpo);
  }
  let r;
  try {
    r = await fetch(BASE + ruta, opciones);
  } catch {
    throw new ErrorApi(0, "SIN_CONEXION", "No se pudo conectar con el servidor.");
  }
  const datos = await r.json().catch(() => null);
  if (!r.ok) {
    const e = datos?.error;
    throw new ErrorApi(r.status, datos?.codigo ?? e?.codigo ?? null, datos?.mensaje ?? (typeof e === "string" ? e : e?.mensaje) ?? null, datos);
  }
  return datos;
}

/** Lo mínimo de /auth/yo que usa este front: permisos y empresa activa. */
export function normalizarYo(d) {
  const yo = d?.yo ?? d ?? {};
  const empresas = yo.empresas ?? yo.membresias ?? [];
  const activa = empresas.find((e) => (e.empresaId ?? e.id ?? e._id) === (yo.empresaActivaId ?? yo.empresaId));
  return {
    empresaActivaId: yo.empresaActivaId ?? yo.empresaId ?? null,
    empresa: activa ? { nombre: activa.nombre ?? activa.empresa?.nombre ?? "" } : null,
    permisos: Array.isArray(yo.permisos) ? yo.permisos : [],
    debeCambiarPassword: Boolean(yo.debeCambiarPassword ?? yo.usuario?.debeCambiarPassword),
  };
}

const enc = encodeURIComponent;

export const api = {
  yo: async () => normalizarYo(await pedir("GET", "auth/yo")),
  picking: {
    activas: () => pedir("GET", "topd/picking"),
    marcar: (code, lineaId, cambio) => pedir("PUT", `topd/picking/${enc(code)}/lineas/${enc(lineaId)}`, cambio),
    listo: (code) => pedir("POST", `topd/picking/${enc(code)}/listo`, {}),
  },
  proformas: {
    crear: (cuerpo) => pedir("POST", "topd/proformas", cuerpo),
    // OCR: lee la foto y devuelve el JSON para revisar; NO crea la proforma
    leer: (cuerpo) => pedir("POST", "topd/proformas/leer", cuerpo),
  },
  ocr: () => pedir("GET", "topd/ocr"),
};

export function mensajeDeError(e) {
  if (!(e instanceof ErrorApi)) return "Ocurrió un error inesperado.";
  if (e.status === 0) return e.message;
  if (e.status === 401) return "Tu sesión caducó. Vuelve a entrar.";
  if (e.status === 403) return "Tu rol no puede hacer esto.";
  if (e.codigo === "OCR_NO_CONFIGURADO") return "La lectura de fotos aún no está activada. Carga la proforma a mano.";
  if (e.codigo === "LIMITE_LECTURAS" || e.codigo === "OCR_FALLO" || e.codigo === "OCR_OCUPADO" || e.codigo === "OCR_SIN_CONEXION" || e.codigo === "IMAGEN_GRANDE") return e.message;
  if (e.codigo === "PICKING_INCOMPLETO") return "Quedan líneas sin resolver.";
  if (e.codigo === "CONFLICTO_VERSION") return "Otra persona cambió esta proforma. Se recargó con lo último.";
  if (e.status === 429) return "Demasiados intentos. Espera unos minutos.";
  if (e.status >= 500) return "El servidor tuvo un problema. Intenta de nuevo en un momento.";
  return e.message || "No se pudo completar la acción.";
}
