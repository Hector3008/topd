import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buscarOpciones, indexar } from "../src/guia.js";
import { crearServicioGuia } from "../src/guia-servicio.js";
import { limpiarLineas } from "../src/picking-servicio.js";
import { formularioDeProforma, prepararProforma, vistaDeProforma } from "../client/src/logica.js";

const item = (codigo, nombre, atributos = {}) => ({ id: `i-${codigo}`, codigo, nombre, categoria: null, precio: null, activo: true, atributos });
const CAT = [
  item("A-1", "Arrancador Toyota 2C", { CODIGO_FORMATEADO: "ZNP-18195" }),
  item("A-2", "Arrancador Toyota 2C GR"),
  item("A-3", "Arrancador Toyota 3C"),
];
const idx = indexar(CAT);

describe("opciones descartadas: guía", () => {
  it("las descartadas no salen; el total y el aviso cuentan solo lo que queda", () => {
    const r = buscarOpciones(idx, { descripcion: "arrancador toyota", excluir: ["A-2"] });
    assert.deepEqual(r.opciones.map((o) => o.codigo), ["ZNP-18195", "A-3"]);
    assert.deepEqual([r.total, r.descartadas], [2, 1]);
  });
  it("se descarta por el código que se ve (el formateado), sin distinguir mayúsculas ni tildes", () => {
    const r = buscarOpciones(idx, { descripcion: "arrancador", excluir: ["znp-18195"] });
    assert.deepEqual(r.opciones.map((o) => o.codigo), ["A-2", "A-3"]);
  });
  it("si se descartan todas, no aparecen otras por la descripción: queda en 0 con el aviso", () => {
    const r = buscarOpciones(idx, { codMax: "arrancador toyota 2c", descripcion: "arrancador", excluir: ["ZNP-18195", "A-2"] });
    assert.deepEqual([r.total, r.descartadas, r.por], [0, 2, "codigo"]);
  });
  it("sin descartes todo igual que antes", () => {
    const r = buscarOpciones(idx, { descripcion: "arrancador" });
    assert.deepEqual([r.total, r.descartadas], [3, 0]);
  });
  it("el servicio pasa la lista de descartadas de cada línea", async () => {
    const svc = crearServicioGuia({ core: { catalogo: { listar: async ({ saltar, limite }) => CAT.slice(saltar, saltar + limite) } } });
    const r = await svc.opciones({ empresaId: "e", lineas: [{ k: "0", descripcion: "arrancador", excluir: ["A-3"] }, { k: "1", descripcion: "arrancador" }] });
    assert.deepEqual([r.lineas["0"].total, r.lineas["1"].total], [2, 3]);
  });
});

describe("opciones descartadas: la línea de la proforma", () => {
  const base = { cantidad: 1, descripcion: "Arrancador", precioUnitario: 10 };
  it("se guardan limpias (sin repetidas ni vacías, hasta 50) y no se guardan si no hay", () => {
    const [l] = limpiarLineas([{ ...base, descartadas: [" A-2 ", "A-2", "", 5, "A-3"] }]);
    assert.deepEqual(l.descartadas, ["A-2", "A-3"]);
    assert.equal("descartadas" in limpiarLineas([base])[0], false);
    assert.equal(limpiarLineas([{ ...base, descartadas: Array.from({ length: 80 }, (_, i) => `C-${i}` ) }])[0].descartadas.length, 50);
  });
  it("cambiar las descartadas al editar marca la línea como corregida; dejarlas igual no", () => {
    const antes = limpiarLineas([{ ...base, descartadas: ["A-2"] }], null, new Date(1));
    const igual = limpiarLineas([{ ...base, id: antes[0].id, descartadas: ["A-2"] }], antes, new Date(2));
    assert.equal(igual[0].modificadaTs, undefined);
    const otra = limpiarLineas([{ ...base, id: antes[0].id, descartadas: ["A-2", "A-3"] }], antes, new Date(3));
    assert.ok(otra[0].modificadaTs);
    assert.deepEqual(otra[0].descartadas, ["A-2", "A-3"]);
    const sin = limpiarLineas([{ ...base, id: antes[0].id }], antes, new Date(4));
    assert.ok(sin[0].modificadaTs);
    assert.equal("descartadas" in sin[0], false);
  });
});

describe("opciones descartadas: formulario", () => {
  it("viajan del servidor al formulario y de vuelta, y la vista previa sabe qué línea es cada una", () => {
    const f = formularioDeProforma({ lineas: [{ id: "L1", cantidad: 1, descripcion: "X", descartadas: ["A-2"] }, { id: "L2", cantidad: 1, descripcion: "Y" }] });
    assert.deepEqual(f.lineas.map((l) => l.descartadas), [["A-2"], []]);
    const r = prepararProforma({ lineas: f.lineas });
    assert.deepEqual(r.lineas[0].descartadas, ["A-2"]);
    assert.equal("descartadas" in r.lineas[1], false);
    const v = vistaDeProforma({ lineas: [{ cantidad: "1", descripcion: "tachada", anulada: true }, ...f.lineas] });
    assert.deepEqual(v.items.map((i) => [i.n, i.indice, i.descartadas]), [[1, 1, ["A-2"]], [2, 2, []]]);
  });
});
