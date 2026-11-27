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

// Sube un archivo tal cual (Excel o PDF) y devuelve la lectura; el servidor reconoce el formato por su contenido.
async function subirArchivo(ruta, archivo) {
  let r;
  try {
    r = await fetch(BASE + ruta, { method: "POST", credentials: "same-origin", body: archivo,
      headers: { Accept: "application/json", "x-requested-with": "topd", "Content-Type": archivo.type || "application/octet-stream" } });
  } catch {
    throw new ErrorApi(0, "SIN_CONEXION", "No se pudo conectar con el servidor.");
  }
  const datos = await r.json().catch(() => null);
  if (!r.ok) throw new ErrorApi(r.status, datos?.codigo ?? null, typeof datos?.error === "string" ? datos.error : null, datos);
  return datos;
}

const enc = encodeURIComponent;
/** Enlace de descarga de la plantilla de Excel (un GET normal: la sesión viaja en la cookie). */
export const urlRelacionales = (f) => `${BASE}topd/relacionales/descarga.xlsx?${new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v)))}`;
export const urlPlantilla = BASE + "topd/proformas/plantilla.xlsx";

export const api = {
  yo: async () => normalizarYo(await pedir("GET", "auth/yo")),
  picking: {
    opciones: (lineas) => pedir("POST", "topd/picking/opciones", { lineas }),
    activas: () => pedir("GET", "topd/picking"),
    marcar: (code, lineaId, cambio) => pedir("PUT", `topd/picking/${enc(code)}/lineas/${enc(lineaId)}`, cambio),
    listo: (code) => pedir("POST", `topd/picking/${enc(code)}/listo`, {}),
    agregarLinea: (code, cuerpo) => pedir("POST", `topd/picking/${enc(code)}/lineas`, cuerpo),
    agregarFoto: (code, lineaId, url) => pedir("POST", `topd/picking/${enc(code)}/lineas/${enc(lineaId)}/fotos`, { url }),
    quitarFoto: (code, lineaId, url) => pedir("DELETE", `topd/picking/${enc(code)}/lineas/${enc(lineaId)}/fotos`, { url }),
  },
  fotos: {
    estado: () => pedir("GET", "topd/fotos"),
    subir: (imagen) => pedir("POST", "topd/fotos", { imagen }),
  },
  revision: {
    pendientes: () => pedir("GET", "topd/revision"),
    cerrar: (code) => pedir("POST", `topd/revision/${enc(code)}/cerrar`, {}),
    opciones: (lineas) => pedir("POST", "topd/revision/opciones", { lineas }),
    agregarFotoDespacho: (code, url) => pedir("POST", `topd/revision/${enc(code)}/despacho/fotos`, { url }),
    quitarFotoDespacho: (code, url) => pedir("DELETE", `topd/revision/${enc(code)}/despacho/fotos`, { url }),
    marcar: (code, lineaId, cambio) => pedir("PUT", `topd/revision/${enc(code)}/lineas/${enc(lineaId)}`, cambio),
    agregarLinea: (code, cuerpo) => pedir("POST", `topd/revision/${enc(code)}/lineas`, cuerpo),
    agregarFoto: (code, lineaId, url) => pedir("POST", `topd/revision/${enc(code)}/lineas/${enc(lineaId)}/fotos`, { url }),
    quitarFoto: (code, lineaId, url) => pedir("DELETE", `topd/revision/${enc(code)}/lineas/${enc(lineaId)}/fotos`, { url }),
  },
  bandeja: {
    listar: (estados) => pedir("GET", `topd/bandeja${estados?.length ? `?estado=${estados.join(",")}` : ""}`),
  },
  proformas: {
    crear: (cuerpo) => pedir("POST", "topd/proformas", cuerpo),
    leerArchivo: (archivo) => subirArchivo("topd/proformas/archivo", archivo),
    listar: (estados) => pedir("GET", `topd/proformas${estados?.length ? `?estado=${estados.join(",")}` : ""}`),
    obtener: (code) => pedir("GET", `topd/proformas/${enc(code)}`),
    editar: (code, cuerpo) => pedir("PUT", `topd/proformas/${enc(code)}`, cuerpo),
    cambiarEstado: (code, cuerpo) => pedir("POST", `topd/proformas/${enc(code)}/estado`, cuerpo),
    opciones: () => pedir("GET", "topd/opciones"),
    // OCR: lee la foto y devuelve el JSON para revisar; NO crea la proforma
    leer: (cuerpo) => pedir("POST", "topd/proformas/leer", cuerpo),
  },
  ocr: () => pedir("GET", "topd/ocr"),
  guia: { opciones: (lineas) => pedir("POST", "topd/guia/opciones", { lineas }) },
  supervision: () => pedir("GET", "topd/supervision"),
  relacionales: {
    listar: (f) => pedir("GET", `topd/relacionales?${new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v)))}`),
    completar: () => pedir("POST", "topd/relacionales/completar", {}),
    anular: (code, motivo) => pedir("POST", `topd/relacionales/${encodeURIComponent(code)}/anular`, { motivo }),
  },
  reportes: {
    picking: (desde, hasta) => pedir("GET", `topd/reportes/picking?${new URLSearchParams({ ...(desde && { desde }), ...(hasta && { hasta }) })}`),
  },
  config: {
    leer: () => pedir("GET", "topd/config"),
    guardar: (cuerpo) => pedir("PUT", "topd/config", cuerpo),
  },
  stock: {
    estado: () => pedir("GET", "topd/stock/estado"),
    sincronizar: () => pedir("POST", "topd/stock/sincronizar"),
  },
};

