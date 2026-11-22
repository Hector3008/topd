import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { permite, pisosDe, haceCuanto, cambioDeEstado, prepararProforma, dinero, reducirDimensiones, formularioDeLectura, sumaDelFormulario } from "../client/src/logica.js";

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
      cabecera: { cliente: " Pedalco SRL ", vendedor: "Max", agencia: "  " },
      lineas: [
        { cantidad: "1", descripcion: "Alternador Deutz", precioUnitario: "400" },
        { cantidad: "", descripcion: "", precioUnitario: "" },
        { cantidad: "1", descripcion: "Conector (tachado)", precioUnitario: "17", anulada: true },
      ],
    });
    assert.equal(ok.cabecera.cliente, "Pedalco SRL");
    assert.equal("agencia" in ok.cabecera, false);
    assert.equal(ok.lineas.length, 2);
    assert.equal(ok.lineas[1].anulada, true);
    assert.match(prepararProforma({ lineas: [{ cantidad: "1.5", descripcion: "x" }] }).error, /línea 1/);
    assert.match(prepararProforma({ lineas: [{ cantidad: "", descripcion: "" }] }).error, /al menos una/);
    assert.equal(dinero(75), "75.00");
    assert.equal(dinero(null), "");
  });

  it("una línea tachada sin cantidad no bloquea la creación", () => {
    const r = prepararProforma({ lineas: [{ cantidad: "1", descripcion: "Alternador", precioUnitario: "400" }, { cantidad: "", descripcion: "Conector chino", precioUnitario: "17", anulada: true }] });
    assert.equal(r.error, undefined);
    assert.equal(r.lineas[1].cantidad, 1);
    assert.match(prepararProforma({ lineas: [{ cantidad: "", descripcion: "Conector" }] }).error, /línea 1/);
  });

  it("reduce la foto sin agrandarla", () => {
    assert.deepEqual(reducirDimensiones(4000, 3000), { ancho: 1600, alto: 1200 });
    assert.deepEqual(reducirDimensiones(800, 600), { ancho: 800, alto: 600 });
  });

  it("pasa la lectura al formulario y suma sin las tachadas", () => {
    const f = formularioDeLectura({
      cabecera: { cliente: "Pedalco SRL", formaPago: "credito", agencia: null },
      lineas: [
        { cantidad: 2, descripcion: "Portadiodo", precioUnitario: 75, anulada: false, dudoso: false },
        { cantidad: null, descripcion: "Conector", precioUnitario: 17, anulada: true, dudoso: true },
      ],
      total: 150, avisos: [{ codigo: "HAY_TACHADAS", mensaje: "x" }],
    });
    assert.equal(f.cabecera.cliente, "Pedalco SRL");
    assert.equal(f.cabecera.formaPago, "credito");
    assert.equal(f.cabecera.agencia, "");
    assert.equal(f.lineas[1].cantidad, "");
    assert.equal(f.lineas[1].dudoso, true);
    assert.equal(sumaDelFormulario(f.lineas), 150);
    assert.equal(f.avisos.length, 1);
  });
});
