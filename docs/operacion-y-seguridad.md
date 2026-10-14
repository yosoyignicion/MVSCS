# Operación local y seguridad

## Arranque y comprobación

Instala las dependencias descritas en el README en un entorno virtual, inicia `uvicorn main:app --host 127.0.0.1 --port 8000` y consulta `http://127.0.0.1:8000/`. `GET /api/health` informa si responde el backend; no comprueba consistencia completa de la base.

Detener Uvicorn no borra datos. La base por defecto está en `data/quadrants.sqlite3`; define `SHIFTS_DB_PATH` antes de iniciar si se necesita una ubicación local distinta.

## Copia manual de datos

La aplicación no incorpora todavía herramienta de backup/restore. Para hacer copia de forma segura:

1. Detén el servidor para evitar cambios concurrentes.
2. Copia el archivo SQLite configurado a una ubicación protegida y con acceso limitado.
3. No subas la base, las copias ni exportaciones a un repositorio, servicio de sincronización o canal no autorizado.
4. Para restaurar, detén el servidor y conserva una copia de la base existente antes de reemplazarla manualmente.
5. Vuelve a iniciar y verifica empleados, turnos y reportes en la interfaz.

Una base, CSV o futura importación de cuadrantes puede contener datos personales y de trabajo. Almacena las copias cifradas y conforme a la política de retención de la empresa.

## Exposición de red

- El comando recomendado enlaza en `127.0.0.1`, accesible desde el mismo equipo.
- No utilices `--host 0.0.0.0` ni reenvíes puertos como mecanismo de conveniencia: la app no tiene usuarios, autenticación, roles ni protección CSRF diseñada para una instalación expuesta.
- Loopback reduce exposición de red, pero no protege frente a otros usuarios o procesos del mismo sistema operativo. Usa una cuenta y controles de acceso locales apropiados.
- No se envían datos a proveedores externos, no hay telemetría y LM Studio no está conectado.

## Mantenimiento de calendarios y reglas

Festivos, municipio del puesto, franja 22:00–06:00 y significado de pausa requieren verificación humana. La app precarga los festivos estatales + autonómicos (Comunitat Valenciana 2025–2026) para Castelló de la Plana; los **locales** de cada municipio se añaden o revisan a mano, y la precarga no certifica exhaustividad. Las reglas de la app no determinan salarios ni cumplimiento de normativa laboral.

## Incidentes de datos

- Conserva un backup de la base antes de migraciones, restauraciones o tareas de reparación.
- No borres o reinicies la base como método de depuración sobre datos operativos.
- Usa bases temporales en pruebas y datos sintéticos.
- Si una migración o cálculo presenta valores inesperados, detén el uso de los informes para decisiones de nómina y reproduce con una copia de prueba antes de cambiar registros.
