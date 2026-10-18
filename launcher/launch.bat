@echo off
setlocal
rem Iniciador del Centro de administracion para Windows.
rem Usa pythonw para que no quede una consola abierta en segundo plano.
cd /d "%~dp0.."

where pythonw >nul 2>nul
if not errorlevel 1 (
  start "" pythonw "launcher\launch.py"
  exit /b 0
)

where pyw >nul 2>nul
if not errorlevel 1 (
  start "" pyw "launcher\launch.py"
  exit /b 0
)

where python >nul 2>nul
if errorlevel 1 (
  echo No se encontro Python 3.10 o superior.
  echo Instala Python desde la Microsoft Store o desde python.org y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

rem Ultimo recurso: arranque oculto con PowerShell; si falla, consola minima.
powershell -NoProfile -WindowStyle Hidden -Command "$p=(Get-Command python).Source; Start-Process -WindowStyle Hidden -FilePath $p -ArgumentList 'launcher\launch.py'" >nul 2>nul
if not errorlevel 1 exit /b 0
start "" python "launcher\launch.py"
exit /b 0
