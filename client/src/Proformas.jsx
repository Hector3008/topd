import { useState } from "react";
import { api } from "./api.js";
import { ESTADOS_PROFORMA, coincideBusqueda, haceCuanto } from "./logica.js";
import { useSondeo } from "./useSondeo.js";

const FILTROS = [
  ["borradores", "Borradores y cotizaciones", ["borrador", "cotizacion"]],
  ["activas", "En proceso", ["orden_salida", "orden_revision"]],
  ["cerradas", "Cerradas", ["cerrada"]],
  ["sinventa", "Sin vender", ["descartado", "rechazada", "vencida"]],
];

// Estación de creación: las proformas ya generadas, para abrir una y corregirla mientras está en el almacén.
export default function Proformas({ alEditar }) {
  const [filtro, setFiltro] = useState("activas");
  const estados = FILTROS.find(([k]) => k === filtro)[2];
  const { datos, error, ahora, cargar } = useSondeo(() => api.proformas.listar(estados));
  const [busqueda, setBusqueda] = useState("");
  const proformas = (datos?.proformas ?? []).filter((p) => coincideBusqueda(p, busqueda));

  return (
    <section aria-labelledby="t-prof">
      <header className="cabecera">
        <h1 id="t-prof">Proformas</h1>
        <button type="button" className="btn" onClick={() => cargar()}>Actualizar</button>
      </header>
      <div className="pestanas" role="group" aria-label="Filtrar por estado" style={{ marginBottom: 12 }}>
        {FILTROS.map(([k, nombre]) => (
          <button key={k} type="button" className={"pestana" + (filtro === k ? " activa" : "")} onClick={() => setFiltro(k)}>{nombre}</button>
        ))}
      </div>
      <input className="buscador" type="search" placeholder="Buscar por código, cliente, vendedor o N.º del papel" aria-label="Buscar proformas" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      {error && <p className="aviso-error" role="alert">{error}</p>}
      {datos === null && !error ? <p className="cargando">Cargando…</p>
        : proformas.length === 0 ? <p className="vacio">No hay proformas en este filtro.</p>
        : (
          <ul className="lista">
            {proformas.map((p) => (
              <li key={p.code} className="tarjeta">
                <div className="tarjeta__cab">
                  <span className="codigo">{p.code}</span>
                  <span className="cliente">{p.cabecera?.cliente || "Sin cliente"}{p.emisor?.nombre ? ` · ${p.emisor.nombre}` : ""}</span>
                  <span className="meta">
                    <span className={"chip chip--est-" + p.estado}>{ESTADOS_PROFORMA[p.estado] ?? p.estado}</span>{" "}
                    {p.lineas.length} líneas · {p.avance.resueltas}/{p.avance.total} resueltas · {haceCuanto(p.actualizadaTs ?? p.creadaTs, ahora)}
                  </span>
                  {p.editable
                    ? <button type="button" className="btn btn--primario" onClick={() => alEditar(p.code)}>Editar</button>
                    : <span className="nota-suave">Ya no se puede editar</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
