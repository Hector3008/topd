import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { filasDeCierre, crearExcelRelacionales, limpiarMotivo } from "../src/relacionales.js";
import { crearServicioRelacionales } from "../src/relacionales-servicio.js";
import { crearServicioPicking } from "../src/picking-servicio.js";
import { ErrorPicking } from "../src/picking.js";

const L = (o) => ({ id: "L1", cantidad: 5, descripcion: "alternador toyota", precioUnitario: 50, ...o });
const T = new Date("2026-11-25T15:00:00Z"); // 10:00 en Lima

describe("filasDeCierre", () => {
  it("una fila por opción sacada, con importes", () => {
    const f = filasDeCierre({
      code: "DP-1", cerradaTs: T, cabecera: { cliente: "Padelco", vendedor: "Ana" },
      lineas: [L({ precioUnitario: 12.5 })],
      filas: [{ lineaId: "L1", estado: "encontrado", sacados: [{ codigo: "ZM-1", cantidad: 3, descripcion: "alt A" }, { codigo: "19812", cantidad: 2 }] }],
    });
    assert.equal(f.length, 2);
    assert.deepEqual([f[0].codigo, f[0].cantidad, f[0].importeUnitario, f[0].importeTotal, f[0].fecha, f[0].descripcion], ["ZM-1", 3, 12.5, 37.5, "2026-11-25", "alt A"]);
    assert.deepEqual([f[1].codigo, f[1].importeTotal, f[1].descripcion, f[1].cliente], ["19812", 25, "alternador toyota", "Padelco"]);
  });
  it("sin opciones usa el código de la línea; las no encontradas y sin cantidad no generan fila", () => {
    const f = filasDeCierre({
      code: "DP-1", cerradaTs: T,
      lineas: [L({ codMax: "ZM-9", cantidad: 2 }), L({ id: "L2" }), L({ id: "L3" }), L({ id: "L4", precioUnitario: null })],
      filas: [
        { lineaId: "L1", estado: "encontrado", cantidadEncontrada: 2, sacados: [] },
        { lineaId: "L2", estado: "no_encontrado" },
        { lineaId: "L3", estado: "encontrado", cantidadEncontrada: 0 },
        { lineaId: "L4", estado: "encontrado", cantidadEncontrada: 1 },
      ],
    });
    assert.equal(f.length, 2);
    assert.equal(f[0].codigo, "ZM-9");
    assert.equal(f[1].sinCodigo, true);
    assert.equal(f[1].importeTotal, 0);
  });
  it("el día es el de la empresa (Lima), no el UTC", () => {
    const f = filasDeCierre({ code: "x", cerradaTs: new Date("2026-11-26T02:00:00Z"), lineas: [L()], filas: [{ lineaId: "L1", estado: "encontrado", cantidadEncontrada: 1 }] });
    assert.equal(f[0].fecha, "2026-11-25");
  });
});

it("el Excel trae las seis columnas del siscore", async () => {
  const buf = await crearExcelRelacionales([{ fecha: "2026-11-25", codigo: "ZM-1", cantidad: 3, importeUnitario: 12.5, importeTotal: 37.5, descripcion: "alt" }]);
  const libro = new ExcelJS.Workbook(); await libro.xlsx.load(buf);
  const h = libro.getWorksheet("Relacionales");
  assert.deepEqual(h.getRow(1).values.slice(1), ["Fecha", "Code", "Cantidad", "Importe unitario", "Importe total", "Descripcion"]);
  assert.equal(h.getRow(2).getCell(1).value.toISOString().slice(0, 10), "2026-11-25");
  assert.deepEqual(h.getRow(2).values.slice(2), ["ZM-1", 3, 12.5, 37.5, "alt"]);
});

it("el motivo de anulación es obligatorio", () => {
  assert.throws(() => limpiarMotivo(" "), (e) => e instanceof ErrorPicking && e.codigo === "MOTIVO_REQUERIDO");
  assert.equal(limpiarMotivo("  devuelto  "), "devuelto");
});

// Colección falsa con lo mínimo de mongoose que usa el servicio
function coleccion() {
  const rows = [];
  const coincide = (r, f) => Object.entries(f).every(([k, v]) => v?.$in ? v.$in.includes(r[k]) : v?.$gte !== undefined ? r[k] >= v.$gte && r[k] <= v.$lte : r[k] === v);
  const cur = (xs) => ({ sort() { return this; }, limit() { return this; }, lean: async () => xs });
  return {
    rows,
    find: (f) => cur(rows.filter((r) => coincide(r, f))),
    async findOneAndUpdate(f, { $set, $setOnInsert }) {
      let r = rows.find((x) => coincide(x, f));
      if (!r) rows.push((r = { ...f, ...$setOnInsert }));
      Object.assign(r, $set); return r;
    },
    async updateMany(f, { $set }) { const m = rows.filter((r) => coincide(r, f)); m.forEach((r) => Object.assign(r, $set)); return { modifiedCount: m.length }; },
  };
}

