import { useEffect, useState } from "react";
import { api, mensajeDeError } from "./api.js";
import { configParaEnviar } from "./logica.js";

const EXTRAS = [["taller", "Pasó por taller"], ["muestra", "Reconocido por muestra"], ["foto", "Reconocido por foto"]];

// Pisos, puntajes y emisores de la empresa. Cambiar el puntaje solo afecta las marcas nuevas: lo ya medido no se toca.
export default function Config() {
  const [f, setF] = useState(null);
  const [error, setError] = useState("");
  const [guardado, setGuardado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { api.config.leer().then(setF, (e) => setError(mensajeDeError(e))); }, []);
  const tocar = (nuevo) => { setF(nuevo); setGuardado(false); };
  const piso = (i, campo, v) => tocar({ ...f, pisos: f.pisos.map((p, j) => (j === i ? { ...p, [campo]: v } : p)) });
  const emisor = (i, campo, v) => tocar({ ...f, emisores: f.emisores.map((e, j) => (j === i ? { ...e, [campo]: v } : e)) });

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true); setError("");
    try { setF(await api.config.guardar(configParaEnviar(f))); setGuardado(true); }
    catch (err) { setError(mensajeDeError(err)); }
    finally { setGuardando(false); }
  }

  if (!f) return <section><h1>Configuración</h1>{error ? <p className="aviso-error" role="alert">{error}</p> : <p className="cargando">Cargando…</p>}</section>;
  return (
    <section aria-labelledby="t-conf">
      <header className="cabecera"><h1 id="t-conf">Configuración</h1></header>
      <form className="form" onSubmit={guardar}>
        <details className="seccion" open>
          <summary>Pisos y puntajes</summary>
          <p className="nota-suave">Puntos que gana el almacén al encontrar un ítem en cada piso. Solo cuenta lo que se marque desde ahora.</p>
          <ul className="form-pagos">
            {f.pisos.map((p, i) => (
              <li key={i}>
                <input className="num" type="number" min="1" max="99" placeholder="Piso" aria-label={`Número del piso ${i + 1}`} value={p.piso} onChange={(e) => piso(i, "piso", e.target.value)} />
                <input className="num" type="number" min="0" step="0.5" placeholder="Puntos" aria-label={`Puntaje del piso ${i + 1}`} value={p.puntaje} onChange={(e) => piso(i, "puntaje", e.target.value)} />
                <button type="button" className="btn" aria-label={`Quitar piso ${i + 1}`} disabled={f.pisos.length <= 1} onClick={() => tocar({ ...f, pisos: f.pisos.filter((_, j) => j !== i) })}>✕</button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn" onClick={() => tocar({ ...f, pisos: [...f.pisos, { piso: Math.max(0, ...f.pisos.map((p) => Number(p.piso) || 0)) + 1, puntaje: 0 }] })}>Agregar piso</button>
        </details>

        <details className="seccion" open>
          <summary>Puntos extra</summary>
          <p className="nota-suave">Se suman al del piso cuando aplican. Déjalos en 0 si no puntúan.</p>
          <div className="form-cab">
            {EXTRAS.map(([k, n]) => (
              <label key={k}>{n}
                <input type="number" min="0" step="0.5" value={f.extras[k]} onChange={(e) => tocar({ ...f, extras: { ...f.extras, [k]: e.target.value } })} />
              </label>
            ))}
          </div>
        </details>

        <details className="seccion" open>
          <summary>Emisores ({f.emisores.filter((e) => e.activo !== false).length})</summary>
          <p className="nota-suave">Quién firma la proforma (razón social o sucursal). Un emisor no se borra: se desactiva, y las proformas ya hechas conservan sus datos.</p>
          {f.emisores.map((e, i) => (
            <div key={e.id ?? `n${i}`} className={"form-cab" + (e.activo === false ? " anulada" : "")} style={{ marginBottom: 12 }}>
              <label className="completo">Nombre<input value={e.nombre} maxLength={120} onChange={(ev) => emisor(i, "nombre", ev.target.value)} /></label>
              <label>RUC<input value={e.ruc ?? ""} maxLength={20} onChange={(ev) => emisor(i, "ruc", ev.target.value)} /></label>
              <label>Teléfono<input value={e.telefono ?? ""} maxLength={40} onChange={(ev) => emisor(i, "telefono", ev.target.value)} /></label>
              <label>E-mail<input value={e.email ?? ""} maxLength={120} onChange={(ev) => emisor(i, "email", ev.target.value)} /></label>
              <label className="completo">Dirección<input value={e.direccion ?? ""} maxLength={200} onChange={(ev) => emisor(i, "direccion", ev.target.value)} /></label>
              {e.id
                ? <label className="marca"><input type="checkbox" checked={e.activo !== false} onChange={(ev) => emisor(i, "activo", ev.target.checked)} /> Activo</label>
                : <button type="button" className="btn" onClick={() => tocar({ ...f, emisores: f.emisores.filter((_, j) => j !== i) })}>Quitar</button>}
            </div>
          ))}
          <button type="button" className="btn" onClick={() => tocar({ ...f, emisores: [...f.emisores, { nombre: "", ruc: "", telefono: "", email: "", direccion: "", activo: true }] })}>Agregar emisor</button>
        </details>

        {error && <p className="aviso-error" role="alert">{error}</p>}
        {guardado && <p className="aviso-ok" role="status">Configuración guardada.</p>}
        <div className="botones"><button type="submit" className="btn btn--primario" disabled={guardando}>{guardando ? "Guardando…" : "Guardar configuración"}</button></div>
      </form>
      <SincronizacionStock />
    </section>
  );
}

// Estado de la sincronización de stock (hoja de cálculo → catálogo) y botón para correrla ahora.
function SincronizacionStock() {
  const [e, setE] = useState(null);
  const [error, setError] = useState("");
  const [corriendo, setCorriendo] = useState(false);
  useEffect(() => { api.stock.estado().then(setE, (x) => setError(mensajeDeError(x))); }, []);

  async function ahora() {
    setCorriendo(true); setError("");
    try { await api.stock.sincronizar(); setE(await api.stock.estado()); }
    catch (x) { setError(mensajeDeError(x)); }
    finally { setCorriendo(false); }
  }
  const u = e?.ultima;
  return (
    <details className="seccion" open style={{ marginTop: 16 }}>
      <summary>Stock desde la hoja de cálculo</summary>
      {!e ? (error ? <p className="aviso-error" role="alert">{error}</p> : <p className="cargando">Cargando…</p>)
        : !e.configurado ? <p className="nota-suave">No está configurada. Faltan las variables de entorno del servidor (empresa, hoja y cuenta de Google); ver el README de topd.</p>
        : (
          <>
            <p className="nota-suave">Lee la hoja cada {e.cadaMin ?? "—"} min y actualiza el catálogo: stock LV y SJL, ubicación, equivalentes y precio. Solo envía lo que cambió.</p>
            {u ? (
              <p role="status" className={u.ok ? "aviso-ok" : "aviso-error"}>
                {new Date(u.ts).toLocaleString("es-PE")} · {u.ok
                  ? `${u.leidas} productos en la hoja: ${u.creados} nuevos, ${u.actualizados} actualizados, ${u.sinCambios} sin cambios${u.desactivados ? `, ${u.desactivados} desactivados` : ""}${u.reactivados ? `, ${u.reactivados} reactivados` : ""}.`
                  : `Falló: ${u.error}`}
              </p>
            ) : <p className="nota-suave">Aún no se ha sincronizado desde que arrancó el servidor.</p>}
            {u?.avisos?.map((a) => <p key={a} className="aviso-error" role="alert">{a}</p>)}
            {u?.descartadas?.length > 0 && (
              <details><summary>{u.descartadas.length} fila(s) de la hoja no se pudieron cargar</summary>
                <ul>{u.descartadas.map((d, i) => <li key={i}>{d.fila ? `Fila ${d.fila}` : "Fila"} · {d.codigo}: {d.error}</li>)}</ul>
              </details>
            )}
            {error && <p className="aviso-error" role="alert">{error}</p>}
            <div className="botones"><button type="button" className="btn" disabled={corriendo || e.corriendo} onClick={ahora}>{corriendo ? "Sincronizando…" : "Sincronizar ahora"}</button></div>
          </>
        )}
    </details>
  );
}
