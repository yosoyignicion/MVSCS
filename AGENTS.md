# AGENTS.md

## Propósito

Mantener el gestor **local** de cuadrantes y horas de seguridad privada. Priorizar cálculos correctos, datos trazables, revisión humana y cambios pequeños. El alcance y las decisiones de negocio están en [`spec.md`](spec.md); las guías operativas en [`docs/`](docs/).

## Mapa del proyecto

- `main.py`: **todo** el backend (FastAPI + SQLite + reglas horarias + importadores de texto tabular/Excel/ODS/PDF). La entidad de ubicación se llama **centro** en la interfaz; internamente conserva la tabla y rutas `posts`. `create_app(db_path=None)` es la fábrica; `app = create_app()` al final del módulo inicializa `data/quadrants.sqlite3` al importar y **sincroniza los festivos oficiales** (ya no siembra datos ficticios).
- `static/index.html`, `static/styles.css`, `static/app.js`: interfaz sin framework servida por la misma app. No es autoridad de negocio.
- `tests/test_app.py`: API y reglas de cálculo con `TestClient` y base temporal.
- `data/quadrants.sqlite3`: base local (gitignored); nunca versionar datos de usuarios.
- `docs/`: `arquitectura.md`, `calculos-y-datos.md`, `importacion.md`, `operacion-y-seguridad.md`.

## Comandos

Existe `requirements.txt`; no hay `pyproject` ni config de lint/typecheck/CI.

```bash
python3 -m venv .venv && source .venv/bin/activate
python -m pip install fastapi uvicorn python-multipart openpyxl xlrd pymupdf pytest httpx  # httpx lo exige TestClient
uvicorn main:app --host 127.0.0.1 --port 8000                                        # http://127.0.0.1:8000/
```

`openpyxl` lee `.xlsx/.xlsm`, `xlrd` lee `.xls`, `pymupdf` (import `fitz`) lee PDF y el lector ODS usa `zipfile` + XML estándar. Se importan de forma perezosa dentro de sus lectores; la app arranca sin ellos hasta que se necesita ese formato.

Verificación (esto es todo lo disponible):

```bash
python3 -m pytest -q
python3 -m pytest -q tests/test_app.py::test_manual_shift_night_break_and_month_aggregation  # prueba única
python3 -m py_compile main.py
node --check static/app.js
```

Para cambios visuales arranca Uvicorn y prueba el flujo en el navegador; que compile no basta.

FastAPI se crea con `docs_url=None, redoc_url=None`: **no hay `/docs` ni `/redoc`**; el listado de rutas está en `docs/arquitectura.md` o en el propio `main.py`. `tests/test_app.py` genera sus propios `.xlsx` (openpyxl) y `.pdf` (fitz) en memoria: **no añadas fixtures binarios** (`.gitignore` solo deja pasar `tests/fixtures/*.csv`).

## Detalles que un agente suele malinterpretar

