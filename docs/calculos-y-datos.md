# Datos y cálculos

## Entidades actuales

- **Empleado (`employees`)**: UUID, código/ID único, nombre, apellidos, indicador activo y fecha de alta. Se crean a mano o al importar; la app arranca sin datos ficticios.
- **Puesto (`posts`)**: UUID, nombre, municipio, provincia e indicador activo. La unicidad está definida por nombre y municipio. Es la ubicación operativa a la que se atribuyen festivos locales.
- **Turno (`shifts`)**: empleado, puesto, inicio y fin locales, pausa opcional, condición remunerada/no remunerada, estado (`pending`/`confirmed`), origen y etiqueta de origen.
- **Festivo (`holidays`)**: fecha, municipio y nombre. Se precargan los festivos estatales + Comunitat Valenciana 2025–2026 para `Castelló de la Plana` (`sync_official_holidays`, idempotente); los **locales** de cada municipio se añaden o revisan a mano.
- **Fila en revisión (`review_items`)**: etiqueta de origen, fila original serializada y lista de incidencias. Sirve para conservar importaciones incompletas antes de la conciliación manual.
- **Resumen mensual (`monthly_summaries`)**: empleado, puesto opcional, mes (`YYYY-MM`) y minutos totales. Se importa aparte; **no son turnos** y no entran en los totales de horas.

Los informes se calculan al consultar y solo suman turnos confirmados.

## Reglas implementadas

### Duración y fechas

- La zona horaria de interpretación es `Europe/Madrid`.
- El formato de entrada de la API es ISO local (`YYYY-MM-DDTHH:MM`). El backend rechaza instantes locales inexistentes o ambiguos por cambio horario, precisión subminuto, entrada igual a salida y turnos superiores a 24 horas.
- En importación CSV, la fecha es la fecha de entrada. Si la salida es anterior o igual a la hora de entrada, se coloca al día siguiente; si la diferencia resultante excede 24 horas, la fila requiere corrección.
- Una pausa, cuando se declara, debe tener inicio y fin dentro del turno. No se deduce automáticamente una pausa por duración.
- Una pausa no remunerada se excluye de duración y subtotales; una pausa remunerada permanece dentro de horas trabajadas. Indicar explícitamente la política es importante para no obtener un total equivocado.
- Las horas se conservan con granularidad de minuto.

### Noche, festivo y fin de semana

- Franja nocturna inicial: desde las 22:00 inclusive hasta las 06:00 exclusiva, atravesando medianoche.
- Una hora cuenta como festiva si su fecha local está en `holidays` para el municipio del puesto del turno.
- Los fines de semana se calculan aparte; no se convierten automáticamente en festivos.
- Los subtotales nocturno y festivo pueden solaparse. El total de trabajo cuenta cada minuto una sola vez.
- Los turnos se segmentan por límites de día, de franja nocturna y de pausa; el cálculo actual no itera minuto a minuto.

### Informes

`GET /api/reports?year=YYYY&month=MM` ofrece agregados y detalle de turnos confirmados para el periodo. Sin `month`, calcula el año completo. `group_by_employee=false` devuelve además totales diarios compactos. Se pueden añadir búsqueda (`q`) y filtro de puesto (`post_id`).

La exportación implementada es CSV con separador `;`, BOM UTF-8 y duraciones `HH:MM`. En una vista anual hay un detalle diario agregado y los totales anual/por empleado/puesto proceden del mismo conjunto de turnos.

## Precauciones de dominio

- El CSV de entrada no aporta por sí mismo una semántica legal a las horas ni a las pausas. Confirma las reglas con la empresa y cualquier convenio aplicable antes de usar resultados para nóminas.
- Los estatales y autonómicos se cargan por defecto; los festivos **locales** dependen de municipio y año y deben verificarse/añadirse. La carga oficial es idempotente pero no certifica exhaustividad.
- No se detectan solapes de turnos entre sí ni se deducen descanso obligatorio, recargos, guardias, vacaciones o cumplimiento normativo.
- El MVP no guarda por separado planificación frente a realización: los registros se consideran horas reales.
- Un cambio de municipio de un puesto debe revisarse; no se mantiene un historial temporal de la ubicación.
