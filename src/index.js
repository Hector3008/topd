import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { TIPO_PROFORMA, ESTACIONES, MOTIVOS_DESCARTE, MOTIVOS_RECHAZO, MOTIVOS_VENCIMIENTO } from "./tipos.js";
import { CAMPOS_REPUESTO } from "./catalogo.js";
import { pickingSchema, relacionalSchema, despachoSchema } from "./picking-modelo.js";
import { crearServicioRelacionales } from "./relacionales-servicio.js";
import { configSchema } from "./config-modelo.js";
import { crearServicioGuia } from "./guia-servicio.js";
import { crearServicioStock, stockDeEntorno } from "./stock-servicio.js";
import { crearLectorHoja } from "./hoja.js";
import { crearServicioFotos, fotosDeEntorno } from "./fotos.js";
import { crearServicioPicking, responderError } from "./picking-servicio.js";
import { PUNTAJES_PISO } from "./picking.js";
import { crearLector, ErrorOcr } from "./ocr.js";
import { leerArchivo, ErrorArchivo, MAX_BYTES_ARCHIVO } from "./archivo.js";
import { crearPlantilla, NOMBRE_PLANTILLA } from "./plantilla.js";

export { TIPO_PROFORMA, ESTACIONES, MOTIVOS_DESCARTE, MOTIVOS_RECHAZO, MOTIVOS_VENCIMIENTO } from "./tipos.js";
export { CAMPOS_REPUESTO } from "./catalogo.js";
export { ENTREGAS, CANALES_VENTA, COMPROBANTES, FORMAS_PAGO } from "./picking-servicio.js";
export { crearLector, normalizarLectura, ErrorOcr, MODOS_OCR } from "./ocr.js";
export { leerArchivo, ErrorArchivo } from "./archivo.js";
export { configPorDefecto, limpiarConfig, puntajesDe } from "./config.js";
export { ESTADOS_LINEA, RECONOCIMIENTOS, PUNTAJES_PISO, ErrorPicking } from "./picking.js";

/**
 * Punto de entrada del servicio. El gateway lo monta así (misma forma que tobt):
 *
 *   import { createRouter as crearTopd } from "topd";
 *   gateway.use("/topd", crearTopd({ core }));
 *
 * Registra el tipo de documento `proforma` y los atributos del catálogo al montarse (idempotente).
 * No abre conexiones: usa el núcleo del gateway.
 */
const DIST_POR_DEFECTO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "client", "dist");

