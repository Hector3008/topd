import { useState } from "react";
import { api } from "./api.js";
import { duracion, haceCuanto } from "./logica.js";
import { useSondeo } from "./useSondeo.js";

const num = (n) => Number(n ?? 0).toLocaleString("es-PE", { maximumFractionDigits: 2 });
const LENTA_MS = 20 * 60 * 1000; // una línea en búsqueda más de 20 min se resalta
const ESTADO = { pendiente: "sin tocar", buscando: "buscando", encontrado: "hallada", no_encontrado: "no hallada" };

// Supervisor: cómo va hoy el almacén. Se actualiza solo cada pocos segundos.
export default function Supervision() {
  const { datos: d, error, ahora, cargar } = useSondeo(api.supervision);
  const [abierta, setAbierta] = useState(null);

  if (!d) return <section><h1>Supervisión</h1>{error ? <p className="aviso-error" role="alert">{error}</p> : <p className="cargando">Cargando…</p>}</section>;
  const { cola, hoy, ritmo } = d;
  const maxHora = Math.max(1, ...d.porHora.map((h) => h.lineas));
  return (
    <section aria-labelledby="t-sup">
      <header className="cabecera">
        <h1 id="t-sup">Supervisión · hoy {d.dia}</h1>
        <button type="button" className="btn" onClick={() => cargar()}>Actualizar</button>
      </header>
      {error && <p className="aviso-error" role="alert">{error}</p>}
      <p className="nota-suave">Actualizado {haceCuanto(d.generadaTs, ahora)}.</p>

      <ul className="resumen-rep">
        <li><b>{num(hoy.puntaje)}</b><span>puntos hoy</span></li>
        <li><b>{hoy.lineas}</b><span>líneas resueltas hoy ({hoy.noEncontradas} no halladas)</span></li>
        <li><b>{cola.lineasPendientes}</b><span>pendientes ({cola.enBusqueda} buscando, {cola.sinTocar} sin tocar)</span></li>
        <li><b>{cola.proformas}</b><span>proformas en el almacén{cola.listasParaPasar ? ` · ${cola.listasParaPasar} listas para pasar` : ""}</span></li>
        <li><b>{cola.listasHoy}</b><span>proformas que ya salieron hoy</span></li>
        <li><b>{ritmo.ultimaHora}</b><span>líneas en la última hora{ritmo.restanteMin != null ? ` · a ese ritmo quedan ~${duracion(ritmo.restanteMin * 60000)}` : ""}</span></li>
      </ul>

      <h2>Buscando ahora</h2>
      {d.enCurso.length === 0 ? <p className="vacio">Nadie tiene una línea en búsqueda.</p> : (
        <ul className="lista-sup">
          {d.enCurso.map((x) => (
            <li key={`${x.code}-${x.lineaId}`} className={x.desdeMs > LENTA_MS ? "lenta" : ""}>
              <b>{x.persona}</b> · {x.cantidad} × {x.descripcion}
              <span className="nota-suave"> — {x.code}{x.cliente ? ` · ${x.cliente}` : ""} · {x.desdeMs == null ? "" : `lleva ${duracion(x.desdeMs)}`}</span>
            </li>
          ))}
        </ul>
      )}

      <h2>Personas</h2>
      {d.personas.length === 0 ? <p className="vacio">Todavía no hay actividad hoy.</p> : (
        <div className="tabla-rep"><table>
          <thead><tr><th>Persona</th><th>Buscando</th><th>Hechas hoy</th><th>Puntos</th><th>Última marca</th></tr></thead>
          <tbody>{d.personas.map((p) => <tr key={p.id || "x"}><td>{p.nombre}</td><td>{p.buscando}</td><td>{p.resueltasHoy}</td><td>{num(p.puntajeHoy)}</td><td>{haceCuanto(p.ultimaTs, ahora) || "—"}</td></tr>)}</tbody>
        </table></div>
      )}

      <h2>Proformas en el almacén</h2>
      {d.proformas.length === 0 ? <p className="vacio">No hay proformas en el almacén.</p> : d.proformas.map((p) => (
        <article key={p.code} className="tarjeta" style={{ marginBottom: 8 }}>
          <button type="button" className="enlace-btn" aria-expanded={abierta === p.code} onClick={() => setAbierta(abierta === p.code ? null : p.code)} style={{ width: "100%", textAlign: "left" }}>
            <b>{p.code}</b> · {p.cliente || "Sin cliente"}{p.entrega ? ` · ${p.entrega}` : ""}
            <span className="nota-suave"> — espera {duracion(p.esperaMs)} · {p.resueltas}/{p.total} ({p.porcentaje}%){p.completa ? " · lista para pasar" : ""}</span>
          </button>
          <div className="barra-avance" aria-hidden="true"><span style={{ width: `${p.porcentaje}%` }} /></div>
          <p className="nota-suave" style={{ margin: "6px 0 0" }}>{p.personas.length ? `La trabajan: ${p.personas.join(", ")}` : "Nadie la ha tocado"}</p>
          {abierta === p.code && (
            <ul className="lista-sup">
              {p.lineas.map((l) => <li key={l.id} className={l.estado === "buscando" ? "lenta" : ""}>{l.cantidad} × {l.descripcion} <span className="nota-suave">— {ESTADO[l.estado]}{l.piso ? ` · piso ${l.piso}` : ""}{l.persona ? ` · ${l.persona}` : ""}</span></li>)}
            </ul>
          )}
        </article>
      ))}

      {d.porHora.length > 0 && (
        <>
          <h2>Líneas por hora</h2>
          <ul className="horas">
            {d.porHora.map((h) => <li key={h.hora}><span className="hora-barra" style={{ width: `${(h.lineas / maxHora) * 100}%` }} /> <span>{h.hora}:00 · {h.lineas} líneas · {num(h.puntaje)} pts</span></li>)}
          </ul>
        </>
      )}
    </section>
  );
}
