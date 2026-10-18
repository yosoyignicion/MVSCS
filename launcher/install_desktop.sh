#!/bin/bash
# Crea un acceso directo (lanzador) en el menú de aplicaciones de Linux.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPS="$HOME/.local/share/applications"
mkdir -p "$APPS"
cat > "$APPS/centro-administracion.desktop" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Centro de administración
Comment=Administración local de personal de seguridad privada
Exec=python3 "$ROOT/launcher/launch.py"
Path=$ROOT
Icon=$ROOT/assets/icon.png
Terminal=false
Categories=Office;Utility;
StartupWMClass=Centro de administración
EOF
chmod +x "$APPS/centro-administracion.desktop"
echo "Acceso directo creado: $APPS/centro-administracion.desktop"
