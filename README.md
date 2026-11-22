# topd — to Picking and Dispatch

Servicio de Mi-Servidor que reemplaza a siscore. Lo esencial es la comunicación entre
**ventas** (crea la proforma), **picking** (junta los ítems en el almacén) y **despacho**
(revisa y valida el pedido), sobre la base común (`core`).

## Documento

Un solo tipo, `proforma`, prefijo `DP` (`DP-0000001`):

    borrador ─► cotizacion ─► orden_salida ─► orden_revision ─► cerrada
       │            ├─► rechazada (motivo)
       │            └─► vencida   (motivo)
       ├─► orden_salida   (saltando la cotización)
       └─► descartado (motivo)

| Estación | Permiso | Qué hace |
|---|---|---|
| creación | `estacion:creacion` | crea y edita; cotiza, emite la orden de salida, descarta |
| producción | `estacion:produccion` | junta el pedido y lo envía a revisión |
| revisión | `estacion:revision` | valida y cierra |
| bandeja | `estacion:bandeja` | solo lee |

Roles de plantilla (en `core`): `vendedor`, `almacen`, `revisor`.

## Uso

```js
import { createRouter } from "topd";
gateway.use("/topd", createRouter({ core }));
```

## Estado

5.71: tipos, estados, permisos, atributos del catálogo, plantilla de roles. Faltan las rutas de
proformas (5.72), las pantallas de las cuatro estaciones (5.73) y la sincronización de stock (5.74).

## Pruebas

    npm test

## Picking (pieza piloto)

Avance del almacén sobre las proformas en `orden_salida`. Vive en su propia colección `picking` (una fila por
proforma + línea), no en las versiones del documento. Cada marca deja el evento `picking.marca`.

| Ruta | Permiso | Qué hace |
|---|---|---|
| `POST /proformas` | `estacion:creacion` | Crea la proforma ya en `orden_salida` (`{ cabecera, lineas:[{cantidad, descripcion, precioUnitario}], origen }`) |
| `GET /picking` | `estacion:produccion` | Proformas activas con el avance de cada línea, y la tabla de puntajes por piso |
| `PUT /picking/:code/lineas/:lineaId` | `estacion:produccion` | Marca parcial: `estado` (pendiente, buscando, encontrado, no_encontrado), `piso`, `taller`, `reconocido` (muestra, foto), `cantidadEncontrada`, `nota` |
| `POST /picking/:code/listo` | `estacion:produccion` | Pasa a `orden_revision` si todas las líneas (menos las anuladas) están resueltas |

Los puntajes por piso (`PUNTAJES_PISO`) son provisionales; se cambian con `createRouter({ core, puntajesPiso })`.

### Front

`client/` (React + Vite, `client/dist` commiteado) se sirve en `<base>/topd/`: pestaña **Almacén** (proformas
activas, botones por línea, refresco cada 10 s) y pestaña **Nueva proforma** (carga manual; luego será la pantalla de
revisión del OCR). Compilar: `npm run build`.
