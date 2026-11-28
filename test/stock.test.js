import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { numero, productosDeHoja, acumula } from "../src/stock.js";
import { crearServicioStock, stockDeEntorno } from "../src/stock-servicio.js";
import { crearLectorHoja } from "../src/hoja.js";

const ENC = ["DICTIONARY", "CODE", "LV", "SJL", "TOTAL", "EQUIVALENTE + STOCK", "NOMBRE COMERCIAL", "FAMILIA", "SUBFAMILIA", "PROVEEDOR", "MARCA", "UBICACION", "PRECIO SUGERIDO"];
const fila = (cod, extra = {}) => ENC.map((h) => extra[h] ?? ({ DICTIONARY: cod, CODE: `C-${cod}`, LV: "4", SJL: "", TOTAL: "4", "NOMBRE COMERCIAL": `Producto ${cod}`, FAMILIA: "ARMADURA", "PRECIO SUGERIDO": "S/ 59.90" }[h] ?? ""));

// Catálogo falso con la misma conducta que core.catalogo para lo que usa el servicio
function catalogoFalso({ rechazar = [] } = {}) {
  const items = new Map(); let seq = 0; const llamadas = { importar: [], listar: 0, desactivar: [], reactivar: [] };
  return {
    items, llamadas,
    async listar({ limite, saltar }) { llamadas.listar++; return [...items.values()].slice(saltar, saltar + limite); },
    async obtener({ codigo }) { const i = items.get(codigo.toLowerCase()); if (!i) throw Object.assign(new Error("no"), { codigo: "NO_ENCONTRADO" }); return i; },
    async importar({ filas }) {
      llamadas.importar.push(filas.map((f) => f.codigo));
      const malas = filas.map((f, i) => ({ f, fila: i + 1 })).filter(({ f }) => rechazar.includes(f.codigo));
      if (malas.length) throw Object.assign(new Error("inválidas"), { codigo: "IMPORTACION_INVALIDA", detalle: { errores: malas.map((m) => ({ fila: m.fila, codigo: m.f.codigo, error: "precio inválido" })) } });
      let creados = 0, actualizados = 0;
      for (const f of filas) {
        const k = f.codigo.toLowerCase(); const previo = items.get(k);
        const atributos = Object.fromEntries(Object.entries(f.atributos).filter(([, v]) => v !== null));
        if (previo) { items.set(k, { ...previo, nombre: f.nombre, categoria: f.categoria, precio: f.precio, atributos }); actualizados++; }
        else { items.set(k, { id: `i${++seq}`, codigo: f.codigo, nombre: f.nombre, categoria: f.categoria, precio: f.precio, activo: true, atributos }); creados++; }
      }
      return { creados, actualizados, omitidos: [], inactivos: [], simulado: false };
    },
    async desactivar({ itemId }) { llamadas.desactivar.push(itemId); for (const [k, i] of items) if (i.id === itemId) items.set(k, { ...i, activo: false }); },
    async reactivar({ itemId }) { llamadas.reactivar.push(itemId); for (const [k, i] of items) if (i.id === itemId) items.set(k, { ...i, activo: true }); },
  };
}
const servicio = (cat, hoja, extra = {}) => crearServicioStock({ core: { catalogo: cat }, empresaId: "emp1", leerHoja: async () => hoja.valores, registrar: { error() {} }, ...extra });

