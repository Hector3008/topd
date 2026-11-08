import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createCore } from "core";
import { TIPO_PROFORMA, ESTACIONES, CAMPOS_REPUESTO, createRouter } from "../src/index.js";

const nuevoCore = () => createCore({ connection: mongoose.createConnection() });

describe("tipo proforma de topd", () => {
  it("el motor acepta las reglas y es idempotente", () => {
    const core = nuevoCore();
    core.documentos.registrarTipo(TIPO_PROFORMA);
    core.documentos.registrarTipo(TIPO_PROFORMA);
    const p = core.documentos.tipos().find((x) => x.tipo === "proforma");
    assert.equal(p.prefijo, "DP");
    assert.equal(p.estadoInicial, "borrador");
    assert.deepEqual(p.estados.sort(), [
      "borrador", "cerrada", "cotizacion", "descartado", "orden_revision", "orden_salida", "rechazada", "vencida",
    ]);
    assert.deepEqual(p.finales.sort(), ["cerrada", "descartado", "rechazada", "vencida"]);
    assert.deepEqual(p.editables.sort(), ["borrador", "cotizacion", "orden_revision", "orden_salida"]);
  });

  it("el camino feliz y las salidas finales", () => {
    const t = TIPO_PROFORMA.transiciones;
    assert.deepEqual(t.borrador.sort(), ["cotizacion", "descartado", "orden_salida"]);
    assert.deepEqual(t.cotizacion.sort(), ["orden_salida", "rechazada", "vencida"]);
    assert.deepEqual(t.orden_salida, ["orden_revision"]);
    assert.deepEqual(t.orden_revision, ["cerrada"]);
    assert.equal(t.cerrada, undefined);
  });

  it("descartar, rechazar y vencer piden motivo; avanzar no", () => {
    for (const e of ["descartado", "rechazada", "vencida"]) assert.ok(TIPO_PROFORMA.motivos[e].length > 0, e);
    for (const e of ["cotizacion", "orden_salida", "orden_revision", "cerrada"]) assert.equal(TIPO_PROFORMA.motivos[e], undefined, e);
  });

  it("estaciones: creación vende, producción envía a revisión, revisión cierra, bandeja no entra a nada", () => {
    assert.equal(TIPO_PROFORMA.permisos.orden_salida, "estacion:creacion");
    assert.equal(TIPO_PROFORMA.permisos.orden_revision, "estacion:produccion");
    assert.equal(TIPO_PROFORMA.permisos.cerrada, "estacion:revision");
    assert.ok(!Object.values(TIPO_PROFORMA.permisos).includes(ESTACIONES.bandeja));
  });

  it("no choca con los tipos ni prefijos de tobt", () => {
    const core = nuevoCore();
    for (const [tipo, prefijo] of [["doc_item", "DOC_ITEM"], ["pedido", "PD"], ["recibo", "RC"]])
      core.documentos.registrarTipo({ tipo, prefijo, estadoInicial: "a", transiciones: {} });
    core.documentos.registrarTipo(TIPO_PROFORMA);
  });
});

describe("createRouter de topd", () => {
  it("registra el tipo y los atributos del catálogo, y es idempotente", () => {
    const core = nuevoCore();
    const r1 = createRouter({ core });
    createRouter({ core });
    assert.equal(typeof r1, "function");
    assert.ok(core.documentos.tipos().some((x) => x.tipo === "proforma"));
    const campos = core.catalogo.esquemas();
    for (const [k, v] of Object.entries(CAMPOS_REPUESTO)) assert.equal(campos[k], v, k);
  });

  it("sin núcleo falla con un mensaje claro", () => {
    assert.throws(() => createRouter({}), /necesita el núcleo/);
  });
});
