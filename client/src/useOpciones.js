import { useEffect, useRef, useState } from "react";
import { mensajeDeError } from "./api.js";

/**
 * Opciones del catálogo para cada línea (guía de almacén). `lineas`: [{ k, descripcion, codMax }]; `buscar` es la llamada
 * a la API. Espera a que se deje de escribir (500 ms) y solo vuelve a preguntar si cambió el texto de alguna línea.
 * Devuelve { porLinea: { [k]: { opciones, total, por } }, total (productos del catálogo), cargando, error }.
 */
export function useOpciones(lineas, buscar, { activo = true, espera = 500 } = {}) {
  const [estado, setEstado] = useState({ porLinea: {}, total: null, cargando: false, error: "" });
  const util = lineas.filter((l) => (l.descripcion ?? "").trim().length >= 2 || (l.codMax ?? "").trim());
  const clave = JSON.stringify(util.map((l) => [l.k, l.descripcion, l.codMax]));
  const fn = useRef(buscar); fn.current = buscar;

  useEffect(() => {
    if (!activo) return undefined;
    if (!util.length) { setEstado({ porLinea: {}, total: null, cargando: false, error: "" }); return undefined; }
    let vigente = true;
    setEstado((e) => ({ ...e, cargando: true, error: "" }));
    const t = setTimeout(async () => {
      try {
        const r = await fn.current(util.slice(0, 100));
        if (vigente) setEstado({ porLinea: r.lineas ?? {}, total: r.catalogo?.total ?? null, cargando: false, error: "" });
      } catch (e) { if (vigente) setEstado((p) => ({ ...p, cargando: false, error: mensajeDeError(e) })); }
    }, espera);
    return () => { vigente = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, activo]);

  return estado;
}
