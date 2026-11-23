// Plantilla de Excel para cargar varias líneas de una vez en la estación de creación. Se arma al pedirla para que
// siempre coincida con lo que lee `archivo.js` (columnas, listas cerradas y límite de líneas).
import { OPCIONES_CABECERA } from "./archivo.js";

export const NOMBRE_PLANTILLA = "plantilla-proforma-topd.xlsx";
const MAX_LINEAS = 200; // el mismo límite que valida el servidor al crear

// [etiqueta, campo] en dos columnas de pares (etiqueta | valor)
const CABECERA = [
  [["Cliente", "cliente"], ["RUC / DNI", "ruc"]],
  [["Teléfono", "telefono"], ["E-mail", "email"]],
  [["Dirección", "direccion"], ["Provincia", "provincia"]],
  [["Ciudad", "ciudad"], ["Fecha", "fecha"]],
  [["Entrega", "entrega"], ["Destino", "destino"]],
  [["Agencia", "agencia"], ["Atención", "atencion"]],
  [["Canal de venta", "canalVenta"], ["Forma de pago", "formaPago"]],
  [["Comprobante", "comprobante"], ["Vendedor", "vendedor"]],
  [["Despachador", "despachador"], ["N.º de la proforma de papel (opcional)", "referencia"]],
];
const COLUMNAS = [
  ["CANTIDAD", 16], ["MODELO", 28], ["NOMBRE COMERCIAL", 46], ["COD MAX", 28], ["PROVEEDOR", 16], ["FAMILIA", 18],
  ["PRECIO UNITARIO", 16], ["COMENTARIO PARA EL ALMACÉN", 34],
];

export async function crearPlantilla() {
  const { default: ExcelJS } = await import("exceljs");
  const libro = new ExcelJS.Workbook();
  libro.creator = "topd";
  const hoja = libro.addWorksheet("Proforma");
  COLUMNAS.forEach(([, ancho], i) => { hoja.getColumn(i + 1).width = ancho; });

  hoja.getCell("A1").value = "Proforma topd · llena los datos y las líneas; borra lo que no uses";
  hoja.getCell("A1").font = { bold: true, size: 13 };
  hoja.getCell("A2").value = "Solo son obligatorias la CANTIDAD y el NOMBRE COMERCIAL de cada línea. Los datos de arriba son opcionales.";
  hoja.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };

  const FILA0 = 4;
  const etiqueta = { font: { bold: true }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } } };
  CABECERA.forEach((par, i) => {
    const fila = FILA0 + i;
    // dos pares por fila: etiqueta en A y valor en B; etiqueta en C (a la derecha) y valor en D. Sin celdas combinadas.
    [[par[0], 1, 2], [par[1], 3, 4]].forEach(([[texto, campo], cEt, cVal]) => {
      const et = hoja.getCell(fila, cEt);
      et.value = texto; Object.assign(et, etiqueta);
      if (cEt === 3) et.alignment = { horizontal: "right" };
      const val = hoja.getCell(fila, cVal);
      val.border = { bottom: { style: "thin", color: { argb: "FFBBBBBB" } } };
      if (campo === "fecha") {
        val.numFmt = "dd/mm/yyyy";
        val.dataValidation = { type: "date", operator: "greaterThan", allowBlank: true, formulae: [new Date(Date.UTC(2020, 0, 1))], showErrorMessage: true, errorTitle: "Fecha", error: "Escribe una fecha, por ejemplo 17/11/2026." };
      }
      if (OPCIONES_CABECERA[campo]) {
        val.dataValidation = { type: "list", allowBlank: true, formulae: [`"${OPCIONES_CABECERA[campo].map(([, n]) => n).join(",")}"`], showErrorMessage: true, errorTitle: "Opción", error: "Elige una opción de la lista." };
      }
    });
  });

  const filaEnc = FILA0 + CABECERA.length + 1;
  COLUMNAS.forEach(([titulo], i) => {
    const c = hoja.getCell(filaEnc, i + 1);
    c.value = titulo;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F5FBF" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  hoja.getRow(filaEnc).height = 28;
  for (let n = 1; n <= MAX_LINEAS; n++) {
    const fila = filaEnc + n;
    hoja.getCell(fila, 1).dataValidation = { type: "whole", operator: "greaterThanOrEqual", allowBlank: true, formulae: [1], showErrorMessage: true, errorTitle: "Cantidad", error: "La cantidad es un número entero, 1 o más." };
    hoja.getCell(fila, 1).alignment = { horizontal: "center" };
    hoja.getCell(fila, 7).dataValidation = { type: "decimal", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: "Precio", error: "Escribe el precio unitario como número (sin S/)." };
    hoja.getCell(fila, 7).numFmt = "0.00";
    COLUMNAS.forEach((_, i) => { hoja.getCell(fila, i + 1).border = { bottom: { style: "hair", color: { argb: "FFCCCCCC" } } }; });
  }

  const ej = libro.addWorksheet("Ejemplo");
  ej.columns = COLUMNAS.map(([, ancho]) => ({ width: ancho }));
  ej.addRow(["Esta hoja es solo un ejemplo y no se carga. Llena la hoja «Proforma»."]).font = { italic: true };
  ej.addRow([]);
  ej.addRow(["Cliente", "Tda Cajamarca", "", "Fecha", "17/11/2026"]);
  ej.addRow(["Entrega", "Agencia", "", "Agencia", "Shalom"]);
  ej.addRow([]);
  const enc = ej.addRow(COLUMNAS.map(([t]) => t));
  enc.font = { bold: true, color: { argb: "FFFFFFFF" } };
  enc.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F5FBF" } }; });
  ej.addRow([1, "LL-AMI61-001", "MITSUBISHI 4D34 24V 13T", "MX2-01-00-LU-875", "LU", "ARMADURA", 120.5, "El de 24 V"]);
  ej.addRow([5, "1.143/4", "MITSUBISHI 4D34 24V", "MX2-07-00-UNI-217", "UNIFAP", "PORTA CARBON", "", ""]);

  const ins = libro.addWorksheet("Instrucciones");
  ins.getColumn(1).width = 110;
  [
    "Cómo usar esta plantilla",
    "1. En la hoja «Proforma» llena los datos de arriba (todos opcionales) y una línea por fila desde el encabezado azul hacia abajo.",
    "2. Obligatorio por línea: CANTIDAD (entero) y NOMBRE COMERCIAL. MODELO, COD MAX, PROVEEDOR, FAMILIA, PRECIO UNITARIO y COMENTARIO son opcionales.",
    "3. Entrega, Canal de venta, Forma de pago y Comprobante se eligen de la lista. La fecha va como día/mes/año.",
    "4. Para anular una línea, táchala (formato de fuente tachado) o bórrala. Los pagos recibidos se agregan en la pantalla.",
    "5. Guarda como .xlsx y, en «Nueva proforma», pulsa «Cargar desde Excel o PDF». Lo cargado se muestra para revisarlo antes de crearla.",
    `6. Hasta ${MAX_LINEAS} líneas por proforma. No cambies los títulos del encabezado azul: así reconoce las columnas.`,
  ].forEach((t, i) => { const c = ins.addRow([t]).getCell(1); c.alignment = { wrapText: true }; if (i === 0) c.font = { bold: true, size: 13 }; });

  return Buffer.from(await libro.xlsx.writeBuffer());
}
