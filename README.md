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

## Reportes del almacén (corte H)

`GET /reportes/picking?desde=AAAA-MM-DD&hasta=AAAA-MM-DD` (`estacion:bandeja`; sin fechas, los últimos 7 días; máximo 92). Cuenta las líneas **resueltas** (halladas o no) en el rango, en la hora de la empresa (`America/Lima`), y devuelve `totales` (líneas, encontradas, no encontradas, puntaje, mediana de tiempo, taller, muestra, foto, proformas), `porPersona`, `porPiso` y `porDia`. El tiempo es de la primera marca a la resolución y se resume con la **mediana** para que una línea olvidada toda la noche no lo distorsione. Pestaña «Reportes» en el front.

## Supervisión del almacén (corte I)

`GET /supervision` (permiso nuevo `estacion:supervision`): cómo va **hoy** el almacén (día de la empresa, `America/Lima`). Devuelve `hoy` (líneas resueltas, no halladas, puntaje, taller, muestra, foto), `cola` (proformas en el almacén, líneas pendientes, en búsqueda, sin tocar, listas para pasar a revisión, proformas que ya salieron hoy), `ritmo` (líneas de la última hora y un **estimado** de lo que tardaría lo pendiente a ese ritmo), `personas` (qué tiene cada una en la mano, cuántas resolvió hoy, puntos y última marca), `enCurso` (cada línea en búsqueda con quién la busca y desde hace cuánto), `proformas` (la que más espera primero, con avance, quiénes la trabajan y el detalle de sus líneas), `porPiso` y `porHora`. La pestaña «Supervisión» se actualiza sola cada 10 s y resalta en ámbar las líneas que llevan más de 20 min en búsqueda. Lógica pura en `src/reportes.js` (`armarSupervisor`).

## Vista previa del documento (corte J)

En «Nueva proforma» y al editar hay una vista previa en vivo (se actualiza al escribir) con dos hojas, como en el siscore: **Proforma** (encabezado con el emisor, datos del cliente, líneas con precio e importe, totales y condiciones) y **Guía de almacén** (cliente, vendedor, entrega, líneas con modelo, cod max, proveedor, familia y comentario; sin precios). En pantallas anchas va a un lado del formulario; en el celular, plegada debajo. No valida ni guarda: solo dibuja lo que hay en el formulario. Las líneas tachadas y vacías no salen. El precio se toma como **IGV incluido**: con factura o boleta se separa el 18 % (`total − total/1.18`); con «proforma» no se separa. `GET /opciones` ahora devuelve los emisores completos (dirección, teléfono, e-mail) para dibujar el encabezado.

## Guía de almacén con opciones del catálogo (corte L)

Como en el siscore: para cada línea se parte la descripción en palabras y se muestran **todos los productos del catálogo** (`core.catalogo`) cuyo texto (código, descripción, proveedor, marca, familia, subfamilia, categoría) contiene todas las palabras, en cualquier orden. Una coincidencia = una opción; cuatro o cinco = cuatro o cinco (hasta 20 por línea, con el total real: «y N más»). Sin coincidencias: «no encontrado». Cada opción muestra código, stock LV y SJL, descripción / familia / subfamilia, equivalentes, ubicación y precio sugerido. Mejoras sobre el siscore: no distingue tildes y, si la línea trae `codMax` (los archivos lo traen), se busca primero por ese código exacto.

- `POST /guia/opciones` (`estacion:creacion`) y `POST /picking/opciones` (`estacion:produccion`): `{ lineas: [{ k, descripcion, codMax }] }` (hasta 100) → `{ catalogo: { total }, lineas: { [k]: { opciones, total, por } } }`.
- El catálogo se lee entero de `core.catalogo` y se guarda en memoria por empresa **5 minutos** (`src/guia-servicio.js`); una importación o sincronización se ve en la guía a más tardar en ese tiempo. Tope de seguridad: 20 000 productos.
- Front: hoja «Guía de almacén» de la vista previa (tabla como la del siscore, una fila por opción) y, en el Almacén, «N opciones en el catálogo» desplegable bajo cada línea (abierto si hay 3 o menos).
- **Depende de que el catálogo de la empresa tenga productos** (la sincronización de stock, pieza 5.74, o una importación con `catalogo.importar`). Con el catálogo vacío la guía avisa «El catálogo de esta empresa está vacío».

