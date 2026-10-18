# Importación y exportación

## Alcance disponible

El MVP acepta **cualquier archivo de texto tabular** (CSV, TSV, TXT y variantes de separador), **Excel** (`.xlsx`, `.xlsm` y `.xls` antiguo con `xlrd`), **ODS** de LibreOffice y **PDF digital**, hasta 10 MB, con una fila por turno **o** una fila por resumen mensual (ver más abajo). La detección es por **contenido real**, no por extensión. Quedan fuera PDF escaneado/OCR, extracción por plantillas, reconocimiento de colores y LM Studio.

- **Texto tabular**: separador coma, punto y coma, tabulador, barra vertical o columnas separadas por dos o más espacios; codificación UTF-8 con o sin BOM, UTF-16, Windows-1252 o Latin-1. Se admiten filas de título antes de los encabezados y extensiones arbitrarias (`.txt`, `.dat`, `.tsv`, etc.).
- **Excel**: `.xlsx`/`.xlsm` con `openpyxl` y `.xls` antiguo con `xlrd`; se elige la hoja con encabezados reconocibles (no necesariamente la primera) y se busca la fila de encabezados entre las primeras filas, tolerando títulos o filas vacías. Las celdas nativas de fecha/hora y los números seriales se normalizan.
- **ODS**: se leen las tablas de `content.xml` (incluidas filas/columnas repetidas), sus valores de fecha, hora y número, y se combinan las hojas válidas.
- **PDF**: se elige la tabla con encabezados mejor reconocidos; si el PDF no expone tabla pero sí texto alineado, se intenta interpretar como texto tabular. Un PDF escaneado sin texto se rechaza con un error explícito; nunca se simula una importación.

El formato se decide por **firma/contenido real** (zip de Excel/ODS, `%PDF`, OLE de `.xls` o texto), sin confiar en el nombre ni en la extensión.

La secuencia técnica es:

1. `POST /api/imports/preview` lee el archivo, interpreta fecha/horas, busca el empleado (ID) y el centro (ID o nombre) y retorna incidencias. **No escribe nada.** (`POST /api/imports/csv/preview` se mantiene como alias.)
2. La interfaz envía la previsualización a `POST /api/imports/confirm`.
3. Al confirmar, **se crean** el empleado y el centro que no existan (por `code`/`post_code` o por nombre; municipio por defecto `Castelló de la Plana`) y las filas válidas se guardan como turnos `pending`; aún no aparecen en los totales.
4. Las filas con datos inválidos (fecha, hora o espacio libre) se guardan en `review_items`, con fila original y explicación.
5. En **Por revisar**, se corrige empleado, centro, fecha/hora y espacio libre; al resolver se crea un turno confirmado. Los turnos válidos pendientes se confirman o descartan.

Cada turno importado guarda su origen (`text`, `xlsx`, `xls`, `ods` o `pdf`) y el nombre de archivo como etiqueta de trazabilidad.

La interfaz confirma automáticamente la carga después de enseñar el resultado del preview; no existe todavía una pantalla de previsualización editable antes de guardar. Una fila válida pasa primero a la bandeja de turnos pendientes. Revisa siempre ese paso antes de usar las horas.

## Formato de entrada

Se recomiendan encabezados normalizados como estos:

