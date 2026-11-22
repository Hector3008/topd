import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { TIPO_PROFORMA, ESTACIONES } from "./tipos.js";
import { CAMPOS_REPUESTO } from "./catalogo.js";
import { pickingSchema } from "./picking-modelo.js";
import { crearServicioPicking, responderError } from "./picking-servicio.js";
import { PUNTAJES_PISO } from "./picking.js";

export { TIPO_PROFORMA, ESTACIONES, MOTIVOS_DESCARTE, MOTIVOS_RECHAZO, MOTIVOS_VENCIMIENTO } from "./tipos.js";
export { CAMPOS_REPUESTO } from "./catalogo.js";
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

export function createRouter({ core, puntajesPiso = PUNTAJES_PISO, dist = DIST_POR_DEFECTO } = {}) {
  if (!core?.documentos || !core?.catalogo)
    throw new Error("topd: createRouter necesita el núcleo (core) con documentos y catalogo");

  core.documentos.registrarTipo(TIPO_PROFORMA);
  core.catalogo.registrarEsquema?.({ campos: { ...CAMPOS_REPUESTO } });

  const router = express.Router();
  router.use(express.json());
  // Picking (pieza piloto). Las rutas completas de proformas llegan en 5.72 y el front de cuatro estaciones en 5.73.
  const Picking = core.model("Picking", pickingSchema, "picking");
  const picking = crearServicioPicking({ core, Picking, puntajesPiso });
  const { autenticar, requierePermiso, eventos } = core;
  const deProduccion = [autenticar(), requierePermiso(ESTACIONES.produccion), eventos.middleware({ estacion: "produccion" })];
  const deCreacion = [autenticar(), requierePermiso(ESTACIONES.creacion), eventos.middleware({ estacion: "creacion" })];
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
  router.post("/proformas", ...deCreacion, async (req, res, next) => {
    try {
      const code = await picking.crearOrden({ cabecera: req.body?.cabecera, lineas: req.body?.lineas, origen: req.body?.origen, ...quien(req) });
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