## Sincronización de stock desde la hoja de cálculo (5.74)

Reemplaza al cron del siscore (que cada minuto borraba y reinsertaba todo). `src/stock-servicio.js` lee la pestaña `RESULT` de la hoja con la cuenta de servicio de Google, compara con el catálogo (`core.catalogo`) y **solo envía lo que cambió** (cada producto guarda una `HUELLA`). Columnas: `DICTIONARY` (obligatoria; es el código que ve el almacén), `CODE`, `LV`, `SJL`, `TOTAL`, `EQUIVALENTE + STOCK`, `NOMBRE COMERCIAL`, `FAMILIA`, `SUBFAMILIA`, `PROVEEDOR`, `MARCA`, `UBICACION`, `PRECIO SUGERIDO`.

- Productos nuevos o cambiados → `catalogo.importar` en lotes de 500 (una fila que el catálogo rechaza se aparta y se informa; las demás se cargan).
- Un producto de la hoja que desaparece se **desactiva** (no se borra); si vuelve, se reactiva. Los productos creados a mano (sin `ORIGEN: hoja`) no se tocan.
- **Freno:** si la hoja viene vacía, o desaparecería más del 30 % (mínimo 20) de los productos, no se desactiva nada y se avisa en Configuración.
- Variables de entorno en el servidor (sin ellas queda apagada): `STOCK_EMPRESA_ID` (o `TOPD_STOCK_EMPRESA_ID`), `SHEET_ID` (o `TOPD_STOCK_SHEET_ID`), `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`; opcionales `TOPD_STOCK_RANGO` (por defecto `RESULT!A:O`), `TOPD_STOCK_CADA_MIN` (por defecto 2; `0` = solo manual), `TOPD_STOCK_APAGADO=1`.
- La hoja debe estar compartida (lector) con el correo de la cuenta de servicio. Sin dependencias nuevas: el token se firma con `crypto`.
- `GET /stock/estado` y `POST /stock/sincronizar` (`estacion:configuracion`); la pestaña Configuración muestra la última corrida y tiene «Sincronizar ahora». La guía de almacén olvida su caché al instante si hubo cambios.
- Una sola empresa por servidor (la de `STOCK_EMPRESA_ID`), como el visor de `/stock`.

## Descartar opciones de la guía (corte N)

En la hoja «Guía de almacén» de la estación de creación, cada opción del catálogo tiene el botón **No sirve** (y **Restaurar**): la opción queda tachada. Los códigos descartados se guardan en la línea de la proforma (`lineas[].descartadas`, hasta 50, el código que se ve en la guía) y se conservan al editar. En el Almacén, `POST /picking/opciones` recibe `excluir` por línea y **no devuelve** las descartadas: el desplegable de la línea muestra solo las que quedan («N opciones, M descartadas por ventas») o «Ventas descartó todas las opciones del catálogo». Si todas las opciones por `codMax` se descartan, no se salta a otras por descripción. Cambiar los descartes de una línea al editar la marca como «Corregida por ventas» pero **no** reinicia su avance en el almacén. La vista previa de creación siempre muestra todas (para poder restaurar).

## Sacar por opción en el Almacén (corte O)

