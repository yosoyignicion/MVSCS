# Arquitectura del MVP

## Decisión

Una aplicación local monolítica y pequeña: FastAPI entrega la interfaz, expone endpoints JSON y aplica reglas; SQLite persiste los datos. La UI usa HTML, CSS y JavaScript nativo. No hay compilación frontend, microservicios ni conexión externa.

Esta elección reduce pasos de instalación para el uso monousuario y coincide con el repositorio actual. La futura adopción de React o LM Studio se mantiene como opción, no como dependencia del MVP.

## Mapa de responsabilidades

```text
Navegador
  ├── static/index.html      estructura y formularios
  ├── static/styles.css      estilos responsive
  └── static/app.js          vistas, eventos y llamadas fetch
             │ HTTP local / JSON
             ▼
main.py · FastAPI
  ├── contratos Pydantic y validación
  ├── endpoints de empleados, puestos, turnos, festivos e informes
  ├── cálculo de intervalos y agregaciones
  ├── parser / preview / confirmación de CSV
  └── SQLite (data/quadrants.sqlite3 por defecto)
```

- `main.py`: composición de la app, modelo SQLite inicial, carga de festivos oficiales, validación, cálculo y endpoints. Las funciones de cálculo/parser se mantienen como funciones Python invocables en pruebas.
- `static/`: interfaz. No debe ser autoridad para las reglas de negocio; el backend valida y vuelve a calcular.
- `tests/test_app.py`: verificaciones del comportamiento mediante `TestClient` y base temporal.
- `spec.md`: alcance y decisiones de negocio más amplias que el código implementado.

## Persistencia

SQLite usa las tablas `employees`, `posts`, `shifts`, `holidays`, `review_items` y `monthly_summaries`; hay índices para fecha, empleado, puesto y estado. La app crea el esquema al iniciar, adapta la adición de `break_paid` si abre una base previa y sincroniza los festivos oficiales (idempotente). La ubicación puede elegirse con `SHIFTS_DB_PATH`.

No se persisten totales agregados de turnos como autoridad: los informes derivan de turnos confirmados y del calendario de festivos. Los resúmenes mensuales importados (`monthly_summaries`) se guardan aparte y no se mezclan con esas métricas.

## Interfaces HTTP implementadas

| Ruta | Responsabilidad |
|---|---|
| `GET /` y `/static/*` | Interfaz local |
| `GET /api/health` | Readiness simple |
| `GET/POST /api/employees` | Consultar/crear empleados |
| `GET/POST /api/posts` | Consultar/crear puestos y municipios |
| `GET/POST /api/shifts` | Consultar/crear turnos |
| `PATCH /api/shifts/{id}` | Editar turno confirmado |
| `POST /api/shifts/{id}/confirm` | Confirmar turno importado pendiente |
| `DELETE /api/shifts/{id}` | Descartar solo un turno pendiente |
| `GET/POST/DELETE /api/holidays` | Festivos (estatales/autonómicos precargados + locales manuales) |
| `GET/DELETE /api/monthly-summaries` | Listar/eliminar resúmenes mensuales importados |
| `GET /api/reports` | Totales mensual/anual, por empleado/puesto o agregados diarios (+ `summaries`) |
| `GET /api/review` | Listar registros pendientes y filas con incidencias |
| `POST /api/review/{id}/resolve`, `DELETE /api/review/{id}` | Corregir o descartar fila ambigua |
| `POST /api/imports/preview` | Validar CSV/Excel/PDF sin escribir nada (alias `csv/preview`) |
| `POST /api/imports/confirm` | Auto-crear empleados/puestos, guardar turnos `pending` y resúmenes; filas erróneas a cola (alias `csv/confirm`) |
| `GET /api/exports/shifts.csv` | Exportar turnos confirmados en CSV |

Los endpoints de API interactúan con SQLite directamente dentro de `main.py`. Si la lógica crece, separar módulos de dominio/repositorios cuando la división reduzca duplicación real; no crear capas vacías de antemano.

## Límites conocidos

- No hay autenticación: loopback no equivale a control de acceso. No exponer el puerto a una red compartida.
- El importador acepta CSV, Excel (.xlsx/.xlsm) y PDF digital con tabla. PDF escaneado/OCR, comprensión de colores y LM Studio aún no existen.
- Festivos estatales y autonómicos (Comunitat Valenciana 2025–2026) se precargan para Castelló de la Plana; los **locales** y los puestos se mantienen manualmente. La app no descarga calendarios de Internet en tiempo de ejecución.
- La bandeja de revisión cubre filas dudosas y turnos importados pendientes; no es un sistema completo de auditoría/versionado.
- No se ofrece restauración de copias, exportación XLSX/PDF ni informes de nómina.