describe("stock: lectura de la hoja", () => {
  it("números a la peruana y a la inglesa; vacío o texto → null", () => {
    assert.equal(numero("S/ 1,234.50"), 1234.5);
    assert.equal(numero("59,9"), 59.9);
    assert.equal(numero("1,234"), 1234);
    assert.equal(numero("12"), 12);
    assert.equal(numero(""), null);
    assert.equal(numero("sin stock"), null);
  });
  it("convierte filas en productos con stock, ubicación, equivalentes y precio", () => {
    const { productos, descartadas } = productosDeHoja([ENC, fila("LL-001", { SJL: "2", UBICACION: "A-12", "EQUIVALENTE + STOCK": "LL-002 (3)", MARCA: "LU" })]);
    assert.equal(descartadas.length, 0);
    const p = productos[0];
    assert.deepEqual([p.codigo, p.nombre, p.categoria, p.precio], ["LL-001", "Producto LL-001", "ARMADURA", 59.9]);
    assert.deepEqual([p.atributos.STOCK_LV, p.atributos.STOCK_SJL, p.atributos.UBICACION, p.atributos.EQUIVALENTES_STOCK, p.atributos.CODIGO, p.atributos.ORIGEN], [4, 2, "A-12", ["LL-002 (3)"], "C-LL-001", "hoja"]);
    assert.equal(p.atributos.HUELLA, p.huella);
  });
  it("los encabezados no distinguen mayúsculas ni tildes; sin DICTIONARY la hoja no sirve", () => {
    const enc = ENC.map((h) => h.toLowerCase());
    assert.equal(productosDeHoja([enc, fila("A-1")]).productos.length, 1);
    assert.throws(() => productosDeHoja([["X", "Y"], ["1", "2"]]), /DICTIONARY/);
  });
  it("ignora filas sin código; descarta código inválido o repetido con su número de fila", () => {
    const r = productosDeHoja([ENC, fila("A-1"), fila(""), fila("a b"), fila("a-1")]);
    assert.equal(r.productos.length, 1);
    assert.deepEqual(r.descartadas.map((d) => d.fila), [4, 5]);
  });
  it("la huella cambia si cambia el stock y no si todo es igual", () => {
    const a = productosDeHoja([ENC, fila("A-1")]).productos[0].huella;
    assert.equal(productosDeHoja([ENC, fila("A-1")]).productos[0].huella, a);
    assert.notEqual(productosDeHoja([ENC, fila("A-1", { LV: "9" })]).productos[0].huella, a);
  });
});

