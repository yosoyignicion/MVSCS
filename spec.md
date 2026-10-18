# Sistema local de gestión de cuadrantes y horas

## 1. Encargo original

> Experto en gestión y administración para empresas y programación de cálculos con datos. El sistema debe buscar información por empleado (ID y nombre), calcular correctamente las horas a partir de entradas y salidas, conocer y resaltar días festivos, mostrar el horario total y calcular horas por mes y año. La búsqueda también debe presentar horas nocturnas y festivas, y permitir filtrar por nombre de servicio. Se necesita introducir datos manualmente en una vista tipo Excel, con ID, nombre y apellidos, calendario por número de día/día de la semana y cálculos; cada empleado tendrá sus horarios de entrada y salida. La app web debe ser responsive, admitir PDF con tablas/cuadrantes, trabajar localmente y prever extracción asistida por IA local cuando se solicite. Se utilizará LM Studio en una fase futura. El diseño debe ser elegante y profesional, sin sobreingeniería. El caso de uso es una empresa de seguridad privada con muchos empleados y cuadrantes mensuales; inicialmente se trabajará con datos ficticios y se podrán incorporar PDF.

## 2. Resumen y objetivo

Construir una aplicación web de uso local para mantener cuadrantes mensuales, revisar turnos por persona o servicio y consultar totales mensuales/anuales. Los cálculos deben ser deterministas, trazables y comprobables; la IA futura podrá asistir en la lectura de documentos, pero nunca será la fuente de verdad para sumar horas.

### Objetivos principales

- Dar de alta y buscar empleados por ID o nombre.
- Organizar turnos por fecha, empleado y servicio.
- Editar y revisar cuadrantes en una interfaz familiar tipo hoja de cálculo.
- Calcular horas trabajadas, nocturnas y festivas, con las reglas visibles y configurables.
- Consultar resúmenes por empleado, servicio, mes y año.
- Importar PDF con una etapa de previsualización y corrección antes de guardar.
- Mantener los datos y documentos en el equipo local, con opciones sencillas de exportación y copia de seguridad.

### No objetivos del MVP

- Nóminas, facturación, control de presencia en tiempo real o planificación automática de turnos.
- Interpretar contratos, convenios o legislación laboral y decidir cumplimiento normativo.
- Sincronización en nube, colaboración multiusuario simultánea, autenticación empresarial o acceso remoto.
- Extracción autónoma de PDF mediante IA. La integración con LM Studio queda diseñada como fase posterior.

## 3. Usuarios y escenarios

**Usuario principal:** persona de administración/coordinación que mantiene cuadrantes y revisa horas. El MVP es monousuario y se ejecuta en un equipo local. La plantilla incluye vigilantes de seguridad; el dato relevante para el filtro es el puesto/instalación asignado al turno.

1. Crear o importar empleados y servicios.
2. Abrir un cuadrante mensual, seleccionar el servicio y registrar turnos.
3. Revisar advertencias (turnos incompletos, solapes, ID desconocido, festivos).
4. Buscar un empleado y consultar turnos y totales de un mes o año.
5. Importar un PDF, corregir la extracción en una vista previa y confirmar los registros.
6. Exportar resultados o crear una copia de seguridad antes de cambiar de periodo.

## 4. Alcance funcional del MVP

### 4.1 Empleados y servicios

- Empleado: ID único, nombre, apellidos, estado activo/inactivo y notas opcionales.
- Puesto/instalación (servicio): nombre único, municipio, provincia (Comunitat Valenciana) y estado activo/inactivo. Los festivos locales se evalúan según el municipio asociado al puesto del turno.
- El ID es la clave preferida para conciliar datos importados; nunca se debe enlazar automáticamente solo por similitud de nombres sin confirmación.
- Desactivar conserva el historial. No borrar en cascada turnos históricos.
- Los filtros por empleado, servicio, año y mes se pueden combinar.

### 4.2 Cuadrante editable