Cada opción del catálogo de una línea tiene **Piso**, **− / +**, un campo para **escribir** las unidades y **Todo** (lo que falta del pedido): se escoge el piso en que se sacó y se suben las unidades. Los cambios se ven al instante y se envían juntos medio segundo después del último toque (nada se bloquea mientras guarda). Una línea de 5 puede atenderse con 3 de una opción y 2 de otra (no se pasa del pedido). Se guarda en la fila de picking como `sacados: [{ codigo, descripcion, cantidad, piso, puntaje }]` (hasta 20; `PUT /picking/:code/lineas/:id` con `{ sacados: [...] }` reemplaza la lista completa). Sacar algo deja la línea en «encontrado»; quitarlo todo, en «buscando»; marcar «buscando» o «no hay» limpia lo sacado. `cantidadEncontrada` es la suma. **Puntaje:** cada opción sacada cuenta el puntaje de su piso (se fija al sacar: cambiar la tabla no lo reescribe) y los extras (taller, muestra, foto) se suman una vez a la línea. El reporte por piso cuenta un hallazgo por opción. Las líneas sin opciones (sin coincidencias en el catálogo) siguen con el flujo de siempre: «Encontrado» + piso. Revisión y Bandeja muestran «3 × ZM-8571003 (piso 1) + 2 × 19812 (piso 3)».

**Revisión opción por opción:** en Revisión una línea sacada de varias opciones lleva una casilla «Revisé 3 × ZM-8571003 (piso 3) · descripción» por cada opción; las líneas sin opciones siguen con una sola casilla. El botón de cerrar cuenta lo que falta («Faltan 2 por revisar») y se activa cuando todo está marcado. Las casillas viven en la pantalla del revisor (no se guardan).

## Fotos en las tres estaciones (corte P)

Creación, Almacén y Revisión pueden adjuntar fotos a cada línea. La imagen se reduce en el navegador (máx. ~1600 px, JPEG), se sube a una carpeta de **Google Drive** y **en la base de datos solo se guarda la URL**: referencia de ventas en la línea (`fotos`, hasta 5), y `fotos: [{ url, etapa, ts, porId }]` en la fila de picking (etapa `almacen` o `revision`, hasta 10 por etapa). Las fotos se ven como miniaturas que abren la foto completa; Bandeja las muestra sin poder editar.

Rutas: `GET /fotos` (`{ activo }`), `POST /fotos` (`{ imagen: dataURL }` → `{ id, url }`; JPEG/PNG/WebP, máx. 4 MB, 150 subidas por usuario por hora; permisos creación, producción o revisión), `POST|DELETE /picking/:code/lineas/:lineaId/fotos` (almacén, solo en `orden_salida`) y `POST|DELETE /revision/:code/lineas/:lineaId/fotos` (revisión, solo en `orden_revision`), cuerpo `{ url }`. Quitar una foto borra solo el enlace, no el archivo de Drive.

Variables de entorno (sin `TOPD_FOTOS_CARPETA_ID` la función queda apagada y el botón no aparece; `TOPD_FOTOS_APAGADO=1` también la apaga):

- `TOPD_FOTOS_CARPETA_ID`: id de la carpeta de Drive (lo que va después de `/folders/` en su URL).
- **Opción A, Unidad compartida (cuenta de servicio):** `GOOGLE_SERVICE_ACCOUNT_EMAIL` y `GOOGLE_PRIVATE_KEY` (las mismas del stock) y agregar esa cuenta como **Administrador de contenido** de la Unidad compartida. Una cuenta de servicio **no puede** subir a un «Mi unidad» personal (no tiene cuota).
- **Opción B, Drive personal (tu usuario):** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` (alcance `https://www.googleapis.com/auth/drive`). Tiene prioridad sobre la cuenta de servicio.

Notas: cada archivo queda con permiso «cualquiera con el enlace puede ver» (es lo que permite mostrarlo sin iniciar sesión en Google); las miniaturas usan `drive.google.com/thumbnail`. Si se cancela una proforma en creación, los archivos ya subidos quedan huérfanos en la carpeta. Pruebas: 164.

## Relacionales (corte Q)

