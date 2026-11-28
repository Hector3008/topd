import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buscarOpciones, indexar, normalizar, opcionDeItem } from "../src/guia.js";
import { crearServicioGuia } from "../src/guia-servicio.js";

const item = (codigo, nombre, atributos = {}, extra = {}) => ({ id: `i-${codigo}`, codigo, nombre, categoria: null, precio: null, activo: true, atributos, ...extra });
const CATALOGO = [
  item("LL-AMI61-001", "Armadura de alternador 12V", { FAMILIA: "ARMADURA", SUBFAMILIA: "ALTERNADOR", PROVEEDOR: "LUCAS", MARCA: "LU", STOCK_LV: 4, STOCK_SJL: 0, UBICACION: "A-12", EQUIVALENTES_STOCK: ["LL-AMI61-002", "LL-AMI61-003"], PRECIO_SUGERIDO: 59 }),
  item("LL-AMI61-002", "Armadura de alternador 24V", { FAMILIA: "ARMADURA", SUBFAMILIA: "ALTERNADOR", PROVEEDOR: "BOSCH" }),
  item("MX2-01-00-LU-875", "Bujía de encendido", { FAMILIA: "ENCENDIDO", SUBFAMILIA: "BUJIA", PROVEEDOR: "LUCAS" }),
  item("ZM-0001", "Filtro de aceite", { FAMILIA: "FILTROS" }),
  item("ZM-OFF", "Alternador viejo", { FAMILIA: "ARMADURA" }, { activo: false }),
];
const idx = indexar(CATALOGO);

describe("guía de almacén: opciones del catálogo", () => {
  it("una sola coincidencia da una sola opción, con ubicación, stock y equivalentes", () => {
    const r = buscarOpciones(idx, { descripcion: "bujia" });
    assert.equal(r.total, 1);
    assert.equal(r.opciones[0].codigo, "MX2-01-00-LU-875");
    const a = buscarOpciones(idx, { descripcion: "armadura 12v" }).opciones[0];
    assert.deepEqual([a.ubicacion, a.stockLV, a.stockSJL, a.equivalentes, a.precioSugerido, a.proveedor], ["A-12", 4, 0, "LL-AMI61-002, LL-AMI61-003", 59, "LUCAS"]);
  });
  it("varias coincidencias muestran todas; todas las palabras deben aparecer, en cualquier campo y orden", () => {
    assert.deepEqual(buscarOpciones(idx, { descripcion: "alternador armadura" }).opciones.map((o) => o.codigo), ["LL-AMI61-001", "LL-AMI61-002"]);
    assert.equal(buscarOpciones(idx, { descripcion: "lucas armadura" }).total, 1); // proveedor + familia
    assert.equal(buscarOpciones(idx, { descripcion: "alternador bosch" }).total, 1);
    assert.equal(buscarOpciones(idx, { descripcion: "alternador bujia" }).total, 0); // una palabra no aparece
  });
  it("no distingue tildes ni mayúsculas, y los productos dados de baja no salen", () => {
    assert.equal(normalizar("BUJÍA"), "bujia");
    assert.equal(buscarOpciones(idx, { descripcion: "BUJÍA" }).total, 1);
    assert.equal(buscarOpciones(idx, { descripcion: "viejo" }).total, 0);
  });
  it("sin coincidencias o sin texto: «no encontrado» (total 0)", () => {
    assert.deepEqual(buscarOpciones(idx, { descripcion: "zzz" }), { opciones: [], total: 0, por: null, descartadas: 0 });
    assert.equal(buscarOpciones(idx, { descripcion: "  " }).total, 0);
    assert.equal(buscarOpciones([], { descripcion: "bujia" }).total, 0);
  });
  it("el código de catálogo (cod max) va primero porque es exacto; si falla se usa la descripción", () => {
    const r = buscarOpciones(idx, { codMax: "mx2-01-00-lu-875", descripcion: "algo distinto" });
    assert.deepEqual([r.total, r.por, r.opciones[0].codigo], [1, "codigo", "MX2-01-00-LU-875"]);
    const f = buscarOpciones(idx, { codMax: "NO-EXISTE", descripcion: "filtro aceite" });
    assert.deepEqual([f.total, f.por], [1, "descripcion"]);
  });
  it("limita las opciones que devuelve pero informa el total real", () => {
    const muchos = indexar(Array.from({ length: 30 }, (_, n) => item(`P-${n}`, "Rodamiento")));
    const r = buscarOpciones(muchos, { descripcion: "rodamiento" }, { max: 5 });
    assert.deepEqual([r.opciones.length, r.total], [5, 30]);
  });
  it("opcionDeItem tolera ítems sin atributos", () => {
    assert.deepEqual(opcionDeItem(item("X", "Algo")), { id: "i-X", codigo: "X", descripcion: "Algo", familia: "", subfamilia: "", proveedor: "", marca: "", stockLV: "", stockSJL: "", ubicacion: "", equivalentes: "", precioSugerido: null, puntaje: null });
  });
});