describe("stock: sincronización con el catálogo", () => {
  it("la primera vez crea todo; la segunda no envía nada (sin cambios)", async () => {
    const cat = catalogoFalso(); const hoja = { valores: [ENC, fila("A-1"), fila("A-2")] };
    const s = servicio(cat, hoja);
    const r1 = await s.sincronizar();
    assert.deepEqual([r1.ok, r1.creados, r1.sinCambios], [true, 2, 0]);
    const r2 = await s.sincronizar();
    assert.deepEqual([r2.ok, r2.creados, r2.actualizados, r2.sinCambios], [true, 0, 0, 2]);
    assert.equal(cat.llamadas.importar.length, 1);
  });
  it("solo reenvía lo que cambió (stock nuevo) y avisa para olvidar el caché de la guía", async () => {
    const cat = catalogoFalso(); const hoja = { valores: [ENC, fila("A-1"), fila("A-2")] }; const avisos = [];
    const s = servicio(cat, hoja, { alCambiar: (e) => avisos.push(e) });
    await s.sincronizar();
    hoja.valores = [ENC, fila("A-1", { LV: "0" }), fila("A-2")];
    const r = await s.sincronizar();
    assert.deepEqual([r.actualizados, r.sinCambios], [1, 1]);
    assert.deepEqual(cat.llamadas.importar[1], ["A-1"]);
    assert.equal(cat.items.get("a-1").atributos.STOCK_LV, 0);
    assert.deepEqual(avisos, ["emp1", "emp1"]);
  });
  it("tras reiniciar el servidor aprende del catálogo y no reenvía lo que ya está igual", async () => {
    const cat = catalogoFalso(); const hoja = { valores: [ENC, fila("A-1"), fila("A-2")] };
    await servicio(cat, hoja).sincronizar();
    const r = await servicio(cat, hoja).sincronizar(); // servicio nuevo = memoria vacía
    assert.deepEqual([r.creados, r.actualizados, r.sinCambios], [0, 0, 2]);
  });
  it("desactiva lo que sale de la hoja, lo reactiva si vuelve y no toca lo creado a mano", async () => {
    const cat = catalogoFalso(); const hoja = { valores: [ENC, fila("A-1"), fila("A-2")] };
    cat.items.set("manual", { id: "m1", codigo: "MANUAL", nombre: "A mano", activo: true, atributos: {} });
    const s = servicio(cat, hoja);
    await s.sincronizar();
    hoja.valores = [ENC, fila("A-1")];
    const r = await s.sincronizar();
    assert.equal(r.desactivados, 1);
    assert.equal(cat.items.get("a-2").activo, false);
    assert.equal(cat.items.get("manual").activo, true);
    hoja.valores = [ENC, fila("A-1"), fila("A-2")];
    const r3 = await s.sincronizar();
    assert.equal(r3.reactivados, 1);
    assert.equal(cat.items.get("a-2").activo, true);
  });
  it("freno: si desaparece demasiado de golpe no desactiva nada y avisa", async () => {
    const cat = catalogoFalso(); const codigos = Array.from({ length: 100 }, (_, i) => `P-${i}`);
    const hoja = { valores: [ENC, ...codigos.map((c) => fila(c))] };
    const s = servicio(cat, hoja);
    await s.sincronizar();
    hoja.valores = [ENC, ...codigos.slice(0, 40).map((c) => fila(c))];
    const r = await s.sincronizar();
    assert.equal(r.desactivados, 0);
    assert.match(r.avisos[0], /Frenado: 60 de 100/);
    assert.equal([...cat.items.values()].filter((i) => i.activo).length, 100);
  });
  it("una hoja vacía no cambia nada y deja el error a la vista", async () => {
    const cat = catalogoFalso(); const hoja = { valores: [ENC, fila("A-1")] };
    const s = servicio(cat, hoja);
    await s.sincronizar();
    hoja.valores = [ENC];
    const r = await s.sincronizar();
    assert.equal(r.ok, false);
    assert.match(r.error, /no trae productos/);
    assert.equal(cat.items.get("a-1").activo, true);
    assert.equal(s.estado().ultima.ok, false);
  });
  it("una fila que el catálogo rechaza se aparta y las demás sí se cargan", async () => {
    const cat = catalogoFalso({ rechazar: ["A-2"] }); const hoja = { valores: [ENC, fila("A-1"), fila("A-2"), fila("A-3")] };
    const r = await servicio(cat, hoja).sincronizar();
    assert.deepEqual([r.ok, r.creados], [true, 2]);
    assert.deepEqual(r.descartadas.map((d) => d.codigo), ["A-2"]);
    assert.ok(!cat.items.has("a-2"));
  });
  it("divide en lotes de 500", async () => {
    const cat = catalogoFalso(); const hoja = { valores: [ENC, ...Array.from({ length: 1200 }, (_, i) => fila(`P-${i}`))] };
    const r = await servicio(cat, hoja).sincronizar();
    assert.equal(r.creados, 1200);
    assert.deepEqual(cat.llamadas.importar.map((l) => l.length), [500, 500, 200]);
  });
  it("sin configuración no corre y lo dice; el error de la hoja queda en el estado", async () => {
    const s = crearServicioStock({ core: { catalogo: catalogoFalso() } });
    assert.equal(s.estado().configurado, false);
    await assert.rejects(() => s.sincronizar(), /no está configurada/);
    const s2 = crearServicioStock({ core: { catalogo: catalogoFalso() }, empresaId: "e", leerHoja: async () => { throw new Error("Google caído"); } });
    const r = await s2.sincronizar();
    assert.deepEqual([r.ok, r.error], [false, "Google caído"]);
  });
  it("variables de entorno: si falta alguna queda apagada", () => {
    const env = { STOCK_EMPRESA_ID: "e1", SHEET_ID: "h1", GOOGLE_SERVICE_ACCOUNT_EMAIL: "a@b.c", GOOGLE_PRIVATE_KEY: "k" };
    assert.deepEqual(stockDeEntorno(env), { empresaId: "e1", hojaId: "h1", email: "a@b.c", clave: "k", rango: "RESULT!A:Z", cadaMin: 2 });
    assert.equal(stockDeEntorno({ ...env, SHEET_ID: "" }), null);
    assert.equal(stockDeEntorno({ ...env, TOPD_STOCK_APAGADO: "1" }), null);
  });
});

