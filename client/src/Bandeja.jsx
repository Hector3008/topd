import { useState } from "react";
import { api } from "./api.js";
import { COMPROBANTES, ESTADOS_PROFORMA, FORMAS_PAGO, coincideBusqueda, dinero, haceCuanto, resumenEntrega, textoOpcion } from "./logica.js";
import { useSondeo } from "./useSondeo.js";
import LineasLectura from "./LineasLectura.jsx";
import FotosLinea from "./FotosLinea.jsx";

const FILTROS = [
  ["todas", "Todas", null],
  ["almacen", "En almacén", ["orden_salida"]],
  ["revisar", "Por revisar", ["orden_revision"]],
  ["cerradas", "Cerradas", ["cerrada"]],
];

// Bandeja: solo lectura. Qué proformas hay, en qué estado van y qué pasó con cada línea.
export default function Bandeja() {
  const [filtro, setFiltro] = useState("todas");
  const estados = FILTROS.find(([k]) => k === filtro)[2];
  const { datos, error, ahora, cargar } = useSondeo(() => api.bandeja.listar(estados));
  const [abierta, setAbierta] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const proformas = (datos?.proformas ?? []).filter((p) => coincideBusqueda(p, busqueda));

  return (
    <section aria-labelledby="t-band">
      <header className="cabecera">
        <h1 id="t-band">Bandeja</h1>
        <button type="button" className="btn" onClick={() => cargar()}>Actualizar</button>
      </header>
      <div className="pestanas" role="group" aria-label="Filtrar por estado" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {FILTROS.map(([k, nombre]) => (
          <button key={k} type="button" className={"pestana" + (filtro === k ? " activa" : "")} onClick={() => { setFiltro(k); setAbierta(null); }}>{nombre}</button>
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
                <button type="button" className="tarjeta__cab" onClick={() => setAbierta(abierta === p.code ? null : p.code)} aria-expanded={abierta === p.code}>
                  <span className="codigo">{p.code}</span>
                  <span className="cliente">{p.cabecera?.cliente || "Sin cliente"}</span>
                  <span className="meta">
                    <span className={"chip chip--est-" + p.estado}>{ESTADOS_PROFORMA[p.estado] ?? p.estado}</span>{" "}
                    {p.avance.resueltas}/{p.avance.total} líneas · {p.avance.puntaje} pts · {haceCuanto(p.actualizadaTs ?? p.creadaTs, ahora)}
                  </span>
                </button>
                {abierta === p.code && (
                  <div className="tarjeta__cuerpo">
                    {(p.cabecera?.vendedor || p.cabecera?.referencia) && (
                      <p className="nota-suave">
                        {p.cabecera.referencia && `Papel N.º ${p.cabecera.referencia}`}{p.cabecera.referencia && p.cabecera.vendedor && " · "}
                        {p.cabecera.vendedor && `Vendedor: ${p.cabecera.vendedor}`}{p.cabecera.despachador ? ` · Despachador: ${p.cabecera.despachador}` : ""}
                      </p>
                    )}
                    {resumenEntrega(p.cabecera) && <p className="entrega">{resumenEntrega(p.cabecera)}</p>}
                    {(p.cabecera?.ruc || p.cabecera?.formaPago || p.cabecera?.comprobante) && (
                      <p className="entrega">
                        {[p.cabecera.ruc && `RUC/DNI ${p.cabecera.ruc}`, p.cabecera.formaPago && `Pago: ${textoOpcion(FORMAS_PAGO, p.cabecera.formaPago)}`, p.cabecera.comprobante && `Comprobante: ${textoOpcion(COMPROBANTES, p.cabecera.comprobante)}`].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {p.pagos?.length > 0 && (
                      <p className="entrega">
                        Pagos: {p.pagos.map((x) => `${x.cuenta} S/ ${dinero(x.monto)}${x.operacion ? ` (op. ${x.operacion})` : ""}`).join(" · ")}
                      </p>
                    )}
                    <LineasLectura lineas={p.lineas} />
                    <FotosLinea titulo="📦 Fotos del despacho" fotos={p.fotosDespacho ?? []} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
