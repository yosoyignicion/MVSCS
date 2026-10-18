<div align="center">

<img src="assets/logo.svg" alt="Centro de administración de personal de seguridad privada" width="480">

# Centro de administración de personal de seguridad privada

### Gestión local de centros, turnos y horas · **Seguridad privada**

**Registra turnos, importa cuadrantes y calcula horas nocturnas y festivas sin enviar nada fuera de tu equipo.**

[Inicio rápido](#-inicio-rápido) · [Modo de uso](#-modo-de-uso) · [Importación](#-importación) · [Festivos](#-festivos-oficiales) · [Estructura](#-estructura-del-proyecto)

</div>

---

## ¿Qué es?

Una aplicación **100 % local** (FastAPI + SQLite + HTML/CSS/JS) para equipos de seguridad privada. Todo ocurre en tu ordenador: no hay cuentas, ni nube, ni telemetría. La base se guarda en `data/quadrants.sqlite3`.

- Panel mensual y anual con horas trabajadas, **nocturnas** y **festivas** en `HH:MM`; los espacios libres restan del total.
- **Panel lateral comprimible** con persistencia, navegación accesible y una interfaz de estilo premium.
- Empleados y **centros** con **ID y nombre** (provincia de Castellón por defecto), **editables y eliminables** sin perder el histórico. El municipio ya no se solicita en la interfaz.
- Registro manual de turnos (varios al día, cruce de medianoche y **espacios libres** opcionales que se descuentan) y **repetición automática**: diaria, lunes a viernes, mismo día de la semana o **días concretos esporádicos**.
- **Importación** de cualquier texto tabular (CSV/TSV/TXT), Excel (`.xlsx`/`.xlsm`/`.xls`), ODS de LibreOffice y PDF digital, o de un **resumen mensual**.
- Bandeja de **revisión** y **unificación de duplicados**.
- **Vista Excel** editable en línea y **exportación XLSX/CSV** del periodo, con fechas comentadas (`Lun 19 oct`).
- **Festivos oficiales** estatales, autonómicos y locales de Castelló generados por reglas hasta cinco años vista; se marcan en el cuadrante, se avisan al crear turnos y los descartes son duraderos.
- **Revisión** de turnos pendientes, filas dudosas y **resúmenes mensuales** (sin convertirlos en turnos).
- Interfaz responsive servida por la propia app, sin datos de ejemplo: la base arranca limpia.

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
| **Windows** | Doble clic en `launcher\launch.bat` (o `launcher\launch.pyw`) |
| **macOS** | Doble clic en `launcher/launch.command` |
| **Linux** | `python3 launcher/launch.py` — o crea un acceso directo en el menú con `bash launcher/install_desktop.sh` |
| **Cualquiera** | `python launcher/launch.py` |

Se abre una **ventana con el logo** que arranca el servidor y te lleva al navegador en `http://127.0.0.1:8000/`. Al pulsar **Cerrar** se detiene todo. Si el puerto 8000 está ocupado, el iniciador usa el siguiente libre. En Windows el `.bat` arranca con `pythonw`, así que **no queda una consola abierta**; en macOS el `.command` cierra la Terminal. Si algo falla, revisa `data/launcher.log`.

> ¿Prefieres hacerlo a mano? `pip install -r requirements.txt` y luego `uvicorn main:app --host 127.0.0.1 --port 8000`.

## Modo de uso

### Resumen del panel

Al abrir verás el panel con los totales del periodo, la actividad y la zona de importación.

![Panel de resumen](docs/img/01-panel.png)

### 1. Importación (automática, con revisión)

Arrastra un archivo a la zona **Importar cuadrante** (o usa *Seleccionar archivo*). La app:

1. Lee el archivo y detecta el formato por **contenido real** (texto tabular, Excel, ODS o PDF), sin fiarse de la extensión.
2. **Auto-crea** el empleado (por ID) y el centro (por ID o nombre) que falten.
3. Deja los turnos válidos **pendientes de confirmar** y las filas dudosas en **Por revisar**.
4. Guarda los **resúmenes mensuales** aparte (no suman a las métricas de turnos).

Formatos admitidos: texto tabular (`, ; tab |` o columnas separadas por espacios; UTF-8/UTF-16/Windows-1252/Latin-1), Excel (`xlsx/xlsm/xls`; se elige la hoja y la fila de encabezados aunque haya títulos), ODS y PDF digital con tabla o texto alineado. Los encabezados se reconocen por alias y variantes (`TOTAL HORAS MES`, `Nº Empleado`, `Centro de trabajo`...); también se admite una columna `Horario` (`08:00-16:00` o partido) y celdas compuestas `ID - Nombre`. Si falta el ID de empleado, se concilia por nombre único. Se combinan hojas/tablas válidas y el límite es de 5000 filas. Ver detalles en [`docs/importacion.md`](docs/importacion.md).

### 2. Revisión manual

En **Por revisar** corriges lo dudoso (empleado, centro, horario y espacios libres) y confirmas. Los turnos pendientes se pueden **editar antes de confirmar**, y los **resúmenes mensuales** con errores tienen su propio editor (empleado, mes y horas) sin convertirse en turnos. Nada entra en los informes hasta confirmarlo.

![Pantalla de revisión](docs/img/03-revision.png)

Si el mismo **nombre** aparece con **IDs distintos**, la app lo detecta y lo muestra en **Posibles duplicados** para que un humano decida **unificar**.

### 3. Modificación y consulta

Al registrar un turno puedes **repetirlo** todos los días, solo de lunes a viernes, el mismo día de la semana hasta una fecha final o en **días concretos** seleccionados a mano. La app muestra cuántos turnos se crearán, admite hasta 366 días y evita duplicar turnos idénticos. Si la fecha coincide con un festivo del centro, el formulario lo avisa antes de guardar.

El **Cuadrante** muestra los turnos confirmados; puedes editar un turno, **exportar el periodo a Excel o CSV** o cambiar a **Vista Excel** para edición rápida en una tabla compacta. Los turnos que caen en festivo se marcan con una etiqueta y sus horas festivas se calculan automáticamente. Las fechas se muestran comentadas con el día de la semana y el número del día (`Dom 18 oct`), y la vista Excel sigue el orden habitual de trabajo (fecha, nombre, centro, horario, espacios libres, duración, noches y festivas). Desde la misma tabla puedes seleccionar turnos (uno o varios) y **enviarlos a revisión**: dejan de sumar en los totales hasta que los confirmes de nuevo.

![Cuadrante](docs/img/02-cuadrante.png)

Vista Excel para edición rápida, con la fecha comentada y las columnas habituales de trabajo:

![Vista Excel](docs/img/06-vista-excel.png)

### 4. Empleados y centros

Cada empleado y cada centro se pueden **editar o eliminar** desde su tarjeta. Al eliminar, los turnos y resúmenes históricos se conservan; si vuelves a crear el mismo ID o centro, se reactiva.

![Empleados](docs/img/05-empleados.png)

### 5. Centros y festivos

Cada centro se identifica por **ID y nombre** y puede editarse o retirarse de la operación activa. La provincia es Castellón y el municipio no se solicita; los festivos se aplican por el municipio por defecto (`Castelló de la Plana`). Si descartas un festivo, no reaparece al reiniciar.

![Centros y festivos](docs/img/04-puestos-festivos.png)

## Importación

Encabezados preferidos (admiten alias en español e inglés):

```csv
id,id centro,centro,fecha,entrada,salida,espacio libre desde,espacio libre hasta
VS-1042,C-01,Edificio principal,2026-04-10,08:00,20:00,14:00,16:00
```

- La fecha es el día de **entrada**; una salida anterior se interpreta como el día siguiente. Si la salida trae fecha completa, se respeta y se rechazan turnos de más de 24 h.
- Se acepta cualquier texto tabular con `,`, `;`, tabulador, `|` o columnas separadas por dos o más espacios; UTF-8/UTF-16/Windows-1252/Latin-1; y fechas `YYYY-MM-DD`, `YYYYMMDD`, `DD/MM/YYYY` o serial de Excel. En Excel/ODS se detectan la hoja y la fila de encabezados aunque haya títulos delante; en PDF se combinan las tablas o se interpreta el texto alineado.
- Los **espacios libres** son opcionales: se indican desde/hasta dentro del turno y sus horas **se descuentan**. Los antiguos campos de pausa y segundo tramo se siguen aceptando para importar históricos.
- **Resumen mensual** (formato alternativo): `id;nombre;mes;horas totales` — p. ej. `SEG-001;Álvaro Castro;2026-07;200`. Se guarda aparte y se corrige desde **Por revisar**.

**Exportación**: el selector `Exportar` ofrece Excel (`.xlsx`) y CSV. El Excel es el formato recomendado: reproduce la vista de trabajo habitual (fecha comentada con día de la semana, nombre, ID y nombre del centro, horario, espacios libres, duración, noches y festivas) y puede volver a importarse. Ambos formatos respetan el periodo y el centro seleccionados e incluyen el ID del centro.

## Festivos oficiales

La app **genera por reglas** los festivos **estatales, autonómicos y locales de Castelló de la Plana** desde 2025 y hasta cinco años vista, sin conexión: nacionales y autonómicos se replican a todos los municipios con centros; los locales de Castelló se calculan con Magdalena = lunes de la tercera semana de Cuaresma y San Pedro = 29 de junio (trasladado al lunes si cae en domingo).

En **Centros ▸ Festivos por municipio** se muestran los festivos **desde hoy en adelante**, agrupados por año. La barra lateral incluye un bloque plegable con los **próximos cuatro**, cerrado por defecto para no restar espacio. Los locales de otros municipios se añaden o revisan a mano.

Fuentes oficiales si necesitas verificarlos:

- **Estatales**: [BOE](https://www.boe.es) — calendario laboral anual (Resolución de la Dirección General de Trabajo).
- **Autonómicos (Comunitat Valenciana)**: [DOGV / Generalitat Valenciana](https://dogv.gva.es) — resolución de fiestas laborales del Consell.
- **Locales de Castelló de la Plana**: [Ajuntament de Castelló](https://www.castello.es) y el *Boletín Oficial de la Provincia de Castellón* (BOP).

La app no descarga de Internet en tiempo de ejecución; la generación es offline e idempotente. Los años calculados son una **previsión revisable** y no certifican que el calendario laboral publicado esté completo: confirma las fechas con el BOE, DOGV y el BOP antes de usarlas para nómina.

## Uso responsable

Esto es una herramienta de **registro y cálculo**, no un sistema de nómina ni una interpretación de convenio. Verifica festivos, espacios libres y centros. Los informes solo suman turnos **confirmados**.

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