Al **cerrar** una proforma en Revisión se guarda, en la colección `relacionales`, una fila por cada opción del catálogo que salió del almacén (una línea de 5 sacada 3 + 2 da dos filas): `fecha` (día del cierre en la hora de la empresa), `codigo`, `cantidad`, `importeUnitario` (precio de la línea), `importeTotal`, `descripcion`, cliente, vendedor y `estado` (`vigente` o `anulado`). Las líneas no encontradas o sin unidades no generan fila; si una línea no tiene opciones se usa el código Max / modelo de la línea (si no hay, queda «sin código»). Si el guardado falla, el cierre se mantiene y se repone con «Completar cerradas anteriores».

Pestaña **Relacionales** (permiso bandeja): filtros por días, estado y proforma, totales, tabla y **Descargar Excel** con las columnas del siscore (Fecha, Code, Cantidad, Importe unitario, Importe total, Descripcion); por defecto solo salen las filas **vigentes**, de modo que una proforma anulada no descuenta stock. Con permiso `estacion:supervision`: **Completar cerradas anteriores** (genera las de proformas cerradas antes de este corte; repetirlo no duplica ni revive anuladas) y **anular** una proforma completa con motivo obligatorio.

Rutas: `GET /relacionales?desde&hasta&estado&code`, `GET /relacionales/descarga.xlsx?desde&hasta&estado` (`estado=todos` para todo), `POST /relacionales/completar`, `POST /relacionales/:code/anular { motivo }`. Evento `relacionales.anulados`. Esta versión **no escribe en Google Sheets**: se descarga el Excel y se carga como hoy. Pruebas: 175.

## Ítems y opciones que suman el almacén y la revisión (corte R)

Quien arma el pedido o lo revisa puede sumar algo que el pedido no traía, de dos formas:

- **Otra opción dentro de una línea** («＋ Agregar otra opción»): se busca en **todo** el catálogo (no solo en lo que sugirió la guía), se elige, se dice el piso y las unidades. Queda como una opción sacada más de esa línea (`sacados[].agregada = "almacen" | "revision"`), así que cuenta en el puntaje por opción, en la revisión opción por opción y en los relacionales. Tope: lo que falta para completar la línea. En la revisión solo se pueden **sumar** opciones; `PUT /revision/:code/lineas/:lineaId` acepta únicamente `{ sacados }`, no cambia quién ni cuándo resolvió la línea el almacén (los reportes siguen contando esa marca) y deja el evento `picking.marca_revision`.
- **Ítem nuevo** («＋ Agregar ítem al pedido»): `POST /picking/:code/lineas` (proforma en `orden_salida`) o `POST /revision/:code/lineas` (en `orden_revision`) con `{ descripcion, cantidad, precioUnitario?, codigo?, piso? }`. Con `codigo` (producto del catálogo; el precio sugerido se propone, se puede cambiar) la línea queda sacada de una vez en el `piso` dicho; sin `codigo`, en el almacén queda por buscar como cualquier línea y en la revisión hay que indicar el piso. La línea guarda `agregada: { etapa, porId, ts }` y se muestra como «Agregada por el almacén / en la revisión»; **no** cuenta como «Corregida por ventas». Crea una nueva versión del documento (el motor valida la versión: si ventas edita a la vez, uno recibe el conflicto y recarga) y deja el evento `picking.linea_agregada`. Ventas la ve en Proformas y su edición la conserva.

Ruta para buscar desde la revisión: `POST /revision/opciones` (igual que la del almacén). Pruebas: 180.

## Foto del despacho (corte S)

Además de las fotos por línea, quien revisa puede subir **fotos del despacho del pedido completo**, como en el siscore («📦 Foto del despacho (pedido completo)» al pie de cada pedido en Revisión; hasta 10). Se guardan en la colección `despachos` (una fila por proforma, solo URLs con quién y cuándo), no dentro del documento, así que no crean versiones ni chocan con ediciones. Se pueden agregar y quitar mientras la proforma está en `orden_revision`; al cerrarla quedan fijas y **Bandeja** las muestra (solo lectura). Rutas: `POST` y `DELETE /revision/:code/despacho/fotos` con `{ url }` (la imagen sube antes por `POST /fotos`, igual que las demás fotos); la lista de proformas trae `fotosDespacho: [url]`. Eventos `picking.foto_despacho` y `picking.foto_despacho_quitada`. No es obligatoria para cerrar. Las fotos por línea de la revisión siguen existiendo. Esta versión también muestra el motivo real de los errores de fotos y de Google en pantalla (antes salía «El servidor tuvo un problema»). Pruebas: 182.

