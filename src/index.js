import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { TIPO_PROFORMA, ESTACIONES } from "./tipos.js";
import { CAMPOS_REPUESTO } from "./catalogo.js";
import { pickingSchema } from "./picking-modelo.js";
import { crearServicioPicking, responderError } from "./picking-servicio.js";
import { PUNTAJES_PISO } from "./picking.js";
import { crearLector, ErrorOcr } from "./ocr.js";

export { TIPO_PROFORMA, ESTACIONES, MOTIVOS_DESCARTE, MOTIVOS_RECHAZO, MOTIVOS_VENCIMIENTO } from "./tipos.js";
export { CAMPOS_REPUESTO } from "./catalogo.js";
export { ENTREGAS, CANALES_VENTA, COMPROBANTES, FORMAS_PAGO } from "./picking-servicio.js";
export { crearLector, normalizarLectura, ErrorOcr, MODOS_OCR } from "./ocr.js";
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
  router.get("/ocr", ...deCreacion, (_req, res) => res.json({ activo: lector.activo, modos: lector.modos }));

  router.use(express.json());
  // Picking (pieza piloto). Las rutas completas de proformas llegan en 5.72 y el front de cuatro estaciones en 5.73.
  const Picking = core.model("Picking", pickingSchema, "picking");
  const picking = crearServicioPicking({ core, Picking, puntajesPiso });
  const deProduccion = [autenticar(), requierePermiso(ESTACIONES.produccion), eventos.middleware({ estacion: "produccion" })];
  const quien = (req) => ({ usuarioId: req.auth.usuarioId, permisos: req.rol.permisos });

  router.get("/picking", ...deProduccion, async (_req, res, next) => {
    try { res.json({ puntajesPiso, proformas: await picking.activas() }); } catch (e) { responderError(e, res, next); }
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
    try { res.json({ puntajesPiso, proformas: await picking.listar({ estados: ["orden_revision"] }) }); } catch (e) { responderError(e, res, next); }
  });
  router.post("/revision/:code/cerrar", ...deRevision, async (req, res, next) => {
    try { res.json(await picking.cerrar({ code: req.params.code, ...quien(req) })); } catch (e) { responderError(e, res, next); }
  });
  // Bandeja: solo lectura de todo lo que pasa (filtro opcional ?estado=a,b).
  const deBandeja = [autenticar(), requierePermiso(ESTACIONES.bandeja), eventos.middleware({ estacion: "bandeja" })];
  router.get("/bandeja", ...deBandeja, async (req, res, next) => {
    try {
      const estados = typeof req.query.estado === "string" && req.query.estado ? req.query.estado.split(",").slice(0, 8) : Object.keys(TIPO_PROFORMA.permisos).concat("borrador", "orden_salida", "orden_revision");
      res.json({ puntajesPiso, proformas: await picking.listar({ estados: [...new Set(estados)], limite: 100, recientes: true, conPagos: true }) });
    } catch (e) { responderError(e, res, next); }
  });
  router.post("/proformas", ...deCreacion, async (req, res, next) => {
    try {
      const code = await picking.crearOrden({ cabecera: req.body?.cabecera, lineas: req.body?.lineas, pagos: req.body?.pagos, origen: req.body?.origen, ...quien(req) });
      res.status(201).json({ code, estado: "orden_salida" });
    } catch (e) { responderError(e, res, next); }
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
