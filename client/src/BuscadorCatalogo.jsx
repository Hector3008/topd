import { useEffect, useRef, useState } from "react";
import { mensajeDeError } from "./api.js";

// Busca en todo el catálogo (no solo en las opciones de la guía). `buscar(texto)` devuelve { opciones, total }.
// Espera a que se deje de escribir y muestra las coincidencias; al elegir una llama a `alElegir(opcion)`.
export default function BuscadorCatalogo({ buscar, alElegir, etiqueta = "Buscar en el catálogo", espera = 400 }) {
  const [texto, setTexto] = useState("");
  const [r, setR] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const fn = useRef(buscar); fn.current = buscar;

  useEffect(() => {
    const t = texto.trim();
    if (t.length < 2) { setR(null); setError(""); return undefined; }
    let vigente = true;
    setCargando(true);
    const id = setTimeout(async () => {
      try { const x = await fn.current(t); if (vigente) { setR(x); setError(""); } }
      catch (e) { if (vigente) setError(mensajeDeError(e)); }
      finally { if (vigente) setCargando(false); }
    }, espera);
    return () => { vigente = false; clearTimeout(id); };
  }, [texto, espera]);

  return (
    <div className="buscador-cat">
      <input type="search" className="buscador" placeholder={etiqueta} aria-label={etiqueta} value={texto} onChange={(e) => setTexto(e.target.value)} />
      {error && <p className="aviso-error" role="alert">{error}</p>}
      {cargando && <p className="nota-suave">Buscando…</p>}
      {r && !cargando && (r.opciones.length === 0 ? <p className="nota-suave">Sin coincidencias.</p> : (
        <ul className="buscador-cat__lista">
          {r.opciones.map((o) => (
            <li key={o.id ?? o.codigo}>
              <button type="button" className="btn" onClick={() => { alElegir(o); setTexto(""); setR(null); }}>Elegir</button>{" "}
              <b>{o.codigo}</b> · {[o.descripcion, o.familia, o.subfamilia].filter(Boolean).join(" / ")}
              {o.precioSugerido != null && o.precioSugerido !== "" && <small> · S/ {o.precioSugerido}</small>}
            </li>
          ))}
          {r.total > r.opciones.length && <li className="nota-suave">y {r.total - r.opciones.length} más: afina lo que escribes</li>}
        </ul>
      ))}
    </div>
  );
}
