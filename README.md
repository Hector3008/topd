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
| configuración | `estacion:configuracion` | pisos, puntajes y emisores de la empresa |

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

### Carga con OCR (corte B)

`POST /proformas/leer` (`estacion:creacion`) recibe `{ imagen, modo: "impreso" | "manuscrito" }` (la foto en data URL, reducida por el
front a 1600 px) y devuelve `{ cabecera, lineas, total, suma, avisos }` **sin crear nada**: la persona revisa el formulario
(foto al lado, líneas dudosas resaltadas, aviso si la suma no cuadra con el total del papel) y recién entonces crea la proforma
con `POST /proformas` (`origen: "ocr:impreso" | "ocr:manuscrito"`). `GET /ocr` dice si la lectura está activada.

- Motor: modelo de visión de Anthropic. Se activa con la variable `ANTHROPIC_API_KEY` (opcional `TOPD_OCR_MODELO`,
  por defecto `claude-sonnet-5-5`). Sin clave, todo sigue funcionando a mano y la ruta responde 503.
- Tope de gasto: 30 lecturas por persona y hora (`crearLector({ limitePorHora })`).
- La foto no se guarda. Cada modo tiene su motor (`crearLector({ motores: { impreso: ... } })`), para cambiar el impreso
  por un OCR gratuito si las fotos de muestra lo justifican.

