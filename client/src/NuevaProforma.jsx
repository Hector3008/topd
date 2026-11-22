import { useState } from "react";
import { api, mensajeDeError } from "./api.js";
import { prepararProforma } from "./logica.js";

const vacia = () => ({ cantidad: "", descripcion: "", precioUnitario: "", anulada: false });

// Carga manual de una proforma (estación de creación). Es también la pantalla de revisión a la que llegará
// el OCR: la foto se leerá y rellenará estas mismas filas para que alguien las corrija.
export default function NuevaProforma({ alCrear }) {
  const [cliente, setCliente] = useState("");
  const [vendedor, setVendedor] = useState("");
  const [lineas, setLineas] = useState([vacia(), vacia(), vacia()]);
  const [error, setError] = useState("");
  const [creada, setCreada] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const cambiar = (i, campo, valor) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
  const total = lineas.filter((l) => !l.anulada).reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precioUnitario) || 0), 0);

  async function enviar(e) {
    e.preventDefault();
    const r = prepararProforma({ cliente, vendedor, lineas });
    if (r.error) return setError(r.error);
    setEnviando(true); setError("");
    try {
      const { code } = await api.proformas.crear({ cabecera: r.cabecera, lineas: r.lineas, origen: "manual" });
      setCreada(code);
      setCliente(""); setVendedor(""); setLineas([vacia(), vacia(), vacia()]);
    } catch (err) { setError(mensajeDeError(err)); }
    finally { setEnviando(false); }
  }

  return (
    <section aria-labelledby="t-nueva">
      <header className="cabecera"><h1 id="t-nueva">Nueva proforma</h1></header>
      {creada && (
        <p className="aviso-ok" role="status">
          Creada {creada}: ya está en el almacén. {alCrear && <button type="button" className="enlace-btn" onClick={alCrear}>Ver almacén</button>}
        </p>
      )}
      <form onSubmit={enviar} className="form">
        <label>Cliente<input value={cliente} onChange={(e) => setCliente(e.target.value)} maxLength={120} /></label>
        <label>Vendedor<input value={vendedor} onChange={(e) => setVendedor(e.target.value)} maxLength={80} /></label>
        <ul className="form-lineas">
          {lineas.map((l, i) => (
            <li key={i} className={l.anulada ? "anulada" : ""}>
              <input className="num" type="number" min="1" inputMode="numeric" placeholder="Cant." aria-label={`Cantidad línea ${i + 1}`} value={l.cantidad} onChange={(e) => cambiar(i, "cantidad", e.target.value)} />
              <input className="desc-in" placeholder="Descripción" aria-label={`Descripción línea ${i + 1}`} value={l.descripcion} onChange={(e) => cambiar(i, "descripcion", e.target.value)} />
              <input className="num" type="number" min="0" step="0.01" inputMode="decimal" placeholder="P. unit." aria-label={`Precio línea ${i + 1}`} value={l.precioUnitario} onChange={(e) => cambiar(i, "precioUnitario", e.target.value)} />
              <label className="marca"><input type="checkbox" checked={l.anulada} onChange={(e) => cambiar(i, "anulada", e.target.checked)} /> Tachada</label>
            </li>
          ))}
        </ul>
        <div className="botones">
          <button type="button" className="btn" onClick={() => setLineas((ls) => [...ls, vacia()])}>Agregar línea</button>
          <span className="total">Total S/ {total.toFixed(2)}</span>
        </div>
        {error && <p className="aviso-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn--primario btn--ancho" disabled={enviando}>{enviando ? "Creando…" : "Crear y mandar al almacén"}</button>
      </form>
    </section>
  );
}