describe("servicio de la guía", () => {
  const crear = () => {
    const llamadas = [];
    const core = { catalogo: { async listar({ empresaId, limite, saltar }) { llamadas.push({ empresaId, limite, saltar }); return CATALOGO.slice(saltar, saltar + limite); } } };
    let t = 1000;
    const svc = crearServicioGuia({ core, ahora: () => t });
    return { svc, llamadas, pasar: (ms) => { t += ms; } };
  };
  it("busca por línea y guarda el catálogo en memoria (se relee a los 5 minutos)", async () => {
    const { svc, llamadas, pasar } = crear();
    const r = await svc.opciones({ empresaId: "e1", lineas: [{ k: "0", descripcion: "bujia" }, { k: "1", descripcion: "nada" }] });
    assert.deepEqual([r.catalogo.total, r.lineas["0"].total, r.lineas["1"].total], [5, 1, 0]);
    await svc.opciones({ empresaId: "e1", lineas: [{ k: "0", descripcion: "bujia" }] });
    assert.equal(llamadas.length, 1);
    pasar(6 * 60 * 1000);
    await svc.opciones({ empresaId: "e1", lineas: [{ k: "0", descripcion: "bujia" }] });
    assert.equal(llamadas.length, 2);
    await svc.opciones({ empresaId: "e2", lineas: [] }); // otra empresa tiene su propio catálogo
    assert.equal(llamadas.length, 3);
  });
  it("valida las líneas", async () => {
    const { svc } = crear();
    await assert.rejects(svc.opciones({ empresaId: "e1", lineas: "x" }), (e) => e.codigo === "LINEAS_INVALIDAS");
    await assert.rejects(svc.opciones({ empresaId: "e1", lineas: [{ descripcion: "a" }] }), (e) => e.codigo === "LINEAS_INVALIDAS");
    await assert.rejects(svc.opciones({ empresaId: "e1", lineas: Array.from({ length: 101 }, (_, i) => ({ k: String(i) })) }), (e) => e.codigo === "LINEAS_INVALIDAS");
  });
});

describe("guía: puntaje propio de los ítems", () => {
  const cat = [item("A-1", "Uno", { CODIGO_FORMATEADO: "A-1", PUNTAJE: 6 }), item("B-2", "Dos", { CODIGO_FORMATEADO: "B-2", PUNTAJE: 0 }), item("C-3", "Tres", { CODIGO_FORMATEADO: "C-3" })];
  const svc = crearServicioGuia({ core: { catalogo: { listar: async ({ saltar, limite }) => cat.slice(saltar, saltar + limite) } } });
  it("devuelve solo los que tienen puntaje (el 0 cuenta) y la opción lo expone", async () => {
    assert.deepEqual(await svc.puntajesDe({ empresaId: "e1", codigos: ["A-1", "B-2", "C-3", "Z-9"] }), { "A-1": 6, "B-2": 0 });
    assert.deepEqual(await svc.puntajesDe({ empresaId: "e1", codigos: [] }), {});
    assert.equal(opcionDeItem(cat[0]).puntaje, 6);
    assert.equal(opcionDeItem(cat[2]).puntaje, null);
  });
});
