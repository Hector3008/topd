import { useEffect, useState } from "react";
import { api, mensajeDeError } from "./api.js";
import { useSondeo } from "./useSondeo.js";
import { useOpciones } from "./useOpciones.js";
import { ESTADOS, cambioDeEstado, detalleLinea, dinero, haceCuanto, pisosDe, resumenEntrega } from "./logica.js";


// Almacén: las proformas en orden_salida, la más antigua primero. Cada marca se envía al instante (el servidor guarda
// una fila por línea), así que lo único que se pierde al recargar es una nota sin guardar (se guarda al salir del campo).
export default function Almacen() {
  const { datos, error, ahora, cargar } = useSondeo(api.picking.activas);
  const [abierta, setAbierta] = useState(null); // code de la proforma desplegada
  const proformas = datos?.proformas ?? [];
  return (
    <section aria-labelledby="t-almacen">
      <header className="cabecera">
        <h1 id="t-almacen">Almacén</h1>
        <button type="button" className="btn" onClick={() => cargar()}>Actualizar</button>
      </header>
      {error && <p className="aviso-error" role="alert">{error}</p>}
      {datos === null && !error ? <p className="cargando">Cargando…</p>
        : proformas.length === 0 ? <p className="vacio">No hay proformas por buscar.</p>
        : (
          <ul className="lista">
            {proformas.map((p) => (
              <Proforma
                key={p.code} p={p} pisos={pisosDe(datos.puntajesPiso)} ahora={ahora}
                abierta={abierta === p.code}
                alAbrir={() => setAbierta(abierta === p.code ? null : p.code)}
                alCambiar={() => cargar(true)}
              />
            ))}
          </ul>
        )}
    </section>
  );
}

function Proforma({ p, pisos, ahora, abierta, alAbrir, alCambiar }) {
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function listo() {
    setEnviando(true); setError("");
    try { await api.picking.listo(p.code); await alCambiar(); }
    catch (e) { setError(mensajeDeError(e)); await alCambiar(); }
    finally { setEnviando(false); }
  }

  // Opciones del catálogo de cada línea (guía de almacén), solo con la proforma abierta
  const op = useOpciones(p.lineas.map((l) => ({ k: l.id, descripcion: l.descripcion, codMax: l.codMax, excluir: l.descartadas ?? [] })), api.picking.opciones, { activo: abierta });
  const { total, resueltas, puntaje, completo } = p.avance;
  return (
    <li className={"tarjeta" + (completo ? " tarjeta--lista" : "")}>
      <button type="button" className="tarjeta__cab" onClick={alAbrir} aria-expanded={abierta}>
        <span className="codigo">{p.code}</span>
        <span className="cliente">{p.cabecera?.cliente || "Sin cliente"}{p.cabecera?.referencia ? ` · papel ${p.cabecera.referencia}` : ""}</span>
        <span className="meta">{resueltas}/{total} · {puntaje} pts · {haceCuanto(p.creadaTs, ahora)}</span>
        <span className="barra-avance" aria-hidden="true"><span style={{ width: total ? `${(resueltas / total) * 100}%` : 0 }} /></span>
      </button>
      {abierta && (
        <div className="tarjeta__cuerpo">
          {resumenEntrega(p.cabecera) && <p className="entrega">{resumenEntrega(p.cabecera)}</p>}
          <ul className="lineas">
            {p.lineas.map((l) => <Linea key={l.id} code={p.code} l={l} pisos={pisos} alCambiar={alCambiar} guia={op.porLinea[l.id]} catalogoVacio={op.total === 0} />)}
          </ul>
          {error && <p className="aviso-error" role="alert">{error}</p>}
          <button type="button" className="btn btn--primario btn--ancho" disabled={!completo || enviando} onClick={listo}>
            {completo ? "Listo para revisión" : `Faltan ${total - resueltas} línea(s)`}
          </button>
        </div>
      )}
    </li>
  );
}

