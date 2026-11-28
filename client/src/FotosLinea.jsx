import { useEffect, useState } from "react";
import { api, mensajeDeError } from "./api.js";
import { fotoReducida } from "./foto.js";
import { miniaturaDe } from "./logica.js";

// ¿Están configuradas las fotos en el servidor? Se pregunta una sola vez y se recuerda.
let consulta = null;
const fotosActivas = () => (consulta ??= api.fotos.estado().then((r) => r.activo === true, () => { consulta = null; return false; }));

/**
 * Fotos de una línea: miniaturas que abren la foto completa y, si se puede, botón para agregar (se sube a Drive; solo la URL
 * viaja y se guarda). `alAgregar(url)` / `alQuitar(url)` las guarda quien llama. Sin permiso de editar muestra solo las miniaturas.
 */
export default function FotosLinea({ titulo = "Fotos", fotos = [], max = 5, alAgregar = null, alQuitar = null, etiqueta = "" }) {
  const [activo, setActivo] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState("");
  const editable = Boolean(alAgregar);
  useEffect(() => { if (editable) fotosActivas().then(setActivo); }, [editable]);
  if (!fotos.length && !(editable && activo)) return null;

  async function elegir(e) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    setSubiendo(true); setError("");
    try {
      const { url } = await api.fotos.subir(await fotoReducida(archivo));
      await alAgregar(url);
    } catch (x) { setError(mensajeDeError(x)); }
    finally { setSubiendo(false); }
  }
  async function quitar(url) {
    setError("");
    try { await alQuitar(url); } catch (x) { setError(mensajeDeError(x)); }
  }

  return (
    <div className="fotos" role="group" aria-label={`${titulo}${etiqueta ? ` de ${etiqueta}` : ""}`}>
      <span className="fotos__titulo">{titulo}</span>
      {fotos.map((u) => (
        <span key={u} className="fotos__item">
          <a href={u} target="_blank" rel="noreferrer"><img src={miniaturaDe(u, 300)} alt="Foto" loading="lazy" /></a>
          {alQuitar && <button type="button" className="fotos__quitar" aria-label="Quitar foto" onClick={() => quitar(u)}>✕</button>}
        </span>
      ))}
      {editable && activo && fotos.length < max && (
        <>
          {/* `capture` abre la cámara del teléfono directamente; en la computadora cae al selector de archivos. */}
          <label className={"btn fotos__agregar" + (subiendo ? " btn--ocupado" : "")}>
            {subiendo ? "Subiendo…" : "📷 Tomar foto"}
            <input type="file" accept="image/*" capture="environment" hidden disabled={subiendo} onChange={elegir} data-origen="camara" />
          </label>
          {!subiendo && (
            <label className="btn fotos__agregar">
              🖼️ Galería
              <input type="file" accept="image/*" hidden onChange={elegir} data-origen="galeria" />
            </label>
          )}
        </>
      )}
      {error && <span className="aviso-error" role="alert">{error}</span>}
    </div>
  );
}
