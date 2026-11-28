import { useEffect, useRef, useState } from "react";
import { api, mensajeDeError } from "./api.js";
import { useSondeo } from "./useSondeo.js";
import { useOpciones } from "./useOpciones.js";
import FotosLinea from "./FotosLinea.jsx";
import AgregarOpcion from "./AgregarOpcion.jsx";
import AgregarItem from "./AgregarItem.jsx";
import { ESTADOS, cambioDeEstado, detalleLinea, dinero, faltanteDeLinea, fotosDeLinea, haceCuanto, pisosDe, resumenEntrega, textoAgregada } from "./logica.js";

// Búsqueda libre en todo el catálogo (para sumar una opción o un ítem que la guía no traía)
const buscarCatalogo = async (texto) => (await api.picking.opciones([{ k: "q", descripcion: texto }])).lineas?.q ?? { opciones: [], total: 0 };


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
          <AgregarItem buscar={buscarCatalogo} pisos={pisos} alAgregar={async (cuerpo) => { await api.picking.agregarLinea(p.code, cuerpo); await alCambiar(); }} />
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

  // Opciones sacadas: { codigo, descripcion, cantidad, piso }. Los cambios se ven al instante (borrador) y se envían juntos
  // medio segundo después del último toque: así se pueden subir muchas unidades sin esperar al servidor en cada una.
  const [borrador, setBorrador] = useState(null);
  const temporizador = useRef(null);
  const secuencia = useRef(0);
  const sacados = borrador ?? pk.sacados ?? [];
  const [pisoElegido, setPisoElegido] = useState({}); // piso escogido para una opción aún sin unidades
  const sacadosDe = (codigo) => sacados.find((s) => s.codigo === codigo);
  const suma = sacados.reduce((t, s) => t + s.cantidad, 0);
  function cambiarSacados(lista) {
    setBorrador(lista);
    const mia = ++secuencia.current;
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(async () => {
      setError("");
      try { await api.picking.marcar(code, l.id, { sacados: lista.map(({ codigo, descripcion, cantidad, piso, agregada }) => ({ codigo, descripcion, cantidad, piso, ...(agregada && { agregada }) })) }); }
      catch (e) { setError(mensajeDeError(e)); }
      finally { await alCambiar(); if (secuencia.current === mia) setBorrador(null); }
    }, 450);
  }
  function sacar(o, cantidad, piso) {
    const resto = sacados.filter((s) => s.codigo !== o.codigo);
    const otras = resto.reduce((t, s) => t + s.cantidad, 0);
    const cant = Math.max(0, Math.min(Math.trunc(cantidad) || 0, l.cantidad - otras));
    cambiarSacados(cant > 0 ? [...resto, { codigo: o.codigo, descripcion: o.descripcion ?? "", cantidad: cant, piso }] : resto);
  }

  return (
    <li className={"linea linea--" + pk.estado}>
      <div className="linea__texto">
        <span className="cant">{l.cantidad}</span>
        <span className="desc">{l.descripcion}</span>
        {l.precioUnitario != null && <span className="precio">S/ {dinero(l.precioUnitario)}</span>}
      </div>
      {detalleLinea(l) && <p className="detalle">{detalleLinea(l)}</p>}
      {l.comentario && <p className="comentario-linea">{l.comentario}</p>}
      <FotosLinea titulo="Referencia de ventas" fotos={fotosDeLinea(l).referencia} />
      <FotosLinea titulo="Fotos del almacén" fotos={fotosDeLinea(l).almacen} max={10} etiqueta={l.descripcion}
        alAgregar={async (u) => { await api.picking.agregarFoto(code, l.id, u); await alCambiar(); }}
        alQuitar={async (u) => { await api.picking.quitarFoto(code, l.id, u); await alCambiar(); }} />
      {textoAgregada(l) && <p className="nota-suave"><span className="chip chip--aviso">{textoAgregada(l)}</span></p>}
      {guia && !catalogoVacio && (
        <details className="opciones-cat" open={(guia.total > 0 && guia.total <= 3) || sacados.length > 0}>
          <summary>{guia.total === 0 ? (guia.descartadas > 0 ? "Ventas descartó todas las opciones del catálogo" : "Sin coincidencias en el catálogo") : `${guia.total} ${guia.total === 1 ? "opción" : "opciones"} en el catálogo`}{guia.total > 0 && guia.descartadas > 0 ? ` (${guia.descartadas} descartada${guia.descartadas === 1 ? "" : "s"} por ventas)` : ""}{sacados.length > 0 ? ` · sacado ${suma} de ${l.cantidad}` : ""}</summary>
          <ul>
            {guia.opciones.map((o) => (
              <li key={o.id ?? o.codigo}>
                <b>{o.codigo}</b> · {[o.descripcion, o.familia, o.subfamilia].filter(Boolean).join(" / ")}
                <small>{[o.ubicacion && `Ubicación: ${o.ubicacion}`, (o.stockLV !== "" || o.stockSJL !== "") && `Stock LV ${o.stockLV === "" ? "—" : o.stockLV} · SJL ${o.stockSJL === "" ? "—" : o.stockSJL}`, o.equivalentes && `Equivalentes: ${o.equivalentes}`].filter(Boolean).join(" · ")}</small>
                <Sacar o={o} actual={sacadosDe(o.codigo)} pisos={pisos} max={l.cantidad - (suma - (sacadosDe(o.codigo)?.cantidad ?? 0))}
                  piso={sacadosDe(o.codigo)?.piso ?? pisoElegido[o.codigo] ?? ""}
                  alPiso={(p) => (sacadosDe(o.codigo) ? sacar(o, sacadosDe(o.codigo).cantidad, p) : setPisoElegido((x) => ({ ...x, [o.codigo]: p })))}
                  alCantidad={(c, p) => sacar(o, c, p)} />
              </li>
            ))}
            {sacados.filter((s) => !guia.opciones.some((o) => o.codigo === s.codigo)).map((s) => (
              <li key={`s-${s.codigo}`} className="nota-suave">
                {s.agregada ? "Opción agregada" : "Sacado"}: {s.cantidad} × {s.codigo} (piso {s.piso}){s.descripcion ? ` · ${s.descripcion}` : ""}{s.agregada ? "" : " — ya no está entre las opciones"}
                <button type="button" className="btn" onClick={() => cambiarSacados(sacados.filter((x) => x.codigo !== s.codigo))}>Quitar</button>
              </li>
            ))}
            {guia.total > guia.opciones.length && <li className="nota-suave">y {guia.total - guia.opciones.length} más: afina la descripción</li>}
          </ul>
        </details>
      )}
      {!catalogoVacio && <AgregarOpcion buscar={buscarCatalogo} pisos={pisos} max={faltanteDeLinea(l, sacados)}
        alAgregar={async (n) => cambiarSacados([...sacados.filter((s) => s.codigo !== n.codigo), { ...n, agregada: "almacen" }])} />}
      <div className="linea__estado">
        <span className={"chip chip--" + pk.estado}>{ESTADOS[pk.estado]}{pk.estado === "encontrado" && sacados.length > 0 ? ` · ${sacados.map((x) => `${x.cantidad} × ${x.codigo} (piso ${x.piso})`).join(" + ")} · ${pk.puntaje} pts` : pk.estado === "encontrado" && pk.piso != null ? ` · piso ${pk.piso} · ${pk.puntaje} pts` : ""}</span>
        {l.modificadaTs && <span className="chip chip--aviso">Corregida por ventas</span>}
        {distinta && <span className="chip chip--aviso">Trajo {pk.cantidadEncontrada} de {l.cantidad}</span>}
      </div>
      <div className="botones" role="group" aria-label={`Marcar ${l.descripcion}`}>
        <button type="button" className={"btn" + (pk.estado === "buscando" ? " btn--sel" : "")} disabled={ocupada} onClick={() => estado("buscando")}>Buscando</button>
        {sacados.length === 0 && <button type="button" className={"btn" + (pk.estado === "encontrado" || eligiendoPiso ? " btn--sel" : "")} disabled={ocupada} onClick={() => setEligiendoPiso((v) => !v)}>Encontrado</button>}
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
        {pk.estado === "encontrado" && sacados.length === 0 && (
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

// Cuántas unidades de esta opción se sacaron y de qué piso. El piso se escoge primero (es lo que da el puntaje);
// después se suben o bajan las unidades. `max`: lo que todavía falta para completar la línea.
function Sacar({ o, actual, pisos, piso, max, alPiso, alCantidad }) {
  const cant = actual?.cantidad ?? 0;
  return (
    <div className="sacar" role="group" aria-label={`Sacar ${o.codigo}`}>
      {o.puntaje != null && <small className="sacar__pts" title="Puntaje propio de este ítem (columna PUNTAJE de la hoja)">{o.puntaje} pts</small>}
      <label>Piso
        <select aria-label={`Piso de ${o.codigo}`} value={piso} onChange={(e) => alPiso(Number(e.target.value))}>
          <option value="" disabled>—</option>
          {pisos.map((p) => <option key={p.piso} value={p.piso}>{p.piso}</option>)}
        </select>
      </label>
      <button type="button" className="btn" aria-label={`Quitar una unidad de ${o.codigo}`} disabled={cant < 1} onClick={() => alCantidad(cant - 1, piso)}>−</button>
      <input className="num sacar__n" type="number" inputMode="numeric" min="0" max={max} aria-label={`Unidades sacadas de ${o.codigo}`} value={cant} disabled={piso === ""}
        onChange={(e) => alCantidad(e.target.value === "" ? 0 : Number(e.target.value), piso)} onFocus={(e) => e.target.select()} />
      <button type="button" className="btn" aria-label={`Sacar una unidad de ${o.codigo}`} disabled={piso === "" || cant >= max} onClick={() => alCantidad(cant + 1, piso)}>+</button>
      <button type="button" className="btn" aria-label={`Sacar todas las unidades que faltan de ${o.codigo}`} disabled={piso === "" || cant >= max} onClick={() => alCantidad(max, piso)}>Todo</button>
    </div>
  );
}
