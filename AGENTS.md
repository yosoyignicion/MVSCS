# AGENTS.md

## Propósito

Mantener el gestor **local** de cuadrantes y horas de seguridad privada. Priorizar cálculos correctos, datos trazables, revisión humana y cambios pequeños. El alcance y las decisiones de negocio están en [`spec.md`](spec.md); las guías operativas en [`docs/`](docs/).

## Mapa del proyecto

- `main.py`: **todo** el backend (FastAPI + SQLite + reglas horarias + importadores CSV/Excel/PDF). `create_app(db_path=None)` es la fábrica; `app = create_app()` al final del módulo inicializa `data/quadrants.sqlite3` al importar y **sincroniza los festivos oficiales** (ya no siembra datos ficticios).
- `static/index.html`, `static/styles.css`, `static/app.js`: interfaz sin framework servida por la misma app. No es autoridad de negocio.
- `tests/test_app.py`: API y reglas de cálculo con `TestClient` y base temporal.
- `data/quadrants.sqlite3`: base local (gitignored); nunca versionar datos de usuarios.
- `docs/`: `arquitectura.md`, `calculos-y-datos.md`, `importacion.md`, `operacion-y-seguridad.md`.

## Comandos

No hay `requirements.txt`/`pyproject` ni config de lint/typecheck/CI: las dependencias se instalan a mano.

```bash
python3 -m venv .venv && source .venv/bin/activate
python -m pip install fastapi uvicorn python-multipart openpyxl pymupdf pytest httpx  # httpx lo exige TestClient
uvicorn main:app --host 127.0.0.1 --port 8000                                        # http://127.0.0.1:8000/
```

`openpyxl` lee Excel y `pymupdf` (import `fitz`) PDF; ambas se importan de forma perezosa dentro de sus lectores, así que la app arranca sin ellas hasta que se importa un archivo de ese tipo.

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
- **Festivos oficiales precargados** (estatales + Comunitat Valenciana 2025–2026) para `DEFAULT_MUNICIPALITY = "Castelló de la Plana"`, vía `sync_official_holidays()` en `initialize()` (idempotente con `INSERT OR IGNORE`). Incluye los **locales de Castelló 2026** (Magdalena 9-mar, San Pedro 29-jun); los locales de 2025 y de otros municipios se añaden/revisan a mano.
- **Horas naive en `Europe/Madrid`**. `parse_local` rechaza horas locales inexistentes/ambiguas por cambio horario y exige precisión de minuto. Franja nocturna 22:00–06:00 (constantes dentro de `shift_metrics`).
- **Import**: formatos CSV, Excel `.xlsx/.xlsm` y PDF digital con tabla, ≤10 MB, detectados por extensión y **validando la firma real** (zip/`%PDF`). CSV = coma o `;` (autodetectado) + UTF-8 (BOM ok); Excel = primera hoja; PDF = tabla con más filas. La **exportación** `GET /api/exports/shifts.csv` usa `;` + BOM (distinto del import). Rutas: `POST /api/imports/preview` y `/api/imports/confirm` (alias `csv/preview`, `csv/confirm`).
- La normalización de filas es compartida (`normalize_rows` + `IMPORT_ALIASES`); añade nuevos lectores devolviendo `list[dict[str,str]]` y reutiliza el mismo pipeline y la cola de revisión. El preview **no escribe**; la creación va en `/api/imports/confirm`.
- **La importación auto-crea** el empleado (por `code`) y el puesto (por nombre + municipio) que no existan; el municipio por defecto es `DEFAULT_MUNICIPALITY`. Lo que aún falle (fechas/pausa vacías, etc.) va a `review_items`.
- **Resumen mensual** (columnas `mes` + `horas totales`): `normalize_rows` lo detecta por `kind="summary"` y se guarda en la tabla `monthly_summaries`. **No son turnos**: no entran en `/api/reports.totals` (aparecen en `reports.summaries`). Formato `;`/`,` y mes en `YYYY-MM` o nombre (es/en) + año.
- Con pausa, `break_paid` debe ser explícito (manual: obligatorio; CSV: `sí/no`).
- Solo turnos `status='confirmed'` entran en `/api/reports`; pendientes y `review_items` quedan excluidos. `end_at <= start_at` se rechaza (CHECK + validación).
- **`POST /api/shifts` inserta el turno ya `confirmed`** (origen `manual`); los importados entran como `pending` y solo pasan a contar con `POST /api/shifts/{id}/confirm`. `PATCH /api/shifts/{id}` solo edita confirmados; `DELETE /api/shifts/{id}` solo descarta pendientes.
- Los puestos se concilian por **nombre y municipio**.

## Reglas de trabajo

1. Lee `spec.md` y el doc pertinente antes de tocar reglas de horas o formatos de importación.
2. Sin servicios externos: nada de telemetría, red, IA ni dependencias nuevas sin aprobación.
3. Los informes se calculan desde turnos **confirmados**; lo pendiente/dudoso nunca se suma en silencio.
4. No deduzcas convenio, pausas, festivos locales ni significado de colores: valida o deja el registro en revisión.
5. Nocturnas y festivas son subtotales superpuestos; no duplican el total. Precisión al minuto, `HH:MM` en la interfaz.
6. Mantén Python/FastAPI/SQLite y JS/CSS/HTML sin framework; evita capas, servicios o paquetes si una función pequeña basta.
7. Valida en backend; la validación de UI no sustituye la del servidor. No confíes en nombre/extensión del archivo ni en campos del navegador.
8. Datos sensibles: usa fixtures ficticios; no copies cuadrantes reales a pruebas, logs, capturas ni docs.
9. Para cálculos nuevos, añade primero pruebas de medianoche, pausa, franja nocturna, festivo, filtros/periodos y transiciones horarias.
10. Actualiza README/docs al cambiar interfaces, reglas, rutas, comandos o límites; no documentes como existente lo que solo está planificado.

## Iniciador y empaquetado

- `launcher/launch.py` (multiplataforma) arranca uvicorn, muestra una ventana Tkinter con `assets/icon.png` y abre el navegador; `launcher/launch.bat`/`.command` y `launcher/install_desktop.sh` son envoltorios por SO. `launcher/build_icons.py` regenera iconos (requiere Pillow). No requiere dependencias nuevas en runtime.
- Repo remoto: `https://github.com/yosoyignicion/MVSCS.git` (rama `main`). No se versionan `data/` (salvo `.gitkeep`), `.engram/`, `*.sqlite3` ni importaciones/exportaciones.

## Cambios de datos y archivos

- Para probar usa base temporal bajo pytest o `SHIFTS_DB_PATH`; nunca la base local.
- No confirmes entornos, bases, originales PDF/CSV/XLSX, exportaciones, cachés ni bytecode.
- Cambios de esquema: migración explícita dentro de `initialize()` (`ALTER TABLE` condicionado como `break_paid`) **y** una prueba que conserve los datos existentes.