- Selector de año, mes y servicio, con navegación al periodo anterior/siguiente.
- Vista de calendario mensual tipo hoja de cálculo. Cada fila representa un empleado y cada columna un día; los encabezados muestran número y día de la semana.
- Cada celda muestra un resumen del turno y su estado; seleccionar la celda abre edición de entrada, salida, pausas y servicio.
- Permitir varios turnos realizados por empleado y día, cada uno con puesto/instalación, entrada, salida y pausas; la celda presenta un resumen y permite ver/editar el detalle.
- Guardado explícito o automático con confirmación visible; no perder cambios al cambiar de mes sin aviso.
- Marcar visualmente festivos, fines de semana y datos incompletos con leyenda accesible. El color nunca será la única señal.
- Ordenar por ID/nombre y filtrar empleados. En pantallas estrechas, usar vista por empleado/día o tarjetas; no comprimir 31 columnas hasta hacer ilegibles los datos.

### 4.3 Consulta y resultados

- Búsqueda por ID o nombre/apellidos, con resultados sin recargar toda la app.
- Filtros por servicio y rango temporal (mes/año).
- Ficha del empleado: turnos, horas trabajadas, nocturnas y festivas; desglose diario y totales mensuales/anuales.
- Resumen del servicio con número de empleados y horas agregadas.
- Los totales deben indicar periodo, unidad y reglas aplicadas. Horas nocturnas y festivas pueden solaparse entre sí; no sumarlas como categorías mutuamente excluyentes.
- Mostrar datos fuente y avisos para que el usuario pueda explicar cómo se obtuvo cada total.

### 4.4 Festivos y reglas

- Calendario local de festivos mantenido por año con festivos estatales, autonómicos valencianos y locales, asociado por municipio del puesto. La app no debe afirmar que un calendario está completo sin una carga/revisión explícita; permitir edición manual e importación/exportación.
  - **(Actualizado)** El MVP genera por reglas desde 2025 y hasta cinco años vista los festivos nacionales, autonómicos y locales de Castelló; los nacionales/autonómicos se replican a todos los municipios con puestos. La lista de Puestos muestra los próximos festivos y la barra lateral los resume de forma plegable. La generación es offline e idempotente, respeta los festivos descartados y no certifica exhaustividad: los locales de otros municipios se añaden/revisan a mano.
- Aplicar festivo por la ubicación donde se realizó el turno, incluso si el vigilante trabaja en puestos de municipios distintos.
- Los sábados y domingos se clasifican aparte; no cuentan como horas festivas salvo que esa fecha esté declarada festiva oficialmente en el calendario local.
- Configurar zona horaria del centro de trabajo y franja nocturna. Valor inicial sugerido: `Europe/Madrid` y 22:00–06:00 como convención configurable, no como afirmación legal.
- Los umbrales, pausas y reglas de redondeo se deben poder revisar. Por defecto, conservar minutos exactos y no redondear.

### 4.5 Importación de archivos

Flujo: seleccionar archivo local → extraer filas → previsualizar y mapear columnas → asociar empleado y puesto/instalación → corregir errores → validar → confirmar importación. El formato esperado preferido es un turno por fila.

- La importación nunca altera el cuadrante hasta que el usuario confirma.
- Mostrar archivo, páginas, filas detectadas, campos sin reconocer y confianza/estado de cada campo cuando el extractor lo permita.
- Priorizar CSV y XLSX; admitir PDF digital solo cuando sus filas/campos puedan extraerse con fiabilidad y siempre con revisión. PDF escaneado requiere OCR local y queda para fase posterior junto con la asistencia futura de LM Studio. Si no se puede interpretar, dejarlo pendiente; no simular una importación exitosa.
- Validar empleados desconocidos, fechas fuera del periodo, horas inválidas, turnos invertidos/ambiguos y posibles duplicados.
- Prevenir duplicados mediante vista previa y decisión explícita: omitir, sustituir o conservar ambos; no sobrescribir silenciosamente.
- Guardar el origen del dato (manual/importación), nombre y huella del archivo, fecha de importación y referencia a página/fila si está disponible.
- El PDF permanece local. Definir retención/borrado del original; el MVP debe permitir al usuario borrarlo sin borrar los turnos ya confirmados.
- **(Actualizado)** Al confirmar, el MVP actual **auto-crea** el empleado (por ID) y el puesto (por nombre + municipio) que no existan. También acepta un formato de **resumen mensual** (mes + horas totales) que se guarda aparte (`monthly_summaries`) y no se suma a las métricas de turnos. La prevención/fusión de duplicados sigue pendiente.

### 4.6 Datos iniciales y exportación

