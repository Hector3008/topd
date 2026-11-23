// Carga de una proforma desde un archivo (Excel o PDF con texto). Es gratis y exacta: no hay OCR de por medio.
// Devuelve el mismo contrato que la lectura de fotos ({ cabecera, lineas, total, suma, avisos }) para que el front
// use la misma pantalla de revisión. No crea nada.
//
// Reconoce la tabla por los nombres de las columnas (en cualquier orden y con o sin acentos):
//   cantidad  CANTIDAD SOLICITADA · CANTIDAD · CANT · PEDIDO
//   nombre    NOMBRE COMERCIAL · NOMBRE · DESCRIPCION · PRODUCTO          (obligatorias: cantidad y nombre)
//   modelo    MODELO · ALIAS · CODIGO
//   cod max   COD MAX · COD. MAX
//   proveedor · familia · fecha de envío · precio unitario · importe (opcionales)
import { normalizarLectura } from "./ocr.js";

export const MAX_BYTES_ARCHIVO = 8 * 1024 * 1024;
const MAX_FILAS = 3000;

export class ErrorArchivo extends Error {
  constructor(codigo, mensaje, detalle) {
    super(mensaje);
    this.name = "ErrorArchivo";
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

const norm = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

const ALIAS = {
  cantidad: ["CANTIDAD SOLICITADA", "CANTIDAD", "CANT", "PEDIDO", "UNIDADES SOLICITADAS"],
  descripcion: ["NOMBRE COMERCIAL", "NOMBRE", "DESCRIPCION", "PRODUCTO"],
  modelo: ["MODELO", "CODIGO"],
  alias: ["ALIAS"],
  codMax: ["COD MAX", "CODIGO MAX", "CODMAX"],
  proveedor: ["PROVEEDOR"],
  familia: ["FAMILIA"],
  fecha: ["FECHA DE ENVIO", "FECHA ENVIO", "FECHA"],
  precio: ["PRECIO UNITARIO", "PRECIO UNIT", "P UNIT", "PRECIO"],
  importe: ["IMPORTE", "SUBTOTAL"],
  comentario: ["COMENTARIO", "COMENTARIO PARA EL ALMACEN", "OBSERVACION", "OBSERVACIONES", "NOTA"],
};
const columnaDe = (texto) => {
  const n = norm(texto);
  if (!n) return null;
  for (const [campo, nombres] of Object.entries(ALIAS)) if (nombres.includes(n)) return campo;
  return null;
};

const numero = (t) => {
  const s = String(t ?? "").replace(/S\/\.?|\$|\s/gi, "");
  if (!s) return null;
  const limpio = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
};
const cantidadEntera = (t) => {
  const m = /^\s*(\d{1,6})(?:[.,]0+)?\s*$/.exec(String(t ?? ""));
  return m ? Number(m[1]) : null;
};
const pad = (n) => String(n).padStart(2, "0");
/** "17/11/26", "17-11-2026" o "2026-11-17" → "2026-11-17" (día/mes/año como se escribe en Perú). */
function fechaIso(t) {
  const s = String(t ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const d = Number(m[1]), mes = Number(m[2]);
  const a = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return null;
  return `${a}-${pad(mes)}-${pad(d)}`;
}

// Datos de la cabecera que se reconocen sobre la tabla, como «Etiqueta: valor» o una celda de etiqueta seguida de su valor.
const ETIQUETAS = {
  cliente: ["CLIENTE", "SENOR", "SENORES", "SENOR ES", "TIENDA", "PARA"],
  ruc: ["RUC", "DNI", "RUC DNI", "RUC O DNI"],
  telefono: ["TELEFONO", "CELULAR", "TELF"],
  email: ["EMAIL", "E MAIL", "CORREO"],
  direccion: ["DIRECCION"], provincia: ["PROVINCIA"], ciudad: ["CIUDAD"],
  entrega: ["ENTREGA"], destino: ["DESTINO"], agencia: ["AGENCIA"], atencion: ["ATENCION"],
  canalVenta: ["CANAL DE VENTA", "CANAL"], formaPago: ["FORMA DE PAGO"], comprobante: ["COMPROBANTE"],
  fecha: ["FECHA"], vendedor: ["VENDEDOR"], despachador: ["DESPACHADOR"],
  referencia: ["REFERENCIA", "N DE PROFORMA", "NRO DE PROFORMA", "N DE PROFORMA DE PAPEL", "N DE LA PROFORMA DE PAPEL", "N DE LA PROFORMA DE PAPEL OPCIONAL", "N DE PEDIDO", "PROFORMA", "PEDIDO"],
};
// Listas cerradas: se aceptan la clave y el texto que se ve en pantalla
export const OPCIONES_CABECERA = {
  entrega: [["tienda", "Tienda"], ["agencia", "Agencia"], ["local", "Local"]],
  canalVenta: [["tienda", "Tienda"], ["online", "Online"], ["cartera", "Cartera"]],
  comprobante: [["factura", "Factura"], ["boleta", "Boleta"], ["proforma", "Proforma"]],
  formaPago: [["efectivo", "Caja / efectivo"], ["deposito", "Depósito"], ["transferencia", "Transferencia"], ["transferencia_y_caja", "Transferencia y caja"], ["tarjeta", "Tarjeta"], ["credito", "Crédito"]],
};
const campoDeEtiqueta = (texto) => {
  const n = norm(texto);
  if (!n) return null;
  for (const [campo, nombres] of Object.entries(ETIQUETAS)) if (nombres.includes(n)) return campo;
  return null;
};

function cabeceraDeTextos(textos) {
  const cab = {};
  const avisos = [];
  const poner = (campo, valor) => {
    let v = String(valor ?? "").trim();
    if (!v || cab[campo] !== undefined) return;
    if (OPCIONES_CABECERA[campo]) {
      const hallada = OPCIONES_CABECERA[campo].find(([k, nombre]) => norm(k) === norm(v) || norm(nombre) === norm(v));
      if (!hallada) { avisos.push({ codigo: "CABECERA_VALOR", mensaje: `«${v}» no es una opción válida para «${campo}»; elige una de la lista (${OPCIONES_CABECERA[campo].map(([, n]) => n).join(", ")}).` }); return; }
      v = hallada[0];
    } else if (campo === "fecha") {
      const f = fechaIso(v);
      if (!f) { avisos.push({ codigo: "CABECERA_VALOR", mensaje: `No entendí la fecha «${v}»; escríbela como día/mes/año.` }); return; }
      v = f;
    } else if (campo === "ruc") v = v.replace(/\D/g, "") || v;
    cab[campo] = v;
  };
  for (let i = 0; i < textos.length; i++) {
    const t = String(textos[i] ?? "").trim();
    if (!t) continue;
    // «Etiqueta: valor» en una sola celda
    const m = /^([^:]{2,40}?)\s*:\s*(.+)$/.exec(t);
    if (m && campoDeEtiqueta(m[1])) { poner(campoDeEtiqueta(m[1]), m[2]); continue; }
    // una celda de etiqueta y la siguiente con el valor (si la siguiente es otra etiqueta o está vacía, no hay valor)
    const solo = campoDeEtiqueta(t.replace(/\s*:\s*$/, ""));
    if (solo) {
      const sig = String(textos[i + 1] ?? "").trim();
      // el valor de una lista puede llamarse igual que otra etiqueta (Entrega → «Agencia»): se acepta si es una opción válida
      const esOpcion = OPCIONES_CABECERA[solo]?.some(([k, nombre]) => norm(k) === norm(sig) || norm(nombre) === norm(sig));
      if (sig && (esOpcion || !campoDeEtiqueta(sig.replace(/\s*:\s*$/, "")))) { poner(solo, sig); i++; }
      continue;
    }
    let r = /^(?:ruc|dni)\s*[:\-]?\s*(\d{8,11})\b/i.exec(t);
    if (r) { poner("ruc", r[1]); continue; }
    r = /^(?:n[°ºo.]*\s*(?:de\s*)?(?:proforma|pedido|documento))\s*[:\-#]?\s*([A-Z0-9][A-Z0-9-]{2,})$/i.exec(t);
    if (r) { poner("referencia", r[1]); continue; }
    if (/^(tda|tienda)\.?\s+\S+/i.test(t)) poner("cliente", t);
  }
  return { cab, avisos };
}

/**
 * Pasa las filas de una tabla (cada fila: arreglo de { t: texto, tachada?: boolean }) a la lectura.
 * `antes` son los textos que había sobre la tabla (para cliente, RUC, etc.).
 */
export function lecturaDeFilas(filas, antes = [], { origen = "archivo" } = {}) {
  const iCab = filas.findIndex((f) => {
    const campos = f.map((c) => columnaDe(c.t));
    return campos.includes("cantidad") && campos.includes("descripcion") && campos.filter(Boolean).length >= 3;
  });
  if (iCab < 0)
    throw new ErrorArchivo("SIN_TABLA", "No encontré la tabla. Debe tener al menos las columnas «Cantidad» y «Nombre» (o «Descripción»).");
  const cols = filas[iCab].map((c) => columnaDe(c.t));
  const dondeEsta = (campo) => cols.indexOf(campo);
  const iCant = dondeEsta("cantidad"), iDesc = dondeEsta("descripcion");
  const iModelo = dondeEsta("modelo") >= 0 ? dondeEsta("modelo") : dondeEsta("alias");

  const lineas = [];
  const fechas = new Map();
  const previas = [...antes];
  for (let i = 0; i < iCab; i++) previas.push(...filas[i].map((c) => c.t));
  for (const fila of filas.slice(iCab + 1)) {
    const t = (i) => (i >= 0 ? String(fila[i]?.t ?? "").trim() : "");
    const cantTxt = t(iCant), desc = t(iDesc);
    if (fila.every((c) => !String(c.t ?? "").trim())) continue;
    if (/^TOTAL\b/.test(norm(fila.find((c) => String(c.t ?? "").trim())?.t))) continue;
    if (columnaDe(cantTxt) === "cantidad") continue; // encabezado repetido (PDF de varias páginas)
    const cantidad = cantidadEntera(cantTxt);
    const extra = { modelo: t(iModelo), codMax: t(dondeEsta("codMax")), proveedor: t(dondeEsta("proveedor")), familia: t(dondeEsta("familia")), comentario: t(dondeEsta("comentario")) };
    if (!cantTxt && desc && !extra.codMax && !extra.modelo && lineas.length) { lineas[lineas.length - 1].descripcion += ` ${desc}`; continue; }
    if (!cantTxt && !desc) continue;
    const f = fechaIso(t(dondeEsta("fecha")));
    if (f) fechas.set(f, (fechas.get(f) ?? 0) + 1);
    lineas.push({
      cantidad: cantidad ?? (cantTxt ? cantTxt : null),
      descripcion: desc || extra.modelo,
      precio_unitario: dondeEsta("precio") >= 0 ? numero(t(dondeEsta("precio"))) : null,
      importe: dondeEsta("importe") >= 0 ? numero(t(dondeEsta("importe"))) : null,
      anulada: Boolean(fila[iCant]?.tachada || fila[iDesc]?.tachada),
      ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)),
    });
  }
  const fecha = [...fechas.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const { cab, avisos: avisosCab } = cabeceraDeTextos(previas);
  const lectura = normalizarLectura({ cabecera: { ...cab, ...(fecha && { fecha }) }, lineas, total: null, dudosos: [] });
  lectura.origen = origen;
  lectura.avisos.push(...avisosCab);
  if (fechas.size > 1) lectura.avisos.push({ codigo: "FECHAS_DISTINTAS", mensaje: `El archivo trae ${fechas.size} fechas de envío distintas; se usó la más frecuente (${fecha}).` });
  return lectura;
}

// ---------------------------------------------------------------- Excel
function textoCelda(v) {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("").trim();
    if ("result" in v) return textoCelda(v.result);
    if (typeof v.text === "string") return v.text.trim();
    if (v.error) return "";
    return "";
  }
  return String(v).trim();
}
const celdaTachada = (c) => Boolean(c.font?.strike) || (Array.isArray(c.value?.richText) && c.value.richText.some((r) => r.font?.strike));

export async function leerExcel(buffer) {
  const { default: ExcelJS } = await import("exceljs");
  const libro = new ExcelJS.Workbook();
  try { await libro.xlsx.load(buffer); } catch { throw new ErrorArchivo("ARCHIVO_INVALIDO", "No pude abrir el Excel. Guárdalo como .xlsx e inténtalo de nuevo."); }
  let ultimo = null;
  for (const hoja of libro.worksheets) {
    if (hoja.state && hoja.state !== "visible") continue;
    if (/^(EJEMPLO|INSTRUCCIONES)$/.test(norm(hoja.name))) continue; // hojas de apoyo de la plantilla
    const filas = [];
    const columnas = Math.min(hoja.columnCount || 0, 40);
    hoja.eachRow({ includeEmpty: false }, (fila) => {
      if (filas.length >= MAX_FILAS) return;
      const celdas = [];
      for (let c = 1; c <= columnas; c++) { const cel = fila.getCell(c); const esCopia = cel.isMerged && cel.master && cel.master.address !== cel.address; celdas.push(esCopia ? { t: "" } : { t: textoCelda(cel.value), tachada: celdaTachada(cel) }); }
      filas.push(celdas);
    });
    try { return lecturaDeFilas(filas, [], { origen: "archivo:xlsx" }); } catch (e) { if (!(e instanceof ErrorArchivo)) throw e; ultimo = e; }
  }
  throw ultimo ?? new ErrorArchivo("SIN_TABLA", "El Excel no tiene hojas con datos.");
}

// ---------------------------------------------------------------- PDF
const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

/** Agrupa los textos de una página en filas de celdas { s, x0, x1, y } (de arriba abajo). */
function filasDePagina(items) {
  const h = mediana(items.map((i) => i.h).filter((x) => x > 0)) || 8;
  const orden = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const filas = [];
  for (const it of orden) {
    const f = filas.find((fila) => Math.abs(fila.y - it.y) <= h * 0.45);
    if (f) { f.items.push(it); f.y = (f.y * (f.items.length - 1) + it.y) / f.items.length; } else filas.push({ y: it.y, items: [it] });
  }
  return filas.sort((a, b) => b.y - a.y).map((f) => {
    const its = f.items.sort((a, b) => a.x - b.x);
    const celdas = [];
    for (const it of its) {
      const ult = celdas[celdas.length - 1];
      if (ult && it.x - ult.x1 < h * 0.8) { ult.s += (it.x - ult.x1 > h * 0.15 ? " " : "") + it.s; ult.x1 = it.x + it.w; }
      else celdas.push({ s: it.s, x0: it.x, x1: it.x + it.w, y: f.y, h: it.h });
    }
    return celdas;
  });
}

export async function leerPdf(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  } catch { throw new ErrorArchivo("ARCHIVO_INVALIDO", "No pude abrir el PDF."); }
  const paginas = [];
  for (let n = 1; n <= Math.min(doc.numPages, 30); n++) {
    const pag = await doc.getPage(n);
    const cont = await pag.getTextContent();
    const items = cont.items
      .filter((i) => typeof i.str === "string" && i.str.trim())
      .map((i) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] - (n - 1) * 100000, w: i.width, h: i.height || Math.abs(i.transform[3]) })); // y global: cada página queda debajo de la anterior
    paginas.push(filasDePagina(items));
  }
  await doc.destroy?.();
  if (!paginas.some((p) => p.length))
    throw new ErrorArchivo("PDF_SIN_TEXTO", "Este PDF es una imagen (no tiene texto). Usa «Leer foto» o pide el archivo en Excel.");

  // Encabezado: los títulos largos se parten en dos líneas («CANTIDAD» / «SOLICITADA»), así que se prueba con una,
  // dos o tres filas seguidas unidas por la posición horizontal de sus celdas.
  const esEncabezado = (cels) => {
    const campos = cels.map((c) => columnaDe(c.s));
    return campos.includes("cantidad") && campos.includes("descripcion") && campos.filter(Boolean).length >= 3;
  };
  const unir = (filas) => {
    const cels = filas.flat().sort((p, q) => q.y - p.y || p.x0 - q.x0);
    const out = [];
    for (const c of cels) {
      const centro = (c.x0 + c.x1) / 2;
      const g = out.find((o) => Math.abs((o.x0 + o.x1) / 2 - centro) < Math.max(o.x1 - o.x0, c.x1 - c.x0) * 0.5);
      if (g) { g.s += ` ${c.s}`; g.x0 = Math.min(g.x0, c.x0); g.x1 = Math.max(g.x1, c.x1); } else out.push({ ...c });
    }
    return out.sort((p, q) => p.x0 - q.x0);
  };
  let cab = null, pagCab = -1, finCab = -1;
  const antes = [];
  for (let n = 0; n < paginas.length && !cab; n++) {
    const filas = paginas[n];
    for (let i = 0; i < filas.length && !cab; i++) {
      // la ventana más grande que siga pareciendo encabezado (filas pegadas y sin una cantidad entera al inicio)
      for (let k = Math.min(3, filas.length - i); k >= 1; k--) {
        const ventana = filas.slice(i, i + k);
        const h = ventana[0][0]?.h || 10;
        const pegadas = ventana.every((f, j) => j === 0 || (ventana[j - 1][0].y - f[0].y <= h * 1.8 && cantidadEntera(f[0]?.s) == null));
        if (!pegadas) continue;
        const cels = unir(ventana);
        if (esEncabezado(cels)) { cab = cels; pagCab = n; finCab = i + k; break; }
      }
      if (!cab) antes.push(...filas[i].map((c) => c.s));
    }
  }
  if (!cab) throw new ErrorArchivo("SIN_TABLA", "No encontré la tabla. Debe tener al menos las columnas «Cantidad» y «Nombre» (o «Descripción»).");
  const xDesc = cab.find((c) => columnaDe(c.s) === "descripcion");
  const esAncla = (f) => cantidadEntera(f[0]?.s) != null && f[0].x0 < xDesc.x0;

  // Filas de datos de todas las páginas.
  const datos = [];
  paginas.forEach((filas, n) => {
    if (n < pagCab) return;
    // En las páginas siguientes se salta el encabezado repetido; lo demás que sobre se descarta por lejano a toda línea
    const resto = (n === pagCab ? filas.slice(finCab) : filas).filter((f) => f.filter((c) => columnaDe(c.s)).length < 2);
    datos.push(...resto);
  });
  // Anclas: filas cuya primera celda es un entero a la izquierda de todo (la cantidad). Las demás (líneas
  // partidas de un nombre largo) se pegan a la ancla más cercana.
  const anclas = datos.filter(esAncla);
  if (!anclas.length) return lecturaDeFilas([cab.map((c) => ({ t: c.s }))], antes, { origen: "archivo:pdf" });
  const paso = mediana(anclas.slice(1).map((a, i) => Math.abs(anclas[i].y - a.y)).filter((d) => d > 0)) || 20;

  // Columnas: se agrupan por donde empiezan las celdas. Se usan todas las filas cercanas a una ancla, porque un nombre
  // o un código partido en dos líneas deja celdas sobre y bajo la fila de la cantidad.
  const cercanas = datos.filter((f) => anclas.some((a) => Math.abs(a[0].y - f[0].y) <= paso * 0.75));
  const inicios = cercanas.flatMap((a) => a.map((c) => c.x0)).sort((a, b) => a - b);
  const hTexto = mediana(cab.map((c) => c.x1 - c.x0)) * 0.12 || 6;
  const grupos = [];
  for (const x of inicios) {
    const g = grupos[grupos.length - 1];
    if (g && x - g.fin <= Math.max(10, hTexto)) { g.fin = x; g.n++; g.suma += x; } else grupos.push({ ini: x, fin: x, n: 1, suma: x });
  }
  const minimo = Math.max(1, Math.floor(anclas.length * 0.25));
  const columnas = grupos.filter((g) => g.n >= minimo).map((g) => g.suma / g.n);
  const avisos = [];
  const N = cab.length;
  if (columnas.length !== N)
    avisos.push({ codigo: "PDF_COLUMNAS", mensaje: `El PDF tiene ${columnas.length} columnas con datos y ${N} encabezados; revisa bien las columnas de cada línea.` });
  const columnaDeX = (x) => { let k = 0; for (let i = 0; i < columnas.length; i++) if (x >= columnas[i] - Math.max(10, hTexto)) k = i; return k; };

  const filasTabla = [cab.map((c) => ({ t: c.s }))];
  const porAncla = anclas.map((a) => ({ a, cels: Array.from({ length: Math.max(N, columnas.length) }, () => []) }));
  for (const fila of datos) {
    let mejor = null, dist = Infinity;
    for (const g of porAncla) { const d = Math.abs(g.a[0].y - fila[0].y); if (d < dist) { dist = d; mejor = g; } }
    if (!mejor || dist > paso * 0.75) continue; // pies de página, sellos, etc.
    for (const c of fila) mejor.cels[Math.min(columnaDeX(c.x0), mejor.cels.length - 1)].push(c);
  }
  for (const g of porAncla)
    filasTabla.push(g.cels.slice(0, N).map((lista) => ({
      // un texto partido en dos líneas se une; si la primera termina en guion («MX2-01-00-LU-» / «875») va pegado
      t: lista.sort((p, q) => q.y - p.y || p.x0 - q.x0).map((c) => c.s).reduce((acc, t) => (acc.endsWith("-") ? acc + t : acc ? `${acc} ${t}` : t), ""),
    })));
  const lectura = lecturaDeFilas(filasTabla, antes, { origen: "archivo:pdf" });
  lectura.avisos.push(...avisos);
  return lectura;
}

/** Detecta el formato por el contenido (no por la extensión) y lee el archivo. */
export async function leerArchivo(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new ErrorArchivo("ARCHIVO_REQUERIDO", "Falta el archivo.");
  if (buffer.length > MAX_BYTES_ARCHIVO) throw new ErrorArchivo("ARCHIVO_GRANDE", "El archivo pesa demasiado (máximo 8 MB).");
  if (buffer.subarray(0, 4).toString("latin1") === "%PDF") return leerPdf(buffer);
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return leerExcel(buffer);
  throw new ErrorArchivo("ARCHIVO_INVALIDO", "El archivo debe ser Excel (.xlsx) o PDF.");
}
