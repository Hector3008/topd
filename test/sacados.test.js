import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aplicarMarca, combinarAvance, resumenAvance } from "../src/picking.js";
import { armarReporte } from "../src/reportes.js";
import { resultadoDeLinea } from "../client/src/logica.js";

const PISOS = { 1: 1, 2: 2, 3: 3 };
const linea = { id: "L1", cantidad: 5 };
const marca = (actual, cambio, extras = {}) => aplicarMarca(actual, cambio, { linea, puntajesPiso: PISOS, extras });
const a = { codigo: "ZM-1", descripcion: "Navara Hitachi", cantidad: 3, piso: 1 };
const b = { codigo: "19812", cantidad: 2, piso: 3 };

describe("picking: opciones sacadas", () => {
  it("3 de una opción y 2 de otra atienden las 5 unidades; el puntaje suma el piso de cada opción", () => {
    const f = marca(null, { sacados: [a, b] });
    assert.deepEqual([f.estado, f.cantidadEncontrada, f.piso, f.puntaje], ["encontrado", 5, 1, 4]); // piso 1 (1) + piso 3 (3)
    assert.deepEqual(f.sacados.map((s) => [s.codigo, s.cantidad, s.piso, s.puntaje]), [["ZM-1", 3, 1, 1], ["19812", 2, 3, 3]]);
  });
  it("los extras (taller, muestra, foto) se suman una sola vez a la línea", () => {
    let f = marca(null, { sacados: [a, b] }, { taller: 2 });
    f = marca(f, { taller: true }, { taller: 2 });
    assert.equal(f.puntaje, 6);
  });
  it("cantidades parciales: queda «encontrado» con la suma (trajo 3 de 5)", () => {
    const f = marca(null, { sacados: [a] });
    assert.deepEqual([f.estado, f.cantidadEncontrada], ["encontrado", 3]);
  });
  it("una opción repetida se junta en una sola (la última manda)", () => {
    const f = marca(null, { sacados: [a, { ...a, cantidad: 4 }] });
    assert.deepEqual(f.sacados.map((s) => s.cantidad), [4]);
  });
  it("quitar todas las opciones vuelve a «buscando» y sin puntaje", () => {
    const f = marca(marca(null, { sacados: [a, b] }), { sacados: [] });
    assert.deepEqual([f.estado, f.cantidadEncontrada, f.piso, f.puntaje, f.sacados], ["buscando", null, null, 0, []]);
  });
  it("«no hay» o «buscando» explícitos limpian lo sacado", () => {
    const f = marca(null, { sacados: [a] });
    assert.deepEqual(marca(f, { estado: "no_encontrado" }).sacados, []);
    assert.deepEqual(marca(f, { estado: "buscando" }).sacados, []);
  });
  it("lo ya medido no cambia si luego cambia la tabla de puntajes", () => {
    const f = marca(null, { sacados: [a] });
    const g = aplicarMarca(f, { sacados: [a, b] }, { linea, puntajesPiso: { 1: 10, 3: 30 }, extras: {} });
    assert.deepEqual(g.sacados.map((s) => s.puntaje), [1, 30]); // la primera conserva su puntaje; la nueva usa el vigente
  });
  it("valida cantidad, piso, código y tope de opciones", () => {
    assert.throws(() => marca(null, { sacados: [{ ...a, cantidad: 0 }] }), (e) => e.codigo === "CANTIDAD_INVALIDA");
    assert.throws(() => marca(null, { sacados: [{ ...a, piso: 9 }] }), (e) => e.codigo === "PISO_INVALIDO");
    assert.throws(() => marca(null, { sacados: [{ ...a, piso: undefined }] }), (e) => e.codigo === "PISO_INVALIDO");
    assert.throws(() => marca(null, { sacados: [{ ...a, codigo: " " }] }), (e) => e.codigo === "SACADOS_INVALIDOS");
    assert.throws(() => marca(null, { sacados: "x" }), (e) => e.codigo === "SACADOS_INVALIDOS");
    assert.throws(() => marca(null, { sacados: Array.from({ length: 21 }, (_, i) => ({ ...a, codigo: `C${i}` })) }), (e) => e.codigo === "SACADOS_INVALIDOS");
  });
  it("sin opciones el flujo de siempre (piso de la línea) sigue igual", () => {
    const f = marca(null, { estado: "encontrado", piso: 2 });
    assert.deepEqual([f.piso, f.puntaje, f.sacados], [2, 2, []]);
  });
  it("el avance las incluye y la revisión las cuenta en una frase", () => {
    const f = { ...marca(null, { sacados: [a, b] }), lineaId: "L1" };
    const [l] = combinarAvance([{ ...linea, descripcion: "x" }], [f]);
    assert.equal(l.picking.sacados.length, 2);
    assert.equal(resumenAvance([l]).puntaje, 4);
    assert.equal(resultadoDeLinea(l), "3 × ZM-1 (piso 1) + 2 × 19812 (piso 3)");
    assert.equal(resultadoDeLinea({ cantidad: 5, picking: { estado: "encontrado", piso: 2, cantidadEncontrada: 5, sacados: [] } }), "Piso 2");
  });
  it("el reporte cuenta un hallazgo por opción en el piso de cada una (extras en el primero)", () => {
    const f1 = { ...marca(null, { sacados: [a, b] }, { taller: 2 }), code: "DP-1", lineaId: "L1", taller: true };
    const f1b = { ...marca(f1, { taller: true }, { taller: 2 }), code: "DP-1", lineaId: "L1", resueltoTs: new Date("2026-11-24T15:00:00Z") };
    const f2 = { ...marca(null, { estado: "encontrado", piso: 1 }), code: "DP-2", lineaId: "L1", resueltoTs: new Date("2026-11-24T15:10:00Z") };
    const r = armarReporte([f1b, f2]);
    assert.deepEqual(r.porPiso, [{ piso: 1, lineas: 2, puntaje: 4 }, { piso: 3, lineas: 1, puntaje: 3 }]); // (1 + 2 extra) + 1 | 3
  });
});

