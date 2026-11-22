import { useEffect, useState } from "react";
import { api, mensajeDeError } from "./api.js";
import { SECCIONES_CABECERA, cabeceraVacia, formularioDeLectura, formularioDeProforma, pagoVacio, prepararProforma, reducirDimensiones, sumaDelFormulario } from "./logica.js";

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

  useEffect(() => {
    if (!editando) return;
    let vivo = true;
    api.proformas.obtener(codigo).then((p) => {
      if (!vivo) return;
      const f = formularioDeProforma(p);
      setCabecera(f.cabecera); setLineas(f.lineas.length ? f.lineas : [vacia()]); setPagos(f.pagos);
      setVersion(p.version); setEstado(p.estado); setOrigen(p.origenCarga ?? "manual");
      if (!p.editable) setError("Esta proforma ya salió del almacén y no se puede editar.");
    }, (err) => vivo && setError(mensajeDeError(err))).finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [codigo, editando]);

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

  function limpiar() {
    setCabecera(cabeceraVacia()); setLineas([vacia(), vacia(), vacia()]); setPagos([]); setFoto(null); setLectura(null); setOrigen("manual");
  }

  async function enviar(e) {
    e.preventDefault();
    const r = prepararProforma({ cabecera, lineas, pagos });
    if (r.error) return setError(r.error);
    setEnviando(true); setError("");
    if (editando) {
      try {
        const resp = await api.proformas.editar(codigo, { cabecera: r.cabecera, lineas: r.lineas, pagos: r.pagos, version });
        alTerminar?.({ code: codigo, ...resp });
      } catch (err) { setError(mensajeDeError(err)); }
      finally { setEnviando(false); }
      return;
    }
    try {
      const { code } = await api.proformas.crear({ cabecera: r.cabecera, lineas: r.lineas, pagos: r.pagos, origen });
      setCreada(code);
      limpiar();
    } catch (err) { setError(mensajeDeError(err)); }
    finally { setEnviando(false); }
  }

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
          Creada {creada}: ya está en el almacén. {alCrear && <button type="button" className="enlace-btn" onClick={alCrear}>Ver almacén</button>}
        </p>
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
        <form onSubmit={enviar} className="form" hidden={cargando}>
          {lectura?.avisos?.length > 0 && (
            <ul className="avisos" role="status">
              {lectura.avisos.map((a, i) => <li key={i}>{a.mensaje}</li>)}
            </ul>
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
            <button type="submit" className="btn btn--primario" disabled={enviando || (editando && version == null)}>
              {editando ? (enviando ? "Guardando…" : "Guardar cambios") : enviando ? "Creando…" : "Crear y mandar al almacén"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
