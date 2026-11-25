import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createCore } from "core";
import { createRouter } from "../src/index.js";
import {
  aplicarMarca, lineasDelDocumento, combinarAvance, resumenAvance, ErrorPicking, PUNTAJES_PISO,
} from "../src/picking.js";

const linea = { id: "L1", cantidad: 2, descripcion: "Portadiodo Chevrolet" };
const falla = (fn, codigo) => assert.throws(fn, (e) => e instanceof ErrorPicking && e.codigo === codigo);

describe("picking: marcas de una línea", () => {
  it("buscando inicia el reloj y no tiene hallazgo", () => {
    const f = aplicarMarca(null, { estado: "buscando" }, { linea });
    assert.equal(f.estado, "buscando");
    assert.ok(f.iniciadoTs);
    assert.equal(f.resueltoTs, null);
    assert.equal(f.puntaje, 0);
  });

  it("encontrado exige piso, toma la cantidad pedida y puntúa según el piso", () => {
    falla(() => aplicarMarca(null, { estado: "encontrado" }, { linea }), "PISO_REQUERIDO");
    const f = aplicarMarca(null, { estado: "encontrado", piso: 3 }, { linea });
    assert.equal(f.cantidadEncontrada, 2);
    assert.equal(f.puntaje, PUNTAJES_PISO[3]);
    assert.ok(f.resueltoTs);
  });

  it("usa una tabla de puntajes distinta si se le pasa", () => {
    const f = aplicarMarca(null, { estado: "encontrado", piso: 2 }, { linea, puntajesPiso: { 2: 10 } });
    assert.equal(f.puntaje, 10);
    falla(() => aplicarMarca(null, { estado: "encontrado", piso: 4 }, { linea, puntajesPiso: { 2: 10 } }), "PISO_INVALIDO");
  });

  it("taller y reconocimiento se acumulan sin pisar el resto", () => {
    let f = aplicarMarca(null, { estado: "encontrado", piso: 2 }, { linea });
    f = aplicarMarca(f, { taller: true }, { linea });
    f = aplicarMarca(f, { reconocido: "foto", nota: " era el de 12V " }, { linea });
    assert.equal(f.piso, 2);
    assert.equal(f.taller, true);
    assert.equal(f.reconocido, "foto");
    assert.equal(f.nota, "era el de 12V");
    falla(() => aplicarMarca(f, { reconocido: "olfato" }, { linea }), "RECONOCIDO_INVALIDO");
  });

  it("no_encontrado borra piso y cantidad; volver a buscando limpia el hallazgo", () => {
    let f = aplicarMarca(null, { estado: "encontrado", piso: 4 }, { linea });
    f = aplicarMarca(f, { estado: "no_encontrado" }, { linea });
    assert.equal(f.piso, null);
    assert.equal(f.cantidadEncontrada, 0);
    assert.equal(f.puntaje, 0);
    f = aplicarMarca(f, { estado: "buscando" }, { linea });
    assert.equal(f.cantidadEncontrada, null);
    assert.equal(f.resueltoTs, null);
  });

  it("valida tipos de los campos", () => {
    falla(() => aplicarMarca(null, { estado: "perdido" }, { linea }), "ESTADO_INVALIDO");
    falla(() => aplicarMarca(null, { taller: "si" }, { linea }), "TALLER_INVALIDO");
    falla(() => aplicarMarca(null, { estado: "encontrado", piso: 2, cantidadEncontrada: 0 }, { linea }), "CANTIDAD_INVALIDA");
    falla(() => aplicarMarca(null, { nota: "x".repeat(301) }, { linea }), "NOTA_INVALIDA");
  });
});

describe("picking: avance de una proforma", () => {
  const doc = {
    payload: { doc: { lineas: [
      { id: "L1", cantidad: 1, descripcion: "Alternador" },
      { id: "L2", cantidad: 2, descripcion: "Portadiodo" },
      { id: "L3", cantidad: 1, descripcion: "Conector (tachado)", anulada: true },
      { cantidad: 20, descripcion: "Contacto" },
    ] } },
  };

  it("omite las líneas anuladas y da id a las que no lo traen", () => {
    assert.deepEqual(lineasDelDocumento(doc).map((l) => l.id), ["L1", "L2", "L4"]);
    assert.deepEqual(lineasDelDocumento({}), []);
  });

  it("solo está completo cuando todas las líneas están resueltas", () => {
    const lineas = lineasDelDocumento(doc);
    let r = resumenAvance(combinarAvance(lineas, [{ lineaId: "L1", estado: "encontrado", piso: 2, puntaje: 2, taller: false }]));
    assert.equal(r.completo, false);
    assert.deepEqual(r.pendientes, ["L2", "L4"]);
    r = resumenAvance(combinarAvance(lineas, [
      { lineaId: "L1", estado: "encontrado", puntaje: 2 },
      { lineaId: "L2", estado: "no_encontrado", puntaje: 0 },
      { lineaId: "L4", estado: "encontrado", puntaje: 4 },
    ]));
    assert.equal(r.completo, true);
    assert.equal(r.puntaje, 6);
  });
});

describe("picking: servicio montado", () => {
  it("el router se monta y registra el modelo sin abrir conexión", () => {
    const core = createCore({ connection: mongoose.createConnection() });
    const router = createRouter({ core });
    const rutas = router.stack.filter((c) => c.route).map((c) => `${Object.keys(c.route.methods)[0]} ${c.route.path}`);
    assert.ok(rutas.includes("get /picking"));
    assert.ok(rutas.includes("put /picking/:code/lineas/:lineaId"));
    assert.ok(rutas.includes("post /picking/:code/listo"));
    assert.ok(rutas.includes("post /proformas"));
    assert.ok(rutas.includes("get /estado"));
    assert.ok(rutas.includes("get /stock/estado"));
    assert.ok(rutas.includes("post /stock/sincronizar"));
  });
});

describe("front servido por el router", () => {
  it("sirve client/dist en la raíz si existe", async () => {
    const { default: express } = await import("express");
    const core = createCore({ connection: mongoose.createConnection() });
    const app = express().use("/topd", createRouter({ core }));
    const servidor = app.listen(0);
    try {
      const { port } = servidor.address();
      const r = await fetch(`http://127.0.0.1:${port}/topd/`);
      assert.equal(r.status, 200);
      assert.match(await r.text(), /topd/);
      assert.equal((await fetch(`http://127.0.0.1:${port}/topd/estado`)).status, 200);
    } finally {
      servidor.close();
    }
  });
});

describe("OCR montado en el router", () => {
  it("registra las rutas de lectura antes del parser general", () => {
    const core = createCore({ connection: mongoose.createConnection() });
    const router = createRouter({ core });
    const rutas = router.stack.filter((c) => c.route).map((c) => `${Object.keys(c.route.methods)[0]} ${c.route.path}`);
    assert.ok(rutas.includes("post /proformas/leer"));
    assert.ok(rutas.includes("get /ocr"));
    assert.ok(rutas.indexOf("post /proformas/leer") < rutas.indexOf("post /proformas"));
  });
});