export function mensajeDeError(e) {
  if (!(e instanceof ErrorApi)) return "Ocurrió un error inesperado.";
  if (e.status === 0) return e.message;
  if (e.status === 401) return "Tu sesión caducó. Vuelve a entrar.";
  if (e.status === 403) return "Tu rol no puede hacer esto.";
  if (e.codigo === "OCR_NO_CONFIGURADO") return "La lectura de fotos aún no está activada. Carga la proforma a mano.";
  if (e.codigo === "LIMITE_LECTURAS" || e.codigo === "OCR_FALLO" || e.codigo === "OCR_OCUPADO" || e.codigo === "OCR_SIN_CONEXION" || e.codigo === "IMAGEN_GRANDE") return e.message;
  if (e.codigo === "CABECERA_INVALIDA" || e.codigo === "PAGOS_INVALIDOS") return e.message;
  if (e.codigo === "ESTADO_NO_REVISION") return "Esta proforma ya no está para revisar. Se recargó la lista.";
  if (e.codigo === "PICKING_INCOMPLETO") return "Quedan líneas sin resolver.";
  if (e.codigo === "CONFLICTO_VERSION") return "Otra persona cambió esta proforma mientras la editabas. Ábrela de nuevo para ver lo último.";
  if (e.codigo === "ESTADO_NO_EDITABLE") return "Esta proforma ya salió del almacén y no se puede editar.";
  if (e.codigo === "RANGO_INVALIDO") return e.message;
  if (e.codigo === "CONFIG_INVALIDA" || e.codigo === "EMISOR_INVALIDO" || e.codigo === "DESTINO_INVALIDO") return e.message;
  if (e.codigo === "LINEA_INVALIDA" || e.codigo === "LINEAS_REQUERIDAS") return e.message;
  if (e.status === 429) return "Demasiados intentos. Espera unos minutos.";
  // Fotos y Google: el servidor ya explica qué pasó (falta configurar, Google rechazó, foto muy grande…)
  if (e.codigo && /^(GOOGLE_|FOTO|DEMASIADAS_FOTOS|LIMITE_FOTOS|ESTADO_NO_FOTOS|IMAGEN)/.test(e.codigo)) return e.message;
  if (e.status >= 500) return "El servidor tuvo un problema. Intenta de nuevo en un momento.";
  return e.message || "No se pudo completar la acción.";
}
