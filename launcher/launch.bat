@echo off
rem Iniciador de MVSCS Private Dashboard para Windows.
cd /d "%~dp0.."
where python >nul 2>nul || (echo Instala Python 3.10+ y vuelve a ejecutar & pause & exit /b 1)
python launcher\launch.py
pause
