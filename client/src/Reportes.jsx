import { useCallback, useEffect, useState } from "react";
import { api, mensajeDeError } from "./api.js";
import { duracion } from "./logica.js";

const num = (n) => Number(n ?? 0).toLocaleString("es-PE", { maximumFractionDigits: 2 });

// Puntajes y tiempos del almacén por persona, piso y día. Sin fechas: los últimos 7 días.
export default function Reportes() {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [r, setR] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async (d, h) => {
    setCargando(true); setError("");
    try {
      const datos = await api.reportes.picking(d, h);
      setR(datos);
      setDesde(datos.desde); setHasta(datos.hasta);
    } catch (e) { setError(mensajeDeError(e)); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar("", ""); }, [cargar]);

  const t = r?.totales;
  return (
    <section aria-labelledby="t-rep">
      <header className="cabecera"><h1 id="t-rep">Reportes del almacén</h1></header>
      <form className="form-cab" onSubmit={(e) => { e.preventDefault(); cargar(desde, hasta); }} style={{ marginBottom: 12 }}>
        <label>Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <button type="submit" className="btn btn--primario" disabled={cargando}>{cargando ? "Calculando…" : "Ver"}</button>
      </form>
      {error && <p className="aviso-error" role="alert">{error}</p>}
      {r && t && (t.lineas === 0 ? <p className="vacio">No hay líneas resueltas en estos días.</p> : (
        <>
          <ul className="resumen-rep">
            <li><b>{num(t.puntaje)}</b><span>puntos</span></li>
            <li><b>{t.lineas}</b><span>líneas resueltas ({t.proformas} proformas)</span></li>
            <li><b>{t.noEncontradas}</b><span>no encontradas</span></li>
            <li><b>{duracion(t.medianaMs)}</b><span>tiempo típico por línea</span></li>
            <li><b>{t.taller}</b><span>pasaron por taller</span></li>
            <li><b>{t.porMuestra + t.porFoto}</b><span>reconocidas por muestra ({t.porMuestra}) o foto ({t.porFoto})</span></li>
          </ul>
          <h2>Por persona</h2>
          <div className="tabla-rep"><table>
            <thead><tr><th>Persona</th><th>Líneas</th><th>No halladas</th><th>Puntos</th><th>Tiempo típico</th></tr></thead>
            <tbody>{r.porPersona.map((p) => <tr key={p.id || "x"}><td>{p.nombre}</td><td>{p.lineas}</td><td>{p.noEncontradas}</td><td>{num(p.puntaje)}</td><td>{duracion(p.medianaMs)}</td></tr>)}</tbody>
          </table></div>
          <h2>Por piso</h2>
          <div className="tabla-rep"><table>
            <thead><tr><th>Piso</th><th>Líneas halladas</th><th>Puntos</th></tr></thead>
            <tbody>{r.porPiso.map((p) => <tr key={p.piso}><td>{p.piso}</td><td>{p.lineas}</td><td>{num(p.puntaje)}</td></tr>)}</tbody>
          </table></div>
          <h2>Por día</h2>
          <div className="tabla-rep"><table>
            <thead><tr><th>Día</th><th>Líneas</th><th>Puntos</th><th>Tiempo típico</th></tr></thead>
            <tbody>{r.porDia.map((d) => <tr key={d.dia}><td>{d.dia}</td><td>{d.lineas}</td><td>{num(d.puntaje)}</td><td>{duracion(d.medianaMs)}</td></tr>)}</tbody>
          </table></div>
          <p className="nota-suave">Cuenta las líneas resueltas (halladas o no) en esos días, en la hora de la empresa. El tiempo es de la primera marca a la resolución; se usa la mediana para que una línea olvidada no lo distorsione.</p>
        </>
      ))}
    </section>
  );
}
