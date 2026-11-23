import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ExcelJS from "exceljs";
import { leerArchivo, ErrorArchivo, lecturaDeFilas } from "../src/archivo.js";

const fixture = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const falla = (p, codigo) => assert.rejects(p, (e) => e instanceof ErrorArchivo && e.codigo === codigo);

async function xlsx(armar) {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Hoja1");
  armar(hoja);
  return Buffer.from(await libro.xlsx.writeBuffer());
}
const ENCABEZADO = ["CANTIDAD SOLICITADA", "MODELO", "NOMBRE COMERCIAL", "COD MAX", "PROVEEDOR", "FAMILIA", "FECHA DE ENVÍO"];

describe("carga desde Excel", () => {
  it("lee la tabla de reposición con sus columnas de catálogo, la tienda y la fecha", async () => {
    const buf = await xlsx((h) => {
      h.addRow(["Tda Cajamarca"]);
      h.addRow([]);
      h.addRow(ENCABEZADO);
      h.addRow([1, "LL-AMI61-001", "MITSUBISHI 4D34 24V", "MX2-01-00-LU-875", "LU", "ARMADURA", "17/11/26"]);
      h.addRow([5, "1.143/4", "MITSUBISHI 4D34 24V 13T", "MX2-07-00-UNI-217", "UNIFAP", "PORTA CARBON", new Date(Date.UTC(2026, 10, 17))]);
      h.addRow(["", "", "", "", "", "", ""]);
    });
    const r = await leerArchivo(buf);
    assert.equal(r.origen, "archivo:xlsx");
    assert.equal(r.cabecera.cliente, "Tda Cajamarca");
    assert.equal(r.cabecera.fecha, "2026-11-17");
    assert.equal(r.lineas.length, 2);
    assert.deepEqual(r.lineas[0], { cantidad: 1, descripcion: "MITSUBISHI 4D34 24V", precioUnitario: null, importe: null, anulada: false, dudoso: false,
      modelo: "LL-AMI61-001", codMax: "MX2-01-00-LU-875", proveedor: "LU", familia: "ARMADURA" });
    assert.equal(r.lineas[1].cantidad, 5);
    assert.deepEqual(r.avisos, []);
  });

  it("las columnas pueden venir en otro orden y con otros nombres (formato de tienda: PEDIDO / NOMBRE / ALIAS)", async () => {
    const buf = await xlsx((h) => {
      h.addRow(["PEDIDO", "NOMBRE", "ALIAS", "COD. MAX", "ELEMENTO", "SUBFAMILIA", "FAMILIA", "PROVEEDOR", "STOCK EN PACASMAYO", "UNIDADES EN STOCK"]);
      h.addRow([2, "MITSUBISHI CANTER", "HX073-4", "MX1-02-00-HXN-20", "-", "-", "ALTERNADOR", "CCHX", "CON STOCK", 1]);
    });
    const [l] = (await leerArchivo(buf)).lineas;
    assert.equal(l.cantidad, 2);
    assert.equal(l.descripcion, "MITSUBISHI CANTER");
    assert.equal(l.modelo, "HX073-4");
    assert.equal(l.codMax, "MX1-02-00-HXN-20");
    assert.equal(l.familia, "ALTERNADOR");
    assert.equal(l.proveedor, "CCHX");
  });

  it("una fila tachada en el Excel queda como línea tachada", async () => {
    const buf = await xlsx((h) => {
      h.addRow(["Cantidad", "Nombre"].concat(["Cod Max"]));
      h.addRow([1, "Alternador", "MX1-1"]);
      const f = h.addRow([2, "Anulado el pedido", "MX1-2"]);
      f.getCell(2).font = { strike: true };
    });
    const r = await leerArchivo(buf);
    assert.deepEqual(r.lineas.map((l) => l.anulada), [false, true]);
    assert.ok(r.avisos.some((a) => a.codigo === "HAY_TACHADAS"));
  });

  it("precio e importe, si están, se leen y se compara la suma", async () => {
    const buf = await xlsx((h) => {
      h.addRow(["Cant", "Descripción", "P. Unit", "Importe"]);
      h.addRow([2, "Relay", "S/ 10.50", "S/ 21.00"]);
      h.addRow([1, "Bendix", "1,200.00", "1,200.00"]);
      h.addRow(["TOTAL", "", "", 1221]);
    });
    const r = await leerArchivo(buf);
    assert.equal(r.lineas.length, 2);
    assert.equal(r.lineas[0].precioUnitario, 10.5);
    assert.equal(r.lineas[1].importe, 1200);
    assert.equal(r.suma, 1221);
  });

  it("una cantidad que no es un entero se deja marcada como dudosa", async () => {
    const buf = await xlsx((h) => { h.addRow(["Cantidad", "Nombre", "Modelo"]); h.addRow(["dos", "Relay", "R1"]); h.addRow([1.5, "Claxon", "C1"]); });
    const r = await leerArchivo(buf);
    assert.equal(r.lineas.length, 2);
    assert.ok(r.lineas.every((l) => l.dudoso));
    assert.equal(r.avisos.filter((a) => a.codigo === "CANTIDAD_DUDOSA").length, 2);
  });

  it("sin tabla reconocible o con archivos que no son Excel ni PDF avisa con claridad", async () => {
    await falla(leerArchivo(await xlsx((h) => { h.addRow(["hola", "mundo"]); })), "SIN_TABLA");
    await falla(leerArchivo(Buffer.from("esto no es un archivo")), "ARCHIVO_INVALIDO");
    await falla(leerArchivo(Buffer.alloc(0)), "ARCHIVO_REQUERIDO");
    await falla(leerArchivo(Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(50)])), "ARCHIVO_INVALIDO");
    await falla(leerArchivo(Buffer.alloc(9 * 1024 * 1024, 1)), "ARCHIVO_GRANDE");
  });
});

