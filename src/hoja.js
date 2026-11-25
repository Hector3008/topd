// Lector de Google Sheets sin dependencias: firma el JWT de la cuenta de servicio con `crypto` y llama a la API REST.
// La cuenta de servicio debe tener la hoja compartida (lector). Las credenciales son las mismas variables que usaba el siscore.
import { createSign } from "node:crypto";
import { ErrorPicking } from "./picking.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ALCANCE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

export function crearLectorHoja({ email, clave, hojaId, rango = "RESULT!A:O", fetch = globalThis.fetch, ahora = () => Date.now(), esperaMs = 30000 }) {
  let token = null; // { valor, vence }
  const llave = String(clave ?? "").replace(/\\n/g, "\n");

  async function pedir(url, opciones) {
    let r;
    try { r = await fetch(url, { ...opciones, signal: AbortSignal.timeout(esperaMs) }); }
    catch (e) { throw new ErrorPicking("HOJA_SIN_CONEXION", `No se pudo conectar con Google (${e.message})`); }
    const cuerpo = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = cuerpo?.error?.message ?? cuerpo?.error_description ?? cuerpo?.error ?? `HTTP ${r.status}`;
      throw new ErrorPicking("HOJA_RECHAZADA", `Google rechazó la lectura: ${msg}`, { http: r.status });
    }
    return cuerpo;
  }

  async function obtenerToken() {
    if (token && token.vence > ahora() + 60000) return token.valor;
    const iat = Math.floor(ahora() / 1000);
    const base = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: email, scope: ALCANCE, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
    let firma;
    try { firma = createSign("RSA-SHA256").update(base).sign(llave, "base64url"); }
    catch { throw new ErrorPicking("HOJA_CLAVE_INVALIDA", "GOOGLE_PRIVATE_KEY no es una clave privada válida"); }
    const c = await pedir(TOKEN_URL, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${base}.${firma}` }),
    });
    token = { valor: c.access_token, vence: ahora() + (Number(c.expires_in) || 3600) * 1000 };
    return token.valor;
  }

  /** Devuelve las filas como lista de listas de texto (la primera es la de encabezados). */
  return async function leerHoja() {
    const t = await obtenerToken();
    const c = await pedir(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(hojaId)}/values/${encodeURIComponent(rango)}`, {
      headers: { authorization: `Bearer ${t}` },
    });
    return c.values ?? [];
  };
}
