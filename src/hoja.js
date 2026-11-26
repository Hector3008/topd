// Lector de Google Sheets sin dependencias (ver google-auth.js). La cuenta de servicio debe tener la hoja compartida (lector).
import { crearGoogle } from "./google-auth.js";

const ALCANCE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export function crearLectorHoja({ email, clave, hojaId, rango = "RESULT!A:O", fetch = globalThis.fetch, ahora = () => Date.now(), esperaMs = 30000 }) {
  const google = crearGoogle({ servicio: { email, clave }, alcance: ALCANCE, fetch, ahora, esperaMs });
  /** Devuelve las filas como lista de listas de texto (la primera es la de encabezados). */
  return async function leerHoja() {
    const c = await google(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(hojaId)}/values/${encodeURIComponent(rango)}`);
    return c.values ?? [];
  };
}