describe("carga desde PDF", () => {
  it("lee la tabla de un PDF con texto: columnas, nombres partidos en dos líneas, tienda y fecha", async () => {
    const r = await leerArchivo(fixture("reposicion.pdf"));
    assert.equal(r.origen, "archivo:pdf");
    assert.equal(r.cabecera.cliente, "Tda Cajamarca");
    assert.equal(r.cabecera.fecha, "2026-11-17");
    assert.equal(r.lineas.length, 7);
    assert.deepEqual(r.avisos, []);
    assert.deepEqual(r.lineas[0], { cantidad: 1, descripcion: "MITSUBISHI 4D34 24V 13T(IM3095)", precioUnitario: null, importe: null, anulada: false, dudoso: false,
      modelo: "LL-AMI61-001", codMax: "MX2-01-00-LU-875", proveedor: "LU", familia: "ARMADURA" });
    const larga = r.lineas[4];
    assert.equal(larga.descripcion, "SOLENOIDE ZM-5491 HYUNDAI H1, STAREX, PORTER/KIA BONGO K2500, SORENTO CON EMBOLO LARGO");
    assert.equal(larga.codMax, "MX2-08-00-ZM-724");
    // una fila con la celda de código vacía no corre las demás columnas
    assert.deepEqual([r.lineas[6].cantidad, r.lineas[6].codMax, r.lineas[6].proveedor, r.lineas[6].familia], [10, undefined, "TORQ X-JPN", "BENDIX"]);
  });

  it("un PDF de varias páginas con el encabezado repetido no pierde ni mezcla líneas", async () => {
    const r = await leerArchivo(fixture("reposicion-2paginas.pdf"));
    assert.equal(r.lineas.length, 45);
    r.lineas.forEach((l, i) => {
      assert.equal(l.descripcion, `REPUESTO NUMERO ${i + 1} PARA PRUEBA`);
      assert.equal(l.codMax, `MX1-00-00-LNS-${i + 1}`);
      assert.equal(l.modelo, `COD-${String(i + 1).padStart(3, "0")}`);
    });
  });

  it("un PDF que es solo una imagen se rechaza y sugiere la foto", async () => {
    await assert.rejects(leerArchivo(fixture("solo-imagen.pdf")), (e) => e.codigo === "PDF_SIN_TEXTO" && /foto/i.test(e.message));
  });
});

describe("filas → lectura", () => {
  it("lo que viene sobre la tabla (cliente, RUC, N.º) completa la cabecera", () => {
    const r = lecturaDeFilas([[{ t: "Cantidad" }, { t: "Nombre" }, { t: "Modelo" }], [{ t: "1" }, { t: "Relay" }, { t: "R1" }]],
      ["Cliente: Pedalco SRL", "RUC 20123456789", "N° de proforma: A-0042"]);
    assert.equal(r.cabecera.cliente, "Pedalco SRL");
    assert.equal(r.cabecera.ruc, "20123456789");
    assert.equal(r.cabecera.referencia, "A-0042");
  });
});
