# Datos y cálculos

## Entidades actuales

- **Empleado (`employees`)**: UUID, código/ID único, nombre, apellidos, indicador activo y fecha de alta. Se crean a mano o al importar; la app arranca sin datos ficticios.
- **Centro (`posts`)**: UUID interno, **ID visible**, nombre, municipio (por defecto Castelló de la Plana), provincia (Castellón) e indicador activo. La interfaz solo pide ID y nombre; la provincia y el municipio no se solicitan. Es el centro de trabajo al que se atribuyen los festivos locales. El personal es vigilante de seguridad; el centro no define categoría profesional.
- **Turno (`shifts`)**: empleado, centro, inicio y fin locales, **espacio libre** opcional (desde/hasta) que se descuenta, estado (`pending`/`confirmed`), origen y etiqueta de origen. Los campos antiguos de pausa y segundo tramo se conservan para históricos, pero la interfaz usa espacios libres.
- **Festivo (`holidays`)**: fecha, municipio y nombre. Se generan por reglas desde 2025 hasta cinco años vista (`sync_official_holidays`, idempotente): nacionales/autonómicos para todos los municipios con centros y locales de Castelló (Magdalena y San Pedro). Los locales de otros municipios se añaden o revisan a mano; un festivo descartado no reaparece.
- **Fila en revisión (`review_items`)**: etiqueta de origen, fila original serializada y lista de incidencias. Sirve para conservar importaciones incompletas antes de la conciliación manual.
- **Resumen mensual (`monthly_summaries`)**: empleado, centro opcional, mes (`YYYY-MM`) y minutos totales. Se importa aparte; **no son turnos** y no entran en los totales de horas.

Los informes se calculan al consultar y solo suman turnos confirmados.

## Reglas implementadas

### Duración y fechas

- La zona horaria de interpretación es `Europe/Madrid`.
- El formato de entrada de la API es ISO local (`YYYY-MM-DDTHH:MM`). El backend rechaza instantes locales inexistentes o ambiguos por cambio horario, precisión subminuto, entrada igual a salida y turnos superiores a 24 horas.
- En importación CSV, la fecha es la fecha de entrada. Si la salida es anterior o igual a la hora de entrada, se coloca al día siguiente; si la diferencia resultante excede 24 horas, la fila requiere corrección.
- Un turno puede declarar un **espacio libre** (desde/hasta) dentro del horario. Esos minutos no se trabajan y se descuentan del total y de los subtotales.
- El espacio libre debe quedar dentro del turno y terminar después de empezar. El turno completo no puede superar 24 horas.
- La interfaz muestra «Espacios libres»; internamente se guarda en los campos `break_*` con `break_paid=0` por compatibilidad. Los turnos históricos con pausa conservan su cálculo.
- Las horas se conservan con granularidad de minuto.

### Noche, festivo y fin de semana

- Franja nocturna inicial: desde las 22:00 inclusive hasta las 06:00 exclusiva, atravesando medianoche.
- Una hora cuenta como festiva si su fecha local está en `holidays` para el municipio del centro del turno.
- Los fines de semana se calculan aparte; no se convierten automáticamente en festivos.
- Los subtotales nocturno y festivo pueden solaparse. El total de trabajo cuenta cada minuto una sola vez.
- Los turnos se segmentan por límites de día, de franja nocturna y del espacio libre; el cálculo actual no itera minuto a minuto.

### Informes

`GET /api/reports?year=YYYY&month=MM` ofrece agregados y detalle de turnos confirmados para el periodo. Sin `month`, calcula el año completo. `group_by_employee=false` devuelve además totales diarios compactos. Se pueden añadir búsqueda (`q`) y filtro de centro (`post_id`).

La exportación implementada ofrece Excel `.xlsx` (recomendado, con fecha/horas separadas y formato condicional de cabecera) y CSV con separador `;`, BOM UTF-8 y duraciones `HH:MM`. En una vista anual hay un detalle diario agregado y los totales anual/por empleado/centro proceden del mismo conjunto de turnos. La exportación incluye `ID centro` y columnas de espacio libre.

## Precauciones de dominio

- El CSV de entrada no aporta por sí mismo una semántica legal a las horas ni a los turnos partidos. Confirma las reglas con la empresa y cualquier convenio aplicable antes de usar resultados para nóminas.
- Los nacionales y autonómicos se replican a todos los municipios; los **locales** de Castelló se calculan por reglas y el resto debe verificarse/añadirse. Los años futuros son previsión revisable. La carga oficial es idempotente pero no certifica exhaustividad.
- No se detectan solapes entre turnos distintos ni se deducen descansos obligatorios, recargos, guardias, vacaciones o cumplimiento normativo.
- El MVP no guarda por separado planificación frente a realización: los registros se consideran horas reales.
- Un cambio de municipio de un centro debe revisarse; no se mantiene un historial temporal de la ubicación.
