import { useState } from "react";
import { mensajeDeError } from "./api.js";
import BuscadorCatalogo from "./BuscadorCatalogo.jsx";

// Suma un ítem nuevo al pedido. Se puede buscar en el catálogo (queda sacado en el piso que se diga) o escribirlo libre.
// En el almacén un ítem libre queda por buscar; en la revisión (`exigirPiso`) siempre hay que decir el piso.
export default function AgregarItem({ buscar, pisos, exigirPiso = false, alAgregar }) {
  const [abierto, setAbierto] = useState(false);
  const vacio = { codigo: "", descripcion: "", cantidad: 1, precio: "", piso: "" };
  const [f, setF] = useState(vacio);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const delCatalogo = Boolean(f.codigo);
  const pideP = delCatalogo || exigirPiso;
  const valido = f.descripcion.trim() && Number.isInteger(Number(f.cantidad)) && Number(f.cantidad) >= 1 && (!pideP || f.piso !== "");

  async function agregar() {
    setOcupado(true); setError("");
    try {
      await alAgregar({
        descripcion: f.descripcion.trim(), cantidad: Number(f.cantidad),
        ...(f.precio !== "" && { precioUnitario: Number(f.precio) }),
        ...(delCatalogo && { codigo: f.codigo }), ...(f.piso !== "" && { piso: Number(f.piso) }),
      });
      setF(vacio); setAbierto(false);
    } catch (e) { setError(mensajeDeError(e)); }
    finally { setOcupado(false); }
  }

  if (!abierto) return <p><button type="button" className="btn" onClick={() => setAbierto(true)}>＋ Agregar ítem al pedido</button></p>;
  return (
    <div className="agregar" role="group" aria-label="Agregar ítem al pedido">
      <p className="nota-suave">Ítem que el pedido no traía. Ventas verá que lo agregó {exigirPiso ? "la revisión" : "el almacén"}.</p>
      <BuscadorCatalogo buscar={buscar} etiqueta="Buscar el ítem en el catálogo (opcional)"
        alElegir={(o) => setF((x) => ({ ...x, codigo: o.codigo, descripcion: o.descripcion ?? x.descripcion, precio: o.precioSugerido != null && o.precioSugerido !== "" ? String(o.precioSugerido) : x.precio }))} />
      {delCatalogo && <p className="nota-suave">Del catálogo: <b>{f.codigo}</b> <button type="button" className="btn" onClick={() => setF((x) => ({ ...x, codigo: "" }))}>Quitar código</button></p>}
      <div className="form-cab">
        <label>Descripción<input value={f.descripcion} maxLength={300} onChange={set("descripcion")} aria-label="Descripción del ítem nuevo" /></label>
        <label>Cantidad<input type="number" min="1" value={f.cantidad} onChange={set("cantidad")} aria-label="Cantidad del ítem nuevo" onFocus={(e) => e.target.select()} /></label>
        <label>Precio unitario (opcional)<input type="number" min="0" step="0.01" value={f.precio} onChange={set("precio")} aria-label="Precio del ítem nuevo" /></label>
        <label>Piso{pideP ? "" : " (si ya lo tienes)"}
          <select value={f.piso} onChange={set("piso")} aria-label="Piso del ítem nuevo">
            <option value="">{pideP ? "—" : "aún no"}</option>
            {pisos.map((p) => <option key={p.piso} value={p.piso}>{p.piso}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="aviso-error" role="alert">{error}</p>}
      <p style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn--primario" disabled={!valido || ocupado} onClick={agregar}>{ocupado ? "Agregando…" : "Agregar ítem"}</button>
        <button type="button" className="btn" onClick={() => { setAbierto(false); setF(vacio); }}>Cancelar</button>
      </p>
    </div>
  );
}
