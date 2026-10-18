#!/bin/bash
# Iniciador del Centro de administración para macOS (doble clic).
# Lanza la ventana en segundo plano y cierra la Terminal para no dejar consola abierta.
cd "$(dirname "$0")/.." || exit 1
mkdir -p data
nohup python3 launcher/launch.py >> data/launcher.log 2>&1 &
disown
sleep 1
osascript -e 'tell application "Terminal" to close front window' >/dev/null 2>&1 &
exit 0
