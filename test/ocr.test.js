import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizarLectura, prepararImagen, crearLector, motorVision, ErrorOcr, ESQUEMA_LECTURA } from "../src/ocr.js";
import { limpiarCabecera } from "../src/picking-servicio.js";

// Lo que debería devolver el motor para la proforma de ejemplo (Max Importaciones N.º 236445)
const MAX = {
  cabecera: { referencia: "236445", agencia: "Flores", cliente: "Pedalco SRL", ciudad: "Tacna", fecha: "2026-11-20", forma_pago: "credito", vendedor: "Max", despachador: "Alexis" },
  lineas: [
    { cantidad: 1, descripcion: "Alternador Deutz Bosch 12v (12181)", precio_unitario: 400, importe: 400, anulada: false },
    { cantidad: 2, descripcion: "Portadiodo Chevrolet", precio_unitario: 75, importe: 150, anulada: false },
    { cantidad: null, descripcion: "Conector chino strato", precio_unitario: 17, importe: null, anulada: true },
    { cantidad: 20, descripcion: "Contacto 707 dina abanico GR", precio_unitario: 4, importe: 80, anulada: false },
  ],
  total: 630,
  dudosos: ["linea 3 cantidad"],
};
const FOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
const codigos = (l) => l.avisos.map((a) => a.codigo);

describe("ocr: normalizar la lectura", () => {
  it("la proforma de ejemplo cuadra: suma 630, la tachada queda marcada y no cuenta", () => {
    const l = normalizarLectura(MAX);
    assert.equal(l.suma, 630);
    assert.equal(l.total, 630);
    assert.equal(l.cabecera.formaPago, "credito");
    assert.equal(l.cabecera.referencia, "236445");
    assert.equal(l.lineas[2].anulada, true);
    assert.equal(l.lineas[2].dudoso, true);
    assert.deepEqual(codigos(l), ["HAY_TACHADAS"]);
  });

  it("avisa cuando el total no cuadra o un importe no sale de cantidad × precio", () => {
    const m = structuredClone(MAX);
    m.lineas[1].importe = 160;
    m.total = 700;
    const l = normalizarLectura(m);
    assert.ok(codigos(l).includes("IMPORTE_NO_CUADRA"));
    assert.ok(codigos(l).includes("TOTAL_NO_CUADRA"));
  });

  it("tolera basura del motor sin romperse", () => {
    const l = normalizarLectura({ cabecera: { fecha: "20/11/2026", forma_pago: "trueque" }, lineas: [{ cantidad: "2,0", descripcion: "  x ", precio_unitario: "7,5" }, null], total: "abc" });
    assert.equal(l.cabecera.fecha, null);
    assert.equal(l.cabecera.formaPago, null);
    assert.equal(l.lineas[0].cantidad, 2);
    assert.equal(l.lineas[0].precioUnitario, 7.5);
    assert.equal(l.lineas[1].dudoso, true);
    assert.equal(l.total, null);
    assert.deepEqual(codigos(normalizarLectura({})), ["SIN_LINEAS"]);
  });
});

describe("ocr: la foto", () => {
  it("acepta data URL o base64 con tipo, y rechaza lo demás", () => {
    assert.equal(prepararImagen({ imagen: FOTO }).mediaType, "image/jpeg");
    assert.equal(prepararImagen({ imagen: "AAAA", mediaType: "image/png" }).base64, "AAAA");
    assert.throws(() => prepararImagen({}), (e) => e.codigo === "IMAGEN_REQUERIDA");
    assert.throws(() => prepararImagen({ imagen: "AAAA", mediaType: "application/pdf" }), (e) => e.codigo === "IMAGEN_INVALIDA");
    assert.throws(() => prepararImagen({ imagen: "<script>", mediaType: "image/png" }), (e) => e.codigo === "IMAGEN_INVALIDA");
    assert.throws(() => prepararImagen({ imagen: "A".repeat(7 * 1024 * 1024), mediaType: "image/png" }), (e) => e.codigo === "IMAGEN_GRANDE");
  });
});

