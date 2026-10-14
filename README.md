<div align="center">

<img src="assets/logo.svg" alt="MVSCS Private Dashboard" width="420">

# MVSCS Private Dashboard

### Panel local de cuadrantes y horas · **MED Vigilantes Castellón**

**Registra turnos, importa cuadrantes y calcula horas nocturnas y festivas sin enviar nada fuera de tu equipo.**

[Inicio rápido](#-inicio-rápido) · [Modo de uso](#-modo-de-uso) · [Importación](#-importación) · [Festivos](#-festivos-oficiales) · [Estructura](#-estructura-del-proyecto)

</div>

---

## ¿Qué es?

Una aplicación **100 % local** (FastAPI + SQLite + HTML/CSS/JS) para equipos de seguridad privada. Todo ocurre en tu ordenador: no hay cuentas, ni nube, ni telemetría. La base se guarda en `data/quadrants.sqlite3`.

- Panel mensual y anual con horas trabajadas, **nocturnas** y **festivas** en `HH:MM`.
- Empleados y **puestos** con municipio y provincia.
- Registro manual de turnos (varios al día, cruce de medianoche, pausas remuneradas/no remuneradas).
- **Importación** de CSV, Excel (`.xlsx`/`.xlsm`) y PDF digital, o de un **resumen mensual**.
- Bandeja de **revisión** y **unificación de duplicados**.
- **Festivos oficiales** estatales y autonómicos precargados (Comunitat Valenciana 2025–2026).
- Interfaz responsive servida por la propia app.

## Inicio rápido

### 1. Descargar

```bash
git clone https://github.com/yosoyignicion/MVSCS.git
cd MVSCS
```

O descarga el ZIP desde <https://github.com/yosoyignicion/MVSCS> → **Code ▸ Download ZIP** y descomprímelo.

### 2. Requisitos

Solo necesitas **Python 3.10 o superior**. El iniciador instala el resto la primera vez.

### 3. Abrir la app (iniciador con logotipo)

| Sistema | Cómo |
|---|---|
| **Windows** | Doble clic en `launcher\launch.bat` |
| **macOS** | Doble clic en `launcher/launch.command` |
| **Linux** | `python3 launcher/launch.py` — o crea un acceso directo en el menú con `bash launcher/install_desktop.sh` |
| **Cualquiera** | `python launcher/launch.py` |

Se abre una **ventana con el logo** que arranca el servidor y te lleva al navegador en `http://127.0.0.1:8000/`. Al pulsar **Cerrar** se detiene todo. Si el puerto 8000 está ocupado, el iniciador usa el siguiente libre.

> ¿Prefieres hacerlo a mano? `pip install -r requirements.txt` y luego `uvicorn main:app --host 127.0.0.1 --port 8000`.

## Modo de uso

### Resumen del panel

Al abrir verás el panel con los totales del periodo, la actividad y la zona de importación.

![Panel de resumen](docs/img/01-panel.png)

### 1. Importación (automática, con revisión)

Arrastra un archivo a la zona **Importar cuadrante** (o usa *Seleccionar archivo*). La app:

1. Lee el archivo y detecta el formato (CSV, Excel o PDF) **validando la firma real**, no solo la extensión.
2. **Auto-crea** el empleado (por ID) y el puesto (por nombre + municipio) que falten.
3. Deja los turnos válidos **pendientes de confirmar** y las filas dudosas en **Por revisar**.
4. Guarda los **resúmenes mensuales** aparte (no suman a las métricas de turnos).

Formatos y separadores admitidos: CSV con `,` o `;` (se detecta solo), Excel (primera hoja) y PDF digital con tabla. Ver detalles en [`docs/importacion.md`](docs/importacion.md).

### 2. Revisión manual

En **Por revisar** corriges lo dudoso (empleado, puesto, horario, pausa) y confirmas. Nada entra en los informes hasta confirmarlo.

![Pantalla de revisión](docs/img/03-revision.png)

Si el mismo **nombre** aparece con **IDs distintos**, la app lo detecta y lo muestra en **Posibles duplicados** para que un humano decida **unificar**.

### 3. Modificación y consulta

El **Cuadrante** muestra los turnos confirmados; puedes editar un turno confirmado o exportar el periodo a CSV.

![Cuadrante](docs/img/02-cuadrante.png)

### 4. Empleados y puestos

![Empleados](docs/img/05-empleados.png)

### 5. Puestos y festivos

Cada puesto tiene municipio y provincia. Los festivos se aplican **por municipio del puesto**.

![Puestos y festivos](docs/img/04-puestos-festivos.png)

## Importación

Encabezados preferidos (admiten alias en español e inglés):

```csv
id,puesto,municipio,provincia,fecha,entrada,salida,pausa inicio,pausa fin,pausa remunerada
VS-1042,Edificio principal,València,Valencia,2026-04-10,22:00,06:00,01:00,01:30,no
```

- La fecha es el día de **entrada**; una salida anterior se interpreta como el día siguiente.
- Con pausa, `pausa remunerada` debe ser explícita (`sí`/`no`).
- **Resumen mensual** (formato alternativo): `id;nombre;mes;horas totales` — p. ej. `SEG-001;Álvaro Castro;2026-07;200`. Se guarda aparte.

## Festivos oficiales

La app **precarga** los festivos **estatales y autonómicos** (Comunitat Valenciana 2025–2026) y, para **2026**, los **locales de Castelló de la Plana** (Fiestas de la Magdalena y San Pedro), todo para `Castelló de la Plana`. Los locales de 2025 y de otros municipios se añaden o revisan a mano en **Puestos ▸ Festivos por municipio**.

Fuentes oficiales si necesitas verificarlos:

- **Estatales**: [BOE](https://www.boe.es) — calendario laboral anual (Resolución de la Dirección General de Trabajo).
- **Autonómicos (Comunitat Valenciana)**: [DOGV / Generalitat Valenciana](https://dogv.gva.es) — resolución de fiestas laborales del Consell.
- **Locales de Castelló de la Plana**: [Ajuntament de Castelló](https://www.castello.es) y el *Boletín Oficial de la Provincia de Castellón* (BOP).

La app no descarga de Internet en tiempo de ejecución; la precarga es offline e idempotente y **no certifica** que el calendario esté completo.

## Uso responsable

Esto es una herramienta de **registro y cálculo**, no un sistema de nómina ni una interpretación de convenio. Verifica festivos, pausas y municipios. Los informes solo suman turnos **confirmados**.

## Estructura del proyecto

```text
main.py                 Backend completo (FastAPI + SQLite + reglas + importadores)
static/                 Interfaz (HTML/CSS/JS sin framework)
assets/                 Logotipo e iconos (SVG/PNG/ICO)
launcher/               Iniciador multiplataforma (ventana con logo)
tests/test_app.py       Pruebas de API y reglas de cálculo
docs/                   Documentación y capturas de ejemplo
data/                   Base local y registro (no se versiona)
requirements.txt        Dependencias
```

## Desarrollo y pruebas

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python3 -m pytest -q            # pruebas
python3 -m py_compile main.py   # compila el backend
node --check static/app.js      # revisa el JS
```

## Licencia

MIT — consulta [`LICENSE`](LICENSE).
