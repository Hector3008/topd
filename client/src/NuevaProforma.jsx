import { useEffect, useState } from "react";
import { api, mensajeDeError, urlPlantilla } from "./api.js";
import { CIERRES_POR_ESTADO, MOTIVOS, SECCIONES_CABECERA, detalleLinea, cabeceraVacia, formularioDeLectura, formularioDeProforma, pagoVacio, prepararProforma, reducirDimensiones, sumaDelFormulario } from "./logica.js";

const vacia = () => ({ cantidad: "", descripcion: "", precioUnitario: "", comentario: "", anulada: false, dudoso: false });

// Reduce la foto en el teléfono (lado mayor 1600 px, JPEG): se lee igual y viaja en una fracción del peso.
async function fotoReducida(archivo) {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error("imagen")); i.src = url; });
    const { ancho, alto } = reducirDimensiones(img.naturalWidth, img.naturalHeight);
    const lienzo = document.createElement("canvas");
    lienzo.width = ancho; lienzo.height = alto;
    lienzo.getContext("2d").drawImage(img, 0, 0, ancho, alto);
    return lienzo.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Estación de creación: carga manual o leyendo la foto de la proforma en papel (OCR impreso o manuscrito).
// El OCR solo rellena este formulario: nada se crea hasta que una persona lo revisa y pulsa «Crear».
// Con `codigo` es el mismo formulario para corregir una proforma ya generada (PUT con la versión que se abrió).
export default function NuevaProforma({ alCrear, codigo = null, alTerminar = null }) {
  const [cabecera, setCabecera] = useState(cabeceraVacia());
  const [lineas, setLineas] = useState([vacia(), vacia(), vacia()]);
  const [pagos, setPagos] = useState([]);
  const [error, setError] = useState("");
  const [creada, setCreada] = useState(null);
  const [enviando, setEnviando] = useState(false);
  // OCR
  const [ocrActivo, setOcrActivo] = useState(null); // null = aún no se sabe
  const [modo, setModo] = useState("manuscrito");
  const [leyendo, setLeyendo] = useState(false);
  const [foto, setFoto] = useState(null); // data URL para verla al lado del formulario
  const [origen, setOrigen] = useState("manual");
  const [lectura, setLectura] = useState(null); // { total, avisos }
  // Edición
  const editando = codigo != null;
  const [version, setVersion] = useState(null);
  const [cargando, setCargando] = useState(editando);
  const [estado, setEstado] = useState(null);
  // Emisor (quién firma) y cierre sin vender
  const [emisores, setEmisores] = useState([]);
  const [emisorId, setEmisorId] = useState("");
  const [emisorInicial, setEmisorInicial] = useState(""); // el que traía la proforma: solo se envía si cambia
  const [emisorGuardado, setEmisorGuardado] = useState(null);
  const [cierre, setCierre] = useState({ a: "", codigo: "", detalle: "" });

  useEffect(() => {
    if (!editando) return;
    let vivo = true;
    api.proformas.obtener(codigo).then((p) => {
      if (!vivo) return;
      const f = formularioDeProforma(p);
      setCabecera(f.cabecera); setLineas(f.lineas.length ? f.lineas : [vacia()]); setPagos(f.pagos);
      setVersion(p.version); setEstado(p.estado); setOrigen(p.origenCarga ?? "manual");
      setEmisorId(p.emisor?.id ?? ""); setEmisorInicial(p.emisor?.id ?? ""); setEmisorGuardado(p.emisor ?? null);
      if (!p.editable) setError("Esta proforma ya salió del almacén y no se puede editar.");
    }, (err) => vivo && setError(mensajeDeError(err))).finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [codigo, editando]);

  useEffect(() => { api.proformas.opciones().then((d) => setEmisores(d.emisores ?? []), () => {}); }, []);
  useEffect(() => { if (editando) return; api.ocr().then((d) => setOcrActivo(d.activo), () => setOcrActivo(false)); }, []);

  const cambiar = (i, campo, valor) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor, dudoso: campo === "anulada" ? l.dudoso : false } : l)));
  const suma = sumaDelFormulario(lineas);
  const total = lineas.filter((l) => !l.anulada).reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precioUnitario) || 0), 0);
  const descuadre = lectura?.total != null && Math.abs(lectura.total - suma) > 0.011;

  async function leer(e) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    setLeyendo(true); setError("");
    try {
      const imagen = await fotoReducida(archivo);
      const r = await api.proformas.leer({ imagen, modo });
      const f = formularioDeLectura(r);
      setFoto(imagen);
      setCabecera(f.cabecera);
      setLineas(f.lineas.length ? f.lineas : [vacia(), vacia(), vacia()]);
      setLectura({ total: f.total, avisos: f.avisos });
      setOrigen(`ocr:${modo}`);
      setCreada(null);
    } catch (err) {
      setError(err.message === "imagen" ? "No se pudo abrir la foto." : mensajeDeError(err));
    } finally {
      setLeyendo(false);
    }
  }

  // Carga desde Excel o PDF: gratis y exacta (no hay OCR). Llena el mismo formulario para revisarlo.
  async function cargarArchivo(e) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    setLeyendo(true); setError("");
    try {
      const r = await api.proformas.leerArchivo(archivo);
      const f = formularioDeLectura(r);
      setFoto(null);
      setCabecera(f.cabecera);
      setLineas(f.lineas.length ? f.lineas : [vacia(), vacia(), vacia()]);
      setLectura({ total: f.total, avisos: f.avisos });
      setOrigen(r.origen ?? "archivo:xlsx");
      setCreada(null);
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setLeyendo(false);
    }
  }

  function limpiar() {
    setCabecera(cabeceraVacia()); setLineas([vacia(), vacia(), vacia()]); setPagos([]); setFoto(null); setLectura(null); setOrigen("manual");
  }

  // Guarda (crea o corrige) y, si se pide, mueve la proforma: «borrador», «cotizacion» u «orden_salida».
  async function enviar(destino = "orden_salida") {
    const esBorrador = editando ? estado === "borrador" : destino === "borrador";
    const r = prepararProforma({ cabecera, lineas, pagos }, { permitirVacio: esBorrador });
    if (r.error) return setError(r.error);
    setEnviando(true); setError("");
    try {
      if (!editando) {
        const { code, estado: nuevo } = await api.proformas.crear({ cabecera: r.cabecera, lineas: r.lineas, pagos: r.pagos, origen, emisorId, destino });
        setCreada({ code, estado: nuevo });
        limpiar();
        return;
      }
      const cuerpo = { cabecera: r.cabecera, lineas: r.lineas, pagos: r.pagos, version };
      if (emisorId !== emisorInicial) cuerpo.emisorId = emisorId;
      const resp = await api.proformas.editar(codigo, cuerpo);
      if (destino && destino !== estado && ["cotizacion", "orden_salida"].includes(destino))
        await api.proformas.cambiarEstado(codigo, { a: destino, version: resp.version });
      alTerminar?.({ code: codigo, ...resp });
    } catch (err) { setError(mensajeDeError(err)); }
    finally { setEnviando(false); }
  }

  async function cerrarSinVender() {
    if (!cierre.a || !cierre.codigo) return setError("Elige cómo se cierra y el motivo.");
    setEnviando(true); setError("");
    try {
      await api.proformas.cambiarEstado(codigo, { a: cierre.a, version, motivo: { codigo: cierre.codigo, ...(cierre.detalle.trim() && { detalle: cierre.detalle.trim() }) } });
      alTerminar?.({ code: codigo });
    } catch (err) { setError(mensajeDeError(err)); }
    finally { setEnviando(false); }
  }

  const cierres = CIERRES_POR_ESTADO[estado] ?? [];
  // El emisor actual de la proforma aparece aunque se haya desactivado después
  const opcionesEmisor = emisorGuardado && !emisores.some((x) => x.id === emisorGuardado.id) ? [...emisores, emisorGuardado] : emisores;
  const textoCreada = { borrador: "guardada como borrador", cotizacion: "guardada como cotización", orden_salida: "creada: ya está en el almacén" };

  return (
    <section aria-labelledby="t-nueva">
      <header className="cabecera">
        <h1 id="t-nueva">{editando ? `Editar ${codigo}` : "Nueva proforma"}</h1>
        {editando && <button type="button" className="btn" onClick={() => alTerminar?.(null)}>Cancelar</button>}
      </header>
      {editando && estado === "orden_salida" && <p className="nota-suave">El almacén verá los cambios en unos segundos. Si cambias cantidad, descripción o tachas una línea, su búsqueda empieza de nuevo; con precio o comentario no.</p>}
      {cargando && <p className="cargando">Cargando…</p>}
      {!editando && creada && (
        <p className="aviso-ok" role="status">
          {creada.code} {textoCreada[creada.estado]}. {creada.estado === "orden_salida" && alCrear && <button type="button" className="enlace-btn" onClick={alCrear}>Ver almacén</button>}
        </p>
      )}

      {!editando && (
        <div className="ocr">
          <label className={"btn btn--primario" + (leyendo ? " btn--off" : "")}>
            {leyendo ? "Leyendo el archivo…" : "Cargar desde Excel o PDF"}
            <input type="file" accept=".xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden disabled={leyendo} onChange={cargarArchivo} />
          </label>
          <p className="nota-suave">Gratis y exacto. Revisa lo cargado antes de crear; si el PDF es una imagen, usa la foto.</p>
          <a className="btn" href={urlPlantilla} download>Descargar plantilla de Excel</a>
        </div>
      )}
      {!editando && ocrActivo !== false && <div className="ocr">
        <fieldset className="ocr__modo" disabled={leyendo}>
          <legend>¿Cómo está la proforma de papel?</legend>
          <label className="marca"><input type="radio" name="modo" checked={modo === "impreso"} onChange={() => setModo("impreso")} /> Impresa</label>
          <label className="marca"><input type="radio" name="modo" checked={modo === "manuscrito"} onChange={() => setModo("manuscrito")} /> Escrita a mano</label>
        </fieldset>
        <label className={"btn btn--primario" + (leyendo ? " btn--off" : "")}>
          {leyendo ? "Leyendo la foto…" : "Leer foto de la proforma"}
          <input type="file" accept="image/*" capture="environment" hidden disabled={leyendo} onChange={leer} />
        </label>
      </div>}

      <div className={foto ? "revision" : ""}>
        {foto && (
          <figure className="revision__foto">
            <img src={foto} alt="Foto de la proforma de papel" />
            <figcaption>Compara con el papel y corrige lo que haga falta.</figcaption>
          </figure>
        )}
        <form onSubmit={(e) => { e.preventDefault(); enviar(editando ? null : "orden_salida"); }} className="form" hidden={cargando}>
          {lectura?.avisos?.length > 0 && (
            <ul className="avisos" role="status">
              {lectura.avisos.map((a, i) => <li key={i}>{a.mensaje}</li>)}
            </ul>
          )}
          {(opcionesEmisor.length > 0 || emisorId) && (
            <label className="completo">Emisor (quién firma)
              <select value={emisorId} onChange={(e) => setEmisorId(e.target.value)}>
                <option value="">— Sin emisor —</option>
                {opcionesEmisor.map((x) => <option key={x.id} value={x.id}>{x.nombre}{x.ruc ? ` · ${x.ruc}` : ""}</option>)}
              </select>
            </label>
          )}
          {SECCIONES_CABECERA.map((sec) => (
            <details key={sec.id} className="seccion" open={sec.abierta}>
              <summary>{sec.titulo}</summary>
              <div className="form-cab">
                {sec.campos.map((c) => (
                  <label key={c.k} className={c.ancho === "completo" ? "completo" : ""}>{c.n}
                    {c.opciones ? (
                      <select value={cabecera[c.k]} onChange={(e) => setCabecera({ ...cabecera, [c.k]: e.target.value })}>
                        <option value="">—</option>
                        {c.opciones.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                      </select>
                    ) : (
                      <input type={c.tipo ?? "text"} value={cabecera[c.k]} onChange={(e) => setCabecera({ ...cabecera, [c.k]: e.target.value })} maxLength={200} />
                    )}
                  </label>
                ))}
              </div>
            </details>
          ))}

          <details className="seccion" open={pagos.length > 0}>
            <summary>Pagos recibidos{pagos.length ? ` (${pagos.length})` : ""}</summary>
            <ul className="form-pagos">
              {pagos.map((p, i) => (
                <li key={i}>
                  <input placeholder="Cuenta destino (BCP, Yape…)" aria-label={`Cuenta del pago ${i + 1}`} value={p.cuenta} maxLength={60} onChange={(e) => setPagos((ps) => ps.map((x, j) => (j === i ? { ...x, cuenta: e.target.value } : x)))} />
                  <input className="num" type="number" min="0" step="0.01" inputMode="decimal" placeholder="Monto" aria-label={`Monto del pago ${i + 1}`} value={p.monto} onChange={(e) => setPagos((ps) => ps.map((x, j) => (j === i ? { ...x, monto: e.target.value } : x)))} />
                  <input placeholder="N.º de operación" aria-label={`Operación del pago ${i + 1}`} value={p.operacion} maxLength={40} onChange={(e) => setPagos((ps) => ps.map((x, j) => (j === i ? { ...x, operacion: e.target.value } : x)))} />
                  <button type="button" className="btn" aria-label={`Quitar pago ${i + 1}`} onClick={() => setPagos((ps) => ps.filter((_, j) => j !== i))}>✕</button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn" onClick={() => setPagos((ps) => [...ps, pagoVacio()])}>Agregar pago</button>
          </details>

          <ul className="form-lineas">
            {lineas.map((l, i) => (
              <li key={i} className={(l.anulada ? "anulada " : "") + (l.dudoso ? "dudosa" : "")}>
                <input className="num" type="number" min="1" inputMode="numeric" placeholder="Cant." aria-label={`Cantidad línea ${i + 1}`} value={l.cantidad} onChange={(e) => cambiar(i, "cantidad", e.target.value)} />
                <input className="desc-in" placeholder="Descripción" aria-label={`Descripción línea ${i + 1}`} value={l.descripcion} onChange={(e) => cambiar(i, "descripcion", e.target.value)} />
                <input className="num" type="number" min="0" step="0.01" inputMode="decimal" placeholder="P. unit." aria-label={`Precio línea ${i + 1}`} value={l.precioUnitario} onChange={(e) => cambiar(i, "precioUnitario", e.target.value)} />
                {editando && <button type="button" className="btn" aria-label={`Quitar línea ${i + 1}`} onClick={() => setLineas((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))}>✕</button>}
                <label className="marca"><input type="checkbox" checked={l.anulada} onChange={(e) => cambiar(i, "anulada", e.target.checked)} /> Tachada</label>
                <input className="coment-in" placeholder="Comentario para el almacén (opcional)" aria-label={`Comentario línea ${i + 1}`} maxLength={300} value={l.comentario} onChange={(e) => cambiar(i, "comentario", e.target.value)} />
                {detalleLinea(l) && <span className="detalle">{detalleLinea(l)}</span>}
                {l.dudoso && <span className="chip chip--aviso">Revisar</span>}
              </li>
            ))}
          </ul>
          <div className="botones">
            <button type="button" className="btn" onClick={() => setLineas((ls) => [...ls, vacia()])}>Agregar línea</button>
            <span className="total">Total S/ {total.toFixed(2)}</span>
          </div>
          {descuadre && <p className="aviso-error" role="status">El papel dice S/ {lectura.total.toFixed(2)} y las líneas suman S/ {suma.toFixed(2)}: revisa cantidades y precios.</p>}
          {error && <p className="aviso-error" role="alert">{error}</p>}
          <div className="botones">
            {!editando && foto && <button type="button" className="btn" onClick={limpiar}>Descartar lectura</button>}
            {!editando && <button type="button" className="btn" disabled={enviando} onClick={() => enviar("borrador")}>Guardar borrador</button>}
            {!editando && <button type="button" className="btn" disabled={enviando} onClick={() => enviar("cotizacion")}>Guardar como cotización</button>}
            {editando && estado === "borrador" && <button type="button" className="btn" disabled={enviando || version == null} onClick={() => enviar("cotizacion")}>Guardar y pasar a cotización</button>}
            {editando && ["borrador", "cotizacion"].includes(estado) && <button type="button" className="btn" disabled={enviando || version == null} onClick={() => enviar("orden_salida")}>Guardar y mandar al almacén</button>}
            <button type="submit" className="btn btn--primario" disabled={enviando || (editando && version == null)}>
              {editando ? (enviando ? "Guardando…" : "Guardar cambios") : enviando ? "Creando…" : "Crear y mandar al almacén"}
            </button>
          </div>
          {editando && cierres.length > 0 && (
            <details className="seccion">
              <summary>Cerrar sin vender</summary>
              <div className="form-cab">
                <label>Cómo
                  <select value={cierre.a} onChange={(e) => setCierre({ a: e.target.value, codigo: "", detalle: "" })}>
                    <option value="">—</option>
                    {cierres.map((k) => <option key={k} value={k}>{MOTIVOS[k].titulo}</option>)}
                  </select>
                </label>
                <label>Motivo
                  <select value={cierre.codigo} disabled={!cierre.a} onChange={(e) => setCierre({ ...cierre, codigo: e.target.value })}>
                    <option value="">—</option>
                    {(MOTIVOS[cierre.a]?.motivos ?? []).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                  </select>
                </label>
                <label className="completo">Detalle (opcional)<input value={cierre.detalle} maxLength={200} onChange={(e) => setCierre({ ...cierre, detalle: e.target.value })} /></label>
              </div>
              <button type="button" className="btn" disabled={enviando || version == null} onClick={cerrarSinVender}>Cerrar sin vender</button>
            </details>
          )}
        </form>
      </div>
    </section>
  );
}
