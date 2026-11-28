import mongoose from "mongoose";
import { tenancyPlugin } from "core";
import { ESTADOS_LINEA, RECONOCIMIENTOS } from "./picking.js";

const { ObjectId } = mongoose.Schema.Types;

// Una fila por proforma + línea. Se actualiza con una sola operación atómica por marca.
export const pickingSchema = new mongoose.Schema(
  {
    code: { type: String, required: true }, // DP-0000001
    lineaId: { type: String, required: true },
    estado: { type: String, enum: ESTADOS_LINEA, default: "pendiente" },
    piso: { type: Number, default: null },
    taller: { type: Boolean, default: false },
    reconocido: { type: String, enum: [...RECONOCIMIENTOS, null], default: null },
    cantidadEncontrada: { type: Number, default: null },
    // Opciones del catálogo que se sacaron (una línea puede salir de varias): { codigo, descripcion, cantidad, piso, puntaje }
    // Fotos de evidencia (URLs de Drive): del almacén y de la revisión
    fotos: { type: [new mongoose.Schema({ url: String, etapa: String, ts: Date, porId: mongoose.Schema.Types.ObjectId }, { _id: false })], default: [] },
    sacados: { type: [new mongoose.Schema({ codigo: String, descripcion: { type: String, default: "" }, cantidad: Number, piso: Number, puntaje: { type: Number, default: 0 }, puntajeBase: { type: Number, default: undefined }, acumula: { type: Boolean, default: undefined }, agregada: { type: String, default: undefined } }, { _id: false })], default: [] },
    nota: { type: String, default: "" },
    puntaje: { type: Number, default: 0 },
    iniciadoTs: { type: Date, default: null },
    resueltoTs: { type: Date, default: null },
    porId: { type: ObjectId, default: null }, // quién hizo la última marca
  },
  { timestamps: true, minimize: false },
);
pickingSchema.plugin(tenancyPlugin);
pickingSchema.index({ empresaId: 1, code: 1, lineaId: 1 }, { unique: true });

// Una fila por proforma cerrada + línea + opción sacada: lo que descuenta el stock y alimenta ventas y anulados
export const relacionalSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    lineaId: { type: String, required: true },
    codigo: { type: String, default: "" }, // código mostrado de la opción (CODIGO_FORMATEADO)
    fecha: { type: String, required: true }, // AAAA-MM-DD, día del cierre en la hora de la empresa
    cantidad: { type: Number, required: true },
    importeUnitario: { type: Number, default: 0 },
    importeTotal: { type: Number, default: 0 },
    descripcion: { type: String, default: "" },
    cliente: { type: String, default: "" },
    vendedor: { type: String, default: "" },
    sinCodigo: { type: Boolean, default: false },
    estado: { type: String, enum: ["vigente", "anulado"], default: "vigente" },
    anuladoTs: { type: Date, default: null },
    anuladoMotivo: { type: String, default: "" },
    anuladoPorId: { type: ObjectId, default: null },
  },
  { timestamps: true, minimize: false },
);
relacionalSchema.plugin(tenancyPlugin);
relacionalSchema.index({ empresaId: 1, code: 1, lineaId: 1, codigo: 1 }, { unique: true });
relacionalSchema.index({ empresaId: 1, fecha: 1, estado: 1 });

// Fotos del despacho: del pedido completo (no de una línea), las toma quien revisa antes de entregarlo. Solo se guarda la URL.
export const despachoSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    fotos: { type: [new mongoose.Schema({ url: { type: String, required: true }, ts: { type: Date, default: Date.now }, porId: { type: ObjectId, default: null } }, { _id: false })], default: [] },
  },
  { timestamps: true },
);
despachoSchema.plugin(tenancyPlugin);
despachoSchema.index({ empresaId: 1, code: 1 }, { unique: true });