function entorno() {
  const doc = { tipo: "proforma", code: "DP-1", estado: "cerrada", version: 3, updatedAt: T, payload: { doc: { cabecera: { cliente: "Padelco" }, lineas: [L(), { id: "L2", cantidad: 1, descripcion: "x", precioUnitario: 10 }] } } };
  const picks = [
    { code: "DP-1", lineaId: "L1", estado: "encontrado", sacados: [{ codigo: "ZM-1", cantidad: 3 }, { codigo: "19812", cantidad: 2 }] },
    { code: "DP-1", lineaId: "L2", estado: "no_encontrado" },
  ];
  const core = { documentos: { async obtener({ code }) { return code === "DP-1" ? doc : null; }, async listar() { return [doc]; } } };
  const Picking = { find: () => ({ lean: async () => picks }) };
  const Relacional = coleccion();
  const eventos = [];
  const svc = crearServicioRelacionales({ core, Picking, Relacional, registrar: async (t, d) => { eventos.push([t, d]); } });
  return { svc, doc, Relacional, eventos };
}

describe("servicio de relacionales", () => {
  it("genera, no duplica y lista con totales", async () => {
    const { svc, Relacional } = entorno();
    assert.deepEqual(await svc.generar({ code: "DP-1" }), { code: "DP-1", filas: 2 });
    await svc.generar({ code: "DP-1" });
    assert.equal(Relacional.rows.length, 2);
    const r = await svc.listar({ desde: "2026-11-25", hasta: "2026-11-25" });
    assert.equal(r.totales.unidades, 5);
    assert.equal(r.totales.importe, 250);
    assert.equal((await svc.listar({ code: "DP-1" })).filas.length, 2);
    assert.equal((await svc.listar({ desde: "2026-11-01", hasta: "2026-11-24" })).filas.length, 0);
  });
  it("solo genera de proformas cerradas", async () => {
    const { svc, doc } = entorno();
    doc.estado = "orden_revision";
    await assert.rejects(svc.generar({ code: "DP-1" }), (e) => e.codigo === "ESTADO_NO_CERRADA");
    await assert.rejects(svc.generar({ code: "DP-9" }), (e) => e.codigo === "PROFORMA_NO_ENCONTRADA");
  });
  it("anular saca las filas de la descarga y generar de nuevo no las revive", async () => {
    const { svc, Relacional, eventos } = entorno();
    await svc.generar({ code: "DP-1" });
    await assert.rejects(svc.anular({ code: "DP-1", motivo: "" }), (e) => e.codigo === "MOTIVO_REQUERIDO");
    await assert.rejects(svc.anular({ code: "DP-7", motivo: "devuelto" }), (e) => e.codigo === "RELACIONALES_NO_ENCONTRADOS");
    assert.deepEqual(await svc.anular({ code: "DP-1", motivo: "devuelto por el cliente", usuarioId: "u9" }), { code: "DP-1", anuladas: 2 });
    assert.equal(eventos[0][0], "relacionales.anulados");
    await svc.generar({ code: "DP-1" });
    assert.ok(Relacional.rows.every((r) => r.estado === "anulado"));
    const vig = await svc.listar({ desde: "2026-11-25", hasta: "2026-11-25", estado: "vigente" });
    assert.equal(vig.filas.length, 0);
    assert.equal((await svc.listar({ desde: "2026-11-25", hasta: "2026-11-25" })).totales.anuladas, 2);
    await assert.rejects(svc.listar({ estado: "raro" }), (e) => e.codigo === "ESTADO_INVALIDO");
  });
  it("completar cerradas: solo las que no tienen filas", async () => {
    const { svc } = entorno();
    assert.deepEqual(await svc.generarFaltantes(), { revisadas: 1, generadas: 1, filas: 2 });
    assert.deepEqual(await svc.generarFaltantes(), { revisadas: 1, generadas: 0, filas: 0 });
  });
  it("la descarga solo trae lo vigente por defecto", async () => {
    const { svc } = entorno();
    await svc.generar({ code: "DP-1" });
    assert.equal((await svc.excel({ desde: "2026-11-25", hasta: "2026-11-25" })).filas, 2);
    await svc.anular({ code: "DP-1", motivo: "devuelto" });
    assert.equal((await svc.excel({ desde: "2026-11-25", hasta: "2026-11-25" })).filas, 0);
    assert.equal((await svc.excel({ desde: "2026-11-25", hasta: "2026-11-25", estado: "" })).filas, 2);
  });
});

describe("al cerrar la proforma en Revisión", () => {
  it("guarda los relacionales y, si fallan, el cierre se mantiene", async () => {
    const doc = { tipo: "proforma", code: "DP-1", estado: "orden_revision", version: 1, payload: { doc: { lineas: [] } } };
    const core = { documentos: { async obtener() { return doc; }, async transicionar({ a }) { doc.estado = a; return doc; } }, modelos: {} };
    const llamadas = [];
    const bien = crearServicioPicking({ core, Picking: {}, relacionales: { async generar(a) { llamadas.push(a); return { filas: 4 }; } } });
    assert.deepEqual(await bien.cerrar({ code: "DP-1", usuarioId: "u", permisos: [] }), { code: "DP-1", estado: "cerrada", relacionales: 4 });
    doc.estado = "orden_revision";
    const mal = crearServicioPicking({ core, Picking: {}, relacionales: { async generar() { throw new Error("mongo caído"); } } });
    const orig = console.error; console.error = () => {};
    try { assert.equal((await mal.cerrar({ code: "DP-1", usuarioId: "u", permisos: [] })).estado, "cerrada"); } finally { console.error = orig; }
  });
});
