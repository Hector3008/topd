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
