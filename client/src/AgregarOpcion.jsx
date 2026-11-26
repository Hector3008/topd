import { useState } from "react";
import { mensajeDeError } from "./api.js";
import BuscadorCatalogo from "./BuscadorCatalogo.jsx";

// Suma a una línea una opción del catálogo que la guía no traía: se busca, se elige, se dice cuántas unidades y de qué piso.
// `max` = lo que todavía falta para completar la línea; `alAgregar({ codigo, descripcion, cantidad, piso })` guarda.
export default function AgregarOpcion({ buscar, pisos, max, alAgregar }) {
  const [abierto, setAbierto] = useState(false);
  const [o, setO] = useState(null);
  const [cantidad, setCantidad] = useState(1);
  const [piso, setPiso] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function agregar() {
    setOcupado(true); setError("");
    try {
      await alAgregar({ codigo: o.codigo, descripcion: o.descripcion ?? "", cantidad: Number(cantidad), piso: Number(piso) });
      setO(null); setCantidad(1); setPiso(""); setAbierto(false);
    } catch (e) { setError(mensajeDeError(e)); }
    finally { setOcupado(false); }
  }

  if (!abierto) return <p><button type="button" className="btn" onClick={() => setAbierto(true)}>＋ Agregar otra opción</button></p>;
  const tope = Math.max(1, max);
  const valido = o && Number.isInteger(Number(cantidad)) && Number(cantidad) >= 1 && Number(cantidad) <= tope && piso !== "";
  return (
    <div className="agregar">
      <p className="nota-suave">Otra opción del catálogo para esta línea{max <= 0 ? " (la línea ya está completa: súmala solo si cambias lo sacado)" : ""}.</p>
      {!o ? <BuscadorCatalogo buscar={buscar} alElegir={setO} etiqueta="Código o descripción de la opción" /> : (
        <div className="sacar" role="group" aria-label="Opción a agregar">
          <span><b>{o.codigo}</b> · {o.descripcion}</span>
          <label>Piso
            <select aria-label="Piso de la opción nueva" value={piso} onChange={(e) => setPiso(e.target.value)}>
              <option value="" disabled>—</option>
              {pisos.map((p) => <option key={p.piso} value={p.piso}>{p.piso}</option>)}
            </select>
          </label>
          <label>Unidades
            <input className="num sacar__n" type="number" min="1" max={tope} aria-label="Unidades de la opción nueva" value={cantidad} onChange={(e) => setCantidad(e.target.value)} onFocus={(e) => e.target.select()} />
          </label>
          <button type="button" className="btn btn--primario" disabled={!valido || ocupado} onClick={agregar}>{ocupado ? "Agregando…" : "Agregar"}</button>
          <button type="button" className="btn" onClick={() => setO(null)}>Cambiar</button>
        </div>
      )}
      {error && <p className="aviso-error" role="alert">{error}</p>}
      <button type="button" className="btn" onClick={() => { setAbierto(false); setO(null); }}>Cancelar</button>
    </div>
  );
}
