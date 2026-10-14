#!/bin/bash
# Crea un acceso directo (lanzador) en el menú de aplicaciones de Linux.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPS="$HOME/.local/share/applications"
mkdir -p "$APPS"
cat > "$APPS/mvscs-private-dashboard.desktop" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=MVSCS Private Dashboard
Comment=Panel local de cuadrantes (MED Vigilantes Castellón)
Exec=python3 "$ROOT/launcher/launch.py"
Path=$ROOT
Icon=$ROOT/assets/icon.png
Terminal=false
Categories=Office;Utility;
StartupWMClass=MVSCS Private Dashboard
EOF
chmod +x "$APPS/mvscs-private-dashboard.desktop"
echo "Acceso directo creado: $APPS/mvscs-private-dashboard.desktop"