- **Import de `main` inicializa la DB real y carga los festivos oficiales** (`app = create_app()`), sin datos ficticios. En pruebas usa `create_app(tmp_path / "x.sqlite3")`; para otra ruta usa `SHIFTS_DB_PATH`. Nunca borres `data/quadrants.sqlite3` para "reiniciar".
- **Festivos oficiales** generados por reglas desde 2025 hasta cinco años vista: nacionales y autonómicos replicados a todos los municipios con centros; locales de Castelló (Magdalena = Pascua−27 días; San Pedro 29-jun trasladado al lunes si cae domingo). `sync_official_holidays()` es idempotente y respeta `dismissed_holidays` para que un borrado no reaparezca.
- **Horas naive en `Europe/Madrid`**. `parse_local` rechaza horas locales inexistentes/ambiguas por cambio horario y exige precisión de minuto. Franja nocturna 22:00–06:00 (constantes dentro de `shift_metrics`).
- **Import**: cualquier texto tabular (UTF-8/UTF-16/Windows-1252/Latin-1; `, ; tab |` o columnas separadas por espacios), Excel `.xlsx/.xlsm/.xls` (elige hoja y fila de encabezados, combina hojas válidas), ODS (`content.xml`, filas/columnas repetidas) y PDF digital (tablas o texto alineado), ≤10 MB y máx. 5000 filas. La detección es por **contenido real**, no por extensión. La **exportación** ofrece `GET /api/exports/shifts.xlsx` (recomendado) y `.csv` (`;` + BOM). Rutas: `POST /api/imports/preview` y `/api/imports/confirm`.
- La normalización de filas es compartida (`normalize_rows` + `IMPORT_ALIASES` + `canonical_header`); añade nuevos lectores devolviendo `list[dict[str,str]]` y reutiliza el mismo pipeline y la cola de revisión. `parse_schedule_range` interpreta columnas `Horario` (simple o partido) y `split_code_name` separa `ID - Nombre`. El preview **no escribe**; la creación va en `/api/imports/confirm`.
- **La importación auto-crea** el empleado (por `code`) y el centro (por `post_code`/nombre + municipio por defecto) que no existan; el municipio por defecto es `DEFAULT_MUNICIPALITY`. Lo que aún falle (fechas/espacio libre vacíos, etc.) va a `review_items`.
- **Resumen mensual** (columnas `mes` + `horas totales`, sin columnas de turno): `normalize_rows` lo detecta por `kind="summary"` y se guarda en `monthly_summaries`. **No son turnos** y se corrigen desde Por revisar con `POST /api/review/{id}/resolve-summary` (no crean turnos). Formato `;`/`,` y mes en `YYYY-MM`, `MM/YYYY` o nombre (es/en) + año.
- **Espacios libres**: la UI usa los campos `break_start_at`/`break_end_at` con `break_paid=0` para restar tiempo no trabajado. Deben quedar dentro del turno. Los campos `second_start_at`/`second_end_at` y pausas históricas se conservan por compatibilidad.
- **Repetición manual**: `POST /api/shifts` acepta `repeat_mode` (`none|daily|weekdays|weekly|custom`) y `repeat_until` o `repeat_dates` (máx. 366 días); crea ocurrencias con el mismo horario, omite duplicados exactos y devuelve `created`/`skipped`.
- Solo turnos `status='confirmed'` entran en `/api/reports`; pendientes y `review_items` quedan excluidos. `end_at <= start_at` se rechaza (CHECK + validación).
- **`POST /api/shifts` inserta el turno ya `confirmed`** (origen `manual`); los importados entran como `pending` y solo pasan a contar con `POST /api/shifts/{id}/confirm`. `PATCH /api/shifts/{id}` edita confirmados y pendientes; `DELETE /api/shifts/{id}` solo descarta pendientes.
- Los centros tienen **código visible único** (`posts.code`) y se concilian por código y, si falta, por **nombre + municipio**. Empleados/centros se **desactivan** (`active=0`) al eliminarlos para conservar turnos históricos; al recrear el mismo código/nombre se reactivan.
- `PATCH /api/shifts/{id}` edita turnos **confirmados y pendientes** (los pendientes siguen pendientes hasta confirmarlos).

## Reglas de trabajo

1. Lee `spec.md` y el doc pertinente antes de tocar reglas de horas o formatos de importación.
2. Sin servicios externos: nada de telemetría, red, IA ni dependencias nuevas sin aprobación.
3. Los informes se calculan desde turnos **confirmados**; lo pendiente/dudoso nunca se suma en silencio.
4. No deduzcas convenio, pausas históricas, festivos locales ni significado de colores: valida o deja el registro en revisión.
5. Nocturnas y festivas son subtotales superpuestos; no duplican el total. Precisión al minuto, `HH:MM` en la interfaz.
6. Mantén Python/FastAPI/SQLite y JS/CSS/HTML sin framework; evita capas, servicios o paquetes si una función pequeña basta.
7. Valida en backend; la validación de UI no sustituye la del servidor. No confíes en nombre/extensión del archivo ni en campos del navegador.
8. Datos sensibles: usa fixtures ficticios; no copies cuadrantes reales a pruebas, logs, capturas ni docs.
9. Para cálculos nuevos, añade primero pruebas de medianoche, espacio libre, franja nocturna, festivo, filtros/periodos y transiciones horarias.
10. Actualiza README/docs al cambiar interfaces, reglas, rutas, comandos o límites; no documentes como existente lo que solo está planificado.

## Iniciador y empaquetado

- `launcher/launch.py` (multiplataforma) arranca uvicorn, muestra una ventana Tkinter con `assets/icon.png` y abre el navegador; en Windows `launch.bat` usa `pythonw` (también existe `launch.pyw`) para no dejar consola abierta; `launcher/launch.bat`/`.command` y `launcher/install_desktop.sh` son envoltorios por SO. `launcher/build_icons.py` regenera iconos (requiere Pillow). No requiere dependencias nuevas en runtime.
- Repo remoto: `https://github.com/yosoyignicion/MVSCS.git` (rama `main`). No se versionan `data/` (salvo `.gitkeep`), `.engram/`, `*.sqlite3` ni importaciones/exportaciones.

## Cambios de datos y archivos

- Para probar usa base temporal bajo pytest o `SHIFTS_DB_PATH`; nunca la base local.
- No confirmes entornos, bases, originales PDF/CSV/XLSX, exportaciones, cachés ni bytecode.
- Cambios de esquema: migración explícita dentro de `initialize()` (`ALTER TABLE` condicionado como `break_paid`) **y** una prueba que conserve los datos existentes.
