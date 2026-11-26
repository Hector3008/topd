import { useCallback, useEffect, useState } from "react";
import { api, mensajeDeError, urlRelacionales } from "./api.js";
import { dinero } from "./logica.js";

const ESTADOS = [["vigente", "Vigentes"], ["anulado", "Anulados"], ["", "Todos"]];

// Relacionales: lo que salió de cada proforma cerrada, una fila por opción. Se descarga en Excel para descontar el stock.
export default function Relacionales({ puedeAdministrar = false }) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [estado, setEstado] = useState("vigente");
  const [code, setCode] = useState("");
  const [r, setR] = useState(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async (f) => {
    setCargando(true); setError("");
    try {
      const datos = await api.relacionales.listar({ desde: f.desde, hasta: f.hasta, estado: f.estado, code: f.code.trim() });
      setR(datos);
      if (datos.desde) { setDesde(datos.desde); setHasta(datos.hasta); }
    } catch (e) { setError(mensajeDeError(e)); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar({ desde: "", hasta: "", estado: "vigente", code: "" }); }, [cargar]);

  const filtros = { desde, hasta, estado, code };
  const ver = (e) => { e?.preventDefault(); setAviso(""); cargar(filtros); };

  async function completar() {
    setAviso(""); setError("");
    try {
      const x = await api.relacionales.completar();
      setAviso(x.generadas ? `Se completaron ${x.generadas} proforma(s) cerradas (${x.filas} filas).` : "No faltaba ninguna: todas las cerradas ya tienen relacionales.");
      cargar(filtros);
    } catch (e) { setError(mensajeDeError(e)); }
  }
  async function anular(c) {
    const motivo = window.prompt(`Motivo para anular los relacionales de ${c} (ya no saldrán en la descarga):`);
    if (!motivo) return;
    setAviso(""); setError("");
    try { const x = await api.relacionales.anular(c, motivo); setAviso(`${c}: ${x.anuladas} fila(s) anuladas.`); cargar(filtros); }
    catch (e) { setError(mensajeDeError(e)); }
  }

  const t = r?.totales;
  const codigos = [...new Set((r?.filas ?? []).filter((f) => f.estado !== "anulado").map((f) => f.code))];
  return (
    <section aria-labelledby="t-rel">
      <header className="cabecera"><h1 id="t-rel">Relacionales</h1></header>
      <form className="form-cab" onSubmit={ver} style={{ marginBottom: 12 }}>
        <label>Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label>Estado
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>{ESTADOS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        </label>
        <label>Proforma<input type="search" placeholder="DP-0000012" value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <button type="submit" className="btn btn--primario" disabled={cargando}>{cargando ? "Buscando…" : "Ver"}</button>
      </form>
      {error && <p className="aviso-error" role="alert">{error}</p>}
      {aviso && <p className="nota-suave" role="status">{aviso}</p>}
      {t && (
        <>
          <ul className="resumen-rep">
            <li><b>{t.vigentes}</b><span>filas vigentes</span></li>
            <li><b>{t.unidades}</b><span>unidades</span></li>
            <li><b>S/ {dinero(t.importe)}</b><span>importe</span></li>
            <li><b>{t.anuladas}</b><span>anuladas</span></li>
          </ul>
          <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="btn btn--primario" href={urlRelacionales({ desde, hasta, estado: estado || "todos" })} download>Descargar Excel ({estado === "anulado" ? "anulados" : estado === "" ? "todos" : "vigentes"})</a>
            {puedeAdministrar && <button type="button" className="btn" onClick={completar}>Completar cerradas anteriores</button>}
          </p>
          {r.filas.length === 0 ? <p className="vacio">No hay relacionales en este filtro. Se guardan al cerrar una proforma en Revisión.</p> : (
            <div className="tabla-rep"><table>
              <thead><tr><th>Fecha</th><th>Proforma</th><th>Code</th><th>Cant.</th><th>Unitario</th><th>Total</th><th>Descripción</th><th>Estado</th></tr></thead>
              <tbody>{r.filas.map((f) => (
                <tr key={`${f.code}|${f.lineaId}|${f.codigo}`} style={f.estado === "anulado" ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
                  <td>{f.fecha}</td><td>{f.code}</td><td>{f.codigo || <i>sin código</i>}</td><td>{f.cantidad}</td>
                  <td>{dinero(f.importeUnitario)}</td><td>{dinero(f.importeTotal)}</td>
                  <td style={{ whiteSpace: "normal", minWidth: 200 }}>{f.descripcion}</td>
                  <td>{f.estado === "anulado" ? `Anulado${f.anuladoMotivo ? `: ${f.anuladoMotivo}` : ""}` : "Vigente"}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {puedeAdministrar && codigos.length > 0 && (
            <p className="nota-suave">Anular una proforma completa:{" "}
              {codigos.map((c) => <button key={c} type="button" className="btn btn--chico" onClick={() => anular(c)} style={{ marginRight: 6 }}>{c}</button>)}
            </p>
          )}
          <p className="nota-suave">El Excel trae las columnas Fecha, Code, Cantidad, Importe unitario, Importe total y Descripcion, igual que el siscore. Por defecto solo salen las filas vigentes: una proforma anulada no descuenta stock.</p>
        </>
      )}
    </section>
  );
}
