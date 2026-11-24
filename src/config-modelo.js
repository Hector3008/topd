import mongoose from "mongoose";
import { tenancyPlugin } from "core";

// Un documento por empresa (clave "topd"): pisos, puntajes y emisores. Ver config.js.
export const configSchema = new mongoose.Schema(
  {
    clave: { type: String, required: true, default: "topd" },
    datos: { type: mongoose.Schema.Types.Mixed, default: {} },
    porId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, minimize: false },
);
configSchema.plugin(tenancyPlugin);
configSchema.index({ empresaId: 1, clave: 1 }, { unique: true });