export function createRouter({ core, puntajesPiso = PUNTAJES_PISO, dist = DIST_POR_DEFECTO, lector = crearLector(), stock = stockDeEntorno(), fotos = fotosDeEntorno() } = {}) {
  if (!core?.documentos || !core?.catalogo)
    throw new Error("topd: createRouter necesita el núcleo (core) con documentos y catalogo");

  core.documentos.registrarTipo(TIPO_PROFORMA);
  core.catalogo.registrarEsquema?.({ campos: { ...CAMPOS_REPUESTO } });

  const router = express.Router();
  const { autenticar, requierePermiso, eventos } = core;
  const deCreacion = [autenticar(), requierePermiso(ESTACIONES.creacion), eventos.middleware({ estacion: "creacion" })];

  // Lectura de una foto de proforma (OCR): solo lee y devuelve el JSON para revisarlo; no crea nada.
  // Va antes del parser general porque la foto (reducida por el front) pesa más que su límite de 100 kb.
  router.post("/proformas/leer", ...deCreacion, express.json({ limit: "8mb" }), async (req, res, next) => {
    try {
      const lectura = await lector.leerProforma({ imagen: req.body?.imagen, mediaType: req.body?.mediaType, modo: req.body?.modo, usuarioId: String(req.auth.usuarioId) });
      res.json(lectura);
    } catch (e) {
      if (e instanceof ErrorOcr) {
        const http = { OCR_NO_CONFIGURADO: 503, OCR_SIN_CONEXION: 502, OCR_FALLO: 502, OCR_CLAVE: 502, OCR_SIN_SALDO: 502, OCR_MODELO: 502, OCR_OCUPADO: 503, LIMITE_LECTURAS: 429, IMAGEN_GRANDE: 413 }[e.codigo] ?? 400;
        return res.status(http).json({ error: e.message, codigo: e.codigo, detalle: e.detalle });
      }
      next(e);
    }
  });
  // Carga desde un archivo Excel (.xlsx) o PDF con texto: gratis y exacta. El cuerpo es el archivo tal cual (binario);
  // el formato se reconoce por su contenido. Solo lee y devuelve la lectura para revisarla; no crea nada.
  router.post("/proformas/archivo", ...deCreacion, express.raw({ type: () => true, limit: MAX_BYTES_ARCHIVO }), async (req, res, next) => {
    try {
      res.json(await leerArchivo(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)));
    } catch (e) {
      if (e instanceof ErrorArchivo) {
        const http = { ARCHIVO_GRANDE: 413 }[e.codigo] ?? 400;
        return res.status(http).json({ error: e.message, codigo: e.codigo, detalle: e.detalle });
      }
      next(e);
    }
  }, (err, _req, res, next) => {
    // El límite de tamaño lo corta el parser antes de llegar al servicio
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "El archivo pesa demasiado (máximo 8 MB).", codigo: "ARCHIVO_GRANDE" });
    next(err);
  });
  router.get("/ocr", ...deCreacion, (_req, res) => res.json({ activo: lector.activo, modos: lector.modos }));

  // Fotos: las tres estaciones pueden subir. `cualquiera` deja pasar a quien tenga alguno de los permisos.
  const cualquiera = (...permisos) => async (req, res, next) => {
    for (const permiso of permisos) {
      const resultado = await new Promise((resolve) => {
        const falso = { status() { return falso; }, json() { resolve("no"); return falso; } };
        requierePermiso(permiso)(req, falso, (err) => { resolve("si"); next(err); });
      });
      if (resultado === "si") return;
    }
    res.status(403).json({ error: "permiso insuficiente" });
  };
  const deFotos = [autenticar(), cualquiera(ESTACIONES.creacion, ESTACIONES.produccion, ESTACIONES.revision)];
  router.get("/fotos", ...deFotos, (_req, res) => res.json({ activo: fotosServicio.activo }));
  // La foto (reducida por el front) pesa más que el límite general de 100 kb
  router.post("/fotos", ...deFotos, express.json({ limit: "7mb" }), async (req, res, next) => {
    try { res.status(201).json(await fotosServicio.subir({ usuarioId: req.auth.usuarioId, imagen: req.body?.imagen })); } catch (e) { responderError(e, res, next); }
  });

  router.use(express.json());
  // Picking (pieza piloto). Las rutas completas de proformas llegan en 5.72 y el front de cuatro estaciones en 5.73.
  const Picking = core.model("Picking", pickingSchema, "picking");
  const Config = core.model("Config", configSchema, "config");
  const Relacional = core.model("Relacional", relacionalSchema, "relacionales");
  const relacionales = crearServicioRelacionales({
    core, Picking, Relacional,
    registrar: async (tipo, { code, usuarioId, datos }) => {
      try { await core.modelos.Evento.create({ usuarioId, documentoCode: code, tipoDocumento: TIPO_PROFORMA.tipo, estacion: "bandeja", tipo, origen: "servidor", ts: new Date(), recibidoTs: new Date(), datos }); }
      catch (e) { console.error("topd: no se pudo guardar el evento", e); }
    },
  });
  const Despacho = core.model("Despacho", despachoSchema, "despachos");
  const picking = crearServicioPicking({ core, Picking, Config, puntajesPiso, relacionales, Despacho });
  const guia = crearServicioGuia({ core });
  // Fotos: se suben a una carpeta de Google Drive y en la base queda solo la URL. Sin configuración quedan apagadas.
  const fotosServicio = fotos?.subir ? fotos : crearServicioFotos({ config: fotos });
  // Sincronización de stock desde la hoja de cálculo (5.74). Sin variables de entorno queda apagada y la API lo dice.
  const stockServicio = crearServicioStock({
    core, empresaId: stock?.empresaId,
    leerHoja: stock ? (stock.leerHoja ?? crearLectorHoja({ email: stock.email, clave: stock.clave, hojaId: stock.hojaId, rango: stock.rango })) : null,
    alCambiar: (empresaId) => guia.olvidar(empresaId),
  });
  if (stock && stock.cadaMin !== 0) stockServicio.iniciar({ cadaMin: stock.cadaMin ?? 2 });
  const deProduccion = [autenticar(), requierePermiso(ESTACIONES.produccion), eventos.middleware({ estacion: "produccion" })];
  const quien = (req) => ({ usuarioId: req.auth.usuarioId, permisos: req.rol.permisos });

  // Guía de almacén: opciones del catálogo para cada línea { lineas: [{ k, descripcion, codMax }] }. La ven creación (vista previa) y almacén.
  const opcionesDeGuia = async (req, res, next) => {
    try { res.json(await guia.opciones({ empresaId: req.auth.empresaId, lineas: req.body?.lineas })); } catch (e) { responderError(e, res, next); }
  };
  router.post("/guia/opciones", ...deCreacion, opcionesDeGuia);
  router.post("/picking/opciones", ...deProduccion, opcionesDeGuia);
  router.get("/picking", ...deProduccion, async (_req, res, next) => {
    try { res.json({ ...(await picking.puntajes()), proformas: await picking.activas() }); } catch (e) { responderError(e, res, next); }
  });
  router.put("/picking/:code/lineas/:lineaId", ...deProduccion, async (req, res, next) => {
    try {
      const fila = await picking.marcar({ code: req.params.code, lineaId: req.params.lineaId, cambio: req.body, usuarioId: req.auth.usuarioId });
      res.json(fila);
    } catch (e) { responderError(e, res, next); }
  });
  router.post("/picking/:code/listo", ...deProduccion, async (req, res, next) => {
    try { res.json(await picking.listoParaRevision({ code: req.params.code, ...quien(req) })); } catch (e) { responderError(e, res, next); }
  });
  // Revisión (despacho): valida el pedido que armó el almacén y lo cierra.
  const deRevision = [autenticar(), requierePermiso(ESTACIONES.revision), eventos.middleware({ estacion: "revision" })];
  // Fotos de evidencia por línea (la imagen ya está en Drive: se guarda su URL)
  for (const [base, guardas, etapa] of [["picking", deProduccion, "almacen"], ["revision", deRevision, "revision"]]) {
    router.post(`/${base}/:code/lineas/:lineaId/fotos`, ...guardas, async (req, res, next) => {
      try { res.status(201).json(await picking.agregarFoto({ code: req.params.code, lineaId: req.params.lineaId, url: req.body?.url, etapa, usuarioId: req.auth.usuarioId })); } catch (e) { responderError(e, res, next); }
    });
    router.delete(`/${base}/:code/lineas/:lineaId/fotos`, ...guardas, async (req, res, next) => {
      try { res.json(await picking.quitarFoto({ code: req.params.code, lineaId: req.params.lineaId, url: req.body?.url, etapa, usuarioId: req.auth.usuarioId })); } catch (e) { responderError(e, res, next); }
    });
  }
  router.post("/revision/opciones", ...deRevision, opcionesDeGuia); // para sumar una opción o un ítem desde la revisión
  // Sumar un ítem que el pedido no traía: desde el almacén (orden_salida) o desde la revisión (orden_revision)
  const cuerpoDeLinea = (b) => ({ descripcion: b?.descripcion, cantidad: b?.cantidad, precioUnitario: b?.precioUnitario ?? null, codigo: b?.codigo ?? "", piso: b?.piso ?? null });
  router.post("/picking/:code/lineas", ...deProduccion, async (req, res, next) => {
    try { res.status(201).json(await picking.agregarLinea({ code: req.params.code, etapa: "almacen", ...cuerpoDeLinea(req.body), usuarioId: req.auth.usuarioId })); } catch (e) { responderError(e, res, next); }
  });
  router.post("/revision/:code/lineas", ...deRevision, async (req, res, next) => {
    try { res.status(201).json(await picking.agregarLinea({ code: req.params.code, etapa: "revision", ...cuerpoDeLinea(req.body), usuarioId: req.auth.usuarioId })); } catch (e) { responderError(e, res, next); }
  });
  // La revisión solo corrige las opciones sacadas de una línea ({ sacados: [...] })
  router.put("/revision/:code/lineas/:lineaId", ...deRevision, async (req, res, next) => {
    try { res.json(await picking.marcar({ code: req.params.code, lineaId: req.params.lineaId, cambio: req.body, usuarioId: req.auth.usuarioId, etapa: "revision" })); } catch (e) { responderError(e, res, next); }
  });
  // Fotos del despacho: del pedido completo, las toma quien revisa (solo la URL; la imagen sube por POST /fotos)
  router.post("/revision/:code/despacho/fotos", ...deRevision, async (req, res, next) => {
    try { res.status(201).json(await picking.agregarFotoDespacho({ code: req.params.code, url: req.body?.url, usuarioId: req.auth.usuarioId })); } catch (e) { responderError(e, res, next); }
  });
  router.delete("/revision/:code/despacho/fotos", ...deRevision, async (req, res, next) => {
    try { res.json(await picking.quitarFotoDespacho({ code: req.params.code, url: req.body?.url, usuarioId: req.auth.usuarioId })); } catch (e) { responderError(e, res, next); }
  });
  router.get("/revision", ...deRevision, async (_req, res, next) => {
    try { res.json({ ...(await picking.puntajes()), proformas: await picking.listar({ estados: ["orden_revision"] }) }); } catch (e) { responderError(e, res, next); }
  });
  router.post("/revision/:code/cerrar", ...deRevision, async (req, res, next) => {
    try { res.json(await picking.cerrar({ code: req.params.code, ...quien(req) })); } catch (e) { responderError(e, res, next); }
  });
  // Bandeja: solo lectura de todo lo que pasa (filtro opcional ?estado=a,b).
  const deBandeja = [autenticar(), requierePermiso(ESTACIONES.bandeja), eventos.middleware({ estacion: "bandeja" })];
  router.get("/bandeja", ...deBandeja, async (req, res, next) => {
    try {
      const estados = typeof req.query.estado === "string" && req.query.estado ? req.query.estado.split(",").slice(0, 8) : Object.keys(TIPO_PROFORMA.permisos).concat("borrador", "orden_salida", "orden_revision");
      res.json({ ...(await picking.puntajes()), proformas: await picking.listar({ estados: [...new Set(estados)], limite: 100, recientes: true, conPagos: true }) });
    } catch (e) { responderError(e, res, next); }
  });
  // Vista del supervisor: cómo va hoy el almacén (se consulta cada pocos segundos)
  const deSupervision = [autenticar(), requierePermiso(ESTACIONES.supervision), eventos.middleware({ estacion: "supervision" })];
  router.get("/supervision", ...deSupervision, async (_req, res, next) => {
    try { res.json(await picking.supervisorPicking()); } catch (e) { responderError(e, res, next); }
  });
  // Puntajes y tiempos del almacén (?desde=AAAA-MM-DD&hasta=AAAA-MM-DD)
  router.get("/reportes/picking", ...deBandeja, async (req, res, next) => {
    try { res.json(await picking.reportePicking({ desde: req.query.desde, hasta: req.query.hasta })); } catch (e) { responderError(e, res, next); }
  });
  // Relacionales: lo que salió de cada proforma cerrada (alimenta el Excel que descuenta el stock). Leer y descargar: bandeja;
  // completar las cerradas antiguas y anular: supervisión.
  router.get("/relacionales", ...deBandeja, async (req, res, next) => {
    try { res.json(await relacionales.listar({ desde: req.query.desde, hasta: req.query.hasta, estado: req.query.estado || undefined, code: req.query.code || undefined })); } catch (e) { responderError(e, res, next); }
  });
  router.get("/relacionales/descarga.xlsx", ...deBandeja, async (req, res, next) => {
    try {
      const x = await relacionales.excel({ desde: req.query.desde, hasta: req.query.hasta, estado: req.query.estado === "todos" ? "" : req.query.estado || "vigente" });
      res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="relacionales-${x.desde}_${x.hasta}.xlsx"`, "Cache-Control": "no-store" });
      res.send(x.buffer);
    } catch (e) { responderError(e, res, next); }
  });
  router.post("/relacionales/completar", ...deSupervision, async (_req, res, next) => {
    try { res.json(await relacionales.generarFaltantes()); } catch (e) { responderError(e, res, next); }
  });
  router.post("/relacionales/:code/anular", ...deSupervision, async (req, res, next) => {
    try { res.json(await relacionales.anular({ code: req.params.code, motivo: req.body?.motivo, usuarioId: req.auth.usuarioId })); } catch (e) { responderError(e, res, next); }
  });
  router.post("/proformas", ...deCreacion, async (req, res, next) => {
    try {
      const r = await picking.crearOrden({
        cabecera: req.body?.cabecera, lineas: req.body?.lineas, pagos: req.body?.pagos, origen: req.body?.origen,
        emisorId: req.body?.emisorId, destino: req.body?.destino, ...quien(req),
      });
      res.status(201).json(r);
    } catch (e) { responderError(e, res, next); }
  });
  // Estación de creación: ver las proformas, abrir una y corregirla (nueva versión; el avance del almacén solo se reinicia
  // en las líneas cuyo fondo cambió).
  router.get("/proformas", ...deCreacion, async (req, res, next) => {
    try {
      const pedidos = typeof req.query.estado === "string" && req.query.estado ? req.query.estado.split(",").slice(0, 8) : ["orden_salida", "orden_revision", "cerrada"];
      res.json({ proformas: await picking.listar({ estados: [...new Set(pedidos)], limite: 100, recientes: true, conPagos: true }) });
    } catch (e) { responderError(e, res, next); }
  });
  // Plantilla de Excel para cargar varias líneas (debe ir antes de /proformas/:code)
  router.get("/proformas/plantilla.xlsx", ...deCreacion, async (_req, res, next) => {
    try {
      res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${NOMBRE_PLANTILLA}"`, "Cache-Control": "no-store" });
      res.send(await crearPlantilla());
    } catch (e) { next(e); }
  });
  router.get("/proformas/:code", ...deCreacion, async (req, res, next) => {
    try { res.json(await picking.obtener({ code: req.params.code })); } catch (e) { responderError(e, res, next); }
  });
  router.put("/proformas/:code", ...deCreacion, async (req, res, next) => {
    try {
      res.json(await picking.editar({
        code: req.params.code, cabecera: req.body?.cabecera, lineas: req.body?.lineas, pagos: req.body?.pagos, emisorId: req.body?.emisorId,
        esperaVersion: req.body?.version, usuarioId: req.auth.usuarioId,
      }));
    } catch (e) { responderError(e, res, next); }
  });
  // Mandar a cotización o al almacén, o cerrar sin vender con motivo: { a, motivo: { codigo, detalle }, version }
  router.post("/proformas/:code/estado", ...deCreacion, async (req, res, next) => {
    try {
      res.json(await picking.cambiarEstado({ code: req.params.code, a: req.body?.a, motivo: req.body?.motivo, esperaVersion: req.body?.version, ...quien(req) }));
    } catch (e) { responderError(e, res, next); }
  });
  // Emisores activos y motivos, para el formulario de creación (la configuración completa es de otra estación)
  router.get("/opciones", ...deCreacion, async (_req, res, next) => {
    try {
      const c = await picking.config();
      res.json({
        emisores: c.emisores.filter((e) => e.activo).map(({ activo: _a, ...e }) => e), // completos: la vista previa los dibuja en el encabezado
        motivos: { descartado: MOTIVOS_DESCARTE, rechazada: MOTIVOS_RECHAZO, vencida: MOTIVOS_VENCIMIENTO },
      });
    } catch (e) { responderError(e, res, next); }
  });
  // Configuración de la empresa: pisos, puntajes y emisores
  const deConfiguracion = [autenticar(), requierePermiso(ESTACIONES.configuracion), eventos.middleware({ estacion: "configuracion" })];
  router.get("/config", ...deConfiguracion, async (_req, res, next) => {
    try { res.json(await picking.config()); } catch (e) { responderError(e, res, next); }
  });
  router.put("/config", ...deConfiguracion, async (req, res, next) => {
    try { res.json(await picking.guardarConfig({ entrada: req.body, usuarioId: req.auth.usuarioId })); } catch (e) { responderError(e, res, next); }
  });
  router.get("/stock/estado", ...deConfiguracion, (_req, res) => res.json(stockServicio.estado()));
  router.post("/stock/sincronizar", ...deConfiguracion, async (_req, res, next) => {
    try { res.json(await stockServicio.sincronizar()); } catch (e) { responderError(e, res, next); }
  });
  router.get("/estado", (_req, res) => {
    res.json({ servicio: "topd", tipo: TIPO_PROFORMA.tipo, estaciones: Object.values(ESTACIONES) });
  });
  // Front (React + Vite, client/dist commiteado) en la raíz del montaje: `<base>/topd/`. Pide la API en relativo,
  // así que debe montarse en `<base>/topd/`. Si aún no se compiló, el servicio funciona solo como API.
  if (fs.existsSync(path.join(dist, "index.html")))
    router.use(
      express.static(dist, {
        index: "index.html",
        setHeaders(res, archivo) {
          // El HTML no se cachea; los archivos con hash en el nombre sí.
          if (archivo.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
          else res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        },
      }),
    );
  return router;
}
