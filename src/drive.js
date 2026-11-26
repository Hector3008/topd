// Subida de fotos a una carpeta de Google Drive. En la base solo se guarda la URL.
// Cuenta de servicio → la carpeta debe estar en una Unidad compartida donde la cuenta sea miembro (supportsAllDrives).
// OAuth de usuario → la carpeta puede estar en tu Drive personal (la cuenta de servicio no puede subir ahí: no tiene espacio).
import { crearGoogle } from "./google-auth.js";

const ALCANCE = "https://www.googleapis.com/auth/drive";
const API = "https://www.googleapis.com";

/** URL pública de visualización de un archivo de Drive (es lo único que se guarda). */
export const urlDeArchivo = (id) => `https://drive.google.com/uc?export=view&id=${id}`;

export function crearDrive({ carpetaId, servicio = null, oauth = null, fetch = globalThis.fetch, ahora = () => Date.now(), esperaMs = 60000 }) {
  const google = crearGoogle({ servicio, oauth, alcance: ALCANCE, fetch, ahora, esperaMs });

  return {
    /** Sube los bytes a la carpeta y deja el archivo visible para quien tenga el enlace. Devuelve { id, url }. */
    async subir({ nombre, mime, bytes }) {
      const frontera = `topd${ahora().toString(36)}${Math.random().toString(36).slice(2)}`;
      const cuerpo = Buffer.concat([
        Buffer.from(`--${frontera}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: nombre, parents: [carpetaId] })}\r\n--${frontera}\r\nContent-Type: ${mime}\r\n\r\n`),
        bytes,
        Buffer.from(`\r\n--${frontera}--`),
      ]);
      const archivo = await google(`${API}/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id`, {
        method: "POST", headers: { "content-type": `multipart/related; boundary=${frontera}` }, body: cuerpo,
      });
      await google(`${API}/drive/v3/files/${encodeURIComponent(archivo.id)}/permissions?supportsAllDrives=true`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "reader", type: "anyone" }),
      });
      return { id: archivo.id, url: urlDeArchivo(archivo.id) };
    },
  };
}