| Campo | Obligatorio | Aliases aceptados actualmente |
|---|---:|---|
| ID del empleado | Sí | `id`, `employee_id`, `employee_code`, `codigo`, `codigo empleado`, `codigo trabajador`, `id trabajador`, `id empleado`, `nº empleado`, `num empleado` |
| Nombre | Recomendado | `employee`, `empleado`, `nombre`, `nombre completo`, `nombre y apellidos`, `trabajador`, `vigilante` |
| Apellidos | No | `apellidos`, `apellido` (se combinan con el nombre) |
| ID centro | Recomendado | `post_code`, `id centro`, `id del centro`, `codigo centro`, `cod centro` |
| Centro | Sí | `post`, `service`, `puesto`, `puesto de trabajo`, `servicio`, `instalacion`, `centro`, `centro de trabajo` |
| Municipio del centro | No | `municipality`, `municipio`, `localidad`, `poblacion`, `ciudad` (por defecto Castelló de la Plana) |
| Provincia | No | `province`, `provincia`, `prov` |
| Fecha de entrada | Sí | `date`, `fecha`, `dia`, `fecha turno`, `fecha de trabajo` |
| Entrada | Sí* | `start`, `entrada`, `hora entrada`, `hora de entrada`, `hora inicio`, `inicio`, `fecha entrada`, `fecha/hora entrada` |
| Salida | Sí* | `end`, `salida`, `hora salida`, `hora de salida`, `hora fin`, `fin`, `fecha salida`, `fecha/hora salida` |
| Horario completo | Alternativa | `horario`, `horario de trabajo`, `franja horaria`, `entrada/salida`; admite `08:00-16:00`, `08:00 a 14:00 y 17:00 a 20:00`, `22:00-06:00` |
| Espacio libre desde | No | `free_start`, `espacio libre desde`, `inicio espacio libre`, `libre desde` |
| Espacio libre hasta | No | `free_end`, `espacio libre hasta`, `fin espacio libre`, `libre hasta` |
| Inicio de pausa (histórico) | No | `break_start`, `pausa inicio`, `inicio pausa`, `inicio descanso`, `comida inicio` |
| Fin de pausa | No | `break_end`, `pausa fin`, `fin pausa`, `fin descanso`, `comida fin` |
| ¿Pausa remunerada? (histórico) | Requerido si se indica pausa | `break_paid`, `pausa remunerada`, `pausa pagada` |

\* Se pueden sustituir por una columna `Horario`. Los encabezados se resuelven por alias y por coincidencia semántica (acentos, mayúsculas, símbolos y órdenes habituales como «TOTAL HORAS MES»). Los aliases se comparan ignorando mayúsculas/minúsculas y espacios repetidos. Si una fila trae un total mensual/anual junto a entrada y salida, el total se ignora para el turno y se recalculan las horas. Las filas de totales de tabla sin empleado se omiten. La fecha admite `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY`, fecha serial de Excel y fecha/hora ISO. La hora admite `HH:MM`, `HH:MM:SS`, `HH.MM`, fracciones de día de Excel y `24:00` como fin de día. Si hay columnas `nombre` y `apellidos`, se combinan automáticamente. Los empleados se concilian por ID; si falta, por **nombre único** (si hay ambigüedad, va a revisión). Los centros se concilian por **ID** y, si no hay ID, por nombre. También se separan celdas compuestas como `VS-777 - Nuevo Vigilante` o `C-99 - Centro Compuesto`. Si el `code` o el centro no existen, **se crean automáticamente al confirmar** (nunca en el preview). No hay conciliación por parecido difuso; los duplicados de nombre se detectan en la cola de revisión y se pueden fusionar manualmente.

Ejemplo:

```csv
id,id centro,centro,fecha,entrada,salida,espacio libre desde,espacio libre hasta
VS-1042,C-01,Edificio principal,2026-04-10,08:00,20:00,14:00,16:00
```

`provincia` y `municipio` se aceptan como columnas, pero la selección principal del centro se hace por `id centro` o por `centro`/`puesto`. `empleado`/`nombre` no sustituye a `id` para la asociación automática.

## Interpretación y revisión

