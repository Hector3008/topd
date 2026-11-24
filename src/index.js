import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { TIPO_PROFORMA, ESTACIONES, MOTIVOS_DESCARTE, MOTIVOS_RECHAZO, MOTIVOS_VENCIMIENTO } from "./tipos.js";
import { CAMPOS_REPUESTO } from "./catalogo.js";
import { pickingSchema } from "./picking-modelo.js";
import { configSchema } from "./config-modelo.js";
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

export function createRouter({ core, puntajesPiso = PUNTAJES_PISO, dist = DIST_POR_DEFECTO, lector = crearLector() } = {}) {
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
        const http = { OCR_NO_CONFIGURADO: 503, OCR_SIN_CONEXION: 502, OCR_FALLO: 502, OCR_OCUPADO: 503, LIMITE_LECTURAS: 429, IMAGEN_GRANDE: 413 }[e.codigo] ?? 400;
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

  router.use(express.json());
  // Picking (pieza piloto). Las rutas completas de proformas llegan en 5.72 y el front de cuatro estaciones en 5.73.
  const Picking = core.model("Picking", pickingSchema, "picking");
  const Config = core.model("Config", configSchema, "config");
  const picking = crearServicioPicking({ core, Picking, Config, puntajesPiso });
  const deProduccion = [autenticar(), requierePermiso(ESTACIONES.produccion), eventos.middleware({ estacion: "produccion" })];
  const quien = (req) => ({ usuarioId: req.auth.usuarioId, permisos: req.rol.permisos });

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
        emisores: c.emisores.filter((e) => e.activo).map(({ id, nombre, ruc }) => ({ id, nombre, ruc })),
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
