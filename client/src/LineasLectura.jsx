import { detalleLinea, dinero, resultadoDeLinea, requiereAtencion } from "./logica.js";

// Líneas de una proforma en solo lectura: qué se pidió y qué pasó con cada una. Las que merecen atención se resaltan.
// `marcas` (opcional): { [lineaId]: true } con casillas «revisé» que controla quien llama.
export default function LineasLectura({ lineas, marcas = null, alMarcar = null }) {
  return (
    <ul className="lineas">
      {lineas.map((l) => (
        <li key={l.id} className={"linea linea--lectura" + (requiereAtencion(l) ? " linea--atencion" : "")}>
          <div className="linea__texto">
            <span className="cant">{l.cantidad}</span>
            <span className="desc">{l.descripcion}</span>
            {l.precioUnitario != null && <span className="precio">S/ {dinero(l.precioUnitario)}</span>}
          </div>
          {detalleLinea(l) && <p className="detalle">{detalleLinea(l)}</p>}
      {l.comentario && <p className="comentario-linea">{l.comentario}</p>}
          <div className="linea__estado">
            <span className={"chip chip--" + (l.picking?.estado ?? "pendiente")}>{resultadoDeLinea(l)}</span>
            {l.modificadaTs && <span className="chip chip--aviso">Corregida por ventas</span>}
            {l.picking?.puntaje > 0 && <span className="chip">{l.picking.puntaje} pts</span>}
          </div>
          {l.picking?.nota && <p className="nota-lectura">Nota: {l.picking.nota}</p>}
          {marcas && (
            <label className="marca">
              <input type="checkbox" checked={Boolean(marcas[l.id])} onChange={(e) => alMarcar(l.id, e.target.checked)} /> Revisé esta línea
            </label>
          )}
        </li>
      ))}
    </ul>
  );
}
