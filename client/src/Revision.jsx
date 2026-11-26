import { useState } from "react";
import { api, mensajeDeError } from "./api.js";
import { haceCuanto, partesDeRevision, pisosDe, requiereAtencion, resumenEntrega } from "./logica.js";
import AgregarItem from "./AgregarItem.jsx";

const buscarCatalogo = async (texto) => (await api.revision.opciones([{ k: "q", descripcion: texto }])).lineas?.q ?? { opciones: [], total: 0 };
import { useSondeo } from "./useSondeo.js";
import LineasLectura from "./LineasLectura.jsx";

// Revisión (despacho): valida el pedido que armó el almacén. Para cerrar hay que marcar como revisada cada línea (o cada opción sacada de una línea)
// (las marcas viven en esta pantalla: es la atención del revisor, no un dato del documento).
export default function Revision() {
  const { datos, error, ahora, cargar } = useSondeo(api.revision.pendientes);
  const [abierta, setAbierta] = useState(null);
  const proformas = datos?.proformas ?? [];

  return (
    <section aria-labelledby="t-rev">
      <header className="cabecera">
        <h1 id="t-rev">Revisión</h1>
        <button type="button" className="btn" onClick={() => cargar()}>Actualizar</button>
      </header>
      {error && <p className="aviso-error" role="alert">{error}</p>}
      {datos === null && !error ? <p className="cargando">Cargando…</p>
        : proformas.length === 0 ? <p className="vacio">No hay pedidos por revisar.</p>
        : (
          <ul className="lista">
            {proformas.map((p) => (
              <Pedido key={p.code} p={p} pisos={pisosDe(datos.puntajesPiso)} ahora={ahora} abierta={abierta === p.code}
                alAbrir={() => setAbierta(abierta === p.code ? null : p.code)} alCerrar={() => cargar(true)} />
            ))}
          </ul>
        )}
    </section>
  );
}

function Pedido({ p, pisos, ahora, abierta, alAbrir, alCerrar }) {
  const [marcas, setMarcas] = useState({});
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  // Se revisa opción por opción: una línea sacada de dos opciones lleva dos casillas
  const partes = p.lineas.flatMap(partesDeRevision);
  const faltan = partes.filter((x) => !marcas[x.clave]).length;
  const todas = faltan === 0;
  const atencion = p.lineas.filter(requiereAtencion).length;

  async function cerrar() {
    setEnviando(true); setError("");
    try { await api.revision.cerrar(p.code); await alCerrar(); }
    catch (e) { setError(mensajeDeError(e)); await alCerrar(); }
    finally { setEnviando(false); }
  }

  return (
    <li className={"tarjeta" + (atencion ? " tarjeta--atencion" : "")}>
      <button type="button" className="tarjeta__cab" onClick={alAbrir} aria-expanded={abierta}>
        <span className="codigo">{p.code}</span>
        <span className="cliente">{p.cabecera?.cliente || "Sin cliente"}</span>
        <span className="meta">
          {p.lineas.length} línea(s) · {p.avance.puntaje} pts · {haceCuanto(p.actualizadaTs ?? p.creadaTs, ahora)}
          {atencion > 0 && ` · ${atencion} para mirar con cuidado`}
        </span>
      </button>
      {abierta && (
        <div className="tarjeta__cuerpo">
          {resumenEntrega(p.cabecera) && <p className="entrega">{resumenEntrega(p.cabecera)}</p>}
          <LineasLectura lineas={p.lineas} marcas={marcas} alMarcar={(id, v) => setMarcas((m) => ({ ...m, [id]: v }))}
            opcion={{
              pisos, buscar: buscarCatalogo,
              // Suma la opción a lo ya sacado de la línea (el servidor solo deja corregir `sacados` en la revisión)
              agregar: async (l, n) => {
                const previos = (l.picking?.sacados ?? []).filter((s) => s.codigo !== n.codigo).map(({ codigo, descripcion, cantidad, piso, agregada }) => ({ codigo, descripcion, cantidad, piso, ...(agregada && { agregada }) }));
                await api.revision.marcar(p.code, l.id, { sacados: [...previos, { ...n, agregada: "revision" }] });
                await alCerrar();
              },
            }}
            fotos={{
              agregar: async (lineaId, url) => { await api.revision.agregarFoto(p.code, lineaId, url); await alCerrar(); },
              quitar: async (lineaId, url) => { await api.revision.quitarFoto(p.code, lineaId, url); await alCerrar(); },
            }} />
          <AgregarItem buscar={buscarCatalogo} pisos={pisos} exigirPiso alAgregar={async (cuerpo) => { await api.revision.agregarLinea(p.code, cuerpo); await alCerrar(); }} />
          {error && <p className="aviso-error" role="alert">{error}</p>}
          <button type="button" className="btn btn--primario btn--ancho" disabled={!todas || enviando} onClick={cerrar}>
            {enviando ? "Cerrando…" : todas ? "Validar y cerrar pedido" : `Faltan ${faltan} por revisar`}
          </button>
        </div>
      )}
    </li>
  );
}
