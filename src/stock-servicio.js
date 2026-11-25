// Sincronización de stock (5.74): lee la hoja, compara con lo que ya está en el catálogo y envía solo lo que cambió.
// Reemplaza al cron del siscore, que borraba todo e insertaba todo cada minuto.
//   - Producto nuevo o cambiado (por huella) → core.catalogo.importar, en lotes de 500.
//   - Producto de la hoja que ya no aparece → se desactiva (nunca se borra). Si reaparece, se reactiva.
//   - Los productos creados a mano (sin ORIGEN «hoja») no se desactivan nunca.
//   - Freno: si la hoja viene vacía, o desaparecería más de 30 % de los productos de la hoja (con un mínimo de 20),
//     no se desactiva nada y se avisa: casi siempre es una hoja a medio editar.
import { ErrorPicking } from "./picking.js";
import { ORIGEN, productosDeHoja } from "./stock.js";

const LOTE = 500;
const PAGINA = 200;
const ACTOR = Object.freeze({ usuarioId: null, permisos: ["catalogo:gestionar"] });
const FRENO_MIN = 20;
const FRENO_PORCENTAJE = 0.3;
const MAX_REPORTADAS = 20;

export function crearServicioStock({ core, empresaId, leerHoja, ahora = () => Date.now(), alCambiar = () => {}, registrar = console }) {
  const configurado = Boolean(empresaId && leerHoja);
  let conocidos = null; // clave (código en minúsculas) → { huella, activo, origen }
  let corriendo = false;
  let ultima = null;
  let temporizador = null;

  async function leerCatalogo() {
    const mapa = new Map();
    for (let saltar = 0; saltar < 100000; saltar += PAGINA) {
      const pag = await core.catalogo.listar({ empresaId, limite: PAGINA, saltar, incluirInactivos: true });
      for (const i of pag) mapa.set(String(i.codigo).toLowerCase(), { huella: i.atributos?.HUELLA ?? null, activo: i.activo !== false, origen: i.atributos?.ORIGEN ?? null });
      if (pag.length < PAGINA) break;
    }
    return mapa;
  }

  const itemDe = async (codigo) => {
    try { return await core.catalogo.obtener({ empresaId, codigo }); }
    catch (e) { if (e?.codigo === "NO_ENCONTRADO") return null; throw e; }
  };

  /** Importa un lote; si el núcleo rechaza filas concretas, las aparta y reintenta con el resto (una mala fila no frena a todas). */
  async function importarLote(lote, rechazadas) {
    let pendientes = lote;
    for (let intento = 0; intento < 3 && pendientes.length; intento++) {
      try {
        const filas = pendientes.map(({ huella: _h, ...p }) => p);
        return await core.catalogo.importar({ empresaId, actor: ACTOR, filas });
      } catch (e) {
        const malas = e?.codigo === "IMPORTACION_INVALIDA" ? e.detalle?.errores ?? e.errores : null;
        if (!malas?.length) throw e;
        const fuera = new Set(malas.map((m) => m.fila - 1));
        for (const m of malas) rechazadas.push({ fila: null, codigo: pendientes[m.fila - 1]?.codigo ?? m.codigo, error: m.error });
        pendientes = pendientes.filter((_, i) => !fuera.has(i));
      }
    }
    return { creados: 0, actualizados: 0, omitidos: [], restantes: pendientes.length };
  }

  async function sincronizar() {
    if (!configurado) throw new ErrorPicking("STOCK_NO_CONFIGURADO", "La sincronización de stock no está configurada (faltan variables de entorno)");
    if (corriendo) return { ...ultima, yaCorria: true };
    corriendo = true;
    const t0 = ahora();
    const r = { ts: t0, ok: false, leidas: 0, creados: 0, actualizados: 0, sinCambios: 0, desactivados: 0, reactivados: 0, descartadas: [], avisos: [], ms: 0, error: null };
    try {
      const { productos, descartadas } = productosDeHoja(await leerHoja());
      r.leidas = productos.length;
      r.descartadas = descartadas;
      if (!productos.length) throw new ErrorPicking("HOJA_VACIA", "La hoja no trae productos: no se cambió nada");

      if (!conocidos) conocidos = await leerCatalogo();
      const enHoja = new Set(productos.map((p) => p.codigo.toLowerCase()));

      // Nuevos o cambiados
      const cambiados = productos.filter((p) => conocidos.get(p.codigo.toLowerCase())?.huella !== p.huella);
      r.sinCambios = productos.length - cambiados.length;
      const rechazadas = [];
      for (let i = 0; i < cambiados.length; i += LOTE) {
        const lote = cambiados.slice(i, i + LOTE);
        const res = await importarLote(lote, rechazadas);
        r.creados += res.creados ?? 0;
        r.actualizados += res.actualizados ?? 0;
        const malos = new Set(rechazadas.map((x) => String(x.codigo).toLowerCase()));
        const omitidos = new Set((res.omitidos ?? []).map((c) => String(c).toLowerCase()));
        for (const p of lote) {
          const k = p.codigo.toLowerCase();
          if (malos.has(k) || omitidos.has(k)) continue;
          const previo = conocidos.get(k);
          conocidos.set(k, { huella: p.huella, activo: previo?.activo ?? true, origen: ORIGEN });
        }
      }
      r.descartadas.push(...rechazadas);

      // Reaparecidos (estaban desactivados por la hoja y vuelven a estar)
      for (const p of productos) {
        const k = p.codigo.toLowerCase();
        const c = conocidos.get(k);
        if (c && c.activo === false && c.origen === ORIGEN) {
          const item = await itemDe(p.codigo);
          if (item?.id && item.activo === false) { await core.catalogo.reactivar({ empresaId, actor: ACTOR, itemId: item.id }); r.reactivados++; }
          conocidos.set(k, { ...c, activo: true });
        }
      }

      // Desaparecidos
      const deLaHoja = [...conocidos].filter(([, c]) => c.origen === ORIGEN && c.activo);
      const faltan = deLaHoja.filter(([k]) => !enHoja.has(k));
      if (faltan.length) {
        if (faltan.length > Math.max(FRENO_MIN, Math.floor(deLaHoja.length * FRENO_PORCENTAJE)))
          r.avisos.push(`Frenado: ${faltan.length} de ${deLaHoja.length} productos de la hoja ya no aparecen; no se desactivó ninguno. Revisa la hoja.`);
        else
          for (const [k, c] of faltan) {
            const item = await itemDe(k);
            if (item?.id && item.activo !== false) { await core.catalogo.desactivar({ empresaId, actor: ACTOR, itemId: item.id }); r.desactivados++; }
            conocidos.set(k, { ...c, activo: false });
          }
      }
      r.ok = true;
      if (r.creados || r.actualizados || r.desactivados || r.reactivados) alCambiar(empresaId);
    } catch (e) {
      r.error = e?.message ?? String(e);
      r.codigo = e?.codigo ?? null;
    } finally {
      r.ms = ahora() - t0;
      r.descartadas = r.descartadas.slice(0, MAX_REPORTADAS);
      ultima = r;
      corriendo = false;
    }
    return r;
  }

  return {
    configurado,
    sincronizar,
    estado: () => ({ configurado, corriendo, cadaMin: temporizador?.cadaMin ?? null, ultima }),
    /** Programa la sincronización: la primera a los 15 s de arrancar y luego cada `cadaMin` minutos. */
    iniciar({ cadaMin = 2 } = {}) {
      if (!configurado || temporizador || !(cadaMin > 0)) return false;
      const correr = () => sincronizar().then((r) => { if (!r.ok && r.error) registrar.error?.(`[topd stock] ${r.error}`); }, (e) => registrar.error?.(`[topd stock] ${e.message}`));
      const primero = setTimeout(correr, 15000);
      const periodico = setInterval(correr, cadaMin * 60000);
      primero.unref?.(); periodico.unref?.();
      temporizador = { cadaMin, detener: () => { clearTimeout(primero); clearInterval(periodico); } };
      return true;
    },
    detener() { temporizador?.detener(); temporizador = null; },
  };
}

/** Configuración desde variables de entorno (las mismas del siscore, con prefijo TOPD_STOCK_ para lo propio). */
export function stockDeEntorno(env = process.env) {
  const empresaId = env.TOPD_STOCK_EMPRESA_ID || env.STOCK_EMPRESA_ID || "";
  const hojaId = env.TOPD_STOCK_SHEET_ID || env.SHEET_ID || "";
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const clave = env.GOOGLE_PRIVATE_KEY || "";
  if (env.TOPD_STOCK_APAGADO === "1" || !empresaId || !hojaId || !email || !clave) return null;
  return { empresaId, hojaId, email, clave, rango: env.TOPD_STOCK_RANGO || "RESULT!A:O", cadaMin: Number(env.TOPD_STOCK_CADA_MIN ?? 2) };
}
