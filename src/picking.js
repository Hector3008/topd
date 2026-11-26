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
export const MAX_SACADOS = 20;
export const ETAPAS_AGREGADO = ["almacen", "revision"];

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
    sacados: [],
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
  // Qué opciones del catálogo se sacaron y cuántas de cada una: [{ codigo, descripcion?, cantidad, piso }]. Una línea de 5 puede
  // atenderse con 3 de una opción y 2 de otra. Reemplaza la lista completa; el puntaje de cada opción es el del piso en que se sacó.
  if (c.sacados !== undefined) {
    if (!Array.isArray(c.sacados) || c.sacados.length > MAX_SACADOS)
      throw new ErrorPicking("SACADOS_INVALIDOS", `sacados debe ser una lista de hasta ${MAX_SACADOS} opciones`);
    const porCodigo = new Map();
    for (const s of c.sacados) {
      const codigo = typeof s?.codigo === "string" ? s.codigo.trim().slice(0, 40) : "";
      if (!codigo) throw new ErrorPicking("SACADOS_INVALIDOS", "Cada opción sacada necesita su código");
      if (!(esEntero(s.cantidad) && s.cantidad >= 1 && s.cantidad <= 99999))
        throw new ErrorPicking("CANTIDAD_INVALIDA", `La cantidad sacada de ${codigo} debe ser un entero de 1 en adelante`);
      if (!(esEntero(s.piso) && s.piso in puntajesPiso))
        throw new ErrorPicking("PISO_INVALIDO", `Indica el piso de ${codigo}`, { validos: Object.keys(puntajesPiso).map(Number) });
      const previo = (actual?.sacados ?? []).find((x) => x.codigo === codigo && x.piso === s.piso);
      // `agregada`: opción que no estaba en la guía y sumó el almacén o la revisión (se conserva aunque se edite después)
      const agregada = ETAPAS_AGREGADO.includes(s.agregada) ? s.agregada : ETAPAS_AGREGADO.includes(previo?.agregada) ? previo.agregada : undefined;
      porCodigo.set(codigo, {
        codigo, descripcion: typeof s.descripcion === "string" ? s.descripcion.trim().slice(0, 120) : "",
        cantidad: s.cantidad, piso: s.piso,
        puntaje: previo?.puntaje ?? puntajesPiso[s.piso] ?? 0, // lo ya medido no cambia si cambia la tabla
        ...(agregada && { agregada }),
      });
    }
    fila.sacados = [...porCodigo.values()];
    // Sacar algo equivale a «encontrado»; quitar todo vuelve a «buscando» (salvo que el estado venga explícito)
    if (c.estado === undefined) {
      if (fila.sacados.length) fila.estado = "encontrado";
      else if (fila.estado === "encontrado") fila.estado = "buscando";
    }
  }
  if (c.nota !== undefined) {
    if (typeof c.nota !== "string" || c.nota.length > 300)
      throw new ErrorPicking("NOTA_INVALIDA", "nota debe ser texto de hasta 300 caracteres");
    fila.nota = c.nota.trim();
  }

  if (fila.estado === "encontrado" && fila.sacados.length) {
    // El hallazgo se mide por opción: cantidad = suma, piso de referencia = el de la primera opción
    fila.cantidadEncontrada = fila.sacados.reduce((s, x) => s + x.cantidad, 0);
    fila.piso = fila.sacados[0].piso;
  } else if (fila.estado === "encontrado") {
    fila.sacados = [];
    if (fila.piso == null) throw new ErrorPicking("PISO_REQUERIDO", "Para marcar 'encontrado' indica el piso");
    fila.cantidadEncontrada ??= linea?.cantidad ?? 1;
    if (fila.cantidadEncontrada < 1)
      throw new ErrorPicking("CANTIDAD_INVALIDA", "Un ítem encontrado lleva al menos 1 unidad");
  } else if (fila.estado === "no_encontrado") {
    fila.sacados = [];
    fila.piso = null;
    fila.cantidadEncontrada = 0;
  } else {
    // pendiente / buscando: aún no hay hallazgo
    fila.sacados = [];
    fila.piso = null;
    fila.cantidadEncontrada = null;
  }

  // Piso + extras configurables (taller, reconocido por muestra o por foto); por defecto los extras valen 0
  const basePiso = fila.sacados.length ? fila.sacados.reduce((s, x) => s + (x.puntaje ?? 0), 0) : puntajesPiso[fila.piso] ?? 0;
  fila.puntaje = fila.estado === "encontrado"
    ? Math.round((basePiso + (fila.taller ? extras.taller ?? 0 : 0) + (fila.reconocido ? extras[fila.reconocido] ?? 0 : 0)) * 100) / 100
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
            cantidadEncontrada: f.cantidadEncontrada, sacados: f.sacados ?? [], fotos: (f.fotos ?? []).map((x) => ({ url: x.url, etapa: x.etapa })), nota: f.nota, puntaje: f.puntaje,
            iniciadoTs: f.iniciadoTs, resueltoTs: f.resueltoTs, porId: f.porId ?? null,
          }
        : { estado: "pendiente", piso: null, taller: false, reconocido: null, cantidadEncontrada: null, sacados: [], fotos: [], nota: "", puntaje: 0 },
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