### Revisión y bandeja (front de las cuatro estaciones)

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /revision` | `estacion:revision` | Proformas en `orden_revision`, con lo que pasó en cada línea |
| `POST /revision/:code/cerrar` | `estacion:revision` | «Revisé y validé el pedido»: pasa a `cerrada` |
| `GET /bandeja?estado=a,b` | `estacion:bandeja` | Solo lectura: todas las proformas con su avance (el front busca por código, cliente, vendedor o referencia) |

El front muestra solo las pestañas a las que el rol da acceso: Nueva proforma, Almacén, Revisión y Bandeja.
En Revisión hay que marcar cada línea como revisada (la marca vive en la pantalla) antes de poder cerrar; se resaltan
las líneas faltantes, con cantidad distinta o con nota. Revisión aún no puede devolver un pedido al almacén (pendiente de decidir).

La cabecera admite una **referencia** opcional (`cabecera.referencia`): el N.º de la proforma de papel o del sistema anterior, para enlazar
la proforma de topd (`DP-000000x`, que corre en paralelo a las de hoy) con lo que se trabaja a mano. El OCR la rellena si el papel la trae.

### Campos heredados del siscore anterior

La cabecera de la proforma guarda: cliente (nombre, RUC/DNI, teléfono, e-mail, dirección, provincia, ciudad), entrega (`tienda | agencia | local`),
destino, agencia, atención, canal de venta (`tienda | online | cartera`), forma de pago (`efectivo | deposito | transferencia | transferencia_y_caja | tarjeta | credito`),
comprobante (`factura | boleta | proforma`), fecha, vendedor, despachador y la referencia del papel. Cada línea lleva un **comentario** para el almacén y el
documento guarda los **pagos** (`{ cuenta, monto, operacion }`, hasta 10), que solo salen en `GET /bandeja`. Las listas cerradas se validan en el servidor.

### Cargar desde Excel o PDF (estación de creación)

`POST /proformas/archivo` (permiso `estacion:creacion`): el cuerpo es el archivo tal cual (binario, máx. 8 MB). El formato se reconoce por su contenido, no por la extensión. Devuelve la misma lectura que la de fotos (`{ cabecera, lineas, total, suma, avisos, origen }`), solo para revisarla; no crea nada. Es gratis: no usa OCR ni `ANTHROPIC_API_KEY`.

- **Columnas** (por su nombre, en cualquier orden, con o sin acentos): `CANTIDAD SOLICITADA` / `CANTIDAD` / `PEDIDO`, `NOMBRE COMERCIAL` / `NOMBRE` / `DESCRIPCION` (estas dos obligatorias), `MODELO` / `ALIAS`, `COD MAX`, `PROVEEDOR`, `FAMILIA`, `FECHA DE ENVIO`, y si existen `PRECIO UNITARIO` e `IMPORTE`.
- Cada línea guarda además `modelo`, `codMax`, `proveedor` y `familia`; el almacén y la revisión los muestran bajo la descripción. Editarlos no reinicia el avance de picking.
- Encima de la tabla se reconocen `Cliente:`/`Tienda:`/`Tda …`, `RUC` y `N° de proforma`. La fecha de envío más frecuente pasa a la cabecera.
- Excel: un texto tachado en la celda deja la línea como tachada. PDF: debe tener texto; los nombres partidos en dos líneas y los encabezados repetidos en varias páginas se resuelven. Un PDF que es solo una imagen responde `PDF_SIN_TEXTO` (usar la foto).
- `origen` de la proforma: `archivo:xlsx` o `archivo:pdf`. Errores: `SIN_TABLA`, `ARCHIVO_INVALIDO`, `ARCHIVO_REQUERIDO`, `ARCHIVO_GRANDE` (413), `PDF_SIN_TEXTO`.
- Dependencias nuevas: `exceljs` y `pdfjs-dist` (se cargan solo al leer un archivo).

#### Plantilla de Excel

`GET /proformas/plantilla.xlsx` (permiso `estacion:creacion`) descarga una plantilla lista para llenar; en «Nueva proforma» está el botón «Descargar plantilla de Excel». Se arma en el momento (`src/plantilla.js`), así que siempre coincide con lo que lee la carga.

- Hoja **Proforma**: datos de cabecera (etiqueta y valor; entrega, canal de venta, forma de pago y comprobante con lista desplegable; fecha con formato) y una tabla con CANTIDAD, MODELO, NOMBRE COMERCIAL, COD MAX, PROVEEDOR, FAMILIA, PRECIO UNITARIO y COMENTARIO PARA EL ALMACÉN, con validación de cantidad entera y precio numérico para 200 líneas (el máximo del servidor).
- Hojas **Ejemplo** e **Instrucciones**: de apoyo; la carga las ignora.
- Al cargar un Excel se reconocen estas etiquetas de cabecera (en una celda «Etiqueta: valor» o una celda de etiqueta seguida de su valor): cliente, RUC/DNI, teléfono, e-mail, dirección, provincia, ciudad, entrega, destino, agencia, atención, canal de venta, forma de pago, comprobante, fecha, vendedor, despachador y N.º de la proforma de papel. Un valor que no está en la lista cerrada no se carga y se avisa (`CABECERA_VALOR`).
- Una columna `COMENTARIO` (o `OBSERVACION`) pasa al comentario de la línea para el almacén.


## Configuración, emisor, borrador y cotización (corte G)

- `GET/PUT /config` (`estacion:configuracion`): pisos con su puntaje, puntos extra (`taller`, `muestra`, `foto`; por defecto 0) y emisores. Un documento por empresa (colección `config`); sin nada guardado rige 1→1 … 4→4. Cada marca del almacén guarda el puntaje de ese momento: cambiar la tabla no reescribe lo ya medido. `/picking`, `/revision` y `/bandeja` devuelven `puntajesPiso` y `extras` vigentes.
- Emisores: nunca se borran, se desactivan. La proforma guarda una **copia** (`doc.emisor`) al emitirse; `POST /proformas` y `PUT /proformas/:code` aceptan `emisorId` (`""` lo quita; sin definir lo conserva). `GET /opciones` (`estacion:creacion`) lista los emisores activos.
- `POST /proformas` acepta `destino`: `borrador` (puede ir sin líneas), `cotizacion` u `orden_salida` (por defecto). Responde `{ code, estado }`.
- `POST /proformas/:code/estado` `{ a, version, motivo: { codigo, detalle? } }` (`estacion:creacion`): manda a `cotizacion` u `orden_salida` (exige líneas) o cierra sin vender (`descartado`, `rechazada`, `vencida`, con motivo). Solo desde borrador, cotización u orden de salida.
- Roles: hay que dar `estacion:configuracion` a quien administre pisos y emisores.
