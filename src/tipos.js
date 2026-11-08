// Reglas del documento de topd (to Picking and Dispatch). Se registran en el motor al montar el servicio
// (core.documentos.registrarTipo); viajan con este código, los documentos viven en MongoDB.
//
// Un solo tipo, `proforma`, con prefijo DP: el código (DP-0000001) acompaña al documento toda su vida,
// como en siscore. No hay "promoción" a otro documento (5.71).
//
//   borrador ─► cotizacion ─► orden_salida ─► orden_revision ─► cerrada
//      │            │
//      │            ├─► rechazada (motivo)     salida final: el cliente no aceptó
//      │            └─► vencida   (motivo)     salida final: pasó la vigencia
//      └─► descartado (motivo)                 salida final: se abandonó el borrador
//      borrador ─► orden_salida                (se puede saltar la cotización)
//
// Estaciones (una por estado de entrada, el motor admite un solo permiso por estado):
//   creación   (ventas)     entra a cotizacion, orden_salida y a las salidas finales
//   producción (picking)    entra a orden_revision: «ya junté el pedido»
//   revisión   (despacho)   entra a cerrada: «revisé y validé el pedido»
//   bandeja                 solo lee: no entra a ningún estado
// El motor NO comprueba quién edita en cada estado: las rutas del servicio (5.72) lo exigen.
export const ESTACIONES = Object.freeze({
  creacion: "estacion:creacion",
  produccion: "estacion:produccion",
  revision: "estacion:revision",
  bandeja: "estacion:bandeja",
});

export const MOTIVOS_DESCARTE = ["error_de_carga", "duplicada", "cliente_desistio", "otro"];
export const MOTIVOS_RECHAZO = ["precio", "plazo", "stock", "eligio_otro_proveedor", "otro"];
export const MOTIVOS_VENCIMIENTO = ["sin_respuesta", "vigencia_agotada", "otro"];

export const TIPO_PROFORMA = Object.freeze({
  tipo: "proforma",
  prefijo: "DP",
  estadoInicial: "borrador",
  transiciones: {
    borrador: ["cotizacion", "orden_salida", "descartado"],
    cotizacion: ["orden_salida", "rechazada", "vencida"],
    orden_salida: ["orden_revision"],
    orden_revision: ["cerrada"],
  },
  permisos: {
    cotizacion: ESTACIONES.creacion,
    orden_salida: ESTACIONES.creacion,
    orden_revision: ESTACIONES.produccion,
    cerrada: ESTACIONES.revision,
    descartado: ESTACIONES.creacion,
    rechazada: ESTACIONES.creacion,
    vencida: ESTACIONES.creacion,
  },
  motivos: {
    descartado: MOTIVOS_DESCARTE,
    rechazada: MOTIVOS_RECHAZO,
    vencida: MOTIVOS_VENCIMIENTO,
  },
  // Editable mientras no es final. Quién edita en cada estado lo decide el servicio, no el motor.
  editables: ["borrador", "cotizacion", "orden_salida", "orden_revision"],
});