## Página de presentación `/info` (corte T)

`GET <base>/topd/info` (en `ilnapo.com/topd/info`) sirve una página pública, **sin sesión**, que explica qué es topd: el titular, una línea de ejemplo sacada de dos opciones, el recorrido de las cuatro estaciones, lo que hace hoy, lo que sigue y el botón «Entrar» (apunta a la raíz del montaje, `/topd/`, que el servidor pone según `req.baseUrl`). Es un solo archivo, `src/info.html`, con estilos y animación propios (una sola animación al cargar, desactivada con `prefers-reduced-motion`; modo claro y oscuro; funciona en celular). Solo carga las fuentes Barlow desde Google Fonts y, si no llegan, usa fuentes del sistema. Para cambiar textos se edita ese archivo; no necesita `npm run build`. Respuesta con `Cache-Control: public, max-age=300`. Pruebas: 183.

## Corte U: «Tomar foto» con la cámara

En el teléfono, el botón de fotos ahora ofrece dos opciones: **📷 Tomar foto** (abre la cámara trasera con `capture="environment"`) y **🖼️ Galería** (el selector de siempre). En la computadora, «Tomar foto» abre el selector de archivos. Solo cambia `client/src/FotosLinea.jsx`; hay que correr `npm run build`.

## Corte V: arreglo del OCR con el modelo actual

La lectura de fotos fallaba con `400 tool_choice: type "tool" and "any" are not supported for this model`: el modelo no admite forzar la herramienta. Ahora `tool_choice` va en `auto` y el mensaje pide llamar a `registrar_proforma`; `max_tokens` sube a 8192 (hojas largas). Además los fallos del motor dan un mensaje claro: clave inválida (`OCR_CLAVE`), sin saldo (`OCR_SIN_SALDO`), modelo inexistente (`OCR_MODELO`); el front muestra cualquier error `OCR_*`.

## Corte W: cantidad vacía en el papel

Si una línea del papel no trae cantidad pero sí precio unitario (y no hay importe, o el importe es igual al precio), la lectura supone **1 unidad**, marca la línea como dudosa y avisa con `CANTIDAD_SUPUESTA` («no tiene cantidad escrita; se puso 1»). Si falta también el precio, sigue el aviso `CANTIDAD_DUDOSA`. Un «02» escrito en el papel ya se lee como 2.

## Corte X: puntaje por ítem desde la hoja de stock

La hoja de stock (pestaña `RESULT`) puede traer una columna **`PUNTAJE`** (o `PUNTAJE PICKING`) con los puntos de picking de ese ítem. Se guarda en el catálogo como atributo `PUNTAJE` al sincronizar (el rango por defecto pasó de `RESULT!A:O` a `RESULT!A:Z` para alcanzar la columna; `TOPD_STOCK_RANGO` sigue mandando si está puesto).

- **Con puntaje en la hoja** → esa opción sacada vale esos puntos, en cualquier piso (un `0` vale 0).
- **Vacío, negativo o mayor que 1000** → vale el puntaje del piso configurado en la pestaña Configuración, como hasta ahora.
- Los ítems libres (sin código de catálogo) siguen con el puntaje del piso.
- El puntaje es **por opción sacada**, igual que antes (no se multiplica por las unidades). Lo ya medido no cambia si después cambia la hoja.
- El servidor lo resuelve al marcar (`POST/PUT` de picking y revisión, y al agregar ítems); la guía de Almacén muestra «N pts» junto a las opciones que tienen puntaje propio. El catálogo se relee cada 5 minutos.
