// Configuración de topd por empresa: pisos del almacén, puntajes y emisores (los que firman la proforma).
// Vive en su propia colección (un documento por empresa) y NO en el código: cambiarla no obliga a desplegar.
// Cada marca del almacén guarda el puntaje vigente en ese momento, así que cambiar la tabla no reescribe lo ya medido.
import { ErrorPicking, PUNTAJES_PISO } from "./picking.js";

export const MAX_PISOS = 12;
export const MAX_EMISORES = 20;
export const EXTRAS = Object.freeze(["taller", "muestra", "foto"]); // suman al puntaje del piso cuando aplican

/** Configuración de una empresa que aún no guardó nada. */
export function configPorDefecto(puntajesPiso = PUNTAJES_PISO) {
  return {
    pisos: Object.entries(puntajesPiso).map(([piso, puntaje]) => ({ piso: Number(piso), puntaje })).sort((a, b) => a.piso - b.piso),
    extras: { taller: 0, muestra: 0, foto: 0 },
    emisores: [],
    acumulaPorDefecto: false, // ¿el puntaje de una opción sacada se multiplica por sus unidades? Cada ítem puede decidirlo en la hoja (columna ACUMULA)
  };
}

const texto = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const puntaje = (v, que) => {
  const n = Number(v);
  if (v === "" || v == null || !Number.isFinite(n) || n < 0 || n > 1000)
    throw new ErrorPicking("CONFIG_INVALIDA", `${que}: el puntaje debe ser un número entre 0 y 1000`);
  return Math.round(n * 100) / 100;
};

/**
 * Valida y normaliza lo que llega del formulario de configuración. Lo que no viene se conserva de `actual`.
 * Los emisores no se borran (los documentos ya emitidos guardan su copia): se desactivan.
 */
export function limpiarConfig(entrada, actual = configPorDefecto()) {
  const e = entrada ?? {};
  const salida = { pisos: actual.pisos, extras: actual.extras, emisores: actual.emisores, acumulaPorDefecto: actual.acumulaPorDefecto === true };
  if (e.acumulaPorDefecto !== undefined) {
    if (typeof e.acumulaPorDefecto !== "boolean") throw new ErrorPicking("CONFIG_INVALIDA", "acumulaPorDefecto debe ser sí o no");
    salida.acumulaPorDefecto = e.acumulaPorDefecto;
  }

  if (e.pisos !== undefined) {
    if (!Array.isArray(e.pisos) || e.pisos.length < 1 || e.pisos.length > MAX_PISOS)
      throw new ErrorPicking("CONFIG_INVALIDA", `Define entre 1 y ${MAX_PISOS} pisos`);
    const vistos = new Set();
    salida.pisos = e.pisos
      .map((p) => {
        const piso = Number(p?.piso);
        if (!Number.isInteger(piso) || piso < 1 || piso > 99) throw new ErrorPicking("CONFIG_INVALIDA", "El número de piso debe ser un entero entre 1 y 99");
        if (vistos.has(piso)) throw new ErrorPicking("CONFIG_INVALIDA", `El piso ${piso} está repetido`);
        vistos.add(piso);
        return { piso, puntaje: puntaje(p?.puntaje, `Piso ${piso}`) };
      })
      .sort((a, b) => a.piso - b.piso);
  }

  if (e.extras !== undefined) {
    if (typeof e.extras !== "object" || e.extras === null) throw new ErrorPicking("CONFIG_INVALIDA", "extras no es válido");
    salida.extras = { ...actual.extras };
    for (const k of EXTRAS) if (e.extras[k] !== undefined) salida.extras[k] = puntaje(e.extras[k], k);
  }

  if (e.emisores !== undefined) {
    if (!Array.isArray(e.emisores) || e.emisores.length > MAX_EMISORES) throw new ErrorPicking("CONFIG_INVALIDA", `Hasta ${MAX_EMISORES} emisores`);
    const previos = new Set(actual.emisores.map((x) => x.id));
    const usados = new Set();
    let siguiente = Math.max(0, ...actual.emisores.map((x) => Number(String(x.id).replace(/\D/g, "")) || 0));
    const lista = e.emisores.map((x, i) => {
      const nombre = texto(x?.nombre, 120);
      if (!nombre) throw new ErrorPicking("CONFIG_INVALIDA", `El emisor ${i + 1} necesita un nombre`);
      // Conserva el id si ya existía; uno nuevo no puede ocupar un id viejo
      const id = typeof x?.id === "string" && previos.has(x.id) && !usados.has(x.id) ? x.id : `E${++siguiente}`;
      usados.add(id);
      return { id, nombre, ruc: texto(x?.ruc, 20), direccion: texto(x?.direccion, 200), telefono: texto(x?.telefono, 40), email: texto(x?.email, 120), activo: x?.activo !== false };
    });
    // Un emisor que ya existía no puede desaparecer: se conserva desactivado
    for (const viejo of actual.emisores) if (!usados.has(viejo.id)) lista.push({ ...viejo, activo: false });
    salida.emisores = lista;
  }
  return salida;
}

/** Tabla { piso: puntaje } que usa el almacén al marcar. */
export const puntajesDe = (config) => Object.fromEntries(config.pisos.map((p) => [p.piso, p.puntaje]));

/** Lo que se copia al documento: el emisor tal como estaba al emitir (cambiarlo después no altera lo ya emitido). */
export function copiaDeEmisor(config, emisorId) {
  if (emisorId == null || emisorId === "") return null;
  const e = config.emisores.find((x) => x.id === emisorId);
  if (!e || !e.activo) throw new ErrorPicking("EMISOR_INVALIDO", "El emisor elegido no existe o está desactivado");
  const { activo: _a, ...copia } = e;
  return copia;
}
