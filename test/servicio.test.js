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
      async transicionar({ code, a, motivo, esperaVersion }) { const d = docs.get(code); if (esperaVersion !== undefined && esperaVersion !== d.version) throw new Error("conflicto"); d.estado = a; if (motivo) d.motivo = motivo; return d; },
    },
    modelos: {
      Evento: { async create(e) { eventos.push(e); } },
      Usuario: { find: () => ({ select: () => ({ lean: async () => [{ _id: "u2", nombre: "Rosa" }] }) }) },
    },
  };
  let config = null;
  const Config = {
    findOne: () => ({ lean: async () => config }),
    async findOneAndUpdate(_f, { $set }) { config = { clave: "topd", ...$set }; return config; },
  };
  const Picking = {
    find: (f) => ({
      lean: async () => filas.filter((x) => (f.resueltoTs
        ? f.estado.$in.includes(x.estado) && x.resueltoTs >= f.resueltoTs.$gte && x.resueltoTs < f.resueltoTs.$lt
        : f.code.$in ? f.code.$in.includes(x.code) : x.code === f.code)),
    }),
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
  const svc = crearServicioPicking({ core, Picking, Config });
  // Casi todas las pruebas solo necesitan el código; la forma completa { code, estado } es svc.crearOrdenCompleta
  const crearOrdenCompleta = svc.crearOrden;
  svc.crearOrdenCompleta = crearOrdenCompleta;
  svc.crearOrden = async (a) => (await crearOrdenCompleta(a)).code;
  return { svc, docs, filas, eventos, config };
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

describe("configuración, emisor, borrador y cotización", () => {
  const una = [{ cantidad: 1, descripcion: "Alternador" }];

  it("guarda la configuración y el almacén puntúa con ella", async () => {
    const e = entorno();
    assert.deepEqual((await e.svc.puntajes()).puntajesPiso, { 1: 1, 2: 2, 3: 3, 4: 4 });
    await e.svc.guardarConfig({ entrada: { pisos: [{ piso: 1, puntaje: 10 }, { piso: 2, puntaje: 20 }], extras: { taller: 5 } }, usuarioId: "u9" });
    assert.deepEqual(await e.svc.puntajes(), { puntajesPiso: { 1: 10, 2: 20 }, extras: { taller: 5, muestra: 0, foto: 0 } });
    const code = await e.svc.crearOrden({ lineas: una });
    await e.svc.marcar({ code, lineaId: "L1", cambio: { estado: "encontrado", piso: 2, taller: true }, usuarioId: "u2" });
    assert.equal(e.filas[0].puntaje, 25);
    await falla(e.svc.marcar({ code, lineaId: "L1", cambio: { piso: 4 }, usuarioId: "u2" }), "PISO_INVALIDO");
    assert.equal(e.eventos.filter((x) => x.tipo === "config.guardada").length, 1);
    await falla(e.svc.guardarConfig({ entrada: { pisos: [] }, usuarioId: "u9" }), "CONFIG_INVALIDA");
  });

  it("cambiar la tabla no reescribe el puntaje ya medido", async () => {
    const e = entorno();
    const code = await e.svc.crearOrden({ lineas: una });
    await e.svc.marcar({ code, lineaId: "L1", cambio: { estado: "encontrado", piso: 3 }, usuarioId: "u2" });
    await e.svc.guardarConfig({ entrada: { pisos: [{ piso: 3, puntaje: 99 }] }, usuarioId: "u9" });
    assert.equal(e.filas[0].puntaje, 3);
  });

  it("el emisor se copia al documento y editar la configuración no lo altera", async () => {
    const e = entorno();
    const cfg = await e.svc.guardarConfig({ entrada: { emisores: [{ nombre: "Repuestos Norte", ruc: "20123456789" }] }, usuarioId: "u9" });
    const id = cfg.emisores[0].id;
    await falla(e.svc.crearOrden({ lineas: una, emisorId: "E7" }), "EMISOR_INVALIDO");
    const code = await e.svc.crearOrden({ lineas: una, emisorId: id });
    assert.equal(e.docs.get(code).payload.doc.emisor.nombre, "Repuestos Norte");
    await e.svc.guardarConfig({ entrada: { emisores: [{ id, nombre: "Otro nombre" }] }, usuarioId: "u9" });
    assert.equal((await e.svc.obtener({ code })).emisor.nombre, "Repuestos Norte");
    // editar sin emisorId lo conserva; con "" lo quita; con id lo renueva
    const v = (await e.svc.obtener({ code })).version;
    const l = (await e.svc.obtener({ code })).lineas;
    await e.svc.editar({ code, lineas: l, esperaVersion: v, usuarioId: "u1" });
    assert.equal(e.docs.get(code).version, v);
    await e.svc.editar({ code, lineas: l, emisorId: id, esperaVersion: v, usuarioId: "u1" });
    assert.equal(e.docs.get(code).payload.doc.emisor.nombre, "Otro nombre");
    await e.svc.editar({ code, lineas: l, emisorId: "", esperaVersion: v + 1, usuarioId: "u1" });
    assert.equal(e.docs.get(code).payload.doc.emisor, null);
    assert.equal((await e.svc.listar({ estados: ["orden_salida"] }))[0].emisor, null);
  });

  it("borrador sin líneas, cotización y envío al almacén", async () => {
    const e = entorno();
    const b = await e.svc.crearOrdenCompleta({ cabecera: { cliente: "Pedalco" }, lineas: [], destino: "borrador" });
    assert.equal(b.estado, "borrador");
    assert.equal(e.docs.get(b.code).estado, "borrador");
    assert.equal((await e.svc.activas()).length, 0); // el almacén no lo ve
    await falla(e.svc.cambiarEstado({ code: b.code, a: "orden_salida", permisos: [] }), "LINEAS_REQUERIDAS");
    await falla(e.svc.cambiarEstado({ code: b.code, a: "cerrada", permisos: [] }), "DESTINO_INVALIDO");
    // el borrador se completa editándolo
    const v = (await e.svc.obtener({ code: b.code })).version;
    await e.svc.editar({ code: b.code, cabecera: { cliente: "Pedalco" }, lineas: una, esperaVersion: v, usuarioId: "u1" });
    assert.equal((await e.svc.cambiarEstado({ code: b.code, a: "cotizacion", permisos: [] })).estado, "cotizacion");
    assert.equal((await e.svc.obtener({ code: b.code })).editable, true);
    assert.equal((await e.svc.cambiarEstado({ code: b.code, a: "orden_salida", permisos: [] })).estado, "orden_salida");
    assert.equal((await e.svc.activas()).length, 1);
    await falla(e.svc.crearOrden({ lineas: [], destino: "orden_salida" }), "LINEAS_REQUERIDAS");
    await falla(e.svc.crearOrden({ lineas: una, destino: "cerrada" }), "DESTINO_INVALIDO");
    // un borrador editado no puede quedar sin líneas una vez que sale de borrador
    const c = await e.svc.crearOrdenCompleta({ lineas: una, destino: "cotizacion" });
    assert.equal(c.estado, "cotizacion");
    await falla(e.svc.editar({ code: c.code, lineas: [], esperaVersion: 1, usuarioId: "u1" }), "LINEAS_REQUERIDAS");
  });

  it("cerrar sin vender lleva motivo y ya no se puede mover", async () => {
    const e = entorno();
    const { code } = await e.svc.crearOrdenCompleta({ lineas: una, destino: "cotizacion" });
    const r = await e.svc.cambiarEstado({ code, a: "rechazada", motivo: { codigo: "precio", detalle: "muy caro" }, permisos: [] });
    assert.equal(r.estado, "rechazada");
    assert.deepEqual(e.docs.get(code).motivo, { codigo: "precio", detalle: "muy caro" });
    await falla(e.svc.cambiarEstado({ code, a: "orden_salida", permisos: [] }), "ESTADO_NO_EDITABLE");
  });
});

describe("reporte de picking", () => {
  it("suma puntajes y tiempos de lo resuelto en el rango, con el nombre de la persona", async () => {
    const e = entorno();
    const code = await e.svc.crearOrden({ lineas: [{ cantidad: 1, descripcion: "A" }, { cantidad: 1, descripcion: "B" }, { cantidad: 1, descripcion: "C" }] });
    await e.svc.marcar({ code, lineaId: "L1", cambio: { estado: "encontrado", piso: 3 }, usuarioId: "u2" });
    await e.svc.marcar({ code, lineaId: "L2", cambio: { estado: "no_encontrado" }, usuarioId: "u2" });
    await e.svc.marcar({ code, lineaId: "L3", cambio: { estado: "buscando" }, usuarioId: "u2" }); // sin resolver: no cuenta
    const hoy = new Date().toISOString().slice(0, 10);
    const r = await e.svc.reportePicking({ desde: hoy, hasta: hoy, zona: "UTC" });
    assert.equal(r.totales.lineas, 2);
    assert.equal(r.totales.puntaje, 3);
    assert.deepEqual(r.porPersona.map((x) => [x.nombre, x.lineas, x.puntaje]), [["Rosa", 2, 3]]);
    assert.deepEqual(r.porPiso, [{ piso: 3, lineas: 1, puntaje: 3 }]);
    const ayer = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    assert.equal((await e.svc.reportePicking({ desde: ayer, hasta: ayer, zona: "UTC" })).totales.lineas, 0);
    await falla(e.svc.reportePicking({ desde: "2026-13-40" }), "RANGO_INVALIDO");
    await falla(e.svc.reportePicking({ desde: "2026-11-10", hasta: "2026-11-01" }), "RANGO_INVALIDO");
    await falla(e.svc.reportePicking({ desde: "2026-01-01", hasta: "2026-11-01" }), "RANGO_INVALIDO");
  });
});
