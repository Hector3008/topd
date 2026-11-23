import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crearServicioPicking, limpiarCabecera, limpiarPagos } from "../src/picking-servicio.js";
import { ErrorPicking } from "../src/picking.js";

// Núcleo y colección falsos en memoria: prueban el flujo completo almacén → revisión sin base de datos.
function entorno() {
  const docs = new Map();
  const filas = [];
  const eventos = [];
  const core = {
    documentos: {
      async crear({ tipo, doc }) { const d = { tipo, code: `DP-000000${docs.size + 1}`, estado: "borrador", version: 1, createdAt: new Date(), updatedAt: new Date(), payload: { doc } }; docs.set(d.code, d); return d; },
      async obtener({ code }) { return docs.get(code) ?? null; },
      async listar({ estado }) { return [...docs.values()].filter((d) => [].concat(estado).includes(d.estado)).reverse(); },
      async nuevaVersion({ code, doc, esperaVersion }) {
        const d = docs.get(code);
        if (esperaVersion !== undefined && esperaVersion !== d.version) { const e = new Error("conflicto"); e.codigo = "CONFLICTO_VERSION"; throw e; }
        d.payload = { ...d.payload, doc }; d.version += 1; return d;
      },
      async transicionar({ code, a, esperaVersion }) { const d = docs.get(code); if (esperaVersion !== undefined && esperaVersion !== d.version) throw new Error("conflicto"); d.estado = a; return d; },
    },
    modelos: { Evento: { async create(e) { eventos.push(e); } } },
  };
  const Picking = {
    find: (f) => ({ lean: async () => filas.filter((x) => (f.code.$in ? f.code.$in.includes(x.code) : x.code === f.code)) }),
    findOne: (f) => ({ lean: async () => filas.find((x) => x.code === f.code && x.lineaId === f.lineaId) ?? null }),
    async deleteMany(f) {
      const ids = f.lineaId.$in;
      for (let i = filas.length - 1; i >= 0; i--) if (filas[i].code === f.code && ids.includes(filas[i].lineaId)) filas.splice(i, 1);
    },
    async findOneAndUpdate(f, { $set }) {
      let x = filas.find((r) => r.code === f.code && r.lineaId === f.lineaId);
      if (!x) filas.push((x = { code: f.code, lineaId: f.lineaId }));
      Object.assign(x, $set); return x;
    },
  };
  return { svc: crearServicioPicking({ core, Picking }), docs, filas, eventos };
}
const falla = (p, codigo) => assert.rejects(p, (e) => e instanceof ErrorPicking && e.codigo === codigo);
const lineas = [{ cantidad: 1, descripcion: "Alternador" }, { cantidad: 2, descripcion: "Portadiodo" }, { cantidad: 1, descripcion: "Conector", anulada: true }];