- Incluir conjunto ficticio claramente etiquetado, con empleados, servicios, varios meses, turnos nocturnos, nocturnos que cruzan medianoche y días festivos.
  - **(Actualizado)** El MVP actual **no** siembra datos ficticios: arranca vacío y los datos se crean a mano o al importar. Se reserva la idea de ejemplos separados para una fase posterior.
- Separar los datos de ejemplo de los datos del usuario y permitir reiniciar los ejemplos sin borrar datos reales.
- Exportar CSV UTF-8, XLSX y PDF imprimible para cuadrantes, detalle por turno e informes mensuales/anuales. Para el primer incremento implementado, priorizar CSV y XLSX y añadir PDF imprimible cuando se valide la plantilla.
- Ofrecer copia de seguridad/restauración de la base local con validación previa. No se debe reemplazar una base existente sin confirmación y copia previa.

## 5. Reglas de cálculo

### 5.1 Representación de turnos

Un turno realizado tiene empleado, puesto/instalación, fecha/hora local de inicio, fecha/hora local de fin y pausa(s) según lo declarado en el archivo o captura manual. La interfaz permite turnos que terminan al día siguiente y varios turnos por día. Este MVP representa horas realizadas, no compara con turnos planificados.

### 5.2 Duración

- Calcular duración como intervalos de tiempo reales, no restando texto de reloj.
- Intervalo de turno semiabierto `[inicio, fin)`. Si la salida es anterior a la entrada, la interfaz propone el día siguiente y lo muestra explícitamente; el usuario confirma. Entrada igual a salida no se interpreta como 24 horas: se rechaza como ambiguo.
- No inferir una pausa a partir de la duración del turno. Usar la pausa declarada para el turno; si falta o es ambigua en una importación, enviarla a revisión pendiente y excluirla de los totales confirmados. La política remunerada/no remunerada debe identificarse o confirmarse antes de restar tiempo.
- Un turno que cruza medianoche se divide internamente por día para asignar cada minuto al día local correspondiente, manteniendo su identidad como turno.
- Manejar cambios de horario estacional de la zona configurada de manera explícita. Si una hora local es inexistente o ambigua por cambio horario, solicitar aclaración en vez de adivinar.

### 5.3 Horas nocturnas y festivas

- Horas nocturnas = intersección de minutos trabajados con la franja nocturna configurada, que puede cruzar medianoche.
- Horas festivas = intersección de minutos trabajados con fechas declaradas festivas en el calendario configurado.
- Una misma hora puede ser nocturna y festiva a la vez. La duración trabajada se contabiliza una sola vez en el total; los subtotales son atributos superpuestos.
- Solo se excluyen pausas identificadas explícitamente como no remuneradas; una pausa ausente o de política ambigua requiere revisión y no se contabiliza como turno confirmado.
- Conservar precisión al minuto. Presentación decimal/HH:MM se define de forma consistente; las exportaciones deben incluir minutos o duración inequívoca.
- Cualquier cómputo con días festivos de jurisdicción, recargos o convenio es configurable y debe ser validado por la empresa; la app no ofrece asesoría legal.

### 5.4 Reconciliación

Para cada periodo, el total trabajado debe coincidir con la suma de segmentos trabajados tras excluir pausas. Cada minuto de trabajo pertenece a un solo día y servicio; puede pertenecer además a los subtotales nocturno y/o festivo. Los resúmenes mensuales y anuales se calculan desde los turnos fuente, no desde totales editables manualmente.

## 6. Modelo de datos conceptual

- **Employee**: `id`, `employee_code` (único), `first_name`, `last_name`, `active`, `notes`, `created_at`, `updated_at`.
- **Post/Service**: `id`, `name` (único), `municipality`, `province`, `active`, `created_at`, `updated_at`.
- **Shift**: `id`, `employee_id`, `service_id`, `start_at`, `end_at`, pausa(s), estado (`pending`/`confirmed`), tipo de origen, metadatos de color/plantilla revisados, `created_at`, `updated_at`. Solo turnos confirmados entran en informes.
- **Break**: `id`, `shift_id`, `start_at`, `end_at`, `paid` (configurable; valor inicial no remunerado para importes explícitos).
- **Holiday**: `id`, `date`, `name`, `scope`/nota opcional; unicidad de fecha y ámbito según regla elegida.
- **ImportBatch**: `id`, `filename`, `file_hash`, `imported_at`, estado, resultado/resumen de validación; almacenar solo lo necesario y evitar guardar rutas arbitrarias.
- **AppSettings**: zona horaria, franja nocturna, versión de reglas y preferencias locales.

