import { useCallback, useEffect, useState } from "react";
import { api, ErrorApi, mensajeDeError, urlCuenta } from "./api.js";
import { puedeAlmacen, puedeBandeja, puedeConfigurar, puedeCrear, puedeRevisar, puedeSupervisar } from "./logica.js";
import Almacen from "./Almacen.jsx";
import NuevaProforma from "./NuevaProforma.jsx";
import Revision from "./Revision.jsx";
import Bandeja from "./Bandeja.jsx";
import Proformas from "./Proformas.jsx";
import Config from "./Config.jsx";
import Reportes from "./Reportes.jsx";
import Relacionales from "./Relacionales.jsx";
import Supervision from "./Supervision.jsx";

// Sin enrutador (como tobt y cuenta): la vista sale del estado. Sin sesión, sin empresa o con contraseña temporal
// se manda a `cuenta`, que lo resuelve.
export default function App() {
  const [yo, setYo] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [problema, setProblema] = useState(null); // { texto, irACuenta }
  const [editando, setEditando] = useState(null); // código de la proforma que se está corrigiendo
  const [vista, setVista] = useState(["nueva", "proformas", "almacen", "revision", "bandeja", "supervision", "reportes", "config"].find((v) => location.hash === `#${v}`) ?? null);

  const cargarYo = useCallback(async () => {
    try {
      const d = await api.yo();
      if (d.debeCambiarPassword) setProblema({ texto: "Debes cambiar tu contraseña temporal antes de usar topd.", irACuenta: true });
      else if (!d.empresaActivaId) setProblema({ texto: "Elige una empresa para continuar.", irACuenta: true });
      else { setYo(d); setProblema(null); }
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 401) setProblema({ texto: "Inicia sesión para continuar.", irACuenta: true });
      else setProblema({ texto: mensajeDeError(e), irACuenta: false });
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarYo(); }, [cargarYo]);

  const ir = (v) => { setVista(v); history.replaceState(null, "", `#${v}`); };

  if (cargando) return <main className="centrado"><p className="cargando">Cargando…</p></main>;
  if (problema)
    return (
      <main className="centrado">
        <section className="aviso-pantalla">
          <p>{problema.texto}</p>
          {problema.irACuenta
            ? <a className="btn btn--primario" href={urlCuenta}>Ir a mi cuenta</a>
            : <button type="button" className="btn btn--primario" onClick={() => { setCargando(true); cargarYo(); }}>Reintentar</button>}
        </section>
      </main>
    );

  const estaciones = [
    ["nueva", "Nueva proforma", puedeCrear(yo.permisos)],
    ["proformas", "Proformas", puedeCrear(yo.permisos)],
    ["almacen", "Almacén", puedeAlmacen(yo.permisos)],
    ["revision", "Revisión", puedeRevisar(yo.permisos)],
    ["bandeja", "Bandeja", puedeBandeja(yo.permisos)],
    ["supervision", "Supervisión", puedeSupervisar(yo.permisos)],
    ["relacionales", "Relacionales", puedeBandeja(yo.permisos)],
    ["reportes", "Reportes", puedeBandeja(yo.permisos)],
    ["config", "Configuración", puedeConfigurar(yo.permisos)],
  ].filter(([, , ok]) => ok);
  if (!estaciones.length)
    return (
      <main className="centrado">
        <section className="aviso-pantalla">
          <p>Tu rol no tiene acceso a las estaciones de topd.</p>
          <a className="btn" href={urlCuenta}>Volver a mi cuenta</a>
        </section>
      </main>
    );

  // La vista elegida si tiene permiso; si no, la primera estación del rol (almacén antes que crear, para quien hace las dos)
  const orden = ["almacen", "revision", "bandeja", "nueva", "proformas", "supervision", "reportes", "config"];
  const actual = estaciones.some(([k]) => k === vista) ? vista : orden.find((k) => estaciones.some(([e]) => e === k));
  return (
    <main className="app">
      <nav className="barra" aria-label="Navegación">
        <a className="enlace" href={urlCuenta}>← Inicio</a>
        <span className="pestanas">
          {estaciones.map(([k, nombre]) => (
            <button key={k} type="button" ref={(el) => { if (el && actual === k) el.scrollIntoView?.({ inline: "center", block: "nearest" }); }} className={"pestana" + (actual === k ? " activa" : "")} onClick={() => { setEditando(null); ir(k); }}>{nombre}</button>
          ))}
        </span>
        {yo.empresa?.nombre && <span className="empresa">{yo.empresa.nombre}</span>}
      </nav>
      {actual === "almacen" && <Almacen />}
      {actual === "revision" && <Revision />}
      {actual === "bandeja" && <Bandeja />}
      {actual === "supervision" && <Supervision />}
      {actual === "relacionales" && <Relacionales puedeAdministrar={puedeSupervisar(yo.permisos)} />}
      {actual === "reportes" && <Reportes />}
      {actual === "config" && <Config />}
      {actual === "proformas" && (editando
        ? <NuevaProforma key={editando} codigo={editando} alTerminar={() => setEditando(null)} />
        : <Proformas alEditar={setEditando} />)}
      {actual === "nueva" && <NuevaProforma alCrear={estaciones.some(([k]) => k === "almacen") ? () => ir("almacen") : null} />}
    </main>
  );
}
