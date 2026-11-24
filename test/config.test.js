import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { configPorDefecto, limpiarConfig, puntajesDe, copiaDeEmisor } from "../src/config.js";
import { aplicarMarca, ErrorPicking } from "../src/picking.js";
import { crearServicioPicking, limpiarLineas } from "../src/picking-servicio.js";

const invalida = (f) => assert.throws(f, (e) => e instanceof ErrorPicking && e.codigo === "CONFIG_INVALIDA");

describe("configuración por empresa", () => {
  it("por defecto: pisos 1 a 4, extras en 0 y sin emisores", () => {
    const c = configPorDefecto();
    assert.deepEqual(puntajesDe(c), { 1: 1, 2: 2, 3: 3, 4: 4 });
    assert.deepEqual(c.extras, { taller: 0, muestra: 0, foto: 0 });
    assert.deepEqual(c.emisores, []);
  });

  it("valida y ordena los pisos; lo que no viene se conserva", () => {
    const c = limpiarConfig({ pisos: [{ piso: 3, puntaje: "2.5" }, { piso: 1, puntaje: 0 }], extras: { taller: 3 } });
    assert.deepEqual(c.pisos, [{ piso: 1, puntaje: 0 }, { piso: 3, puntaje: 2.5 }]);
    assert.deepEqual(c.extras, { taller: 3, muestra: 0, foto: 0 });
    invalida(() => limpiarConfig({ pisos: [] }));
    invalida(() => limpiarConfig({ pisos: [{ piso: 1, puntaje: 1 }, { piso: 1, puntaje: 2 }] }));
    invalida(() => limpiarConfig({ pisos: [{ piso: 0, puntaje: 1 }] }));
    invalida(() => limpiarConfig({ pisos: [{ piso: 1, puntaje: -1 }] }));
    invalida(() => limpiarConfig({ pisos: [{ piso: 1, puntaje: "" }] }));
    invalida(() => limpiarConfig({ extras: { foto: "mucho" } }));
    assert.deepEqual(limpiarConfig({}).pisos, configPorDefecto().pisos);
  });

  it("emisores: ids estables, nunca se borran (se desactivan) y la copia exige uno activo", () => {
    const a = limpiarConfig({ emisores: [{ nombre: " Repuestos Norte ", ruc: "20123456789" }, { nombre: "Taller Sur" }] });
    assert.deepEqual(a.emisores.map((e) => [e.id, e.nombre, e.activo]), [["E1", "Repuestos Norte", true], ["E2", "Taller Sur", true]]);
    const b = limpiarConfig({ emisores: [{ id: "E2", nombre: "Taller Sur SAC" }, { nombre: "Nuevo" }] }, a);
    assert.deepEqual(b.emisores.map((e) => [e.id, e.nombre, e.activo]), [["E2", "Taller Sur SAC", true], ["E3", "Nuevo", true], ["E1", "Repuestos Norte", false]]);
    invalida(() => limpiarConfig({ emisores: [{ nombre: " " }] }));
    assert.equal(copiaDeEmisor(b, "E2").nombre, "Taller Sur SAC");
    assert.equal("activo" in copiaDeEmisor(b, "E2"), false);
    assert.equal(copiaDeEmisor(b, ""), null);
    assert.equal(copiaDeEmisor(b, undefined), null);
    assert.throws(() => copiaDeEmisor(b, "E1"), (e) => e.codigo === "EMISOR_INVALIDO");
    assert.throws(() => copiaDeEmisor(b, "E9"), (e) => e.codigo === "EMISOR_INVALIDO");
  });

  it("el puntaje de una marca suma piso + taller + muestra/foto según la tabla", () => {
    const o = { puntajesPiso: { 1: 1, 2: 5 }, extras: { taller: 2, muestra: 0.5, foto: 1 }, linea: { cantidad: 1 } };
    assert.equal(aplicarMarca(null, { estado: "encontrado", piso: 2 }, o).puntaje, 5);
    assert.equal(aplicarMarca(null, { estado: "encontrado", piso: 2, taller: true }, o).puntaje, 7);
    assert.equal(aplicarMarca(null, { estado: "encontrado", piso: 1, reconocido: "muestra" }, o).puntaje, 1.5);
    assert.equal(aplicarMarca(null, { estado: "encontrado", piso: 1, taller: true, reconocido: "foto" }, o).puntaje, 4);
    assert.equal(aplicarMarca(null, { estado: "no_encontrado", taller: true }, o).puntaje, 0);
    assert.throws(() => aplicarMarca(null, { estado: "encontrado", piso: 3 }, o), (e) => e.codigo === "PISO_INVALIDO");
    // sin extras configurados todo sigue valiendo solo el piso
    assert.equal(aplicarMarca(null, { estado: "encontrado", piso: 2, taller: true }, { puntajesPiso: { 2: 5 } }).puntaje, 5);
  });

  it("un borrador puede ir sin líneas; lo demás no", () => {
    assert.deepEqual(limpiarLineas([], null, undefined, { permitirVacio: true }), []);
    assert.deepEqual(limpiarLineas(undefined, null, undefined, { permitirVacio: true }), []);
    assert.throws(() => limpiarLineas([]), (e) => e.codigo === "LINEAS_REQUERIDAS");
  });
});
