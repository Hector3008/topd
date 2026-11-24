// Picking (pieza piloto): lógica pura, sin base de datos. El avance del almacén NO vive en las versiones del
// documento (regla 5.3: versión nueva solo si cambia el contenido impreso): tiene su propia colección, una fila
// por proforma + línea, y cada marca deja un evento.
//
// Las líneas viven en el documento: payload.doc.lineas = [{ id, cantidad, descripcion, precioUnitario, importe,
// origen, anulada }]. Una línea anulada (tachada en el papel) no se busca.

export const ESTADOS_LINEA = Object.freeze(["pendiente", "buscando", "encontrado", "no_encontrado"]);
export const RECONOCIMIENTOS = Object.freeze(["muestra", "foto"]); // cómo se identificó el repuesto

// Puntaje por defecto por piso, para una empresa que aún no configuró nada. La tabla real es CONFIGURABLE por empresa
// (config.js, pantalla «Configuración»). Se guarda en cada marca el puntaje vigente en ese momento, así cambiar la
// tabla no reescribe lo ya medido.
export const PUNTAJES_PISO = Object.freeze({ 1: 1, 2: 2, 3: 3, 4: 4 });

export class ErrorPicking extends Error {
  constructor(codigo, mensaje, detalle) {
    super(mensaje);
    this.name = "ErrorPicking";
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

/** Líneas del documento listas para buscar: con id estable (L1, L2…) y sin las anuladas. */
export function lineasDelDocumento(doc) {
  const lineas = doc?.payload?.doc?.lineas;
  if (!Array.isArray(lineas)) return [];
  return lineas
    .map((l, i) => ({ ...l, id: l.id ?? `L${i + 1}` }))
    .filter((l) => !l.anulada);
}

const esEntero = (n) => Number.isInteger(n);

/**
 * Aplica un cambio parcial sobre la fila actual (o una vacía) y valida el resultado completo.
 * Devuelve la fila nueva; el puntaje se recalcula siempre desde el piso.
 */
export function aplicarMarca(actual, cambio, { linea, puntajesPiso = PUNTAJES_PISO, extras = {}, ahora = new Date() } = {}) {
  const base = {
    estado: "pendiente",
    piso: null,
    taller: false,
    reconocido: null,
    cantidadEncontrada: null,
    nota: "",
    puntaje: 0,
    iniciadoTs: null,
    resueltoTs: null,
    ...actual,
  };
  const c = cambio ?? {};
  const fila = { ...base };

  if (c.estado !== undefined) {
    if (!ESTADOS_LINEA.includes(c.estado))
      throw new ErrorPicking("ESTADO_INVALIDO", `Estado '${c.estado}' no válido`, { validos: ESTADOS_LINEA });
    fila.estado = c.estado;
  }
  if (c.piso !== undefined) {
    if (c.piso !== null && !(esEntero(c.piso) && c.piso in puntajesPiso))
      throw new ErrorPicking("PISO_INVALIDO", `Piso '${c.piso}' no válido`, { validos: Object.keys(puntajesPiso).map(Number) });
    fila.piso = c.piso;
  }
  if (c.taller !== undefined) {
    if (typeof c.taller !== "boolean") throw new ErrorPicking("TALLER_INVALIDO", "taller debe ser true o false");
    fila.taller = c.taller;
  }
  if (c.reconocido !== undefined) {
    if (c.reconocido !== null && !RECONOCIMIENTOS.includes(c.reconocido))
      throw new ErrorPicking("RECONOCIDO_INVALIDO", `reconocido '${c.reconocido}' no válido`, { validos: RECONOCIMIENTOS });
    fila.reconocido = c.reconocido;
  }
  if (c.cantidadEncontrada !== undefined) {
    if (c.cantidadEncontrada !== null && !(esEntero(c.cantidadEncontrada) && c.cantidadEncontrada >= 0))
      throw new ErrorPicking("CANTIDAD_INVALIDA", "cantidadEncontrada debe ser un entero mayor o igual a 0");
    fila.cantidadEncontrada = c.cantidadEncontrada;
  }
  if (c.nota !== undefined) {
    if (typeof c.nota !== "string" || c.nota.length > 300)
      throw new ErrorPicking("NOTA_INVALIDA", "nota debe ser texto de hasta 300 caracteres");
    fila.nota = c.nota.trim();
  }

  if (fila.estado === "encontrado") {
    if (fila.piso == null) throw new ErrorPicking("PISO_REQUERIDO", "Para marcar 'encontrado' indica el piso");
    fila.cantidadEncontrada ??= linea?.cantidad ?? 1;
    if (fila.cantidadEncontrada < 1)
      throw new ErrorPicking("CANTIDAD_INVALIDA", "Un ítem encontrado lleva al menos 1 unidad");
  } else if (fila.estado === "no_encontrado") {
    fila.piso = null;
    fila.cantidadEncontrada = 0;
  } else {
    // pendiente / buscando: aún no hay hallazgo
    fila.piso = null;
    fila.cantidadEncontrada = null;
  }

  // Piso + extras configurables (taller, reconocido por muestra o por foto); por defecto los extras valen 0
  fila.puntaje = fila.estado === "encontrado"
    ? Math.round(((puntajesPiso[fila.piso] ?? 0) + (fila.taller ? extras.taller ?? 0 : 0) + (fila.reconocido ? extras[fila.reconocido] ?? 0 : 0)) * 100) / 100
    : 0;

  if (fila.estado !== "pendiente" && !fila.iniciadoTs) fila.iniciadoTs = ahora;
  if (fila.estado === "pendiente") fila.iniciadoTs = null;
  fila.resueltoTs = fila.estado === "encontrado" || fila.estado === "no_encontrado" ? ahora : null;
  return fila;
}

/** Une las líneas del documento con sus filas de avance (las que no tienen fila están pendientes). */
export function combinarAvance(lineas, filas) {
  const porId = new Map((filas ?? []).map((f) => [f.lineaId, f]));
  return lineas.map((l) => {
    const f = porId.get(l.id);
    return {
      ...l,
      picking: f
        ? {
            estado: f.estado, piso: f.piso, taller: f.taller, reconocido: f.reconocido,
            cantidadEncontrada: f.cantidadEncontrada, nota: f.nota, puntaje: f.puntaje,
            iniciadoTs: f.iniciadoTs, resueltoTs: f.resueltoTs, porId: f.porId ?? null,
          }
        : { estado: "pendiente", piso: null, taller: false, reconocido: null, cantidadEncontrada: null, nota: "", puntaje: 0 },
    };
  });
}

/** Resumen de una proforma para la pantalla y para decidir si se puede pasar a revisión. */
export function resumenAvance(lineasConAvance) {
  const total = lineasConAvance.length;
  const resueltas = lineasConAvance.filter((l) => ["encontrado", "no_encontrado"].includes(l.picking.estado)).length;
  return {
    total,
    resueltas,
    pendientes: lineasConAvance.filter((l) => !["encontrado", "no_encontrado"].includes(l.picking.estado)).map((l) => l.id),
    puntaje: lineasConAvance.reduce((s, l) => s + l.picking.puntaje, 0),
    completo: total > 0 && resueltas === total,
  };
}
