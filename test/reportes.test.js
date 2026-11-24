import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, diaDe, inicioDeDia, rangoDeDias } from "../src/reportes.js";

const f = (o) => ({ code: "DP-1", lineaId: "L1", estado: "encontrado", piso: 1, taller: false, reconocido: null, puntaje: 1, porId: "u1", iniciadoTs: "2026-11-23T15:00:00Z", resueltoTs: "2026-11-23T15:01:00Z", ...o });

describe("reporte de picking (lógica pura)", () => {
  it("totales, personas, pisos y días; ignora lo que no está resuelto", () => {
    const r = armarReporte([
      f({ lineaId: "L1", piso: 2, puntaje: 5, taller: true, reconocido: "foto" }),
      f({ lineaId: "L2", piso: 3, puntaje: 3, porId: "u2", resueltoTs: "2026-11-23T15:03:00Z" }),
      f({ lineaId: "L3", estado: "no_encontrado", piso: null, puntaje: 0, resueltoTs: "2026-11-24T15:00:00Z", iniciadoTs: "2026-11-24T14:58:00Z" }),
      f({ lineaId: "L4", estado: "buscando", resueltoTs: null, puntaje: 0 }),
    ], { u1: "Rosa", u2: "Luis" });
    assert.deepEqual(r.totales, { lineas: 3, encontradas: 2, noEncontradas: 1, puntaje: 8, medianaMs: 120000, taller: 1, porMuestra: 0, porFoto: 1, proformas: 1 });
    assert.deepEqual(r.porPersona.map((p) => [p.nombre, p.lineas, p.puntaje]), [["Rosa", 2, 5], ["Luis", 1, 3]]);
    assert.deepEqual(r.porPiso, [{ piso: 2, lineas: 1, puntaje: 5 }, { piso: 3, lineas: 1, puntaje: 3 }]);
    assert.deepEqual(r.porDia.map((d) => [d.dia, d.lineas, d.puntaje]), [["2026-11-23", 2, 8], ["2026-11-24", 1, 0]]);
  });

  it("la mediana no se deja torcer por una línea olvidada; sin tiempos queda en null", () => {
    const filas = [60, 70, 80].map((s, i) => f({ lineaId: `L${i}`, resueltoTs: new Date(Date.parse("2026-11-23T15:00:00Z") + s * 1000).toISOString() }))
      .concat(f({ lineaId: "X", resueltoTs: "2026-11-24T15:00:00Z" })); // quedó abierta un día entero
    assert.equal(armarReporte(filas).totales.medianaMs, 75000);
    assert.equal(armarReporte([f({ iniciadoTs: null })]).totales.medianaMs, null);
    assert.equal(armarReporte([]).totales.lineas, 0);
  });

  it("agrupa los días en la hora de la empresa, no en UTC", () => {
    // 02:00 UTC del 24 sigue siendo el 23 a las 21:00 en Lima
    assert.equal(diaDe("2026-11-24T02:00:00Z", "America/Lima"), "2026-11-23");
    assert.equal(diaDe("2026-11-24T02:00:00Z", "UTC"), "2026-11-24");
    assert.equal(inicioDeDia("2026-11-23", "America/Lima").toISOString(), "2026-11-23T05:00:00.000Z");
  });

  it("el rango incluye ambos días, por defecto son 7 y se valida", () => {
    const r = rangoDeDias({ desde: "2026-11-23", hasta: "2026-11-23" }, { zona: "America/Lima" });
    assert.equal(r.ini.toISOString(), "2026-11-23T05:00:00.000Z");
    assert.equal(r.fin.toISOString(), "2026-11-24T05:00:00.000Z");
    const d = rangoDeDias({}, { zona: "America/Lima", ahora: new Date("2026-11-23T20:00:00Z") });
    assert.deepEqual([d.desde, d.hasta], ["2026-11-17", "2026-11-23"]);
    assert.throws(() => rangoDeDias({ desde: "ayer" }), (e) => e.codigo === "RANGO_INVALIDO");
    assert.throws(() => rangoDeDias({ desde: "2026-02-30" }), (e) => e.codigo === "RANGO_INVALIDO");
    assert.throws(() => rangoDeDias({ desde: "2026-11-24", hasta: "2026-11-23" }), (e) => e.codigo === "RANGO_INVALIDO");
  });
});
