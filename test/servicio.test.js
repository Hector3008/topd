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
      async transicionar({ code, a, esperaVersion }) { const d = docs.get(code); if (esperaVersion !== undefined && esperaVersion !== d.version) throw new Error("conflicto"); d.estado = a; return d; },
    },
    modelos: { Evento: { async create(e) { eventos.push(e); } } },
  };
  const Picking = {
    find: (f) => ({ lean: async () => filas.filter((x) => (f.code.$in ? f.code.$in.includes(x.code) : x.code === f.code)) }),
    findOne: (f) => ({ lean: async () => filas.find((x) => x.code === f.code && x.lineaId === f.lineaId) ?? null }),
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
