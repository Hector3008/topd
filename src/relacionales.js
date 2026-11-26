// «Relacionales» del siscore: al cerrar una proforma, una fila por cada opción del catálogo que salió del almacén
// (fecha, code, cantidad, importe unitario, importe total, descripción). Es lo que alimenta el Excel que descuenta el
// stock, y queda guardado con estado vigente/anulado para sacar después ventas, anulados y otros reportes.
import { ErrorPicking } from "./picking.js";
import { diaDe } from "./reportes.js";

export const ESTADOS_RELACIONAL = ["vigente", "anulado"];
export const COLUMNAS_EXCEL = [
  ["Fecha", 12], ["Code", 26], ["Cantidad", 10], ["Importe unitario", 16], ["Importe total", 14], ["Descripcion", 60],
];
const redondeo = (n) => Math.round(n * 100) / 100;

/**
 * Filas de una proforma cerrada. `lineas` = líneas vigentes del documento (sin tachadas); `filas` = filas de picking.
 * Una línea sacada de varias opciones da una fila por opción; sin opciones (flujo antiguo) da una con el código de la línea.
 * Las líneas no encontradas o sin unidades no generan fila.
 */
export function filasDeCierre({ code, lineas, filas, cabecera = {}, cerradaTs = new Date(), zona }) {
  const fecha = diaDe(cerradaTs, zona);
  const porLinea = new Map(filas.map((f) => [f.lineaId, f]));
  const salida = [];
  for (const l of lineas) {
    const f = porLinea.get(l.id);
    if (!f || f.estado !== "encontrado") continue;
    const precio = Number(l.precioUnitario) >= 0 && l.precioUnitario != null ? Number(l.precioUnitario) : 0;
    const partes = Array.isArray(f.sacados) && f.sacados.length
      ? f.sacados.map((s) => ({ codigo: s.codigo, cantidad: s.cantidad, descripcion: s.descripcion || l.descripcion }))
      : [{ codigo: l.codMax || l.modelo || "", cantidad: f.cantidadEncontrada ?? l.cantidad, descripcion: l.descripcion }];
    for (const p of partes) {
      const cantidad = Number(p.cantidad);
      if (!(cantidad > 0)) continue;
      salida.push({
        code, lineaId: l.id, codigo: String(p.codigo ?? ""), fecha, cantidad,
        importeUnitario: redondeo(precio), importeTotal: redondeo(cantidad * precio),
        descripcion: String(p.descripcion ?? "").slice(0, 300),
        cliente: cabecera.cliente ?? "", vendedor: cabecera.vendedor ?? "",
        sinCodigo: !p.codigo,
      });
    }
  }
  return salida;
}

/** Excel con las seis columnas del siscore, listo para cargarse en la hoja que descuenta. */
export async function crearExcelRelacionales(filas) {
  const { default: ExcelJS } = await import("exceljs");
  const libro = new ExcelJS.Workbook();
  libro.creator = "topd";
  const hoja = libro.addWorksheet("Relacionales");
  hoja.columns = COLUMNAS_EXCEL.map(([header, width]) => ({ header, width }));
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: "frozen", ySplit: 1 }];
  for (const f of filas) {
    const [a, m, d] = f.fecha.split("-").map(Number);
    hoja.addRow([new Date(Date.UTC(a, m - 1, d)), f.codigo, f.cantidad, f.importeUnitario, f.importeTotal, f.descripcion]);
  }
  hoja.getColumn(1).numFmt = "dd/mm/yyyy";
  hoja.getColumn(4).numFmt = "0.00";
  hoja.getColumn(5).numFmt = "0.00";
  return Buffer.from(await libro.xlsx.writeBuffer());
}

export const limpiarMotivo = (m) => {
  const t = typeof m === "string" ? m.trim().slice(0, 200) : "";
  if (t.length < 3) throw new ErrorPicking("MOTIVO_REQUERIDO", "Escribe el motivo de la anulación (mínimo 3 letras)");
  return t;
};
