import { useState } from "react";
import { api } from "./api.js";
import { useOpciones } from "./useOpciones.js";
import { COMPROBANTES, ENTREGAS, CANALES_VENTA, FORMAS_PAGO, dinero, resumenEntrega, textoOpcion, vistaDeProforma } from "./logica.js";

const soles = (n) => `S/ ${dinero(n) || "0.00"}`;
const hoyISO = () => new Date().toLocaleDateString("en-CA"); // AAAA-MM-DD en la hora del dispositivo
const dia = (f) => (f && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f.split("-").reverse().join("/") : f || "");

// Vista previa en vivo del documento que se está creando: la proforma para el cliente y la guía del almacén.
// Solo muestra lo que hay en el formulario; no valida ni guarda nada.
export default function VistaPrevia({ cabecera, lineas, pagos, emisor, codigo, version, estado }) {
  const [hoja, setHoja] = useState("proforma");
  const v = vistaDeProforma({ cabecera, lineas, pagos });
  // Guía: opciones del catálogo para cada línea (solo se piden con la hoja de la guía abierta)
  const op = useOpciones(v.items.map((it) => ({ k: String(it.n), descripcion: it.descripcion, codMax: it.codMax })), api.guia.opciones, { activo: hoja === "guia" });
  const c = cabecera;
  const fecha = dia(c.fecha) || dia(hoyISO());
  const num = codigo ? `${codigo}${version ? ` · v${version}` : ""}` : "DP-… (se asigna al guardar)";
  const campos = [
    ["Cliente", c.cliente], ["Teléfono", c.telefono], ["RUC/DNI", c.ruc], ["E-mail", c.email], ["Dirección", c.direccion],
    ["Provincia", c.provincia], ["Ciudad", c.ciudad], ["Entrega", [textoOpcion(ENTREGAS, c.entrega), c.agencia].filter(Boolean).join(" · ")], ["Destino", c.destino],
    ["Canal de venta", textoOpcion(CANALES_VENTA, c.canalVenta)], ["Forma de pago", textoOpcion(FORMAS_PAGO, c.formaPago)], ["Comprobante", textoOpcion(COMPROBANTES, c.comprobante)],
    ["Atención", c.atencion], ["Vendedor", c.vendedor], ["Pagos", v.pagado ? soles(v.pagado) : ""],
  ];

  return (
    <div className="vista">
      <div className="pestanas" role="tablist" aria-label="Documento">
        {[["proforma", "Proforma"], ["guia", "Guía de almacén"]].map(([k, n]) => (
          <button key={k} type="button" role="tab" aria-selected={hoja === k} className={"pestana" + (hoja === k ? " activa" : "")} onClick={() => setHoja(k)}>{n}</button>
        ))}
      </div>

      {hoja === "proforma" ? (
        <article className="hoja" aria-label="Vista previa de la proforma">
          <header className="hoja__cab">
            <div>
              {emisor ? (
                <>
                  <strong>{emisor.nombre}</strong>
                  {emisor.ruc && <p>RUC: {emisor.ruc}</p>}
                  {emisor.direccion && <p>{emisor.direccion}</p>}
                  {(emisor.telefono || emisor.email) && <p>{[emisor.telefono && `Tel: ${emisor.telefono}`, emisor.email].filter(Boolean).join(" · ")}</p>}
                </>
              ) : <p className="hoja__vacio">Sin emisor (elígelo arriba si la proforma lo lleva)</p>}
            </div>
            <div className="hoja__num"><strong>{num}</strong><p>Fecha: {fecha}</p>{estado && <p>{estado === "borrador" ? "Borrador" : estado === "cotizacion" ? "Cotización" : ""}</p>}</div>
          </header>
          <dl className="hoja__datos">
            {campos.map(([k, val]) => <div key={k}><dt>{k}:</dt><dd>{val || "—"}</dd></div>)}
          </dl>
          <div className="hoja__tabla"><table>
            <thead><tr><th>#</th><th>Descripción</th><th>Cant.</th><th>P. unit.</th><th>Importe</th></tr></thead>
            <tbody>
              {v.items.length === 0 && <tr><td colSpan={5} className="hoja__vacio">Todavía no hay líneas.</td></tr>}
              {v.items.map((it) => (
                <tr key={it.n}>
                  <td>{it.n}</td>
                  <td>{it.descripcion || "—"}{it.detalle && <small>{it.detalle}</small>}{it.comentario && <small>{it.comentario}</small>}</td>
                  <td>{it.cantidad}</td><td>{it.precio == null ? "—" : dinero(it.precio)}</td><td>{it.importe == null ? "—" : dinero(it.importe)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div className="hoja__totales">
            {v.conIgv && <><p><span>Subtotal</span><span>{soles(v.subtotal)}</span></p><p><span>IGV (18 % incluido)</span><span>{soles(v.igv)}</span></p></>}
            <p className="hoja__total"><span>Importe total</span><span>{soles(v.total)}</span></p>
            {v.sinPrecios && <p className="hoja__vacio">Hay líneas sin precio: el total no las cuenta.</p>}
          </div>
          <footer className="hoja__pie"><p><strong>Condiciones:</strong> precios sujetos a cambio sin previo aviso.</p>{(emisor?.telefono || emisor?.email) && <p><strong>Contacto:</strong> {[emisor.telefono, emisor.email].filter(Boolean).join(" · ")}</p>}</footer>
        </article>
      ) : (
        <article className="hoja" aria-label="Vista previa de la guía de almacén">
          <header className="hoja__cab hoja__cab--guia">
            <span>CLIENTE: <b>{c.cliente || "—"}</b></span><span>VENDEDOR: <b>{c.vendedor || "—"}</b></span>
            <span>Fecha: <b>{fecha}</b></span><span><b>{num}</b></span>
          </header>
          {resumenEntrega(c) && <p className="hoja__entrega">{resumenEntrega(c)}</p>}
          {op.error && <p className="aviso-error" role="alert">{op.error}</p>}
          {op.total === 0 && <p className="hoja__vacio">El catálogo de esta empresa está vacío: todavía no hay opciones que mostrar.</p>}
          <div className="hoja__tabla"><table className="hoja__guia">
            <thead><tr><th>Item</th><th>Cant.</th><th>Precio uni</th><th>Pedido</th><th>Comentario</th><th>Código</th><th>LV</th><th>SJL</th><th>Descripción</th><th>Equivalente</th><th>Ubicación</th><th>Precio sug.</th></tr></thead>
            <tbody>
              {v.items.length === 0 && <tr><td colSpan={12} className="hoja__vacio">Todavía no hay líneas.</td></tr>}
              {v.items.map((it) => {
                const r = op.porLinea[String(it.n)];
                const filas = r?.opciones?.length ? r.opciones : [null];
                return filas.map((o, j) => (
                  <tr key={`${it.n}-${j}`} className={j === 0 ? "hoja__inicio" : ""}>
                    <td>{j === 0 ? String(it.n).padStart(3, "0") : ""}</td>
                    <td>{j === 0 ? it.cantidad : ""}</td>
                    <td>{j === 0 && it.precio != null ? `S/ ${dinero(it.precio)}` : ""}</td>
                    <td>{j === 0 ? <>{it.descripcion || "—"}{it.detalle && <small>{it.detalle}</small>}</> : ""}</td>
                    <td>{j === 0 ? it.comentario : ""}</td>
                    {o ? (
                      <>
                        <td>{o.codigo}</td><td>{o.stockLV}</td><td>{o.stockSJL}</td>
                        <td>{[o.descripcion, o.familia, o.subfamilia].filter(Boolean).join(" / ")}</td>
                        <td>{o.equivalentes}</td><td>{o.ubicacion}</td><td>{o.precioSugerido ?? ""}</td>
                      </>
                    ) : (
                      <td colSpan={7} className="hoja__vacio">{!r ? (op.cargando ? "Buscando en el catálogo…" : "") : "no encontrado"}</td>
                    )}
                  </tr>
                )).concat(r && r.total > r.opciones.length ? [<tr key={`${it.n}-mas`}><td colSpan={5} /><td colSpan={7} className="hoja__vacio">y {r.total - r.opciones.length} opciones más: afina la descripción</td></tr>] : []);
              })}
            </tbody>
          </table></div>
          <p className="hoja__vacio">Una fila por cada producto del catálogo donde aparecen todas las palabras de la descripción.</p>
        </article>
      )}
    </div>
  );
}
