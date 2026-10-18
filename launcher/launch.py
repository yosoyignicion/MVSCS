"""Iniciador de MVSCS Private Dashboard.

Arranca el servidor local (uvicorn) y muestra una ventana con el logo que
permite abrir el panel en el navegador y cerrar la app. Funciona en Linux,
macOS y Windows con Python 3.10+.

Uso:
    python launcher/launch.py            # ventana con logo
    python launcher/launch.py --no-gui   # sin ventana (solo navegador + consola)
    python launcher/launch.py --check    # comprueba dependencias y sale
"""
from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
LOG_PATH = ROOT / "data" / "launcher.log"
DEFAULT_PORT = int(os.environ.get("MVSCS_PORT", "8000"))
HEALTH_TIMEOUT = 25.0


def free_port(preferred: int) -> int:
    for candidate in (preferred, *range(preferred + 1, preferred + 20), 0):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", candidate))
                return sock.getsockname()[1]
            except OSError:
                continue
    return preferred


def dependencies_ready() -> tuple[bool, str]:
    required = ["fastapi", "uvicorn", "multipart", "openpyxl", "fitz"]
    if sys.platform.startswith("win"):
        required.append("tzdata")
    missing = [name for name in required if not _importable(name)]
    if not missing:
        return True, ""
    return False, " ".join(missing)


def _importable(name: str) -> bool:
    try:
        __import__(name)
        return True
    except Exception:
        return False


def install_requirements() -> bool:
    req = ROOT / "requirements.txt"
    cmd = [sys.executable, "-m", "pip", "install", "-r", str(req)] if req.exists() else [sys.executable, "-m", "pip", "install", "fastapi", "uvicorn", "python-multipart", "openpyxl", "pymupdf"]
    print("Instalando dependencias:", " ".join(cmd))
    return subprocess.call(cmd) == 0


def start_server(port: int) -> subprocess.Popen:
    (ROOT / "data").mkdir(exist_ok=True)
    log = open(LOG_PATH, "a", encoding="utf-8")
    return subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=str(ROOT), stdout=log, stderr=subprocess.STDOUT,
    )


def wait_healthy(port: int, process: subprocess.Popen) -> bool:
    import urllib.request

    url = f"http://127.0.0.1:{port}/api/health"
    deadline = time.time() + HEALTH_TIMEOUT
    while time.time() < deadline:
        if process.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return True
        except Exception:
            time.sleep(0.4)
    return False


def stop_server(process: subprocess.Popen) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=6)
        except subprocess.TimeoutExpired:
            process.kill()


def run_gui(port: int, process: subprocess.Popen) -> None:
    import tkinter as tk
    from tkinter import messagebox

    url = f"http://127.0.0.1:{port}/"
    window = tk.Tk()
    window.title("MVSCS Private Dashboard")
    window.configure(bg="#0b1220")
    window.resizable(False, False)
    try:
        window.iconphoto(True, tk.PhotoImage(file=str(ASSETS / "icon.png")))
    except Exception:
        pass

    default_font = ("DejaVu Sans", 10)
    try:
        logo_image = tk.PhotoImage(file=str(ASSETS / "icon.png")).subsample(3, 3)
        tk.Label(window, image=logo_image, bg="#0b1220").pack(padx=24, pady=(22, 8))
    except Exception:
        logo_image = None

    tk.Label(window, text="MVSCS Private Dashboard", bg="#0b1220", fg="#f1f5f9", font=("DejaVu Sans", 15, "bold")).pack()
    tk.Label(window, text="MED Vigilantes Castellón · panel local", bg="#0b1220", fg="#38bdf8", font=("DejaVu Sans", 9)).pack(pady=(2, 10))
    tk.Label(window, text=f"Servidor activo en\n{url}", bg="#0b1220", fg="#cbd5e1", font=default_font, justify="center").pack(pady=(0, 15))

    opened = {"done": False}

    def open_panel() -> None:
        webbrowser.open(url)
        opened["done"] = True

    buttons = tk.Frame(window, bg="#0b1220")
    buttons.pack(pady=(0, 22), padx=22, fill="x")
    open_button = tk.Button(buttons, text="Abrir panel", command=open_panel, bg="#22d3ee", fg="#06202b", activebackground="#38bdf8", relief="flat", font=("DejaVu Sans", 11, "bold"), padx=18, pady=8)
    open_button.pack(side="left", expand=True, fill="x", padx=(0, 8))

    def close_app() -> None:
        stop_server(process)
        window.destroy()

    tk.Button(buttons, text="Cerrar", command=close_app, bg="#1e293b", fg="#e2e8f0", activebackground="#334155", relief="flat", font=("DejaVu Sans", 11), padx=18, pady=8).pack(side="right", expand=True, fill="x", padx=(8, 0))

    window.protocol("WM_DELETE_WINDOW", close_app)
    open_panel()
    if not opened["done"]:
        messagebox.showwarning("MVSCS", "No se pudo abrir el navegador automáticamente. Usa el botón «Abrir panel».")
    window.mainloop()


def run_headless(port: int, process: subprocess.Popen) -> None:
    url = f"http://127.0.0.1:{port}/"
    webbrowser.open(url)
    print(f"MVSCS Private Dashboard en {url}")
    print("Pulsa Ctrl+C para detener el servidor.")
    try:
        process.wait()
    except KeyboardInterrupt:
        stop_server(process)


def main() -> int:
    parser = argparse.ArgumentParser(description="Iniciador de MVSCS Private Dashboard")
    parser.add_argument("--no-gui", action="store_true", help="Sin ventana: abre el navegador y deja el servidor en consola")
    parser.add_argument("--check", action="store_true", help="Comprueba dependencias y termina")
    args = parser.parse_args()

    ready, missing = dependencies_ready()
    if args.check:
        print("Dependencias:", "OK" if ready else f"faltan: {missing}")
        return 0 if ready else 1
    if not ready:
        print(f"Faltan dependencias ({missing}). Se instalarán ahora.")
        if not install_requirements():
            print("No se pudieron instalar las dependencias. Ejecuta: python -m pip install -r requirements.txt")
            return 1

    port = free_port(DEFAULT_PORT)
    process = start_server(port)
    print(f"Servidor MVSCS iniciado (PID {process.pid}) en http://127.0.0.1:{port}/")
    if not wait_healthy(port, process):
        print(f"El servidor no respondió. Revisa el registro en {LOG_PATH}.")
        stop_server(process)
        return 1

    try:
        if args.no_gui or not _has_gui():
            run_headless(port, process)
        else:
            run_gui(port, process)
    finally:
        stop_server(process)
    return 0


def _has_gui() -> bool:
    try:
        import tkinter  # noqa: F401
    except Exception:
        return False
    return bool(os.environ.get("DISPLAY") or sys.platform in {"darwin", "win32"})


if __name__ == "__main__":
    raise SystemExit(main())