describe("servicio de picking (núcleo falso)", () => {
  it("de la creación a la revisión y el cierre", async () => {
    const { svc, docs, eventos } = entorno();
    const doc = await docs.get((await svc.crearOrden({ cabecera: { cliente: "Pedalco", $x: 1 }, lineas, usuarioId: "u1", permisos: [] })));
    // crearOrden transiciona con el núcleo real; aquí queda en orden_salida
    assert.equal(doc.estado, "orden_salida");
    assert.deepEqual(doc.payload.doc.cabecera, { cliente: "Pedalco" });
    const code = doc.code;

    const [p] = await svc.activas();
    assert.equal(p.lineas.length, 2); // la tachada no se busca
    assert.equal(p.avance.completo, false);

    await falla(svc.listoParaRevision({ code, usuarioId: "u2", permisos: [] }), "PICKING_INCOMPLETO");
    await svc.marcar({ code, lineaId: "L1", cambio: { estado: "encontrado", piso: 3 }, usuarioId: "u2" });
    await svc.marcar({ code, lineaId: "L2", cambio: { estado: "no_encontrado" }, usuarioId: "u2" });
    await falla(svc.marcar({ code, lineaId: "L3", cambio: { estado: "buscando" }, usuarioId: "u2" }), "LINEA_NO_ENCONTRADA");
    assert.equal(eventos.filter((e) => e.tipo === "picking.marca").length, 2);

    await falla(svc.cerrar({ code, usuarioId: "u3", permisos: [] }), "ESTADO_NO_REVISION");
    const r = await svc.listoParaRevision({ code, usuarioId: "u2", permisos: [] });
    assert.equal(r.estado, "orden_revision");
    assert.equal((await svc.activas()).length, 0);
    await falla(svc.marcar({ code, lineaId: "L1", cambio: { taller: true }, usuarioId: "u2" }), "ESTADO_NO_PICKING");

    const [enRevision] = await svc.listar({ estados: ["orden_revision"] });
    assert.equal(enRevision.lineas[0].picking.piso, 3);
    assert.equal(enRevision.avance.puntaje, 3);

    assert.equal((await svc.cerrar({ code, usuarioId: "u3", permisos: [] })).estado, "cerrada");
    assert.equal((await svc.listar({ estados: ["cerrada"], recientes: true })).length, 1);
  });

  it("rechaza orígenes y líneas inválidas al crear", async () => {
    const { svc } = entorno();
    await falla(svc.crearOrden({ lineas, origen: "telepatia" }), "ORIGEN_INVALIDO");
    await falla(svc.crearOrden({ lineas: [] }), "LINEAS_REQUERIDAS");
    await falla(svc.crearOrden({ lineas: [{ cantidad: 0, descripcion: "x" }] }), "LINEA_INVALIDA");
    const code = await svc.crearOrden({ lineas: [{ cantidad: 1, descripcion: "a" }, { descripcion: "Tachada sin cantidad", anulada: true }], origen: "ocr:manuscrito" });
    assert.ok(code.startsWith("DP-"));
  });
});

describe("datos heredados del siscore anterior", () => {
  it("la cabecera guarda cliente completo, entrega y venta, y valida las listas cerradas", () => {
    const c = limpiarCabecera({
      cliente: "Pedalco SRL", ruc: "20123456789", telefono: "999 111 222", email: "a@b.pe", direccion: "Av. X 123",
      provincia: "Tacna", ciudad: "Tacna", entrega: "agencia", destino: "Arequipa", agencia: "Flores", atencion: "Sr. Luis",
      canalVenta: "online", formaPago: "transferencia_y_caja", comprobante: "factura", extra: "no",
    });
    assert.equal(c.ruc, "20123456789");
    assert.equal(c.entrega, "agencia");
    assert.equal("extra" in c, false);
    for (const [k, v] of [["entrega", "drone"], ["canalVenta", "feria"], ["comprobante", "recibo"], ["formaPago", "trueque"]])
      assert.throws(() => limpiarCabecera({ [k]: v }), (e) => e.codigo === "CABECERA_INVALIDA", k);
  });

  it("valida los pagos", () => {
    assert.deepEqual(limpiarPagos(undefined), []);
    assert.deepEqual(limpiarPagos([{ cuenta: " BCP Max Imp ", monto: "150.456", operacion: " 884422 " }]), [{ cuenta: "BCP Max Imp", monto: 150.46, operacion: "884422" }]);
    for (const malo of [[{ cuenta: "", monto: 10 }], [{ cuenta: "BCP", monto: "" }], [{ cuenta: "BCP", monto: -1 }], "x", Array(11).fill({ cuenta: "a", monto: 1 })])
      assert.throws(() => limpiarPagos(malo), (e) => e.codigo === "PAGOS_INVALIDOS");
  });

  it("guarda pagos y el comentario de cada línea en el documento", async () => {
    const { svc, docs } = entorno();
    const code = await svc.crearOrden({
      cabecera: { cliente: "Pedalco", entrega: "tienda" },
      lineas: [{ cantidad: 1, descripcion: "Alternador", comentario: " el de 24v, no el de 12v " }],
      pagos: [{ cuenta: "BCP Max Imp", monto: 200, operacion: "123" }],
    });
    const d = docs.get(code).payload.doc;
    assert.equal(d.lineas[0].comentario, "el de 24v, no el de 12v");
    assert.equal(d.pagos.length, 1);
    assert.equal(d.cabecera.entrega, "tienda");
  });

  it("los pagos solo salen cuando se piden (bandeja), no en la lista del almacén", async () => {
    const { svc } = entorno();
    await svc.crearOrden({ lineas: [{ cantidad: 1, descripcion: "x" }], pagos: [{ cuenta: "BCP", monto: 10 }] });
    assert.equal("pagos" in (await svc.activas())[0], false);
    assert.equal((await svc.listar({ conPagos: true }))[0].pagos.length, 1);
  });
});

