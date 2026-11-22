import { useCallback, useEffect, useState } from "react";
import { api, ErrorApi, mensajeDeError, urlCuenta } from "./api.js";
import { puedeAlmacen, puedeCrear } from "./logica.js";
import Almacen from "./Almacen.jsx";
import NuevaProforma from "./NuevaProforma.jsx";

// Sin enrutador (como tobt y cuenta): la vista sale del estado. Sin sesión, sin empresa o con contraseña temporal
// se manda a `cuenta`, que lo resuelve.
export default function App() {
  const [yo, setYo] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [problema, setProblema] = useState(null); // { texto, irACuenta }
  const [vista, setVista] = useState(location.hash === "#nueva" ? "nueva" : "almacen");

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

  const ir = (v) => { setVista(v); history.replaceState(null, "", v === "nueva" ? "#nueva" : location.pathname + location.search); };

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

  const almacen = puedeAlmacen(yo.permisos);
  const crear = puedeCrear(yo.permisos);
  if (!almacen && !crear)
    return (
      <main className="centrado">
        <section className="aviso-pantalla">
          <p>Tu rol no tiene acceso a las estaciones de topd.</p>
          <a className="btn" href={urlCuenta}>Volver a mi cuenta</a>
        </section>
      </main>
    );

  const actual = vista === "nueva" && crear ? "nueva" : almacen ? "almacen" : "nueva";
  return (
    <main className="app">
      <nav className="barra" aria-label="Navegación">
        <a className="enlace" href={urlCuenta}>← Inicio</a>
        <span className="pestanas">
          {almacen && <button type="button" className={"pestana" + (actual === "almacen" ? " activa" : "")} onClick={() => ir("almacen")}>Almacén</button>}
          {crear && <button type="button" className={"pestana" + (actual === "nueva" ? " activa" : "")} onClick={() => ir("nueva")}>Nueva proforma</button>}
        </span>
        {yo.empresa?.nombre && <span className="empresa">{yo.empresa.nombre}</span>}
      </nav>
      {actual === "almacen" && <Almacen />}
      {actual === "nueva" && <NuevaProforma alCrear={almacen ? () => ir("almacen") : null} />}
    </main>
  );
}
