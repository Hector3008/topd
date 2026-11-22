import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { permite, pisosDe, haceCuanto, cambioDeEstado, prepararProforma, dinero, reducirDimensiones, formularioDeLectura, sumaDelFormulario, coincideBusqueda, resumenEntrega, textoOpcion, ENTREGAS, SECCIONES_CABECERA, cabeceraVacia, resultadoDeLinea, requiereAtencion, puedeRevisar, puedeBandeja } from "../client/src/logica.js";

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

  it("resume lo que pasó con una línea y marca las que piden atención", () => {
    const enc = { cantidad: 2, picking: { estado: "encontrado", piso: 3, taller: true, reconocido: "foto", cantidadEncontrada: 1, nota: "" } };
    assert.equal(resultadoDeLinea(enc), "Piso 3 · pasó por taller · reconocido por foto · trajo 1 de 2");
    assert.equal(requiereAtencion(enc), true);
    const ok = { cantidad: 1, picking: { estado: "encontrado", piso: 2, taller: false, reconocido: null, cantidadEncontrada: 1, nota: "" } };
    assert.equal(resultadoDeLinea(ok), "Piso 2");
    assert.equal(requiereAtencion(ok), false);
    assert.equal(resultadoDeLinea({ cantidad: 1, picking: { estado: "no_encontrado" } }), "No se encontró");
    assert.equal(requiereAtencion({ cantidad: 1, picking: { estado: "no_encontrado" } }), true);
    assert.equal(requiereAtencion({ cantidad: 1, picking: { estado: "encontrado", cantidadEncontrada: 1, nota: "golpeado" } }), true);
  });

  it("las estaciones salen de los permisos", () => {
    assert.equal(puedeRevisar(["estacion:revision"]), true);
    assert.equal(puedeRevisar(["estacion:produccion"]), false);
    assert.equal(puedeBandeja(["*"]), true);
  });

  it("la bandeja busca por código, cliente, vendedor o referencia del papel", () => {
    const p = { code: "DP-0000007", cabecera: { cliente: "Pedalco SRL", vendedor: "Max", referencia: "236445", ciudad: "Tacna" } };
    for (const q of ["dp-0000007", "pedalco", "MAX", "236445", "tacna", ""]) assert.equal(coincideBusqueda(p, q), true, q);
    assert.equal(coincideBusqueda(p, "999"), false);
    assert.equal(coincideBusqueda({ code: "DP-1" }, "x"), false);
  });

  it("la cabecera del formulario cubre los campos del siscore anterior", () => {
    const claves = Object.keys(cabeceraVacia());
    for (const k of ["cliente", "ruc", "telefono", "email", "direccion", "provincia", "ciudad", "entrega", "destino", "agencia", "atencion", "canalVenta", "formaPago", "comprobante", "fecha", "vendedor", "referencia"])
      assert.ok(claves.includes(k), k);
    assert.equal(SECCIONES_CABECERA.length, 2);
  });

  it("resume la entrega para el almacén", () => {
    assert.equal(resumenEntrega({ entrega: "agencia", agencia: "Flores", destino: "Arequipa", atencion: "Sr. Luis" }), "Entrega: Agencia Flores · Destino: Arequipa · Atención: Sr. Luis");
    assert.equal(resumenEntrega({ agencia: "Flores" }), "Agencia: Flores");
    assert.equal(resumenEntrega({}), "");
    assert.equal(textoOpcion(ENTREGAS, "local"), "Local");
  });

  it("lleva comentarios y pagos al servidor, y exige cuenta y monto en cada pago", () => {
    const r = prepararProforma({
      lineas: [{ cantidad: "1", descripcion: "Alternador", comentario: " el de 24v " }],
      pagos: [{ cuenta: "BCP Max Imp", monto: "200", operacion: "123" }, { cuenta: "", monto: "", operacion: "" }],
    });
    assert.equal(r.lineas[0].comentario, "el de 24v");
    assert.deepEqual(r.pagos, [{ cuenta: "BCP Max Imp", monto: 200, operacion: "123" }]);
    assert.match(prepararProforma({ lineas: [{ cantidad: "1", descripcion: "x" }], pagos: [{ cuenta: "BCP", monto: "" }] }).error, /pago 1/);
  });
});