Los totales son consultas derivadas y no se persisten como datos autoritativos. Guardar fechas/horas en una representación inequívoca y conservar la zona horaria configurada; fijar en implementación cómo se serializan y migran los datos horarios.

## 7. Arquitectura técnica recomendada

Diseño local, modular y pequeño; una aplicación local, sin microservicios ni servicios externos.

- **Interfaz inicial recomendada:** HTML/CSS/JavaScript ligero servido por FastAPI, sin paso de compilación, dado que el alcance es monousuario/local y no existe una base frontend previa. Mantener módulos de UI separados y diseñar el contrato de API para poder sustituir/ampliar la interfaz más adelante. Si se confirma crecimiento de UX/edición, migrar a React + TypeScript + Vite.
- **API/local backend:** Python + FastAPI. Centraliza validación, persistencia, reglas de negocio, cálculos e importación. La lógica horaria vive en funciones de dominio independientes de HTTP y UI.
- **Persistencia:** SQLite en un directorio de datos local configurable. Transacciones para importaciones y ediciones; claves foráneas e índices por empleado/fecha/servicio. Versionar el esquema y respaldar antes de una migración.
- **PDF:** extracción local mediante librería Python adecuada a PDFs textuales y tabulares. Hacer una prueba con documentos representativos antes de escoger/parser final; los diseños variables pueden requerir mapeo configurable por plantilla.
- **Ejecución:** iniciar backend y frontend compilado desde un comando/documentación local, enlazados solo a `localhost` por defecto. No publicar puertos a la red por defecto.
- **Futuro:** adaptador aislado para LM Studio (API local compatible con OpenAI, endpoint configurable), desactivado por defecto. Enviar documento/datos solo al servicio local explícitamente configurado, informar al usuario y exigir revisión humana del resultado.

### Separación lógica

1. **UI:** captura, navegación, validación inmediata y visualización.
2. **API:** contratos HTTP, mensajes de error claros, paginación/filtros si el volumen lo requiere.
3. **Dominio:** turnos, pausas, calendarios, segmentación por fecha, cálculo de totales y validaciones.
4. **Repositorios:** operaciones SQLite y transacciones.
5. **Importadores:** lectura PDF a filas normalizadas; no guardan datos finales directamente.

## 8. Contratos de API iniciales

Rutas orientativas; se refinan junto con la implementación:

- `GET/POST /api/employees`, `GET/PATCH /api/employees/{id}`
- `GET/POST /api/services`, `PATCH /api/services/{id}`
- `GET/POST /api/shifts`, `GET/PATCH/DELETE /api/shifts/{id}`
- `GET /api/reports/employee/{id}?from=YYYY-MM-DD&to=YYYY-MM-DD&service_id=...`
- `GET /api/reports/summary?year=YYYY&month=MM&service_id=...`
- `GET/POST /api/holidays`
- `POST /api/imports/csv/preview` para validar una carga tabular sin persistir turnos; `POST /api/imports/{id}/confirm` para confirmar explícitamente. Añadir XLSX/PDF en fases posteriores, una vez probadas plantillas reales.
- `GET /api/settings`, `PATCH /api/settings`.

Usar esquemas de petición/respuesta explícitos, IDs estables y errores validables (por ejemplo, solape o empleado desconocido). Limitar tamaño de archivos y validar tipo/contenido real, no confiar solo en la extensión.

## 9. UX y accesibilidad

- Estética sobria y profesional: fondo neutro, tipografía legible, jerarquía clara, acento de color único y estados semánticos.
- Pantalla principal: selector de periodo, servicio y filtros; cuadrante como área central; panel/resumen con horas y alertas.
- Ficha de empleado: identificación visible, navegación mensual/anual, desglose y lista de turnos.
- Estados vacíos útiles, mensajes de guardado/importación y errores accionables.
- Diseñar para teclado, foco visible, etiquetas de campos, contraste suficiente y lectores de pantalla. No depender exclusivamente del color para indicar festivos/errores.
- Confirmar acciones destructivas; ofrecer deshacer en edición cuando sea viable.
- Diseño adaptativo: cuadrante denso para escritorio/tablet; consulta y edición por empleado en móvil.

## 10. Privacidad, seguridad y fiabilidad