describe("ocr: el motor de visión", () => {
  const respuesta = (cuerpo, ok = true, status = 200) => async () => ({ ok, status, json: async () => cuerpo });

  it("manda la foto con las instrucciones del modo y toma la salida de la herramienta", async () => {
    let enviado;
    const fetchFn = async (url, init) => { enviado = { url, ...init, cuerpo: JSON.parse(init.body) }; return { ok: true, status: 200, json: async () => ({ content: [{ type: "tool_use", name: "registrar_proforma", input: MAX }] }) }; };
    const lector = crearLector({ apiKey: "k", modelo: "m", fetchFn });
    const r = await lector.leerProforma({ imagen: FOTO, modo: "manuscrito" });
    assert.equal(r.modo, "manuscrito");
    assert.equal(r.suma, 630);
    assert.equal(enviado.headers["x-api-key"], "k");
    assert.equal(enviado.cuerpo.model, "m");
    assert.match(enviado.cuerpo.system, /escrita a mano/);
    assert.equal(enviado.cuerpo.tool_choice.name, "registrar_proforma");
    assert.equal(enviado.cuerpo.messages[0].content[0].source.media_type, "image/jpeg");
    await lector.leerProforma({ imagen: FOTO, modo: "impreso" });
    assert.match(enviado.cuerpo.system, /impresa o llenada a máquina/);
    assert.ok(ESQUEMA_LECTURA.required.includes("lineas"));
  });

  it("sin clave dice que no está activado, y no gasta nada", async () => {
    let llamadas = 0;
    const lector = crearLector({ apiKey: "", fetchFn: async () => { llamadas++; } });
    assert.equal(lector.activo, false);
    await assert.rejects(lector.leerProforma({ imagen: FOTO, modo: "impreso" }), (e) => e.codigo === "OCR_NO_CONFIGURADO");
    assert.equal(llamadas, 0);
  });

  it("traduce los fallos del motor a errores claros", async () => {
    const mal = (f) => crearLector({ apiKey: "k", fetchFn: f }).leerProforma({ imagen: FOTO, modo: "impreso" });
    await assert.rejects(mal(respuesta({ error: { message: "x" } }, false, 429)), (e) => e.codigo === "OCR_OCUPADO");
    await assert.rejects(mal(respuesta({}, false, 500)), (e) => e.codigo === "OCR_FALLO");
    await assert.rejects(mal(respuesta({ content: [{ type: "text", text: "hola" }] })), (e) => e.codigo === "OCR_FALLO");
    await assert.rejects(mal(async () => { throw new Error("red"); }), (e) => e.codigo === "OCR_SIN_CONEXION");
  });

  it("valida el modo y limita las lecturas por persona y hora", async () => {
    let t = 0;
    const lector = crearLector({ apiKey: "k", limitePorHora: 2, ahora: () => t, fetchFn: respuesta({ content: [{ type: "tool_use", name: "registrar_proforma", input: MAX }] }) });
    await assert.rejects(lector.leerProforma({ imagen: FOTO, modo: "foto" }), (e) => e.codigo === "MODO_INVALIDO");
    await lector.leerProforma({ imagen: FOTO, modo: "impreso", usuarioId: "u1" });
    await lector.leerProforma({ imagen: FOTO, modo: "impreso", usuarioId: "u1" });
    await assert.rejects(lector.leerProforma({ imagen: FOTO, modo: "impreso", usuarioId: "u1" }), (e) => e.codigo === "LIMITE_LECTURAS");
    await lector.leerProforma({ imagen: FOTO, modo: "impreso", usuarioId: "u2" }); // otra persona
    t = 3600_001; // pasó la hora
    await lector.leerProforma({ imagen: FOTO, modo: "impreso", usuarioId: "u1" });
  });

  it("un motor propio reemplaza a la visión en un modo (p. ej. impreso → Tesseract)", async () => {
    const lector = crearLector({ apiKey: "", motores: { impreso: async () => MAX } });
    assert.equal((await lector.leerProforma({ imagen: FOTO, modo: "impreso" })).suma, 630);
    await assert.rejects(lector.leerProforma({ imagen: FOTO, modo: "manuscrito" }), (e) => e instanceof ErrorOcr);
  });
});

describe("cabecera guardada", () => {
  it("solo guarda los campos conocidos y como texto corto", () => {
    const c = limpiarCabecera({ cliente: " Pedalco ", referencia: " 236445 ", agencia: "x".repeat(500), formaPago: "credito", $where: "1", vendedor: 5 });
    assert.deepEqual(Object.keys(c).sort(), ["agencia", "cliente", "formaPago", "referencia"]);
    assert.equal(c.referencia, "236445");
    assert.equal(c.agencia.length, 200);
  });
});
