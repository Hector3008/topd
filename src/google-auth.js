// Acceso a las APIs de Google sin dependencias (Sheets para el stock, Drive para las fotos).
// Dos formas de identificarse:
//   - cuenta de servicio: se firma un JWT (RS256) con `crypto` y se cambia por un token. Sirve para hojas compartidas y para
//     Unidades compartidas de Drive (la cuenta de servicio no tiene espacio propio en un Drive personal).
//   - OAuth de usuario: un refresh token de TU cuenta; sirve para subir a tu Drive personal.
import { createSign } from "node:crypto";
import { ErrorPicking } from "./picking.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

export function crearGoogle({ servicio = null, oauth = null, alcance, fetch = globalThis.fetch, ahora = () => Date.now(), esperaMs = 30000 }) {
  let token = null; // { valor, vence }

  async function pedir(url, opciones = {}) {
    let r;
    try { r = await fetch(url, { ...opciones, signal: AbortSignal.timeout(esperaMs) }); }
    catch (e) { throw new ErrorPicking("GOOGLE_SIN_CONEXION", `No se pudo conectar con Google (${e.message})`); }
    const cuerpo = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = cuerpo?.error?.message ?? cuerpo?.error_description ?? (typeof cuerpo?.error === "string" ? cuerpo.error : null) ?? `HTTP ${r.status}`;
      throw new ErrorPicking("GOOGLE_RECHAZADO", `Google rechazó la solicitud: ${msg}`, { http: r.status });
    }
    return cuerpo;
  }

  async function obtenerToken() {
    if (token && token.vence > ahora() + 60000) return token.valor;
    let c;
    if (oauth) {
      c = await pedir(TOKEN_URL, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", client_id: oauth.clientId, client_secret: oauth.clientSecret, refresh_token: oauth.refreshToken }),
      });
    } else {
      const llave = String(servicio?.clave ?? "").replace(/\\n/g, "\n");
      const iat = Math.floor(ahora() / 1000);
      const base = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: servicio?.email, scope: alcance, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
      let firma;
      try { firma = createSign("RSA-SHA256").update(base).sign(llave, "base64url"); }
      catch { throw new ErrorPicking("GOOGLE_CLAVE_INVALIDA", "GOOGLE_PRIVATE_KEY no es una clave privada válida"); }
      c = await pedir(TOKEN_URL, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${base}.${firma}` }),
      });
    }
    token = { valor: c.access_token, vence: ahora() + (Number(c.expires_in) || 3600) * 1000 };
    return token.valor;
  }

  /** Llama a una API de Google con el token puesto; devuelve el JSON. */
  return async function llamar(url, opciones = {}) {
    const t = await obtenerToken();
    return pedir(url, { ...opciones, headers: { ...(opciones.headers ?? {}), authorization: `Bearer ${t}` } });
  };
}