function Linea({ code, l, pisos, alCambiar, guia, catalogoVacio }) {
  const pk = l.picking;
  const [error, setError] = useState("");
  const [eligiendoPiso, setEligiendoPiso] = useState(false);
  const [ocupada, setOcupada] = useState(false);
  const [nota, setNota] = useState(pk.nota ?? "");
  useEffect(() => { setNota(pk.nota ?? ""); }, [pk.nota]);

  async function marcar(cambio) {
    if (ocupada) return;
    setOcupada(true); setError("");
    try { await api.picking.marcar(code, l.id, cambio); }
    catch (e) { setError(mensajeDeError(e)); }
    finally { await alCambiar(); setOcupada(false); }
  }

  const estado = (e) => { setEligiendoPiso(false); return marcar(cambioDeEstado(e)); };
  const elegirPiso = (piso) => { setEligiendoPiso(false); return marcar(cambioDeEstado("encontrado", piso)); };
  const distinta = pk.estado === "encontrado" && pk.cantidadEncontrada !== l.cantidad;

  return (
    <li className={"linea linea--" + pk.estado}>
      <div className="linea__texto">
        <span className="cant">{l.cantidad}</span>
        <span className="desc">{l.descripcion}</span>
        {l.precioUnitario != null && <span className="precio">S/ {dinero(l.precioUnitario)}</span>}
      </div>
      {detalleLinea(l) && <p className="detalle">{detalleLinea(l)}</p>}
      {l.comentario && <p className="comentario-linea">{l.comentario}</p>}
      {guia && !catalogoVacio && (
        <details className="opciones-cat" open={guia.total > 0 && guia.total <= 3}>
          <summary>{guia.total === 0 ? (guia.descartadas > 0 ? "Ventas descartó todas las opciones del catálogo" : "Sin coincidencias en el catálogo") : `${guia.total} ${guia.total === 1 ? "opción" : "opciones"} en el catálogo`}{guia.total > 0 && guia.descartadas > 0 ? ` (${guia.descartadas} descartada${guia.descartadas === 1 ? "" : "s"} por ventas)` : ""}</summary>
          <ul>
            {guia.opciones.map((o) => (
              <li key={o.id ?? o.codigo}>
                <b>{o.codigo}</b> · {[o.descripcion, o.familia, o.subfamilia].filter(Boolean).join(" / ")}
                <small>{[o.ubicacion && `Ubicación: ${o.ubicacion}`, (o.stockLV !== "" || o.stockSJL !== "") && `Stock LV ${o.stockLV === "" ? "—" : o.stockLV} · SJL ${o.stockSJL === "" ? "—" : o.stockSJL}`, o.equivalentes && `Equivalentes: ${o.equivalentes}`].filter(Boolean).join(" · ")}</small>
              </li>
            ))}
            {guia.total > guia.opciones.length && <li className="nota-suave">y {guia.total - guia.opciones.length} más: afina la descripción</li>}
          </ul>
        </details>
      )}
      <div className="linea__estado">
        <span className={"chip chip--" + pk.estado}>{ESTADOS[pk.estado]}{pk.estado === "encontrado" && pk.piso != null ? ` · piso ${pk.piso} · ${pk.puntaje} pts` : ""}</span>
        {l.modificadaTs && <span className="chip chip--aviso">Corregida por ventas</span>}
        {distinta && <span className="chip chip--aviso">Trajo {pk.cantidadEncontrada} de {l.cantidad}</span>}
      </div>
      <div className="botones" role="group" aria-label={`Marcar ${l.descripcion}`}>
        <button type="button" className={"btn" + (pk.estado === "buscando" ? " btn--sel" : "")} disabled={ocupada} onClick={() => estado("buscando")}>Buscando</button>
        <button type="button" className={"btn" + (pk.estado === "encontrado" || eligiendoPiso ? " btn--sel" : "")} disabled={ocupada} onClick={() => setEligiendoPiso((v) => !v)}>Encontrado</button>
        <button type="button" className={"btn" + (pk.estado === "no_encontrado" ? " btn--sel" : "")} disabled={ocupada} onClick={() => estado("no_encontrado")}>No hay</button>
      </div>
      {eligiendoPiso && (
        <div className="botones botones--pisos" role="group" aria-label="¿En qué piso?">
          {pisos.map(({ piso, puntos }) => (
            <button key={piso} type="button" className="btn btn--piso" disabled={ocupada} onClick={() => elegirPiso(piso)}>
              Piso {piso}<small>{puntos} pts</small>
            </button>
          ))}
        </div>
      )}
      <div className="botones botones--extra">
        <label className="marca"><input type="checkbox" checked={pk.taller} disabled={ocupada} onChange={(e) => marcar({ taller: e.target.checked })} /> Pasó por taller</label>
        <label className="marca"><input type="checkbox" checked={pk.reconocido === "muestra"} disabled={ocupada} onChange={(e) => marcar({ reconocido: e.target.checked ? "muestra" : null })} /> Por muestra</label>
        <label className="marca"><input type="checkbox" checked={pk.reconocido === "foto"} disabled={ocupada} onChange={(e) => marcar({ reconocido: e.target.checked ? "foto" : null })} /> Por foto</label>
        {pk.estado === "encontrado" && (
          <label className="marca">Cantidad
            <input className="num" type="number" min="1" value={pk.cantidadEncontrada ?? ""} disabled={ocupada}
              onChange={(e) => e.target.value !== "" && marcar({ cantidadEncontrada: Number(e.target.value) })} />
          </label>
        )}
      </div>
      <input className="nota" type="text" maxLength={300} placeholder="Nota (opcional)" value={nota}
        onChange={(e) => setNota(e.target.value)}
        onBlur={() => { if (nota.trim() !== (pk.nota ?? "")) marcar({ nota }); }} />
      {error && <p className="aviso-error" role="alert">{error}</p>}
    </li>
  );
}
