import FotosLinea from "./FotosLinea.jsx";
import AgregarOpcion from "./AgregarOpcion.jsx";
import { detalleLinea, dinero, faltanteDeLinea, fotosDeLinea, partesDeRevision, resultadoDeLinea, requiereAtencion, textoAgregada } from "./logica.js";

// Líneas de una proforma en solo lectura: qué se pidió y qué pasó con cada una. Las que merecen atención se resaltan.
// `marcas` (opcional): { [lineaId]: true } con casillas «revisé» que controla quien llama.
// `opcion` (opcional): { pisos, buscar(texto), agregar(linea, opcion) } para sumar una opción a una línea desde la revisión.
// `fotos` (opcional): { agregar(lineaId, url), quitar(lineaId, url) } para que quien revisa agregue fotos de revisión.
export default function LineasLectura({ lineas, marcas = null, alMarcar = null, fotos = null, opcion = null }) {
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
            {textoAgregada(l) && <span className="chip chip--aviso">{textoAgregada(l)}</span>}
            {l.picking?.puntaje > 0 && <span className="chip">{l.picking.puntaje} pts</span>}
          </div>
          {l.picking?.nota && <p className="nota-lectura">Nota: {l.picking.nota}</p>}
          <FotosLinea titulo="Referencia de ventas" fotos={fotosDeLinea(l).referencia} />
          <FotosLinea titulo="Fotos del almacén" fotos={fotosDeLinea(l).almacen} />
          <FotosLinea titulo="Fotos de la revisión" fotos={fotosDeLinea(l).revision} max={10} etiqueta={l.descripcion}
            alAgregar={fotos ? (u) => fotos.agregar(l.id, u) : null} alQuitar={fotos ? (u) => fotos.quitar(l.id, u) : null} />
          {opcion && <AgregarOpcion buscar={opcion.buscar} pisos={opcion.pisos} max={faltanteDeLinea(l)} alAgregar={(n) => opcion.agregar(l, n)} />}
          {marcas && (
            <ul className="revision-partes">
              {partesDeRevision(l).map((x) => (
                <li key={x.clave}>
                  <label className="marca">
                    <input type="checkbox" checked={Boolean(marcas[x.clave])} onChange={(e) => alMarcar(x.clave, e.target.checked)} />
                    {" "}Revisé {x.texto}{x.detalle ? ` · ${x.detalle}` : ""}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