describe("revisión opción por opción", () => {
  it("una línea sacada de dos opciones lleva dos casillas; sin opciones, una sola por la línea", async () => {
    const { partesDeRevision } = await import("../client/src/logica.js");
    const l = { id: "L1", cantidad: 5, picking: { estado: "encontrado", sacados: [{ codigo: "ZM-1", cantidad: 3, piso: 1, descripcion: "Navara" }, { codigo: "19812", cantidad: 2, piso: 3 }] } };
    assert.deepEqual(partesDeRevision(l).map((x) => [x.clave, x.texto]), [["L1:ZM-1", "3 × ZM-1 (piso 1)"], ["L1:19812", "2 × 19812 (piso 3)"]]);
    assert.equal(partesDeRevision(l)[0].detalle, "Navara");
    assert.deepEqual(partesDeRevision({ id: "L2", picking: { estado: "encontrado", sacados: [] } }).map((x) => x.clave), ["L2"]);
    assert.deepEqual(partesDeRevision({ id: "L3", picking: { estado: "no_encontrado" } }).map((x) => x.clave), ["L3"]);
  });
});

describe("picking: puntaje propio del ítem (columna PUNTAJE de la hoja)", () => {
  const conItem = (cambio, puntajesItem, actual = null) => aplicarMarca(actual, cambio, { linea, puntajesPiso: PISOS, puntajesItem });
  it("el ítem con puntaje propio lo usa en cualquier piso; el que no tiene toma el del piso", () => {
    const f = conItem({ sacados: [a, b] }, { "ZM-1": 10 });
    assert.deepEqual(f.sacados.map((s) => [s.codigo, s.piso, s.puntaje]), [["ZM-1", 1, 10], ["19812", 3, 3]]);
    assert.equal(f.puntaje, 13);
  });
  it("un puntaje propio de 0 vale 0 (no cae al piso)", () => {
    const f = conItem({ sacados: [a] }, { "ZM-1": 0 });
    assert.equal(f.puntaje, 0);
  });
  it("valores inválidos se ignoran y rige el piso", () => {
    const f = conItem({ sacados: [a, b] }, { "ZM-1": -5, "19812": "x" });
    assert.equal(f.puntaje, 4);
  });
  it("lo ya medido no cambia si después cambia el puntaje del ítem", () => {
    const f1 = conItem({ sacados: [a] }, { "ZM-1": 10 });
    const f2 = conItem({ sacados: [{ ...a, cantidad: 2 }] }, { "ZM-1": 99 }, f1);
    assert.equal(f2.sacados[0].puntaje, 10);
  });
});
