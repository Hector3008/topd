import { useEffect, useState } from "react";
import { api, mensajeDeError } from "./api.js";
import { CAMPOS_CABECERA, cabeceraVacia, formularioDeLectura, prepararProforma, reducirDimensiones, sumaDelFormulario } from "./logica.js";

const vacia = () => ({ cantidad: "", descripcion: "", precioUnitario: "", anulada: false, dudoso: false });
const FORMAS_PAGO = [["", "—"], ["efectivo", "Efectivo"], ["deposito", "Depósito"], ["credito", "Crédito"]];

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
export default function NuevaProforma({ alCrear }) {
  const [cabecera, setCabecera] = useState(cabeceraVacia());
  const [lineas, setLineas] = useState([vacia(), vacia(), vacia()]);
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

  useEffect(() => { api.ocr().then((d) => setOcrActivo(d.activo), () => setOcrActivo(false)); }, []);

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
    setCabecera(cabeceraVacia()); setLineas([vacia(), vacia(), vacia()]); setFoto(null); setLectura(null); setOrigen("manual");
  }

  async function enviar(e) {
    e.preventDefault();
    const r = prepararProforma({ cabecera, lineas });
    if (r.error) return setError(r.error);
    setEnviando(true); setError("");
    try {
      const { code } = await api.proformas.crear({ cabecera: r.cabecera, lineas: r.lineas, origen });
      setCreada(code);
      limpiar();
    } catch (err) { setError(mensajeDeError(err)); }
    finally { setEnviando(false); }
  }

  return (
    <section aria-labelledby="t-nueva">
      <header className="cabecera"><h1 id="t-nueva">Nueva proforma</h1></header>
      {creada && (
        <p className="aviso-ok" role="status">
          Creada {creada}: ya está en el almacén. {alCrear && <button type="button" className="enlace-btn" onClick={alCrear}>Ver almacén</button>}
        </p>
      )}

      <div className="ocr">
        <fieldset className="ocr__modo" disabled={leyendo}>
          <legend>¿Cómo está la proforma de papel?</legend>
          <label className="marca"><input type="radio" name="modo" checked={modo === "impreso"} onChange={() => setModo("impreso")} /> Impresa</label>
          <label className="marca"><input type="radio" name="modo" checked={modo === "manuscrito"} onChange={() => setModo("manuscrito")} /> Escrita a mano</label>
        </fieldset>
        <label className={"btn btn--primario" + (leyendo || ocrActivo === false ? " btn--off" : "")}>
          {leyendo ? "Leyendo la foto…" : "Leer foto de la proforma"}
          <input type="file" accept="image/*" capture="environment" hidden disabled={leyendo || ocrActivo === false} onChange={leer} />
        </label>
        {ocrActivo === false && <p className="nota-suave">La lectura de fotos aún no está activada en este servidor: carga la proforma a mano.</p>}
      </div>

      <div className={foto ? "revision" : ""}>
        {foto && (
          <figure className="revision__foto">
            <img src={foto} alt="Foto de la proforma de papel" />
            <figcaption>Compara con el papel y corrige lo que haga falta.</figcaption>
          </figure>
        )}
        <form onSubmit={enviar} className="form">
          {lectura?.avisos?.length > 0 && (
            <ul className="avisos" role="status">
              {lectura.avisos.map((a, i) => <li key={i}>{a.mensaje}</li>)}
            </ul>
          )}
          <div className="form-cab">
            {CAMPOS_CABECERA.map(([k, nombre]) => (
              <label key={k}>{nombre}<input value={cabecera[k]} onChange={(e) => setCabecera({ ...cabecera, [k]: e.target.value })} maxLength={200} /></label>
            ))}
            <label>Forma de pago
              <select value={cabecera.formaPago} onChange={(e) => setCabecera({ ...cabecera, formaPago: e.target.value })}>
                {FORMAS_PAGO.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
              </select>
            </label>
          </div>
          <ul className="form-lineas">
            {lineas.map((l, i) => (
              <li key={i} className={(l.anulada ? "anulada " : "") + (l.dudoso ? "dudosa" : "")}>
                <input className="num" type="number" min="1" inputMode="numeric" placeholder="Cant." aria-label={`Cantidad línea ${i + 1}`} value={l.cantidad} onChange={(e) => cambiar(i, "cantidad", e.target.value)} />
                <input className="desc-in" placeholder="Descripción" aria-label={`Descripción línea ${i + 1}`} value={l.descripcion} onChange={(e) => cambiar(i, "descripcion", e.target.value)} />
                <input className="num" type="number" min="0" step="0.01" inputMode="decimal" placeholder="P. unit." aria-label={`Precio línea ${i + 1}`} value={l.precioUnitario} onChange={(e) => cambiar(i, "precioUnitario", e.target.value)} />
                <label className="marca"><input type="checkbox" checked={l.anulada} onChange={(e) => cambiar(i, "anulada", e.target.checked)} /> Tachada</label>
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
            {foto && <button type="button" className="btn" onClick={limpiar}>Descartar lectura</button>}
            <button type="submit" className="btn btn--primario" disabled={enviando}>{enviando ? "Creando…" : "Crear y mandar al almacén"}</button>
          </div>
        </form>
      </div>
    </section>
  );
}
