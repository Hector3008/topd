import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { crearPlantilla } from "../src/plantilla.js";
import { leerArchivo } from "../src/archivo.js";
import { limpiarCabecera } from "../src/picking-servicio.js";

// La lectura trae todos los campos de la cabecera; los que no vienen quedan en null
const conDatos = (cab) => Object.fromEntries(Object.entries(cab).filter(([, v]) => v != null));
async function abrir(buf) { const l = new ExcelJS.Workbook(); await l.xlsx.load(buf); return l; }
// Escribe un valor en la celda de valor que está junto a la etiqueta dada (columnas de etiquetas: A y C, hoja «Proforma»)
function junto(hoja, etiqueta, valor) {
  let hecho = false;
  hoja.eachRow((fila, i) => [1, 3].forEach((col) => {
    if (!hecho && i < 14 && fila.getCell(col).value === etiqueta) { fila.getCell(col + 1).value = valor; hecho = true; }
  }));
  assert.ok(hecho, `no hay etiqueta ${etiqueta}`);
}
// Pone los valores en las columnas 1, 2, 3… de la fila (los null se saltan)
const poner = (hoja, n, valores) => valores.forEach((v, i) => { if (v != null) hoja.getCell(n, i + 1).value = v; });
const filaEncabezado = (hoja) => { let n = 0; hoja.eachRow((f, i) => { if (!n && f.getCell(1).value === "CANTIDAD") n = i; }); return n; };

describe("plantilla de Excel", () => {
  it("trae la hoja Proforma con encabezados que la carga reconoce, listas desplegables y límite de 200 líneas", async () => {
    const libro = await abrir(await crearPlantilla());
    assert.deepEqual(libro.worksheets.map((h) => h.name), ["Proforma", "Ejemplo", "Instrucciones"]);
    const hoja = libro.getWorksheet("Proforma");
    const n = filaEncabezado(hoja);
    assert.ok(n > 0);
    assert.deepEqual(hoja.getRow(n).values.slice(1, 9).map(String), ["CANTIDAD", "MODELO", "NOMBRE COMERCIAL", "COD MAX", "PROVEEDOR", "FAMILIA", "PRECIO UNITARIO", "COMENTARIO PARA EL ALMACÉN"]);
    assert.equal(hoja.getCell(n + 1, 1).dataValidation.type, "whole");
    assert.equal(hoja.getCell(n + 200, 1).dataValidation.type, "whole");
    const listas = Object.values(hoja.dataValidations.model).filter((v) => v.type === "list");
    assert.equal(listas.length, 4); // entrega, canal de venta, forma de pago, comprobante
  });

  it("sin llenar se carga sin líneas y avisa; no lee la hoja de ejemplo", async () => {
    const r = await leerArchivo(await crearPlantilla());
    assert.equal(r.lineas.length, 0);
    assert.ok(r.avisos.some((a) => a.codigo === "SIN_LINEAS"));
    assert.deepEqual(conDatos(r.cabecera), {});
  });

  it("llenada a mano: cabecera, listas con el texto que se ve, fecha y líneas con comentario", async () => {
    const libro = await abrir(await crearPlantilla());
    const hoja = libro.getWorksheet("Proforma");
    junto(hoja, "Cliente", "Pedalco SRL");
    junto(hoja, "RUC / DNI", "20123456789");
    junto(hoja, "Entrega", "Agencia");
    junto(hoja, "Agencia", "Shalom");
    junto(hoja, "Forma de pago", "Caja / efectivo");
    junto(hoja, "Comprobante", "Factura");
    junto(hoja, "Fecha", new Date(Date.UTC(2026, 10, 17)));
    junto(hoja, "N.º de la proforma de papel (opcional)", "A-0042");
    const n = filaEncabezado(hoja);
    poner(hoja, n + 1, [2, "SR45250", "Relay Volvo FM 150A", "MX1-03-00-SUNR-2006", "TORQ X-JPN", "RELAY", 35.5, "El original"]);
    poner(hoja, n + 2, [1, null, "Alternador Hyundai H1"]);
    const r = await leerArchivo(Buffer.from(await libro.xlsx.writeBuffer()));
    assert.deepEqual(conDatos(r.cabecera), { cliente: "Pedalco SRL", ruc: "20123456789", entrega: "agencia", agencia: "Shalom", formaPago: "efectivo", comprobante: "factura", fecha: "2026-11-17", referencia: "A-0042" });
    assert.doesNotThrow(() => limpiarCabecera(r.cabecera)); // lo que sale de la plantilla lo acepta el servidor
    assert.equal(r.lineas.length, 2);
    assert.deepEqual(r.lineas[0], { cantidad: 2, descripcion: "Relay Volvo FM 150A", precioUnitario: 35.5, importe: null, anulada: false, dudoso: false,
      modelo: "SR45250", codMax: "MX1-03-00-SUNR-2006", proveedor: "TORQ X-JPN", familia: "RELAY", comentario: "El original" });
    assert.equal(r.lineas[1].descripcion, "Alternador Hyundai H1");
    assert.equal(r.lineas[1].precioUnitario, null);
    assert.deepEqual(r.avisos, []);
  });

  it("una opción que no está en la lista no se carga y se avisa; una etiqueta vacía no toma la siguiente como valor", async () => {
    const libro = await abrir(await crearPlantilla());
    const hoja = libro.getWorksheet("Proforma");
    junto(hoja, "Entrega", "Por dron");
    junto(hoja, "Ciudad", "Tacna"); // «Fecha» queda vacía, y «Ciudad» no debe tomar «Fecha» como valor ni al revés
    const n = filaEncabezado(hoja);
    poner(hoja, n + 1, [1, null, "Relay"]);
    const r = await leerArchivo(Buffer.from(await libro.xlsx.writeBuffer()));
    assert.ok(r.cabecera.entrega == null);
    assert.equal(r.cabecera.ciudad, "Tacna");
    assert.equal(r.cabecera.fecha, null);
    assert.ok(r.avisos.some((a) => a.codigo === "CABECERA_VALOR" && /Por dron/.test(a.mensaje)));
  });

  it("una línea tachada en la plantilla queda como tachada", async () => {
    const libro = await abrir(await crearPlantilla());
    const hoja = libro.getWorksheet("Proforma");
    const n = filaEncabezado(hoja);
    poner(hoja, n + 1, [1, null, "Relay"]);
    poner(hoja, n + 2, [1, null, "Claxon"]);
    const c = hoja.getCell(n + 2, 3);
    c.style = { ...c.style, font: { strike: true } }; // un estilo nuevo: exceljs comparte el objeto entre celdas iguales
    const r = await leerArchivo(Buffer.from(await libro.xlsx.writeBuffer()));
    assert.deepEqual(r.lineas.map((l) => l.anulada), [false, true]);
  });
});