describe("stock: lector de Google Sheets", () => {
  it("firma el JWT con la cuenta de servicio, pide el token y lee el rango", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).replace(/\n/g, "\\n"); // como llega en la variable de entorno
    const pedidos = [];
    const fetch = async (url, op) => {
      pedidos.push({ url: String(url), op });
      if (String(url).includes("oauth2")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
      return { ok: true, json: async () => ({ values: [["A"], ["1"]] }) };
    };
    const leer = crearLectorHoja({ email: "svc@x.iam", clave: pem, hojaId: "HOJA1", rango: "RESULT!A:O", fetch });
    assert.deepEqual(await leer(), [["A"], ["1"]]);
    await leer(); // el token se reutiliza
    assert.equal(pedidos.filter((p) => p.url.includes("oauth2")).length, 1);
    const assertion = pedidos[0].op.body.get("assertion"); const [h, c, f] = assertion.split(".");
    assert.equal(JSON.parse(Buffer.from(c, "base64url")).iss, "svc@x.iam");
    assert.ok(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, f, "base64url"));
    assert.match(pedidos[1].url, /spreadsheets\/HOJA1\/values\/RESULT!A%3AO$/);
    assert.equal(pedidos[1].op.headers.authorization, "Bearer tok");
  });
  it("traduce los rechazos de Google y las claves inválidas a mensajes claros", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" });
    const fetch = async (url) => String(url).includes("oauth2")
      ? { ok: true, json: async () => ({ access_token: "t" }) }
      : { ok: false, status: 403, json: async () => ({ error: { message: "The caller does not have permission" } }) };
    await assert.rejects(crearLectorHoja({ email: "e", clave: pem, hojaId: "h", fetch }), /does not have permission/);
    await assert.rejects(crearLectorHoja({ email: "e", clave: "no-es-clave", hojaId: "h", fetch }), /clave privada/);
  });
});

describe("stock: columna PUNTAJE", () => {
  it("lee PUNTAJE (o PUNTAJE PICKING) como atributo; vacío, negativo o fuera de rango = null", () => {
    const enc = ["DICTIONARY", "NOMBRE COMERCIAL", "PUNTAJE"];
    const { productos } = productosDeHoja([enc, ["A1", "uno", "2.5"], ["A2", "dos", ""], ["A3", "tres", "-1"], ["A4", "cuatro", "5000"], ["A5", "cinco", "0"]]);
    assert.deepEqual(productos.map((p) => p.atributos.PUNTAJE), [2.5, null, null, null, 0]);
    const otro = productosDeHoja([["DICTIONARY", "Puntaje Picking"], ["B1", "7"]]).productos[0];
    assert.equal(otro.atributos.PUNTAJE, 7);
  });
  it("sin la columna, PUNTAJE es null y la huella cambia al cambiar el puntaje", () => {
    const sin = productosDeHoja([["DICTIONARY"], ["C1"]]).productos[0];
    assert.equal(sin.atributos.PUNTAJE, null);
    const a = productosDeHoja([["DICTIONARY", "PUNTAJE"], ["C1", "1"]]).productos[0];
    const b = productosDeHoja([["DICTIONARY", "PUNTAJE"], ["C1", "2"]]).productos[0];
    assert.notEqual(a.huella, b.huella);
  });
});

describe("stock: columna ACUMULA", () => {
  it("sí / por unidad → true; no / fijo → false; vacío o ilegible → null", () => {
    for (const v of ["SI", "Sí", "x", "por unidad", "C/U", "1", true]) assert.equal(acumula(v), true, String(v));
    for (const v of ["No", "FIJO", "0", "por opción", false]) assert.equal(acumula(v), false, String(v));
    for (const v of ["", "  ", "quizás", undefined]) assert.equal(acumula(v), null, String(v));
  });
  it("se guarda como atributo PUNTAJE_ACUMULA", () => {
    const { productos } = productosDeHoja([["DICTIONARY", "PUNTAJE", "ACUMULA"], ["A1", "5", "sí"], ["A2", "5", "no"], ["A3", "5", ""]]);
    assert.deepEqual(productos.map((p) => p.atributos.PUNTAJE_ACUMULA), [true, false, null]);
  });
});

