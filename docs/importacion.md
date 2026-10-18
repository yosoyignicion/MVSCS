# Importación y exportación

## Alcance disponible

El MVP acepta **CSV**, **Excel `.xlsx`/`.xlsm`** y **PDF digital con tabla**, hasta 10 MB, con una fila por turno **o** una fila por resumen mensual (ver más abajo). Quedan fuera PDF escaneado/OCR, extracción por plantillas, reconocimiento de colores y LM Studio.

- **CSV**: separador coma, punto y coma, tabulador o barra vertical (se detecta automáticamente), codificación UTF-8 con o sin BOM, Windows-1252 o Latin-1. Se admiten filas de título antes de los encabezados.
- **Excel**: se elige la hoja con encabezados reconocibles (no necesariamente la primera) y se busca la fila de encabezados entre las primeras filas, tolerando títulos o filas vacías. Las celdas nativas de fecha/hora y los números seriales de Excel se normalizan.
- **PDF**: se elige la tabla con encabezados mejor reconocidos y se detecta la fila de cabecera aunque haya un título dentro de la tabla. Un PDF que no exponga una tabla (por ejemplo, un escaneo) se rechaza con un error explícito; nunca se simula una importación.

El formato se decide por extensión y se valida la firma real del archivo (zip para Excel, `%PDF` para PDF), sin confiar en el nombre.

La secuencia técnica es:

1. `POST /api/imports/preview` lee el archivo, interpreta fecha/horas, busca el empleado (ID) y el puesto (nombre + municipio) y retorna incidencias. **No escribe nada.** (`POST /api/imports/csv/preview` se mantiene como alias.)
2. La interfaz envía la previsualización a `POST /api/imports/confirm`.
3. Al confirmar, **se crean** el empleado y el puesto que no existan (por `code` y por nombre + municipio; municipio por defecto `Castelló de la Plana`) y las filas válidas se guardan como turnos `pending`; aún no aparecen en los totales.
4. Las filas con datos inválidos (fecha/hora/pausa) se guardan en `review_items`, con fila original y explicación.
5. En **Por revisar**, se corrige empleado, puesto, fecha/hora y pausa; al resolver se crea un turno confirmado. Los turnos válidos pendientes se confirman o descartan.

Cada turno importado guarda su origen (`csv`, `xlsx` o `pdf`) y el nombre de archivo como etiqueta de trazabilidad.

La interfaz confirma automáticamente la carga después de enseñar el resultado del preview; no existe todavía una pantalla de previsualización editable antes de guardar. Una fila válida pasa primero a la bandeja de turnos pendientes. Revisa siempre ese paso antes de usar las horas.

## Formato de entrada

Se recomiendan encabezados normalizados como estos:

| Campo | Obligatorio | Aliases aceptados actualmente |
|---|---:|---|
| ID del empleado | Sí | `id`, `employee_id`, `employee_code`, `codigo`, `codigo empleado`, `codigo trabajador`, `id trabajador`, `id empleado`, `nº empleado`, `num empleado` |
| Nombre | Recomendado | `employee`, `empleado`, `nombre`, `nombre completo`, `nombre y apellidos`, `trabajador`, `vigilante` |
| Apellidos | No | `apellidos`, `apellido` (se combinan con el nombre) |
| Puesto | Sí | `post`, `service`, `puesto`, `puesto de trabajo`, `servicio`, `instalacion`, `centro`, `centro de trabajo` |
| Municipio del puesto | Sí | `municipality`, `municipio`, `localidad`, `poblacion`, `ciudad` |
| Provincia | No | `province`, `provincia`, `prov` |
| Fecha de entrada | Sí | `date`, `fecha`, `dia`, `fecha turno`, `fecha de trabajo` |
| Entrada | Sí | `start`, `entrada`, `hora entrada`, `hora de entrada`, `hora inicio`, `inicio`, `fecha entrada`, `fecha/hora entrada` |
| Salida | Sí | `end`, `salida`, `hora salida`, `hora de salida`, `hora fin`, `fin`, `fecha salida`, `fecha/hora salida` |
| Inicio de pausa | No | `break_start`, `pausa inicio`, `inicio pausa`, `inicio descanso`, `comida inicio` |
| Fin de pausa | No | `break_end`, `pausa fin`, `fin pausa`, `fin descanso`, `comida fin` |
| ¿Pausa remunerada? | Requerido si se indica pausa | `break_paid`, `pausa remunerada`, `pausa pagada` |