- La fecha del CSV es la fecha de inicio del turno. Si la hora de salida es igual o anterior a la entrada, el parser la interpreta en el día siguiente; la duración resultante no puede superar 24 horas.
- Si no hay columna de fecha pero la entrada trae fecha y hora completas (como en el CSV que exporta la app), la fecha se toma de la entrada.
- Espacio libre: `espacio libre desde` y `espacio libre hasta` deben aparecer juntos, quedar dentro del turno y terminar después de empezar. Sus minutos se descuentan.
- Compatibilidad histórica: se siguen aceptando pausas y el antiguo segundo tramo. La interfaz nueva usa espacios libres.
- Datos inválidos (fecha/hora/espacio libre o falta de `id`/centro): fila a **Por revisar**; no se cuenta hasta corregirla. El ID y el centro desconocidos **ya no** mandan la fila a revisión: se crean al confirmar.
- Las filas válidas se mantienen pendientes explícitamente y tampoco se cuentan hasta pulsar **Confirmar turno**.
- **Nombre duplicado**: si el ID no existe pero el nombre coincide con el de un empleado ya registrado (con otro ID), la fila va a **Por revisar** en vez de crear otro empleado. En **Por revisar ▸ Posibles duplicados** se pueden **unificar** dos empleados de mismo nombre (`POST /api/employees/{destino}/merge`), moviendo turnos y resúmenes. Aún no hay detector de turnos repetidos.

## Resumen mensual

Además de turnos, se acepta un **resumen mensual** con una fila por empleado y mes:

| Campo | Aliases | Ejemplo |
|---|---|---|
| ID del empleado | `id`, `id empleado`, … | `SEG-001` |
| Mes | `mes`, `month` | `2026-07`, `julio 2026`, `July 2026` |
| Horas totales | `horas totales trabajadas`, `horas totales`, `horas` | `200` o `200:00` |
| Nombre (opcional) | `nombre`, `nombre ficticio`, `empleado` | `Álvaro Castro` |
| Localización/centro (opcional) | `localizacion`, `localización ficticia`, `puesto`, `centro` | `Centro Comercial Aurora` |

Se detecta automáticamente cuando aparecen columnas de mes/horas y **no** hay columnas de turno (`fecha`, `entrada` o `salida`). Si un resumen tiene errores, se corrige en **Por revisar** con `POST /api/review/{id}/resolve-summary` (empleado, mes y horas); ese flujo no crea turnos. Estos totales **no son turnos**: se guardan en `monthly_summaries`, aparecen en el informe como **“Resúmenes mensuales importados”** y **no se suman** a las horas trabajadas/nocturnas/festivas. El empleado se crea si no existe. `GET /api/monthly-summaries` los lista y `DELETE /api/monthly-summaries/{id}` los elimina.

## Exportación disponible

- `GET /api/exports/shifts.xlsx?year=2026&month=4` descarga un libro Excel con encabezados fijos, filtros, panel congelado y columnas separadas de fecha/entrada/salida para edición rápida. Es el formato recomendado para trabajar y volver a importar.
- `GET /api/exports/shifts.csv?year=2026&month=4` descarga el mismo contenido en CSV con punto y coma y BOM UTF-8.

Ambos aceptan el filtro opcional `post_id`; omitir `month` exporta el año entero. Los turnos pendientes y filas sin resolver quedan excluidos. Tanto el Excel como el CSV exportados se pueden volver a importar: el libro usa `Fecha` + `Entrada`/`Salida`, y el CSV usa fecha/hora ISO, ambos reconocidos por los alias.

## Límites y futuro

La lectura usa una **plantilla genérica**: detecta encabezados por alias, combina las hojas/tablas con cabeceras válidas y tolera títulos previos. El preview rechaza más de 5000 filas con un mensaje claro. No interpreta plantillas con cabeceras repartidas en varias filas, celdas combinadas complejas ni cuadrantes sin tabla detectable. Esos casos requieren un mapeo configurable y deberían validarse con documentos anonimizados antes de ampliar el soporte.

Pendiente, no disponible todavía: OCR de PDF escaneado, reconocimiento de colores (exige una leyenda por plantilla y municipio) y asistencia opcional de LM Studio. La extracción debe ser predecible y cualquier dato ambiguo debe quedar en revisión; nunca un sustituto de las reglas de cálculo deterministas.