describe("editar una proforma generada", () => {
  const base = [{ cantidad: 1, descripcion: "Alternador", precioUnitario: 100 }, { cantidad: 2, descripcion: "Portadiodo", precioUnitario: 10 }];
  async function conAvance() {
    const e = entorno();
    const code = await e.svc.crearOrden({ cabecera: { cliente: "Pedalco" }, lineas: base, pagos: [] });
    await e.svc.marcar({ code, lineaId: "L1", cambio: { estado: "encontrado", piso: 2 }, usuarioId: "u2" });
    await e.svc.marcar({ code, lineaId: "L2", cambio: { estado: "no_encontrado" }, usuarioId: "u2" });
    return { ...e, code };
  }
  const deLaProforma = async (svc, code) => (await svc.obtener({ code }));

  it("abre la proforma completa con su versión", async () => {
    const { svc, code } = await conAvance();
    const p = await svc.obtener({ code });
    assert.equal(p.version, 1);
    assert.equal(p.editable, true);
    assert.deepEqual(p.lineas.map((l) => l.id), ["L1", "L2"]);
  });

  it("cambiar precio o comentario conserva el avance del almacén", async () => {
    const { svc, code, filas } = await conAvance();
    const p = await svc.obtener({ code });
    const r = await svc.editar({ code, esperaVersion: p.version, usuarioId: "u1", cabecera: { cliente: "Pedalco SRL" },
      lineas: [{ ...p.lineas[0], precioUnitario: 90, comentario: "el de 24v" }, p.lineas[1]] });
    assert.equal(r.version, 2);
    assert.deepEqual(r.reiniciadas, []);
    assert.equal(filas.length, 2);
    const nuevo = await deLaProforma(svc, code);
    assert.equal(nuevo.cabecera.cliente, "Pedalco SRL");
    assert.ok(nuevo.lineas[0].modificadaTs);          // el almacén verá «Cambió»
    assert.equal(nuevo.lineas[1].modificadaTs, undefined); // la que no cambió no se marca
  });

  it("cambiar cantidad o descripción reinicia solo esa línea; las demás siguen", async () => {
    const { svc, code, filas } = await conAvance();
    const p = await svc.obtener({ code });
    const r = await svc.editar({ code, esperaVersion: 1, usuarioId: "u1", lineas: [{ ...p.lineas[0], cantidad: 3 }, p.lineas[1]] });
    assert.deepEqual(r.reiniciadas, ["L1"]);
    assert.deepEqual(filas.map((f) => f.lineaId), ["L2"]);
    const [act] = await svc.activas();
    assert.equal(act.lineas[0].picking.estado, "pendiente");
    assert.equal(act.lineas[1].picking.estado, "no_encontrado");
  });

  it("una línea quitada pierde su avance y su id no se reutiliza para otra", async () => {
    const { svc, code, filas } = await conAvance();
    const p = await svc.obtener({ code });
    // quita L2 y agrega una nueva
    await svc.editar({ code, esperaVersion: 1, usuarioId: "u1", lineas: [p.lineas[0], { cantidad: 5, descripcion: "Escobilla" }] });
    const nuevo = await svc.obtener({ code });
    assert.deepEqual(nuevo.lineas.map((l) => l.id), ["L1", "L3"]);
    assert.deepEqual(filas.map((f) => f.lineaId), ["L1"]);
    assert.ok(nuevo.lineas[1].modificadaTs);
  });

  it("tachar una línea la saca de la búsqueda", async () => {
    const { svc, code } = await conAvance();
    const p = await svc.obtener({ code });
    await svc.editar({ code, esperaVersion: 1, usuarioId: "u1", lineas: [p.lineas[0], { ...p.lineas[1], anulada: true }] });
    assert.equal((await svc.activas())[0].lineas.length, 1);
  });

  it("sin cambios no crea versión", async () => {
    const { svc, code, docs } = await conAvance();
    const p = await svc.obtener({ code });
    const r = await svc.editar({ code, esperaVersion: 1, usuarioId: "u1", cabecera: p.cabecera, lineas: p.lineas, pagos: p.pagos });
    assert.equal(r.sinCambios, true);
    assert.equal(docs.get(code).version, 1);
  });

  it("exige versión, rechaza versión vieja y estados que ya no se editan", async () => {
    const { svc, code } = await conAvance();
    const p = await svc.obtener({ code });
    await falla(svc.editar({ code, lineas: p.lineas }), "VERSION_REQUERIDA");
    await svc.editar({ code, esperaVersion: 1, usuarioId: "u1", cabecera: { cliente: "Otro" }, lineas: p.lineas });
    await assert.rejects(svc.editar({ code, esperaVersion: 1, usuarioId: "u1", cabecera: { cliente: "Otro 2" }, lineas: p.lineas }), (e) => e.codigo === "CONFLICTO_VERSION");
    await svc.listoParaRevision({ code, usuarioId: "u2", permisos: [] });
    await falla(svc.editar({ code, esperaVersion: 2, usuarioId: "u1", lineas: p.lineas }), "ESTADO_NO_EDITABLE");
    assert.equal((await svc.obtener({ code })).editable, false);
    await falla(svc.editar({ code: "DP-9999999", esperaVersion: 1, lineas: p.lineas }), "PROFORMA_NO_ENCONTRADA");
  });

  it("valida lo editado igual que al crear y deja un evento", async () => {
    const { svc, code, eventos } = await conAvance();
    const p = await svc.obtener({ code });
    await falla(svc.editar({ code, esperaVersion: 1, lineas: [] }), "LINEAS_REQUERIDAS");
    await falla(svc.editar({ code, esperaVersion: 1, lineas: [{ cantidad: 0, descripcion: "x" }] }), "LINEA_INVALIDA");
    await falla(svc.editar({ code, esperaVersion: 1, cabecera: { entrega: "drone" }, lineas: p.lineas }), "CABECERA_INVALIDA");
    await svc.editar({ code, esperaVersion: 1, usuarioId: "u1", lineas: [{ ...p.lineas[0], cantidad: 2 }, p.lineas[1]] });
    const ev = eventos.find((e) => e.tipo === "proforma.editada");
    assert.equal(ev.estacion, "creacion");
    assert.deepEqual(ev.datos.reiniciadas, ["L1"]);
  });
});

