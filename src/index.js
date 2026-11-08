import express from "express";
import { TIPO_PROFORMA, ESTACIONES } from "./tipos.js";
import { CAMPOS_REPUESTO } from "./catalogo.js";

export { TIPO_PROFORMA, ESTACIONES, MOTIVOS_DESCARTE, MOTIVOS_RECHAZO, MOTIVOS_VENCIMIENTO } from "./tipos.js";
export { CAMPOS_REPUESTO } from "./catalogo.js";

/**
 * Punto de entrada del servicio. El gateway lo monta así (misma forma que tobt):
 *
 *   import { createRouter as crearTopd } from "topd";
 *   gateway.use("/topd", crearTopd({ core }));
 *
 * Registra el tipo de documento `proforma` y los atributos del catálogo al montarse (idempotente).
 * No abre conexiones: usa el núcleo del gateway.
 */
export function createRouter({ core } = {}) {
  if (!core?.documentos || !core?.catalogo)
    throw new Error("topd: createRouter necesita el núcleo (core) con documentos y catalogo");

  core.documentos.registrarTipo(TIPO_PROFORMA);
  core.catalogo.registrarEsquema?.({ campos: { ...CAMPOS_REPUESTO } });

  const router = express.Router();
  router.use(express.json());
  // Las rutas del servicio llegan en 5.72 (proformas) y 5.73 (estaciones).
  router.get("/estado", (_req, res) => {
    res.json({ servicio: "topd", tipo: TIPO_PROFORMA.tipo, estaciones: Object.values(ESTACIONES) });
  });
  return router;
}