- Funcionamiento offline salvo configuración posterior explícita; no enviar datos a terceros ni incorporar telemetría en el MVP.
- Backend ligado a loopback; CORS limitado al origen local; validar todas las entradas también en servidor.
- Limitar tamaño de PDF, tratar archivos como no confiables, evitar ejecución de contenido, traversal de rutas y nombres de archivo como rutas.
- Mantener archivos en una carpeta local definida, explicar su ubicación y permitir borrarlos. No registrar datos personales ni contenido de PDF en logs innecesarios.
- SQLite: transacciones, integridad referencial, copia de seguridad/restauración probadas y mensajes claros ante disco lleno o base bloqueada.
- No incluir datos reales en fixtures, capturas, logs o repositorio. La copia de seguridad puede contener datos personales y debe avisarlo.

## 11. Rendimiento y capacidad

Uso esperado inicial: ~100 empleados; picos habituales de hasta 1.000 según evento; objetivo de crecimiento configurable hasta 5.000 empleados en plantilla. Mantener consultas mensuales/anuales de históricos. Medir el comportamiento con 1.000 filas activas y una prueba de capacidad con 5.000; no prometer rendimiento sin medir en equipo de referencia.

- Evitar recalcular toda la base por cada edición; actualizar el resumen afectado.
- Consultar con filtros/índices y paginar o virtualizar filas si la UI lo necesita.
- Medir carga, edición y consulta anual con datos sintéticos representativos antes de optimizar.
- Objetivo de aceptación inicial propuesto: apertura/consulta del cuadrante de prueba en menos de 2 segundos en el equipo de referencia; acordar equipo y volumen definitivo durante el prototipo.

## 12. Pruebas y criterios de aceptación

### Pruebas automatizadas

- Duración normal, cruce de medianoche, varios turnos diarios, pausas y validaciones de límites.
- Franja nocturna que cruza medianoche; turno que entra/sale de la franja; cálculo por minuto.
- Festivo a medianoche, fin de año/año nuevo, año bisiesto y cruce entre meses/años.
- Solape de turno/pausas, salida anterior ambigua, hora local ambigua/inexistente por cambio estacional.
- Coexistencia de hora nocturna y festiva sin duplicar total trabajado.
- Agregación mensual/anual y filtros por servicio/empleado.
- Importación: PDF válido, PDF vacío/no textual, campo desconocido, empleado no conciliado, duplicado, cancelación y confirmación transaccional.
- Copia de seguridad y restauración sobre una base de prueba.

### Aceptación funcional

1. Crear empleado, servicio y turno manual; recargar la app y comprobar que siguen guardados.
2. Editar y consultar cuadrante en escritorio y móvil sin perder la posibilidad de leer/corregir los turnos.
3. Buscar por ID y nombre, combinar filtros y ver desglose mensual y anual correcto.
4. Ver festivos señalados y verificar horas festivas/nocturnas de forma reproducible con ejemplos de referencia.
5. Importar un PDF textual, corregir la vista previa y confirmar; cancelar no altera datos.
6. Exportar CSV y verificar que los minutos, fechas, servicio e ID se conservan sin ambigüedad.
7. Ejecutar todas las operaciones sin conexión externa ni enviar datos a servicios remotos.
8. Alcanzar el objetivo de rendimiento acordado con el conjunto sintético de referencia.

## 13. Fases sugeridas

**Fase 0 — Validación de supuestos:** reunir CSV/XLSX/PDF anonimizados representativos, confirmar interpretación de pausas y leyenda de colores, cargar/revisar festivos de municipios valencianos y definir años históricos; comprobar extracción tabular. No conectar todavía LM Studio ni procesar escaneados.

**Fase 1 — MVP manual:** esquema SQLite, datos ficticios, empleados/servicios, cuadrante responsive, edición y validación de turnos, festivos configurables, búsquedas, informes y pruebas de cálculo.

**Fase 2 — Importación PDF:** extracción local, mapeo de columnas, previsualización, conciliación, duplicados, confirmación transaccional y trazabilidad; comenzar por formatos reales priorizados.

**Fase 3 — Operación diaria:** CSV, copias/restauración, afinado de rendimiento y accesibilidad con usuarios y datos sintéticos realistas.

**Fase 4 — IA local opcional:** integración con LM Studio para sugerir campos/filas de formatos difíciles. Mantener revisión humana obligatoria, cálculo determinista y modo manual disponible.

