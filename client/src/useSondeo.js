import { useCallback, useEffect, useRef, useState } from "react";
import { mensajeDeError } from "./api.js";

const REFRESCO_MS = 10000;

/** Carga una lista y la refresca cada 10 s mientras la pestaña está visible (como tobt). */
export function useSondeo(cargarFn) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [ahora, setAhora] = useState(Date.now());
  const viva = useRef(true);
  const fn = useRef(cargarFn);
  fn.current = cargarFn;

  const cargar = useCallback(async (silencioso = false) => {
    try {
      const d = await fn.current();
      if (!viva.current) return;
      setDatos(d); setAhora(Date.now());
      if (!silencioso) setError("");
    } catch (e) {
      if (viva.current && !silencioso) setError(mensajeDeError(e));
    }
  }, []);

  useEffect(() => {
    viva.current = true;
    cargar();
    const id = setInterval(() => { if (document.visibilityState === "visible") cargar(true); }, REFRESCO_MS);
    return () => { viva.current = false; clearInterval(id); };
  }, [cargar]);

  return { datos, error, ahora, cargar };
}
