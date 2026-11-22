import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { permite, pisosDe, haceCuanto, cambioDeEstado, prepararProforma, dinero } from "../client/src/logica.js";

describe("front de topd: lógica", () => {
  it("permite imita al núcleo", () => {
    assert.equal(permite(["*"], "estacion:produccion"), true);
    assert.equal(permite(["estacion:*"], "estacion:produccion"), true);
    assert.equal(permite(["estacion:bandeja"], "estacion:produccion"), false);
    assert.equal(permite(undefined, "estacion:produccion"), false);
  });

  it("ordena los pisos de la tabla del servidor", () => {
    assert.deepEqual(pisosDe({ 3: 3, 1: 1, 2: 5 }), [{ piso: 1, puntos: 1 }, { piso: 2, puntos: 5 }, { piso: 3, puntos: 3 }]);
    assert.deepEqual(pisosDe(null), []);
  });

  it("dice hace cuánto", () => {
    const t = Date.parse("2026-11-21T12:00:00Z");
    assert.equal(haceCuanto("2026-11-21T11:59:40Z", t), "ahora");
    assert.equal(haceCuanto("2026-11-21T11:30:00Z", t), "hace 30 min");
    assert.equal(haceCuanto("2026-11-21T09:00:00Z", t), "hace 3 h");
    assert.equal(haceCuanto("2026-11-19T12:00:00Z", t), "hace 2 d");
  });

  it("encontrado manda el piso; los demás estados no", () => {
    assert.deepEqual(cambioDeEstado("encontrado", 2), { estado: "encontrado", piso: 2 });
    assert.deepEqual(cambioDeEstado("buscando", 2), { estado: "buscando" });
  });

  it("prepara la proforma: salta filas vacías y valida las demás", () => {
    const ok = prepararProforma({
      cliente: " Pedalco SRL ", vendedor: "Max",
      lineas: [
        { cantidad: "1", descripcion: "Alternador Deutz", precioUnitario: "400" },
        { cantidad: "", descripcion: "", precioUnitario: "" },
        { cantidad: "1", descripcion: "Conector (tachado)", precioUnitario: "17", anulada: true },
      ],
    });
    assert.equal(ok.cabecera.cliente, "Pedalco SRL");
    assert.equal(ok.lineas.length, 2);
    assert.equal(ok.lineas[1].anulada, true);
    assert.match(prepararProforma({ lineas: [{ cantidad: "1.5", descripcion: "x" }] }).error, /línea 1/);
    assert.match(prepararProforma({ lineas: [{ cantidad: "", descripcion: "" }] }).error, /al menos una/);
    assert.equal(dinero(75), "75.00");
    assert.equal(dinero(null), "");
  });
});