## 14. Decisiones pendientes antes de cerrar reglas

1. ¿Qué calendario oficial y municipio corresponden a cada puesto y año? Hay que revisar la carga de festivos locales de cada localidad valenciana.
2. ¿La pausa declarada en cada archivo es remunerada o no remunerada, y el archivo indica sus horas exactas? Sin esos datos, mantener el turno pendiente.
3. ¿Qué formatos/plantillas y códigos de color reales aparecen? Validar con muestras anonimizadas antes de automatizar mapeos.
4. ¿Cuántos años de historial y qué equipo de referencia deben cubrir las pruebas de capacidad?
5. ¿Cuánto tiempo deben conservarse los originales y los registros de importación? El MVP asume un usuario y un equipo local.

Las respuestas pueden ajustar valores y alcance sin cambiar el principio central: datos locales, cálculo verificable, importaciones revisables y mínima complejidad operativa.

## 15. Personalización acordada con el usuario

- **Operación:** un usuario en un equipo local; una oficina administrativa y cuadrantes de puestos de vigilancia en varias localidades de la Comunitat Valenciana.
- **Plantilla:** vigilantes de seguridad. Capacidad de partida para unos 100 empleados, picos operativos de hasta 1.000 y crecimiento deseado hasta 5.000 empleados; consultar históricos mensuales y anuales.
- **Hecho registrado:** horas realmente trabajadas tal como aparecen en el cuadrante recibido. No se solicita comparar planificado frente a realizado.
- **Turnos:** la estructura de entrada habitual es un turno por fila; admitir varios turnos por persona y día. La salida anterior a la entrada se propone como turno de día siguiente con confirmación explícita.
- **Puesto/servicio:** entidad que representa la instalación o ubicación donde presta servicio el vigilante. Cada puesto tiene municipio y provincia, porque la tabla puede asociar puesto por fila o mediante plantilla/color.
- **Noche:** franja inicial configurable 22:00–06:00; mostrar resultados en `HH:MM`, sin redondeo y conservando minuto exacto.
- **Festivos:** estatal + autonómico valenciano + local, aplicado según municipio del puesto. El fin de semana no es festivo por sí mismo. Mantener calendario local revisable; no depender de conexión externa ni asegurar exhaustividad sin validar el año y municipio.
- **Pausas:** usar la pausa explícita del archivo; no aplicar un descuento automático por duración. Si falta o no se puede determinar si es remunerada, el turno queda pendiente de revisión.
- **Colores:** en las plantillas, usar color para señalar puesto y/o nocturnidad/festivo. Guardar un mapa configurable por plantilla, mostrar siempre una leyenda textual y no inferir automáticamente sin revisión inicial.
- **Celdas blancas:** representan día sin turno; turnos y descansos como estados de calendario. Los códigos desconocidos no se interpretan como descanso automáticamente.
- **Importación:** objetivo CSV, XLSX y PDF digital tabular. PDF escaneado: OCR local en fase posterior, potencial ayuda LM Studio; revisión humana obligatoria. Filas/turnos no reconciliados o ambiguos van a una bandeja de pendientes.
- **Informes:** totales por empleado y puesto, detalle por turno y cuadrante imprimible; exportaciones deseadas CSV, XLSX y PDF. Solo turnos confirmados forman los totales principales; pendientes se muestran aparte y excluidos.
- **Recomendación operativa:** validar inicialmente plantillas anonimizadas reales y la leyenda de colores antes de automatizar su extracción; cargar/revisar calendarios locales por municipio y año; conservar trazabilidad del origen y no usar horas calculadas para nómina hasta validar las reglas aplicables con la empresa.

## 16. Decisiones de implementación para el primer incremento

Para evitar sobreingeniería en un repositorio inicialmente vacío, el primer incremento usará FastAPI, SQLite y una interfaz web ligera sin compilación de frontend. Implementará captura manual, cálculos, filtros e importación/exportación CSV con una cola de revisión; la arquitectura deja previsto el soporte XLSX/PDF y LM Studio, pero no presentará capacidades futuras como disponibles. La compatibilidad PDF/XLSX se ampliará una vez probada con ejemplos anonimizados de cada plantilla.

Las reglas de pausa (remunerada/no remunerada), hora/zona de cada puesto y calendarios municipales requieren confirmación operativa cuando se configuren; son requisitos pendientes, no valores que el software pueda deducir de forma segura.