describe("proformas con datos de catálogo (carga desde archivo)", () => {
  it("se guardan en la línea, aceptan el origen archivo y editarlos no reinicia el almacén", async () => {
    const e = entorno();
    const code = await e.svc.crearOrden({ origen: "archivo:pdf", cabecera: { cliente: "Tda Cajamarca" },
      lineas: [{ cantidad: 2, descripcion: "Relay Volvo", modelo: "SR45250", codMax: "MX1-03-00-SUNR-2006", proveedor: "TORQ X-JPN", familia: "RELAY", extra: "no se guarda" }] });
    const p = await e.svc.obtener({ code });
    assert.equal(p.origenCarga, "archivo:pdf");
    assert.deepEqual([p.lineas[0].modelo, p.lineas[0].codMax, p.lineas[0].proveedor, p.lineas[0].familia], ["SR45250", "MX1-03-00-SUNR-2006", "TORQ X-JPN", "RELAY"]);
    assert.equal("extra" in p.lineas[0], false);
    await e.svc.marcar({ code, lineaId: "L1", cambio: { estado: "encontrado", piso: 2 }, usuarioId: "u2" });
    const r = await e.svc.editar({ code, esperaVersion: 1, usuarioId: "u1", lineas: [{ ...p.lineas[0], proveedor: "TORQ" }] });
    assert.deepEqual(r.reiniciadas, []);
    assert.equal(e.filas.length, 1);
    assert.equal((await e.svc.obtener({ code })).lineas[0].proveedor, "TORQ");
    await falla(e.svc.crearOrden({ origen: "archivo:csv", lineas: [{ cantidad: 1, descripcion: "x" }] }), "ORIGEN_INVALIDO");
  });
});
