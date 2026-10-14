# Importación y exportación

## Alcance disponible

El MVP acepta **CSV UTF-8**, **Excel `.xlsx`/`.xlsm`** y **PDF digital con tabla**, hasta 10 MB, con una fila por turno **o** una fila por resumen mensual (ver más abajo). Quedan fuera PDF escaneado/OCR, extracción por plantillas, reconocimiento de colores y LM Studio.

- **CSV**: separador coma o punto y coma (se detecta automáticamente, igual que el tabulador), UTF-8 (se acepta BOM).
- **Excel**: se lee la **primera hoja**; la primera fila debe contener los encabezados. Las celdas de fecha/hora nativas de Excel se normalizan a texto antes de aplicar los alias.
- **PDF**: se detecta la **tabla con más filas** del documento y se usa su primera fila como encabezado. Un PDF que no exponga una tabla (por ejemplo, un escaneo) se rechaza con un error explícito; nunca se simula una importación.

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
| ID del empleado | Sí | `id`, `employee_id`, `employee_code`, `codigo`, `codigo empleado`, `id trabajador`, `id empleado` |
| Puesto | Sí | `post`, `service`, `puesto`, `servicio`, `instalacion` |
| Municipio del puesto | Sí | `municipality`, `municipio`, `localidad` |
| Fecha de entrada | Sí | `date`, `fecha`, `dia` |
| Entrada | Sí | `start`, `entrada`, `hora entrada`, `inicio` |
| Salida | Sí | `end`, `salida`, `hora salida`, `fin` |
| Inicio de pausa | No | `break_start`, `pausa inicio`, `inicio pausa` |
| Fin de pausa | No | `break_end`, `pausa fin`, `fin pausa` |
| ¿Pausa remunerada? | Requerido si se indica pausa | `break_paid`, `pausa remunerada` |

Los aliases se comparan ignorando mayúsculas/minúsculas; se espera fecha ISO (`YYYY-MM-DD`) y hora (`HH:MM`). El archivo debe estar codificado en UTF-8; también se acepta BOM UTF-8. Los empleados se concilian por ID. Los puestos se concilian por nombre **y** municipio. Si el `code` o el puesto no existen, **se crean automáticamente al confirmar** (nunca en el preview). No hay conciliación por parecido textual ni fusión de duplicados.

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

Se detecta automáticamente cuando aparecen las columnas de mes y horas. Estos totales **no son turnos**: se guardan en `monthly_summaries`, aparecen en el informe como **“Resúmenes mensuales importados”** y **no se suman** a las horas trabajadas/nocturnas/festivas. El empleado se crea si no existe. `GET /api/monthly-summaries` los lista y `DELETE /api/monthly-summaries/{id}` los elimina.

## Exportación disponible

`GET /api/exports/shifts.csv?year=2026&month=4` descarga turnos confirmados, con filtro opcional `post_id`. Omitir `month` exporta el año entero. El resultado usa punto y coma, BOM UTF-8, fechas/horas locales ISO y columnas de duración `HH:MM`. Los turnos pendientes y filas sin resolver quedan excluidos. Ese mismo CSV se puede volver a importar (el separador `;` y el encabezado `ID empleado` se reconocen).

## Límites y futuro

La lectura de Excel y PDF usa una **plantilla genérica** (primera hoja / tabla con más filas). Plantillas reales con cabeceras en varias filas, celdas combinadas, varias hojas o cuadrantes sin tabla detectable requieren un mapeo configurable y deberían validarse con documentos anonimizados de cada plantilla antes de ampliar el soporte.

Pendiente, no disponible todavía: OCR de PDF escaneado, reconocimiento de colores (exige una leyenda por plantilla y municipio) y asistencia opcional de LM Studio. La extracción debe ser predecible y cualquier dato ambiguo debe quedar en revisión; nunca un sustituto de las reglas de cálculo deterministas.