Los aliases se comparan ignorando mayúsculas/minúsculas y espacios repetidos. La fecha admite `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY`, fecha serial de Excel y fecha/hora ISO. La hora admite `HH:MM`, `HH:MM:SS`, `HH.MM`, fracciones de día de Excel y `24:00` como fin de día. Si hay columnas `nombre` y `apellidos`, se combinan automáticamente. Los empleados se concilian por ID. Los puestos se concilian por nombre **y** municipio. Si el `code` o el puesto no existen, **se crean automáticamente al confirmar** (nunca en el preview). No hay conciliación por parecido difuso; los duplicados de nombre se detectan en la cola de revisión y se pueden fusionar manualmente.

Ejemplo:

```csv
id,puesto,municipio,provincia,fecha,entrada,salida,pausa inicio,pausa fin,pausa remunerada
VS-1042,Edificio principal,València,Valencia,2026-04-10,22:00,06:00,01:00,01:30,no
```

`provincia` se acepta como columna, pero la selección del puesto se hace por `puesto` y `municipio`. `empleado`/`nombre` no sustituye a `id` para la asociación automática.

## Interpretación y revisión

- La fecha del CSV es la fecha de inicio del turno. Si la hora de salida es igual o anterior a la entrada, el parser la interpreta en el día siguiente; la duración resultante no puede superar 24 horas.
- Si no hay columna de fecha pero la entrada trae fecha y hora completas (como en el CSV que exporta la app), la fecha se toma de la entrada.
- Pausa declarada: inicio y fin deben aparecer juntos y estar dentro del turno. La pausa requiere especificar `sí/no` en la columna remunerada; si la pausa no está incluida en el archivo, el MVP interpreta que no hay pausa. Asegúrate de que eso sea cierto para la fuente que importas.
- Una pausa remunerada se conserva como tal y no se resta. Una pausa no remunerada se excluye de horas trabajadas y subtotales.
- Datos inválidos (fecha/hora/pausa o falta de `id`/puesto): fila a **Por revisar**; no se cuenta hasta corregirla. El ID y el puesto desconocidos **ya no** mandan la fila a revisión: se crean al confirmar.
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
| Localización/puesto (opcional) | `localizacion`, `localización ficticia`, `puesto` | `Centro Comercial Aurora` |

Se detecta automáticamente cuando aparecen columnas de mes/horas y **no** hay columnas de turno (`fecha`, `entrada` o `salida`). Si un resumen tiene errores, se corrige en **Por revisar** con `POST /api/review/{id}/resolve-summary` (empleado, mes y horas); ese flujo no crea turnos. Estos totales **no son turnos**: se guardan en `monthly_summaries`, aparecen en el informe como **“Resúmenes mensuales importados”** y **no se suman** a las horas trabajadas/nocturnas/festivas. El empleado se crea si no existe. `GET /api/monthly-summaries` los lista y `DELETE /api/monthly-summaries/{id}` los elimina.

## Exportación disponible

- `GET /api/exports/shifts.xlsx?year=2026&month=4` descarga un libro Excel con encabezados fijos, filtros, panel congelado y columnas separadas de fecha/entrada/salida para edición rápida. Es el formato recomendado para trabajar y volver a importar.
- `GET /api/exports/shifts.csv?year=2026&month=4` descarga el mismo contenido en CSV con punto y coma y BOM UTF-8.

Ambos aceptan el filtro opcional `post_id`; omitir `month` exporta el año entero. Los turnos pendientes y filas sin resolver quedan excluidos. Tanto el Excel como el CSV exportados se pueden volver a importar: el libro usa `Fecha` + `Entrada`/`Salida`, y el CSV usa fecha/hora ISO, ambos reconocidos por los alias.

## Límites y futuro

La lectura usa una **plantilla genérica**: detecta encabezados por alias, combina las hojas/tablas con cabeceras válidas y tolera títulos previos. El preview rechaza más de 5000 filas con un mensaje claro. No interpreta plantillas con cabeceras repartidas en varias filas, celdas combinadas complejas ni cuadrantes sin tabla detectable. Esos casos requieren un mapeo configurable y deberían validarse con documentos anonimizados antes de ampliar el soporte.

Pendiente, no disponible todavía: OCR de PDF escaneado, reconocimiento de colores (exige una leyenda por plantilla y municipio) y asistencia opcional de LM Studio. La extracción debe ser predecible y cualquier dato ambiguo debe quedar en revisión; nunca un sustituto de las reglas de cálculo deterministas.
