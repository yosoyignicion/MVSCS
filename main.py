from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import sqlite3
import unicodedata
import uuid
from contextlib import closing
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
LOCAL_ZONE = ZoneInfo("Europe/Madrid")
MAX_IMPORT_BYTES = 10 * 1024 * 1024

# Municipio operativo por defecto (solo Castellón por ahora).
DEFAULT_MUNICIPALITY = "Castelló de la Plana"
DEFAULT_PROVINCE = "Castellón"

# Calendario oficial: nacional, Comunitat Valenciana y locales de Castelló de la Plana.
# Los años se calculan por reglas offline (Pascua incluida) desde 2025 hasta cinco
# ejercicios vista. Los festivos nacionales/autonómicos se replican para todos los
# municipios dados de alta; los locales solo para el municipio por defecto.
HOLIDAY_FIRST_YEAR = 2025
HOLIDAY_GENERATED_YEARS_AHEAD = 5


def easter_sunday(year: int) -> date:
    """Domingo de Pascua (algoritmo gregoriano anónimo)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


def holidays_for_year(year: int) -> list[tuple[str, str, str]]:
    """Devuelve (fecha, nombre, ámbito) para un ejercicio."""
    easter = easter_sunday(year)
    entries: list[tuple[date, str, str]] = [
        (date(year, 1, 1), "Año Nuevo", "national"),
        (date(year, 1, 6), "Epifanía del Señor", "national"),
        (easter - timedelta(days=2), "Viernes Santo", "national"),
        (date(year, 5, 1), "Fiesta del Trabajo", "national"),
        (date(year, 8, 15), "Asunción de la Virgen", "national"),
        (date(year, 10, 12), "Fiesta Nacional de España", "national"),
        (date(year, 11, 1), "Todos los Santos", "national"),
        (date(year, 12, 6), "Día de la Constitución Española", "national"),
        (date(year, 12, 8), "Inmaculada Concepción", "national"),
        (date(year, 12, 25), "Natividad del Señor", "national"),
        (date(year, 3, 19), "San José", "autonomic"),
        (easter + timedelta(days=1), "Lunes de Pascua", "autonomic"),
        (date(year, 6, 24), "San Juan", "autonomic"),
        (date(year, 10, 9), "Día de la Comunitat Valenciana", "autonomic"),
        # Magdalena: lunes de la tercera semana de Cuaresma (Pascua - 27 días).
        (easter - timedelta(days=27), "Fiestas de la Magdalena (local)", "local"),
    ]
    san_pedro = date(year, 6, 29)
    if san_pedro.weekday() == 6:  # Si cae en domingo, se traslada al lunes.
        san_pedro += timedelta(days=1)
    entries.append((san_pedro, "San Pedro (local)", "local"))
    return [(day.isoformat(), name, scope) for day, name, scope in entries]


def generated_official_holidays(start_year: int, end_year: int) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    for year in range(start_year, end_year + 1):
        rows.extend(holidays_for_year(year))
    return rows


SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    municipality TEXT NOT NULL,
    province TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE(name, municipality)
);
CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id),
    post_id TEXT NOT NULL REFERENCES posts(id),
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    break_start_at TEXT,
    break_end_at TEXT,
    break_paid INTEGER NOT NULL DEFAULT 0 CHECK(break_paid IN (0,1)),
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('pending','confirmed')),
    source TEXT NOT NULL DEFAULT 'manual',
    source_label TEXT,
    created_at TEXT NOT NULL,
    CHECK(end_at > start_at),
    CHECK((break_start_at IS NULL AND break_end_at IS NULL) OR
          (break_start_at IS NOT NULL AND break_end_at IS NOT NULL AND
           break_end_at > break_start_at AND break_start_at >= start_at AND break_end_at <= end_at))
);
CREATE INDEX IF NOT EXISTS idx_shifts_start ON shifts(start_at);
CREATE INDEX IF NOT EXISTS idx_shifts_employee_start ON shifts(employee_id, start_at);
CREATE INDEX IF NOT EXISTS idx_shifts_post_start ON shifts(post_id, start_at);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE TABLE IF NOT EXISTS holidays (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    municipality TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(date, municipality, name)
);
CREATE TABLE IF NOT EXISTS dismissed_holidays (
    date TEXT NOT NULL,
    municipality TEXT NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY(date, municipality, name)
);
CREATE TABLE IF NOT EXISTS review_items (
    id TEXT PRIMARY KEY,
    source_label TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    errors_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS monthly_summaries (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id),
    post_id TEXT REFERENCES posts(id),
    month TEXT NOT NULL,
    minutes INTEGER NOT NULL CHECK(minutes >= 0),
    source TEXT NOT NULL DEFAULT 'manual',
    source_label TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(employee_id, month)
);
CREATE INDEX IF NOT EXISTS idx_monthly_month ON monthly_summaries(month);
"""


def now_text() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 15000")
    return conn


def sync_official_holidays(conn: sqlite3.Connection) -> int:
    """Carga idempotente de festivos y respeta los que el usuario haya descartado.

    Los nacionales/autonómicos se replican a todos los municipios con puestos dados de
    alta; los locales solo se aplican al municipio por defecto (Castelló de la Plana).
    """
    last_year = datetime.now(LOCAL_ZONE).year + HOLIDAY_GENERATED_YEARS_AHEAD
    official = generated_official_holidays(HOLIDAY_FIRST_YEAR, max(HOLIDAY_FIRST_YEAR, last_year))
    dismissed = {(row["date"], row["municipality"], row["name"]) for row in conn.execute("SELECT date,municipality,name FROM dismissed_holidays").fetchall()}
    municipalities = {DEFAULT_MUNICIPALITY}
    municipalities.update(row["municipality"] for row in conn.execute("SELECT DISTINCT municipality FROM posts").fetchall() if row["municipality"])
    rows: list[tuple[str, str, str, str, str]] = []
    for day, name, scope in official:
        targets = municipalities if scope in {"national", "autonomic"} else {DEFAULT_MUNICIPALITY}
        for municipality in targets:
            if (day, municipality, name) in dismissed:
                continue
            rows.append((str(uuid.uuid4()), day, municipality, name, now_text()))
    before = conn.execute("SELECT COUNT(*) FROM holidays").fetchone()[0]
    conn.executemany("INSERT OR IGNORE INTO holidays(id,date,municipality,name,created_at) VALUES(?,?,?,?,?)", rows)
    after = conn.execute("SELECT COUNT(*) FROM holidays").fetchone()[0]
    return after - before


def initialize(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(connect(db_path)) as conn:
        conn.executescript(SCHEMA)
        shift_columns = {row["name"] for row in conn.execute("PRAGMA table_info(shifts)").fetchall()}
        if "break_paid" not in shift_columns:
            conn.execute("ALTER TABLE shifts ADD COLUMN break_paid INTEGER NOT NULL DEFAULT 0 CHECK(break_paid IN (0,1))")
        sync_official_holidays(conn)
        conn.commit()


class EmployeeInput(BaseModel):
    code: str = Field(min_length=1, max_length=60)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(default="", max_length=120)


class PostInput(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    municipality: str = Field(min_length=1, max_length=100)
    province: str = Field(min_length=1, max_length=80)


class ShiftInput(BaseModel):
    employee_id: str
    post_id: str
    start_at: str
    end_at: str
    break_start_at: str | None = None
    break_end_at: str | None = None
    break_paid: bool | None = None
    repeat_mode: str = "none"
    repeat_until: str | None = None


class ImportRows(BaseModel):
    rows: list[dict[str, Any]] = Field(min_length=1, max_length=5000)


class ShiftIds(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=5000)

class SummaryReviewInput(BaseModel):
    employee_id: str
    month: str
    hours: str


class ConfirmImport(BaseModel):
    rows: list[dict[str, Any]] = Field(min_length=1, max_length=5000)
    filename: str = Field(default="importación", max_length=240)
    source: str = Field(default="csv", max_length=10)


class HolidayInput(BaseModel):
    date: str
    municipality: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=160)


class MergeInput(BaseModel):
    source_id: str


def parse_local(value: str, label: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"{label}: usa fecha y hora válidas.") from exc
    if parsed.tzinfo is not None:
        parsed = parsed.replace(tzinfo=None)
    candidates = [parsed.replace(tzinfo=LOCAL_ZONE, fold=fold) for fold in (0, 1)]
    round_trips = [item.astimezone(timezone.utc).astimezone(LOCAL_ZONE).replace(tzinfo=None) for item in candidates]
    if any(roundtrip != parsed for roundtrip in round_trips):
        raise ValueError(f"{label}: esa hora local no existe por el cambio horario.")
    if candidates[0].utcoffset() != candidates[1].utcoffset():
        raise ValueError(f"{label}: esa hora local es ambigua por el cambio horario.")
    if parsed.second or parsed.microsecond:
        raise ValueError(f"{label}: la precisión admitida es de un minuto.")
    return parsed.replace(tzinfo=LOCAL_ZONE)


def validate_shift(data: ShiftInput, conn: sqlite3.Connection) -> tuple[datetime, datetime, datetime | None, datetime | None]:
    if not conn.execute("SELECT 1 FROM employees WHERE id=? AND active=1", (data.employee_id,)).fetchone():
        raise ValueError("Selecciona un empleado activo.")
    if not conn.execute("SELECT 1 FROM posts WHERE id=? AND active=1", (data.post_id,)).fetchone():
        raise ValueError("Selecciona un puesto activo.")
    start = parse_local(data.start_at, "Entrada")
    end = parse_local(data.end_at, "Salida")
    if end <= start:
        raise ValueError("La salida debe ser posterior a la entrada. Para turnos nocturnos, indica la fecha del día siguiente.")
    if end - start > timedelta(hours=24):
        raise ValueError("Un turno no puede superar 24 horas.")
    if bool(data.break_start_at) != bool(data.break_end_at):
        raise ValueError("Indica inicio y fin de la pausa, o deja ambos vacíos.")
    break_start = parse_local(data.break_start_at, "Inicio de pausa") if data.break_start_at else None
    break_end = parse_local(data.break_end_at, "Fin de pausa") if data.break_end_at else None
    if break_start and break_end and not (start <= break_start < break_end <= end):
        raise ValueError("La pausa debe estar dentro del turno y terminar después de empezar.")
    if break_start and data.break_paid is None:
        raise ValueError("Confirma si la pausa es remunerada para calcular el turno.")
    return start, end, break_start, break_end


def shift_metrics(shift: sqlite3.Row, holiday_dates: set[str], window_start: datetime | None = None, window_end: datetime | None = None) -> dict[str, Any]:
    start = parse_local(shift["start_at"], "Entrada").astimezone(timezone.utc)
    end = parse_local(shift["end_at"], "Salida").astimezone(timezone.utc)
    if window_start:
        start = max(start, window_start.astimezone(timezone.utc))
    if window_end:
        end = min(end, window_end.astimezone(timezone.utc))
    if end <= start:
        return {"minutes": 0, "night_minutes": 0, "holiday_minutes": 0, "weekend_minutes": 0, "days": {}}
    break_start = parse_local(shift["break_start_at"], "Inicio de pausa").astimezone(timezone.utc) if shift["break_start_at"] and not shift["break_paid"] else None
    break_end = parse_local(shift["break_end_at"], "Fin de pausa").astimezone(timezone.utc) if shift["break_end_at"] and not shift["break_paid"] else None
    boundaries = {start, end}
    first_day = start.astimezone(LOCAL_ZONE).date() - timedelta(days=1)
    final_day = end.astimezone(LOCAL_ZONE).date() + timedelta(days=1)
    current_day = first_day
    while current_day <= final_day:
        for boundary_time in (time.min, time(6), time(22)):
            boundary = datetime.combine(current_day, boundary_time, LOCAL_ZONE).astimezone(timezone.utc)
            if start < boundary < end:
                boundaries.add(boundary)
        current_day += timedelta(days=1)
    if break_start and start < break_start < end:
        boundaries.add(break_start)
    if break_end and start < break_end < end:
        boundaries.add(break_end)
    points = sorted(boundaries)
    totals = {"minutes": 0, "night_minutes": 0, "holiday_minutes": 0, "weekend_minutes": 0}
    days: dict[str, dict[str, int]] = {}
    for left, right in zip(points, points[1:]):
        if break_start and break_start <= left < break_end:
            continue
        minute_count = int((right - left).total_seconds() // 60)
        if minute_count <= 0:
            continue
        local = left.astimezone(LOCAL_ZONE)
        day = local.date().isoformat()
        is_night = local.hour >= 22 or local.hour < 6
        is_holiday = day in holiday_dates
        is_weekend = local.weekday() >= 5
        totals["minutes"] += minute_count
        if is_night:
            totals["night_minutes"] += minute_count
        if is_holiday:
            totals["holiday_minutes"] += minute_count
        if is_weekend:
            totals["weekend_minutes"] += minute_count
        bucket = days.setdefault(day, {"minutes": 0, "night_minutes": 0, "holiday_minutes": 0})
        bucket["minutes"] += minute_count
        bucket["night_minutes"] += minute_count if is_night else 0
        bucket["holiday_minutes"] += minute_count if is_holiday else 0
    totals["days"] = days
    return totals


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def safe_export_text(value: Any) -> str:
    """Evita que un texto importado se evalúe como fórmula al abrir CSV/Excel."""
    text = str(value or "")
    return f"'{text}" if text[:1] in {"=", "+", "-", "@"} else text


def normalized_name(*parts: str) -> str:
    """Nombre comparable: minúsculas, sin acentos ni espacios sobrantes."""
    text = " ".join(part for part in parts if part).strip().lower()
    return "".join(char for char in unicodedata.normalize("NFKD", text) if not unicodedata.combining(char))


def row_dict(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def cell_to_text(value: Any) -> str:
    """Normaliza celdas de CSV/Excel/PDF a texto estable para el parser de alias."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, time):
        return value.strftime("%H:%M")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, timedelta):
        total_minutes = int(value.total_seconds() // 60)
        return f"{total_minutes // 60}:{total_minutes % 60:02d}"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def coerce_date(value: str) -> date:
    text = (value or "").strip()
    if not text:
        raise ValueError("falta la fecha")
    try:
        return date.fromisoformat(text)
    except ValueError:
        pass
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        pass
    if re.fullmatch(r"\d{8}", text):
        try:
            return date(int(text[:4]), int(text[4:6]), int(text[6:8]))
        except ValueError:
            pass
    try:
        serial = float(text.replace(",", "."))
        if 20000 <= serial <= 80000:  # Fecha serial de Excel (base 1899-12-30).
            return date(1899, 12, 30) + timedelta(days=int(serial))
    except ValueError:
        pass
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError("fecha no válida (usa YYYY-MM-DD o DD/MM/YYYY)")


def coerce_time(value: str) -> time:
    text = (value or "").strip().replace("\u00a0", " ")
    if not text:
        raise ValueError("falta la hora")
    try:
        return time.fromisoformat(text)
    except ValueError:
        pass
    try:
        return datetime.fromisoformat(text).time()
    except ValueError:
        pass
    match = re.fullmatch(r"(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*(?:h|hs)?", text, re.IGNORECASE)
    if match:
        hour, minute = int(match.group(1)), int(match.group(2))
        second = int(match.group(3) or 0)
        if hour == 24 and minute == 0 and second == 0:
            hour = 0
        if 0 <= hour < 24 and 0 <= minute < 60 and 0 <= second < 60:
            return time(hour, minute, second)
    try:
        numeric = float(text.replace(",", "."))
        if 0 <= numeric < 1:  # Fracción de día típica de Excel (0.5 = 12:00).
            total = round(numeric * 1440)
            return time((total // 60) % 24, total % 60)
        if numeric.is_integer() and 0 <= numeric < 24:
            return time(int(numeric), 0)
    except ValueError:
        pass
    raise ValueError("hora no válida (usa HH:MM)")


def import_time(raw_date: str, raw_time: str, base_date: date, start: datetime | None = None) -> datetime:
    text = (raw_time or "").strip()
    if re.search(r"\d{4}-\d{2}-\d{2}", text) and re.search(r"\d{1,2}:\d{2}", text):
        try:
            parsed = datetime.fromisoformat(text.replace(" ", "T"))
            return parsed.replace(tzinfo=None)
        except ValueError:
            pass
    parsed_time = coerce_time(text)
    parsed_date = coerce_date(raw_date) if (raw_date or "").strip() else base_date
    result = datetime.combine(parsed_date, parsed_time)
    if start and result <= start:
        result += timedelta(days=1)
    return result


IMPORT_ALIASES = {
    "id": "code", "employee_id": "code", "employee_code": "code", "codigo": "code", "código": "code",
    "codigo empleado": "code", "código empleado": "code", "codigo trabajador": "code", "código trabajador": "code", "cod empleado": "code", "cod. empleado": "code",
    "id trabajador": "code", "id empleado": "code", "n empleado": "code", "nº empleado": "code",
    "n.º empleado": "code", "num empleado": "code", "numero empleado": "code", "número empleado": "code",
    "employee": "employee", "empleado": "employee", "nombre": "employee", "nombre ficticio": "employee",
    "nombre completo": "employee", "nombre y apellidos": "employee", "trabajador": "employee", "vigilante": "employee",
    "apellidos": "last_name", "apellido": "last_name",
    "post": "post", "service": "post", "puesto": "post", "puesto de trabajo": "post", "servicio": "post",
    "instalacion": "post", "instalación": "post", "servicio/instalacion": "post", "servicio/instalación": "post",
    "centro": "post", "centro de trabajo": "post",
    "municipality": "municipality", "municipio": "municipality", "localidad": "municipality", "poblacion": "municipality",
    "población": "municipality", "ciudad": "municipality",
    "province": "province", "provincia": "province", "prov": "province",
    "date": "date", "fecha": "date", "dia": "date", "día": "date", "fecha turno": "date",
    "fecha de trabajo": "date", "fecha servicio": "date",
    "start": "start", "entrada": "start", "hora entrada": "start", "hora de entrada": "start", "inicio": "start",
    "hora inicio": "start", "fecha entrada": "start", "fecha de entrada": "start", "fecha inicio": "start",
    "fecha/hora entrada": "start",
    "end": "end", "salida": "end", "hora salida": "end", "hora de salida": "end", "fin": "end",
    "hora fin": "end", "fecha salida": "end", "fecha de salida": "end", "fecha fin": "end", "fecha/hora salida": "end",
    "break_start": "break_start", "pausa inicio": "break_start", "inicio pausa": "break_start",
    "inicio descanso": "break_start", "descanso inicio": "break_start", "comida inicio": "break_start",
    "break_end": "break_end", "pausa fin": "break_end", "fin pausa": "break_end",
    "fin descanso": "break_end", "descanso fin": "break_end", "comida fin": "break_end",
    "break_paid": "break_paid", "pausa remunerada": "break_paid", "pausa pagada": "break_paid",
    "location": "location", "localizacion": "location", "localización": "location",
    "localización ficticia": "location", "localizacion ficticia": "location",
    "month": "month", "mes": "month", "periodo": "month", "periodo/mes": "month", "mes/año": "month",
    "total_hours": "total_hours", "horas": "total_hours", "horas totales": "total_hours",
    "horas totales trabajadas": "total_hours", "horas totales mes": "total_hours", "horas mes": "total_hours",
}

MONTH_NAMES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}


def parse_month(value: str) -> str:
    text = (value or "").strip()
    if not text:
        raise ValueError("falta el mes")
    match = re.fullmatch(r"(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:[ T].*)?", text)
    if match:
        month = int(match.group(2))
        if not 1 <= month <= 12:
            raise ValueError("mes no válido")
        return f"{int(match.group(1)):04d}-{month:02d}"
    match = re.fullmatch(r"(\d{1,2})[/-](\d{4})", text)
    if match:
        month = int(match.group(1))
        if not 1 <= month <= 12:
            raise ValueError("mes no válido")
        return f"{int(match.group(2)):04d}-{month:02d}"
    tokens = re.split(r"[\s/,.]+", text.lower())
    year = next((int(token) for token in tokens if re.fullmatch(r"\d{4}", token)), None)
    name = next((token for token in tokens if token in MONTH_NAMES), None)
    if year and name:
        return f"{year:04d}-{MONTH_NAMES[name]:02d}"
    raise ValueError(f"mes no válido ({value})")


def parse_hours(value: str) -> int:
    text = (value or "").strip().replace(",", ".")
    if not text:
        raise ValueError("faltan las horas")
    try:
        if ":" in text:
            hours, _, minutes = text.partition(":")
            total = int(hours) * 60 + int((minutes or "0")[:2] or 0)
        else:
            number = float(text)
            if not math.isfinite(number):
                raise ValueError("las horas deben ser un número finito")
            total = round(number * 60)
    except (ValueError, OverflowError) as exc:
        raise ValueError(f"horas no válidas ({value})") from exc
    if total < 0 or total > 100000:
        raise ValueError("las horas deben estar entre 0 y 100000 minutos")
    return total


def resolve_or_create_employee(conn: sqlite3.Connection, row: dict[str, Any]) -> str:
    employee_id = str(row.get("employee_id") or "")
    if employee_id and conn.execute("SELECT 1 FROM employees WHERE id=?", (employee_id,)).fetchone():
        return employee_id
    code = str(row.get("employee_code") or "").strip()
    if not code:
        return ""
    existing = conn.execute("SELECT id FROM employees WHERE code=?", (code,)).fetchone()
    if existing:
        return existing["id"]
    new_id = str(uuid.uuid4())
    name = str(row.get("employee_name") or "").strip()
    first, _, last = name.partition(" ")
    conn.execute(
        "INSERT INTO employees(id,code,first_name,last_name,created_at) VALUES(?,?,?,?,?)",
        (new_id, code, first or code, last, now_text()),
    )
    return new_id


def resolve_or_create_post(conn: sqlite3.Connection, row: dict[str, Any]) -> str:
    post_id = str(row.get("post_id") or "")
    if post_id and conn.execute("SELECT 1 FROM posts WHERE id=?", (post_id,)).fetchone():
        return post_id
    name = str(row.get("post_name") or "").strip()
    if not name:
        return ""
    municipality = str(row.get("municipality") or "").strip() or DEFAULT_MUNICIPALITY
    existing = conn.execute("SELECT id FROM posts WHERE name=? AND municipality=?", (name, municipality)).fetchone()
    if existing:
        return existing["id"]
    province = str(row.get("province") or "").strip() or DEFAULT_PROVINCE
    new_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO posts(id,name,municipality,province,created_at) VALUES(?,?,?,?,?)",
        (new_id, name, municipality, province, now_text()),
    )
    sync_official_holidays(conn)
    return new_id


def queue_review(conn: sqlite3.Connection, label: str, row: dict[str, Any], errors: list[str], now: str) -> None:
    conn.execute(
        "INSERT INTO review_items(id,source_label,raw_json,errors_json,created_at) VALUES(?,?,?,?,?)",
        (str(uuid.uuid4()), label, json.dumps(row, ensure_ascii=False), json.dumps(errors or ["Revisa la fila antes de incluirla en los totales."], ensure_ascii=False), now),
    )


def store_summary_row(conn: sqlite3.Connection, row: dict[str, Any], errors: list[str], label: str, source: str, filename: str, now: str) -> int:
    """Guarda/actualiza un resumen mensual (no son turnos: no entran en los totales de turnos)."""
    if errors:
        queue_review(conn, label, row, errors, now)
        return 0
    employee_id = resolve_or_create_employee(conn, row)
    if not employee_id:
        errors.append("No se pudo identificar o crear el empleado (falta el ID).")
    month = str(row.get("month") or "")
    minutes = row.get("minutes")
    if not month:
        errors.append("Mes no válido.")
    if minutes is None:
        errors.append("Horas no válidas.")
    if errors:
        queue_review(conn, label, row, errors, now)
        return 0
    post_id = resolve_or_create_post(conn, row) or None
    existing = conn.execute("SELECT id FROM monthly_summaries WHERE employee_id=? AND month=?", (employee_id, month)).fetchone()
    if existing:
        conn.execute("UPDATE monthly_summaries SET post_id=?, minutes=?, source=?, source_label=?, created_at=? WHERE id=?", (post_id, int(minutes), source, Path(filename).name, now, existing["id"]))
    else:
        conn.execute("INSERT INTO monthly_summaries(id,employee_id,post_id,month,minutes,source,source_label,created_at) VALUES(?,?,?,?,?,?,?,?)", (str(uuid.uuid4()), employee_id, post_id, month, int(minutes), source, Path(filename).name, now))
    return 1

IMPORT_EXTENSIONS = {".csv": "csv", ".xlsx": "xlsx", ".xlsm": "xlsx", ".pdf": "pdf"}


def build_name_index(conn: sqlite3.Connection) -> dict[str, list[str]]:
    index: dict[str, list[str]] = {}
    for row in conn.execute("SELECT code, first_name, last_name FROM employees WHERE active=1").fetchall():
        key = normalized_name(row["first_name"], row["last_name"])
        if key:
            index.setdefault(key, []).append(row["code"])
    return index


def combined_employee_name(fields: dict[str, str]) -> str:
    parts = [fields.get("employee", "").strip(), fields.get("last_name", "").strip()]
    return " ".join(part for part in parts if part)


def normalize_rows(raw_rows: list[dict[str, Any]], conn: sqlite3.Connection) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    name_index = build_name_index(conn)
    for line_number, raw in enumerate(raw_rows, start=2):
        fields = {IMPORT_ALIASES.get(header_key(key), header_key(key)): cell_to_text(value) for key, value in raw.items() if key}
        looks_like_shift = any(fields.get(key) for key in ("date", "start", "end"))
        if (fields.get("month") or fields.get("total_hours")) and not looks_like_shift:
            record = normalize_summary_row(fields, line_number, conn, name_index)
        else:
            record = normalize_shift_row(fields, line_number, conn, name_index)
        code = str(record.get("employee_code") or "").strip()
        name = str(record.get("employee_name") or "").strip()
        if code and name:
            key = normalized_name(name)
            if key and code not in name_index.get(key, []):
                name_index.setdefault(key, []).append(code)
        records.append(record)
    return records


def normalize_shift_row(fields: dict[str, str], line_number: int, conn: sqlite3.Connection, name_index: dict[str, list[str]]) -> dict[str, Any]:
    errors: list[str] = []
    code = fields.get("code", "").strip()
    name = combined_employee_name(fields)
    employee = conn.execute("SELECT * FROM employees WHERE code=? AND active=1", (code,)).fetchone() if code else None
    duplicate_of: list[str] = []
    if not employee and name:
        duplicate_of = [candidate for candidate in name_index.get(normalized_name(name), []) if candidate != code]
        if duplicate_of:
            errors.append(f"fila {line_number}: nombre duplicado ({name}) coincide con {'/'.join(duplicate_of)}; revisa y unifica el empleado")
    if not code:
        errors.append(f"fila {line_number}: falta el ID de empleado")
    post_name = fields.get("post", "").strip()
    municipality = fields.get("municipality", "").strip() or DEFAULT_MUNICIPALITY
    province = fields.get("province", "").strip() or DEFAULT_PROVINCE
    post = conn.execute("SELECT * FROM posts WHERE name=? AND municipality=? AND active=1", (post_name, municipality)).fetchone() if post_name else None
    if not post_name:
        errors.append(f"fila {line_number}: falta el puesto")
    date_text = fields.get("date", "")
    start_text = fields.get("start", "")
    if not date_text.strip():
        try:
            date_text = datetime.fromisoformat(start_text.strip()).date().isoformat()
        except (ValueError, TypeError):
            date_text = ""
    try:
        day = coerce_date(date_text)
        start = import_time(day.isoformat(), start_text, day)
        end = import_time(day.isoformat(), fields.get("end", ""), day, start)
        if end <= start:
            raise ValueError("la salida debe ser posterior a la entrada")
        if end - start > timedelta(hours=24):
            raise ValueError("el turno supera 24 horas")
    except ValueError as exc:
        errors.append(f"fila {line_number}: fecha/horas: {exc}")
        day, start, end = date.today(), datetime.combine(date.today(), time(0)), datetime.combine(date.today(), time(1))
    break_start = break_end = None
    if fields.get("break_start") or fields.get("break_end"):
        try:
            break_start = import_time(day.isoformat(), fields.get("break_start", ""), day, start)
            break_end = import_time(day.isoformat(), fields.get("break_end", ""), day, break_start)
            if not (start <= break_start < break_end <= end):
                raise ValueError("la pausa debe estar dentro del turno")
        except ValueError as exc:
            errors.append(f"fila {line_number}: pausa: {exc}")
    paid_raw = fields.get("break_paid", "").lower()
    if (break_start or break_end) and paid_raw not in {"si", "sí", "no", "true", "false", "1", "0"}:
        errors.append(f"fila {line_number}: indica si la pausa es remunerada (sí/no)")
    if bool(fields.get("break_start")) != bool(fields.get("break_end")):
        errors.append(f"fila {line_number}: indica inicio y fin de pausa")
    if employee:
        employee_label = f"{employee['code']} · {employee['first_name']} {employee['last_name']}".strip()
    else:
        employee_label = name or code or "Empleado sin ID"
    return {
        "kind": "shift",
        "line": line_number,
        "employee_id": employee["id"] if employee else "",
        "employee_code": code,
        "employee_name": name,
        "employee_label": employee_label,
        "post_id": post["id"] if post else "",
        "post_name": post_name,
        "municipality": municipality,
        "province": province,
        "post_label": f"{post_name} · {municipality}" if post_name else "Puesto sin indicar",
        "start_at": "" if any("fecha/horas:" in message for message in errors) else start.isoformat(timespec="minutes"),
        "end_at": "" if any("fecha/horas:" in message for message in errors) else end.isoformat(timespec="minutes"),
        "break_start_at": break_start.isoformat(timespec="minutes") if break_start else None,
        "break_end_at": break_end.isoformat(timespec="minutes") if break_end else None,
        "break_paid": paid_raw in {"si", "sí", "true", "1"} if paid_raw else (False if not break_start else None),
        "duplicate_of": duplicate_of,
        "errors": errors,
        "status": "pending" if errors else "ready",
    }


def normalize_summary_row(fields: dict[str, str], line_number: int, conn: sqlite3.Connection, name_index: dict[str, list[str]]) -> dict[str, Any]:
    errors: list[str] = []
    code = fields.get("code", "").strip()
    name = combined_employee_name(fields)
    duplicate_of: list[str] = []
    code_known = bool(code) and bool(conn.execute("SELECT 1 FROM employees WHERE code=?", (code,)).fetchone())
    if not code_known and name:
        duplicate_of = [candidate for candidate in name_index.get(normalized_name(name), []) if candidate != code]
        if duplicate_of:
            errors.append(f"fila {line_number}: nombre duplicado ({name}) coincide con {'/'.join(duplicate_of)}; revisa y unifica el empleado")
    if not code:
        errors.append(f"fila {line_number}: falta el ID de empleado")
    try:
        month = parse_month(fields.get("month", ""))
    except ValueError as exc:
        errors.append(f"fila {line_number}: mes: {exc}")
        month = ""
    try:
        minutes = parse_hours(fields.get("total_hours", ""))
    except ValueError as exc:
        errors.append(f"fila {line_number}: horas: {exc}")
        minutes = None
    post_name = (fields.get("location") or fields.get("post") or "").strip()
    return {
        "kind": "summary",
        "line": line_number,
        "employee_id": "",
        "employee_code": code,
        "employee_name": name,
        "employee_label": name or code or "Empleado sin ID",
        "post_name": post_name,
        "municipality": fields.get("municipality", "").strip() or DEFAULT_MUNICIPALITY,
        "province": fields.get("province", "").strip() or DEFAULT_PROVINCE,
        "month": month,
        "minutes": minutes,
        "hours": hhmm(minutes) if minutes is not None else "",
        "duplicate_of": duplicate_of,
        "errors": errors,
        "status": "pending" if errors else "ready",
    }


def header_key(value: Any) -> str:
    return " ".join(cell_to_text(value).lower().split())


def header_score(row: list[Any]) -> int:
    return sum(1 for cell in row if header_key(cell) in IMPORT_ALIASES)


def matrix_header_index(rows: list[list[Any]]) -> int:
    """Busca la fila de encabezados aunque haya títulos o filas vacías delante."""
    best_score, best_index = 0, None
    for index, row in enumerate(rows[:20]):
        score = header_score(row)
        if score > best_score:
            best_score, best_index = score, index
    if best_index is not None and best_score >= 2:
        return best_index
    for index, row in enumerate(rows):
        if any(cell_to_text(cell) for cell in row):
            return index
    return 0


def matrix_to_records(matrix: list[list[Any]]) -> list[dict[str, str]]:
    """Convierte una matriz (CSV/Excel/PDF) en filas usando la fila de encabezados detectada."""
    rows = [list(row) for row in matrix if row is not None]
    if not rows:
        return []
    header_index = matrix_header_index(rows)
    columns: list[tuple[int, str]] = []
    seen: set[str] = set()
    for index, cell in enumerate(rows[header_index]):
        name = cell_to_text(cell)
        if not name:
            continue
        key, suffix = name, 2
        while key in seen:
            key = f"{name} {suffix}"
            suffix += 1
        seen.add(key)
        columns.append((index, key))
    result: list[dict[str, str]] = []
    for row in rows[header_index + 1:]:
        values = [cell_to_text(cell) for cell in row]
        if all(value == "" for value in values):
            continue
        record = {name: values[index] if index < len(values) else "" for index, name in columns}
        if any(value for value in record.values()):
            result.append(record)
    return result


def csv_delimiter(text: str) -> str:
    """Detecta el separador (coma, punto y coma, tabulador o barra) sin fiarse del nombre."""
    try:
        return csv.Sniffer().sniff(text[:4096], delimiters=",;\t|").delimiter
    except csv.Error:
        lines = [line for line in text.splitlines()[:20] if line.strip()]
        if not lines:
            return ","
        counts = {delimiter: sum(line.count(delimiter) for line in lines) for delimiter in ",;\t|"}
        best = max(counts, key=counts.get)
        return best if counts[best] else ","


def rows_from_csv(file_bytes: bytes) -> list[dict[str, str]]:
    text: str | None = None
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = file_bytes.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError("No se pudo leer el CSV. Guarda el archivo en UTF-8 o Windows-1252.")
    matrix = list(csv.reader(io.StringIO(text), delimiter=csv_delimiter(text)))
    records = matrix_to_records(matrix)
    if not records:
        raise ValueError("El archivo CSV no contiene encabezados ni filas de datos.")
    return records


def rows_from_xlsx(file_bytes: bytes) -> list[dict[str, str]]:
    import openpyxl
    try:
        workbook = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    except Exception as exc:
        raise ValueError("No se pudo leer el libro de Excel (.xlsx/.xlsm).") from exc
    try:
        if not workbook.worksheets:
            raise ValueError("El libro de Excel no contiene hojas.")
        best_rank = (-1, -1)
        best_records: list[dict[str, str]] = []
        combined: list[dict[str, str]] = []
        for sheet in workbook.worksheets:
            matrix = [list(row) for row in sheet.iter_rows(values_only=True)]
            if not matrix:
                continue
            header_index = matrix_header_index(matrix)
            score = header_score(matrix[header_index])
            records = matrix_to_records(matrix)
            rank = (score, len(matrix))
            if rank > best_rank:
                best_rank = rank
                best_records = records
            if score >= 2:
                combined.extend(records)
        if combined:
            return combined
        if not best_records:
            raise ValueError("La hoja de Excel no contiene encabezados ni filas de datos.")
        return best_records
    finally:
        workbook.close()


def rows_from_pdf(file_bytes: bytes) -> list[dict[str, str]]:
    import fitz
    try:
        document = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as exc:
        raise ValueError("No se pudo abrir el PDF.") from exc
    try:
        best_rank = (-1, -1)
        best_matrix: list[list[Any]] | None = None
        combined: list[dict[str, str]] = []
        for page in document:
            for table in page.find_tables():
                matrix = table.extract()
                if not matrix or not any(any(cell_to_text(cell) for cell in row) for row in matrix):
                    continue
                header_index = matrix_header_index(matrix)
                score = header_score(matrix[header_index])
                rank = (score, len(matrix))
                if rank > best_rank:
                    best_rank = rank
                    best_matrix = matrix
                if score >= 2:
                    combined.extend(matrix_to_records(matrix))
        if combined:
            return combined
        if best_matrix is None:
            raise ValueError("No se detectó una tabla en el PDF. Los PDF escaneados (imagen) todavía no se admiten.")
        records = matrix_to_records(best_matrix)
        if not records:
            raise ValueError("La tabla del PDF no contiene filas de datos reconocibles.")
        return records
    finally:
        document.close()


def read_import_file(filename: str, file_bytes: bytes) -> tuple[str, list[dict[str, str]]]:
    """Detecta el formato por extensión, valida la firma real y devuelve filas crudas."""
    kind = IMPORT_EXTENSIONS.get(Path(filename).suffix.lower())
    if kind is None:
        raise ValueError("Formato no admitido. Usa CSV, Excel (.xlsx/.xlsm) o PDF.")
    if kind == "csv":
        if b"\x00" in file_bytes:
            raise ValueError("El archivo no parece un CSV UTF-8 válido.")
        return kind, rows_from_csv(file_bytes)
    if kind == "xlsx":
        if not file_bytes.startswith(b"PK"):
            raise ValueError("El archivo no parece un libro de Excel (.xlsx) válido.")
        return kind, rows_from_xlsx(file_bytes)
    if not file_bytes.startswith(b"%PDF"):
        raise ValueError("El archivo no parece un PDF válido.")
    return kind, rows_from_pdf(file_bytes)


def create_app(db_path: str | Path | None = None) -> FastAPI:
    selected_path = Path(db_path or os.environ.get("SHIFTS_DB_PATH", ROOT / "data" / "quadrants.sqlite3")).resolve()
    initialize(selected_path)
    app = FastAPI(title="Turnos · Gestor local", docs_url=None, redoc_url=None)
    app.state.db_path = selected_path

    @app.middleware("http")
    async def no_store_api(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "storage": "local"}

    @app.get("/api/employees")
    def employees(q: str = "", limit: int = 5000) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 5000))
        with closing(connect(selected_path)) as conn:
            rows = conn.execute(
                "SELECT id,code,first_name,last_name,active FROM employees WHERE active=1 AND (code LIKE ? OR first_name LIKE ? OR last_name LIKE ?) ORDER BY code LIMIT ?",
                (f"%{q}%", f"%{q}%", f"%{q}%", limit),
            ).fetchall()
            return [row_dict(row) for row in rows]

    @app.post("/api/employees", status_code=201)
    def add_employee(data: EmployeeInput) -> dict[str, Any]:
        with closing(connect(selected_path)) as conn:
            existing = conn.execute("SELECT id,active FROM employees WHERE code=?", (data.code.strip(),)).fetchone()
            if existing:
                if existing["active"]:
                    raise HTTPException(409, "Ese ID de empleado ya existe.")
                conn.execute("UPDATE employees SET first_name=?,last_name=?,active=1 WHERE id=?", (data.first_name.strip(), data.last_name.strip(), existing["id"]))
                conn.commit()
                return row_dict(conn.execute("SELECT id,code,first_name,last_name,active FROM employees WHERE id=?", (existing["id"],)).fetchone())
            employee_id = str(uuid.uuid4())
            try:
                conn.execute("INSERT INTO employees(id,code,first_name,last_name,created_at) VALUES(?,?,?,?,?)", (employee_id, data.code.strip(), data.first_name.strip(), data.last_name.strip(), now_text()))
                conn.commit()
            except sqlite3.IntegrityError as exc:
                raise HTTPException(409, "Ese ID de empleado ya existe.") from exc
            return row_dict(conn.execute("SELECT id,code,first_name,last_name,active FROM employees WHERE id=?", (employee_id,)).fetchone())

    @app.patch("/api/employees/{employee_id}")
    def update_employee(employee_id: str, data: EmployeeInput) -> dict[str, Any]:
        with closing(connect(selected_path)) as conn:
            if not conn.execute("SELECT 1 FROM employees WHERE id=?", (employee_id,)).fetchone():
                raise HTTPException(404, "Empleado no encontrado.")
            conflict = conn.execute("SELECT 1 FROM employees WHERE code=? AND id<>?", (data.code.strip(), employee_id)).fetchone()
            if conflict:
                raise HTTPException(409, "Ese ID de empleado ya existe.")
            conn.execute("UPDATE employees SET code=?,first_name=?,last_name=? WHERE id=?", (data.code.strip(), data.first_name.strip(), data.last_name.strip(), employee_id))
            conn.commit()
            return row_dict(conn.execute("SELECT id,code,first_name,last_name,active FROM employees WHERE id=?", (employee_id,)).fetchone())

    @app.delete("/api/employees/{employee_id}", status_code=204)
    def delete_employee(employee_id: str) -> None:
        with closing(connect(selected_path)) as conn:
            result = conn.execute("UPDATE employees SET active=0 WHERE id=? AND active=1", (employee_id,))
            if not result.rowcount:
                raise HTTPException(404, "Empleado no encontrado.")
            conn.commit()

    @app.get("/api/posts")
    def posts(q: str = "") -> list[dict[str, Any]]:
        with closing(connect(selected_path)) as conn:
            rows = conn.execute("SELECT id,name,municipality,province,active FROM posts WHERE active=1 AND (name LIKE ? OR municipality LIKE ?) ORDER BY name", (f"%{q}%", f"%{q}%")).fetchall()
            return [row_dict(row) for row in rows]

    @app.post("/api/posts", status_code=201)
    def add_post(data: PostInput) -> dict[str, Any]:
        with closing(connect(selected_path)) as conn:
            existing = conn.execute("SELECT id,active FROM posts WHERE name=? AND municipality=?", (data.name.strip(), data.municipality.strip())).fetchone()
            if existing:
                if existing["active"]:
                    raise HTTPException(409, "Ya existe un puesto con ese nombre en ese municipio.")
                conn.execute("UPDATE posts SET province=?,active=1 WHERE id=?", (data.province.strip(), existing["id"]))
                sync_official_holidays(conn)
                conn.commit()
                return row_dict(conn.execute("SELECT id,name,municipality,province,active FROM posts WHERE id=?", (existing["id"],)).fetchone())
            post_id = str(uuid.uuid4())
            try:
                conn.execute("INSERT INTO posts(id,name,municipality,province,created_at) VALUES(?,?,?,?,?)", (post_id, data.name.strip(), data.municipality.strip(), data.province.strip(), now_text()))
                sync_official_holidays(conn)
                conn.commit()
            except sqlite3.IntegrityError as exc:
                raise HTTPException(409, "Ya existe un puesto con ese nombre en ese municipio.") from exc
            return row_dict(conn.execute("SELECT id,name,municipality,province,active FROM posts WHERE id=?", (post_id,)).fetchone())

    @app.patch("/api/posts/{post_id}")
    def update_post(post_id: str, data: PostInput) -> dict[str, Any]:
        with closing(connect(selected_path)) as conn:
            if not conn.execute("SELECT 1 FROM posts WHERE id=?", (post_id,)).fetchone():
                raise HTTPException(404, "Puesto no encontrado.")
            conflict = conn.execute("SELECT 1 FROM posts WHERE name=? AND municipality=? AND id<>?", (data.name.strip(), data.municipality.strip(), post_id)).fetchone()
            if conflict:
                raise HTTPException(409, "Ya existe otro puesto con ese nombre en ese municipio.")
            conn.execute("UPDATE posts SET name=?,municipality=?,province=? WHERE id=?", (data.name.strip(), data.municipality.strip(), data.province.strip(), post_id))
            sync_official_holidays(conn)
            conn.commit()
            return row_dict(conn.execute("SELECT id,name,municipality,province,active FROM posts WHERE id=?", (post_id,)).fetchone())

    @app.delete("/api/posts/{post_id}", status_code=204)
    def delete_post(post_id: str) -> None:
        with closing(connect(selected_path)) as conn:
            result = conn.execute("UPDATE posts SET active=0 WHERE id=? AND active=1", (post_id,))
            if not result.rowcount:
                raise HTTPException(404, "Puesto no encontrado.")
            conn.commit()

    @app.get("/api/shifts")
    def shifts(from_date: str | None = None, to_date: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if from_date:
            clauses.append("s.end_at >= ?")
            params.append(from_date)
        if to_date:
            clauses.append("s.start_at < ?")
            params.append(to_date)
        if status in {"pending", "confirmed"}:
            clauses.append("s.status = ?")
            params.append(status)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with closing(connect(selected_path)) as conn:
            rows = conn.execute(
                "SELECT s.*, e.code employee_code, e.first_name, e.last_name, p.name post_name, p.municipality, p.province FROM shifts s JOIN employees e ON e.id=s.employee_id JOIN posts p ON p.id=s.post_id" + where + " ORDER BY s.start_at LIMIT 20000",
                params,
            ).fetchall()
            return [row_dict(row) for row in rows]

    @app.post("/api/shifts", status_code=201)
    def add_shift(data: ShiftInput) -> dict[str, Any]:
        mode = (data.repeat_mode or "none").strip().lower()
        if mode not in {"none", "daily", "weekdays", "weekly"}:
            raise HTTPException(422, "Opción de repetición no válida.")
        with closing(connect(selected_path)) as conn:
            try:
                start, end, break_start, break_end = validate_shift(data, conn)
                if mode == "none":
                    days = [start.date()]
                else:
                    if not data.repeat_until:
                        raise ValueError("Indica hasta qué fecha repetir el turno.")
                    until = coerce_date(data.repeat_until)
                    if until < start.date():
                        raise ValueError("La fecha final de repetición debe ser igual o posterior a la entrada.")
                    if (until - start.date()).days > 366:
                        raise ValueError("La repetición admite como máximo 366 días.")
                    days = []
                    current = start.date()
                    while current <= until:
                        if mode == "daily" or (mode == "weekdays" and current.weekday() < 5) or (mode == "weekly" and current.weekday() == start.date().weekday()):
                            days.append(current)
                        current += timedelta(days=1)
                    if not days:
                        raise ValueError("La repetición seleccionada no genera ningún día en ese rango.")
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            created: list[str] = []
            skipped = 0
            for day in days:
                offset = day - start.date()
                occurrence = ShiftInput(
                    employee_id=data.employee_id,
                    post_id=data.post_id,
                    start_at=(start + offset).isoformat(timespec="minutes"),
                    end_at=(end + offset).isoformat(timespec="minutes"),
                    break_start_at=(break_start + offset).isoformat(timespec="minutes") if break_start else None,
                    break_end_at=(break_end + offset).isoformat(timespec="minutes") if break_end else None,
                    break_paid=data.break_paid,
                )
                try:
                    occ_start, occ_end, occ_break_start, occ_break_end = validate_shift(occurrence, conn)
                except ValueError as exc:
                    raise HTTPException(422, f"{day.isoformat()}: {exc}") from exc
                start_text = occ_start.isoformat(timespec="minutes")
                end_text = occ_end.isoformat(timespec="minutes")
                break_start_text = occ_break_start.isoformat(timespec="minutes") if occ_break_start else None
                break_end_text = occ_break_end.isoformat(timespec="minutes") if occ_break_end else None
                duplicate = conn.execute(
                    "SELECT 1 FROM shifts WHERE employee_id=? AND post_id=? AND start_at=? AND end_at=? AND COALESCE(break_start_at,'')=? AND COALESCE(break_end_at,'')=? AND break_paid=? AND status IN ('confirmed','pending')",
                    (data.employee_id, data.post_id, start_text, end_text, break_start_text or "", break_end_text or "", int(bool(data.break_paid))),
                ).fetchone()
                if duplicate:
                    skipped += 1
                    continue
                shift_id = str(uuid.uuid4())
                conn.execute("INSERT INTO shifts(id,employee_id,post_id,start_at,end_at,break_start_at,break_end_at,break_paid,status,source,created_at) VALUES(?,?,?,?,?,?,?,?, 'confirmed','manual',?)", (shift_id, data.employee_id, data.post_id, start_text, end_text, break_start_text, break_end_text, int(bool(data.break_paid)), now_text()))
                created.append(shift_id)
            conn.commit()
            return {"id": created[0] if created else "", "status": "confirmed", "created": len(created), "skipped": skipped}

    @app.patch("/api/shifts/{shift_id}")
    def update_shift(shift_id: str, data: ShiftInput) -> dict[str, str]:
        with closing(connect(selected_path)) as conn:
            current = conn.execute("SELECT status FROM shifts WHERE id=?", (shift_id,)).fetchone()
            if not current:
                raise HTTPException(404, "No se encontró el turno.")
            try:
                start, end, break_start, break_end = validate_shift(data, conn)
                conn.execute("UPDATE shifts SET employee_id=?,post_id=?,start_at=?,end_at=?,break_start_at=?,break_end_at=?,break_paid=? WHERE id=?", (data.employee_id,data.post_id,start.isoformat(timespec="minutes"),end.isoformat(timespec="minutes"),break_start.isoformat(timespec="minutes") if break_start else None,break_end.isoformat(timespec="minutes") if break_end else None,int(bool(data.break_paid)),shift_id))
                conn.commit()
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            return {"id": shift_id, "status": current["status"]}

    @app.post("/api/shifts/{shift_id}/confirm")
    def confirm_shift(shift_id: str) -> dict[str, str]:
        with closing(connect(selected_path)) as conn:
            result = conn.execute("UPDATE shifts SET status='confirmed' WHERE id=? AND status='pending'", (shift_id,))
            if not result.rowcount:
                raise HTTPException(404, "No se encontró un turno pendiente.")
            conn.commit()
            return {"status": "confirmed"}

    @app.post("/api/shifts/review")
    def send_shifts_to_review(data: ShiftIds) -> dict[str, int]:
        ids = list(dict.fromkeys(data.ids))
        with closing(connect(selected_path)) as conn:
            placeholders = ",".join("?" for _ in ids)
            result = conn.execute(f"UPDATE shifts SET status='pending' WHERE status='confirmed' AND id IN ({placeholders})", ids)
            conn.commit()
            return {"updated": result.rowcount, "requested": len(ids)}

    @app.post("/api/review/{review_id}/resolve", status_code=201)
    def resolve_review(review_id: str, data: ShiftInput) -> dict[str, str]:
        with closing(connect(selected_path)) as conn:
            if not conn.execute("SELECT 1 FROM review_items WHERE id=?", (review_id,)).fetchone():
                raise HTTPException(404, "El elemento de revisión ya no existe.")
            try:
                start, end, break_start, break_end = validate_shift(data, conn)
                shift_id = str(uuid.uuid4())
                conn.execute("INSERT INTO shifts(id,employee_id,post_id,start_at,end_at,break_start_at,break_end_at,break_paid,status,source,source_label,created_at) VALUES(?,?,?,?,?,?,?,?, 'confirmed','csv','Revisado manualmente',?)", (shift_id, data.employee_id, data.post_id, start.isoformat(timespec="minutes"), end.isoformat(timespec="minutes"), break_start.isoformat(timespec="minutes") if break_start else None, break_end.isoformat(timespec="minutes") if break_end else None, int(bool(data.break_paid)), now_text()))
                conn.execute("DELETE FROM review_items WHERE id=?", (review_id,))
                conn.commit()
                return {"id": shift_id, "status": "confirmed"}
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc

    @app.post("/api/review/{review_id}/resolve-summary", status_code=201)
    def resolve_summary_review(review_id: str, data: SummaryReviewInput) -> dict[str, Any]:
        with closing(connect(selected_path)) as conn:
            item = conn.execute("SELECT * FROM review_items WHERE id=?", (review_id,)).fetchone()
            if not item:
                raise HTTPException(404, "El elemento de revisión ya no existe.")
            if not conn.execute("SELECT 1 FROM employees WHERE id=? AND active=1", (data.employee_id,)).fetchone():
                raise HTTPException(422, "El empleado seleccionado no existe.")
            try:
                month = parse_month(data.month)
                minutes = parse_hours(data.hours)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            raw = json.loads(item["raw_json"])
            post_id = raw.get("post_id") or None
            if not post_id:
                post_id = resolve_or_create_post(conn, raw) or None
            now = now_text()
            existing = conn.execute("SELECT id FROM monthly_summaries WHERE employee_id=? AND month=?", (data.employee_id, month)).fetchone()
            if existing:
                conn.execute("UPDATE monthly_summaries SET post_id=?, minutes=?, source=?, source_label=?, created_at=? WHERE id=?", (post_id, minutes, "manual", "Revisado manualmente", now, existing["id"]))
                summary_id = existing["id"]
            else:
                summary_id = str(uuid.uuid4())
                conn.execute("INSERT INTO monthly_summaries(id,employee_id,post_id,month,minutes,source,source_label,created_at) VALUES(?,?,?,?,?,?,?,?)", (summary_id, data.employee_id, post_id, month, minutes, "manual", "Revisado manualmente", now))
            conn.execute("DELETE FROM review_items WHERE id=?", (review_id,))
            conn.commit()
            return {"id": summary_id, "month": month, "minutes": minutes, "status": "saved"}

    @app.delete("/api/review/{review_id}", status_code=204)
    def discard_review(review_id: str) -> None:
        with closing(connect(selected_path)) as conn:
            result = conn.execute("DELETE FROM review_items WHERE id=?", (review_id,))
            if not result.rowcount:
                raise HTTPException(404, "Elemento de revisión no encontrado.")
            conn.commit()

    @app.delete("/api/shifts/{shift_id}", status_code=204)
    def delete_shift(shift_id: str) -> None:
        with closing(connect(selected_path)) as conn:
            result = conn.execute("DELETE FROM shifts WHERE id=? AND status='pending'", (shift_id,))
            if not result.rowcount:
                raise HTTPException(404, "Solo se pueden descartar turnos pendientes.")
            conn.commit()

    @app.get("/api/holidays")
    def holidays(year: int | None = None, municipality: str | None = None) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if year:
            clauses.append("date >= ? AND date < ?")
            params.extend([f"{year:04d}-01-01", f"{year + 1:04d}-01-01"])
        if municipality:
            clauses.append("municipality = ?")
            params.append(municipality)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with closing(connect(selected_path)) as conn:
            return [row_dict(row) for row in conn.execute("SELECT * FROM holidays" + where + " ORDER BY date", params).fetchall()]

    @app.post("/api/holidays", status_code=201)
    def add_holiday(data: HolidayInput) -> dict[str, Any]:
        try:
            parsed_date = date.fromisoformat(data.date)
        except ValueError as exc:
            raise HTTPException(422, "Fecha festiva no válida.") from exc
        holiday_id = str(uuid.uuid4())
        with closing(connect(selected_path)) as conn:
            try:
                conn.execute("INSERT INTO holidays(id,date,municipality,name,created_at) VALUES(?,?,?,?,?)", (holiday_id, parsed_date.isoformat(), data.municipality.strip(), data.name.strip(), now_text()))
                conn.execute("DELETE FROM dismissed_holidays WHERE date=? AND municipality=? AND name=?", (parsed_date.isoformat(), data.municipality.strip(), data.name.strip()))
                conn.commit()
            except sqlite3.IntegrityError as exc:
                raise HTTPException(409, "Ese festivo ya está registrado.") from exc
            return row_dict(conn.execute("SELECT * FROM holidays WHERE id=?", (holiday_id,)).fetchone())

    @app.delete("/api/holidays/{holiday_id}", status_code=204)
    def delete_holiday(holiday_id: str) -> None:
        with closing(connect(selected_path)) as conn:
            row = conn.execute("SELECT date,municipality,name FROM holidays WHERE id=?", (holiday_id,)).fetchone()
            if not row:
                raise HTTPException(404, "Festivo no encontrado.")
            conn.execute("INSERT OR IGNORE INTO dismissed_holidays(date,municipality,name) VALUES(?,?,?)", (row["date"], row["municipality"], row["name"]))
            conn.execute("DELETE FROM holidays WHERE id=?", (holiday_id,))
            conn.commit()

    @app.get("/api/monthly-summaries")
    def monthly_summaries(year: int | None = None, month: int | None = None) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if year:
            if month:
                clauses.append("ms.month=?")
                params.append(f"{year:04d}-{month:02d}")
            else:
                clauses.append("ms.month LIKE ?")
                params.append(f"{year:04d}-%")
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with closing(connect(selected_path)) as conn:
            rows = conn.execute("SELECT ms.*, e.code employee_code, e.first_name, e.last_name, p.name post_name FROM monthly_summaries ms JOIN employees e ON e.id=ms.employee_id LEFT JOIN posts p ON p.id=ms.post_id" + where + " ORDER BY ms.month, e.code", params).fetchall()
            return [{"id": r["id"], "employee_code": r["employee_code"], "name": f"{r['first_name']} {r['last_name']}".strip(), "post_name": r["post_name"], "month": r["month"], "minutes": r["minutes"], "hours": hhmm(r["minutes"]), "source_label": r["source_label"]} for r in rows]

    @app.delete("/api/monthly-summaries/{summary_id}", status_code=204)
    def delete_summary(summary_id: str) -> None:
        with closing(connect(selected_path)) as conn:
            result = conn.execute("DELETE FROM monthly_summaries WHERE id=?", (summary_id,))
            if not result.rowcount:
                raise HTTPException(404, "Resumen mensual no encontrado.")
            conn.commit()

    @app.get("/api/duplicates")
    def duplicates() -> list[dict[str, Any]]:
        """Empleados activos con el mismo nombre y distinto ID (para revisar/unificar)."""
        with closing(connect(selected_path)) as conn:
            groups: dict[str, list[dict[str, Any]]] = {}
            for row in conn.execute("SELECT id,code,first_name,last_name FROM employees WHERE active=1 ORDER BY code").fetchall():
                key = normalized_name(row["first_name"], row["last_name"])
                if not key:
                    continue
                groups.setdefault(key, []).append({"id": row["id"], "code": row["code"], "name": f"{row['first_name']} {row['last_name']}".strip()})
            result: list[dict[str, Any]] = []
            for people in groups.values():
                if len(people) < 2:
                    continue
                for person in people:
                    person["shift_count"] = conn.execute("SELECT COUNT(*) FROM shifts WHERE employee_id=?", (person["id"],)).fetchone()[0]
                    person["summary_count"] = conn.execute("SELECT COUNT(*) FROM monthly_summaries WHERE employee_id=?", (person["id"],)).fetchone()[0]
                result.append({"name": people[0]["name"], "employees": people})
            return result

    @app.post("/api/employees/{target_id}/merge")
    def merge_employee(target_id: str, data: MergeInput) -> dict[str, Any]:
        """Mueve turnos y resúmenes del empleado origen al destino y elimina el origen."""
        with closing(connect(selected_path)) as conn:
            if target_id == data.source_id:
                raise HTTPException(422, "Origen y destino son el mismo empleado.")
            if not conn.execute("SELECT 1 FROM employees WHERE id=?", (target_id,)).fetchone():
                raise HTTPException(404, "Empleado destino no encontrado.")
            if not conn.execute("SELECT 1 FROM employees WHERE id=?", (data.source_id,)).fetchone():
                raise HTTPException(404, "Empleado origen no encontrado.")
            moved_shifts = conn.execute("UPDATE shifts SET employee_id=? WHERE employee_id=?", (target_id, data.source_id)).rowcount
            moved_summaries = 0
            for row in conn.execute("SELECT id,month,minutes FROM monthly_summaries WHERE employee_id=?", (data.source_id,)).fetchall():
                existing = conn.execute("SELECT id FROM monthly_summaries WHERE employee_id=? AND month=?", (target_id, row["month"])).fetchone()
                if existing:
                    conn.execute("UPDATE monthly_summaries SET minutes=minutes+? WHERE id=?", (row["minutes"], existing["id"]))
                    conn.execute("DELETE FROM monthly_summaries WHERE id=?", (row["id"],))
                else:
                    conn.execute("UPDATE monthly_summaries SET employee_id=? WHERE id=?", (target_id, row["id"]))
                moved_summaries += 1
            conn.execute("DELETE FROM employees WHERE id=?", (data.source_id,))
            conn.commit()
            return {"merged_shifts": moved_shifts, "merged_summaries": moved_summaries, "target_id": target_id}

    @app.get("/api/reports")
    def reports(year: int, month: int | None = None, q: str = "", post_id: str = "", group_by_employee: bool = True) -> dict[str, Any]:
        if year < 2000 or year > 2200 or (month is not None and not 1 <= month <= 12):
            raise HTTPException(422, "Selecciona un año y mes válidos.")
        first_day = date(year, month or 1, 1)
        if month:
            last_day = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
        else:
            last_day = date(year + 1, 1, 1)
        start_bound = datetime.combine(first_day, time.min, LOCAL_ZONE)
        end_bound = datetime.combine(last_day, time.min, LOCAL_ZONE)
        with closing(connect(selected_path)) as conn:
            clauses = ["s.status='confirmed'", "s.start_at < ?", "s.end_at > ?", "(e.code LIKE ? OR e.first_name LIKE ? OR e.last_name LIKE ?)"]
            params: list[Any] = [end_bound.replace(tzinfo=None).isoformat(timespec="minutes"), start_bound.replace(tzinfo=None).isoformat(timespec="minutes"), f"%{q}%", f"%{q}%", f"%{q}%"]
            if post_id:
                clauses.append("s.post_id=?")
                params.append(post_id)
            selected = conn.execute(
                "SELECT s.*, e.code employee_code,e.first_name,e.last_name,p.name post_name,p.municipality,p.province FROM shifts s JOIN employees e ON e.id=s.employee_id JOIN posts p ON p.id=s.post_id WHERE " + " AND ".join(clauses) + " ORDER BY s.start_at",
                params,
            ).fetchall()
            municipalities = {row["municipality"] for row in selected}
            holiday_dates: dict[str, set[str]] = {municipality: set() for municipality in municipalities}
            for h in conn.execute("SELECT date,municipality FROM holidays WHERE date>=? AND date<?", (first_day.isoformat(), last_day.isoformat())).fetchall():
                holiday_dates.setdefault(h["municipality"], set()).add(h["date"])
            summary_clauses = ["ms.month=?" if month else "ms.month LIKE ?", "(e.code LIKE ? OR e.first_name LIKE ? OR e.last_name LIKE ?)"]
            summary_params: list[Any] = [f"{year:04d}-{month:02d}" if month else f"{year:04d}-%", f"%{q}%", f"%{q}%", f"%{q}%"]
            if post_id:
                summary_clauses.append("ms.post_id=?")
                summary_params.append(post_id)
            summary_rows = conn.execute(
                "SELECT ms.*, e.code employee_code, e.first_name, e.last_name, p.name post_name FROM monthly_summaries ms JOIN employees e ON e.id=ms.employee_id LEFT JOIN posts p ON p.id=ms.post_id WHERE " + " AND ".join(summary_clauses) + " ORDER BY ms.month, e.code",
                summary_params,
            ).fetchall()
            summaries = [
                {"id": row["id"], "employee_code": row["employee_code"], "name": f"{row['first_name']} {row['last_name']}".strip(), "post_name": row["post_name"], "month": row["month"], "minutes": row["minutes"], "hours": hhmm(row["minutes"]), "source_label": row["source_label"]}
                for row in summary_rows
            ]
            by_day: dict[str, dict[str, int]] = {}
            totals = {"minutes": 0, "night_minutes": 0, "holiday_minutes": 0, "weekend_minutes": 0}
            by_employee: dict[str, dict[str, Any]] = {}
            by_post: dict[str, dict[str, Any]] = {}
            details: list[dict[str, Any]] = []
            for shift in selected:
                metrics = shift_metrics(shift, holiday_dates.get(shift["municipality"], set()), start_bound, end_bound)
                for key in totals:
                    totals[key] += metrics[key]
                if not group_by_employee:
                    for day, values in metrics["days"].items():
                        bucket = by_day.setdefault(day, {"minutes": 0, "night_minutes": 0, "holiday_minutes": 0, "shift_count": 0})
                        for key in ("minutes", "night_minutes", "holiday_minutes"):
                            bucket[key] += values[key]
                        if day == shift["start_at"][:10]:
                            bucket["shift_count"] += 1
                employee = by_employee.setdefault(shift["employee_id"], {"employee_id": shift["employee_id"], "code": shift["employee_code"], "name": f"{shift['first_name']} {shift['last_name']}".strip(), "minutes": 0, "night_minutes": 0, "holiday_minutes": 0, "shift_count": 0})
                post = by_post.setdefault(shift["post_id"], {"post_id": shift["post_id"], "name": shift["post_name"], "municipality": shift["municipality"], "minutes": 0, "night_minutes": 0, "holiday_minutes": 0, "shift_count": 0})
                for key in ("minutes", "night_minutes", "holiday_minutes"):
                    employee[key] += metrics[key]
                    post[key] += metrics[key]
                employee["shift_count"] += 1
                post["shift_count"] += 1
                if group_by_employee:
                    details.append({**row_dict(shift), **metrics})
            for group in (by_employee, by_post):
                for item in group.values():
                    item["hours"] = hhmm(item["minutes"])
                    item["night_hours"] = hhmm(item["night_minutes"])
                    item["holiday_hours"] = hhmm(item["holiday_minutes"])
            return {
                "year": year, "month": month,
                "period": {"from": first_day.isoformat(), "to_exclusive": last_day.isoformat()},
                "totals": {**totals, "hours": hhmm(totals["minutes"]), "night_hours": hhmm(totals["night_minutes"]), "holiday_hours": hhmm(totals["holiday_minutes"]), "weekend_hours": hhmm(totals["weekend_minutes"])},
                "employees": sorted(by_employee.values(), key=lambda item: item["code"]),
                "posts": sorted(by_post.values(), key=lambda item: item["name"]),
                "shifts": details,
                "summaries": summaries,
                "days": [{"date": day, **values, "hours": hhmm(values["minutes"]), "night_hours": hhmm(values["night_minutes"]), "holiday_hours": hhmm(values["holiday_minutes"])} for day, values in sorted(by_day.items())] if not group_by_employee else [],
            }

    @app.get("/api/review")
    def review_queue() -> list[dict[str, Any]]:
        with closing(connect(selected_path)) as conn:
            rows = conn.execute("SELECT * FROM review_items ORDER BY created_at DESC").fetchall()
            result = [{"kind": "raw", "id": row["id"], "source_label": row["source_label"], "created_at": row["created_at"], "raw": json.loads(row["raw_json"]), "errors": json.loads(row["errors_json"])} for row in rows]
            pending = conn.execute("SELECT s.*,e.code employee_code,e.first_name,e.last_name,p.name post_name,p.municipality,p.province FROM shifts s JOIN employees e ON e.id=s.employee_id JOIN posts p ON p.id=s.post_id WHERE s.status='pending' ORDER BY s.created_at DESC").fetchall()
            result.extend({"kind": "shift", "id": row["id"], "created_at": row["created_at"], "shift": row_dict(row)} for row in pending)
            return sorted(result, key=lambda item: item["created_at"], reverse=True)

    async def preview_upload(file: UploadFile) -> dict[str, Any]:
        filename = Path(file.filename or "").name
        if not filename or Path(filename).suffix.lower() not in IMPORT_EXTENSIONS:
            raise HTTPException(415, "Formatos admitidos: CSV, Excel (.xlsx/.xlsm) y PDF.")
        content = await file.read(MAX_IMPORT_BYTES + 1)
        if len(content) > MAX_IMPORT_BYTES:
            raise HTTPException(413, "El archivo supera el límite local de 10 MB.")
        with closing(connect(selected_path)) as conn:
            try:
                kind, raw_rows = read_import_file(filename, content)
                rows = normalize_rows(raw_rows, conn)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
        if not rows:
            raise HTTPException(422, "El archivo no contiene filas de turnos.")
        if len(rows) > 5000:
            raise HTTPException(422, "El archivo supera el máximo de 5000 filas. Divídelo en varios archivos.")
        return {"filename": filename, "kind": kind, "count": len(rows), "ready": sum(row["status"] == "ready" for row in rows), "pending": sum(row["status"] == "pending" for row in rows), "rows": rows}

    @app.post("/api/imports/preview")
    async def preview_import(file: UploadFile = File(...)) -> dict[str, Any]:
        return await preview_upload(file)

    @app.post("/api/imports/csv/preview")
    async def preview_csv(file: UploadFile = File(...)) -> dict[str, Any]:
        return await preview_upload(file)

    @app.post("/api/imports/confirm", status_code=201)
    def commit_import(data: ConfirmImport) -> dict[str, Any]:
        source = data.source if data.source in {"csv", "xlsx", "pdf"} else "csv"
        with closing(connect(selected_path)) as conn:
            inserted = 0
            summaries = 0
            queued = 0
            now = now_text()
            try:
                for index, row in enumerate(data.rows, start=1):
                    errors = list(row.get("errors") or [])
                    label = f"{Path(data.filename).name} · fila {row.get('line', index)}"
                    if row.get("kind") == "summary":
                        summaries += store_summary_row(conn, row, errors, label, source, data.filename, now)
                        queued += 1 if errors else 0
                        continue
                    if errors:
                        queue_review(conn, label, row, errors, now)
                        queued += 1
                        continue
                    employee_id = resolve_or_create_employee(conn, row)
                    post_id = resolve_or_create_post(conn, row)
                    if not employee_id:
                        errors.append("No se pudo identificar o crear el empleado (falta el ID).")
                    if not post_id:
                        errors.append("No se pudo identificar o crear el puesto (falta el nombre).")
                    shift_data = ShiftInput(
                        employee_id=employee_id, post_id=post_id,
                        start_at=str(row.get("start_at", "")), end_at=str(row.get("end_at", "")),
                        break_start_at=row.get("break_start_at"), break_end_at=row.get("break_end_at"), break_paid=row.get("break_paid"),
                    )
                    try:
                        start, end, break_start, break_end = validate_shift(shift_data, conn) if employee_id and post_id else (None, None, None, None)
                    except ValueError as exc:
                        start = end = break_start = break_end = None
                        errors.append(str(exc))
                    if errors or not start or not end:
                        queue_review(conn, label, row, errors, now)
                        queued += 1
                        continue
                    conn.execute("INSERT INTO shifts(id,employee_id,post_id,start_at,end_at,break_start_at,break_end_at,break_paid,status,source,source_label,created_at) VALUES(?,?,?,?,?,?,?,?, 'pending',?,?,?)", (str(uuid.uuid4()), shift_data.employee_id, shift_data.post_id, start.isoformat(timespec="minutes"), end.isoformat(timespec="minutes"), break_start.isoformat(timespec="minutes") if break_start else None, break_end.isoformat(timespec="minutes") if break_end else None, int(bool(shift_data.break_paid)), source, Path(data.filename).name, now))
                    inserted += 1
                conn.commit()
            except Exception:
                conn.rollback()
                raise
        return {"pending": inserted, "summaries": summaries, "needs_review": queued, "message": "Los turnos válidos se guardaron en revisión; los resúmenes mensuales se guardaron aparte; las filas ambiguas quedaron para revisar. Nada entra en los totales hasta confirmar."}

    @app.post("/api/imports/csv/confirm", status_code=201)
    def commit_csv(data: ConfirmImport) -> dict[str, Any]:
        return commit_import(data)

    @app.get("/api/exports/shifts.csv")
    def export_shifts(year: int, month: int | None = None, post_id: str = "") -> FileResponse:
        if year < 2000 or year > 2200 or (month is not None and not 1 <= month <= 12):
            raise HTTPException(422, "Periodo no válido.")
        report = reports(year=year, month=month, q="", post_id=post_id)
        output = io.StringIO(newline="")
        writer = csv.writer(output, delimiter=";")
        writer.writerow(["ID empleado","Empleado","Puesto","Municipio","Provincia","Entrada","Salida","Inicio pausa","Fin pausa","Pausa remunerada","Horas trabajadas HH:MM","Horas nocturnas HH:MM","Horas festivas HH:MM"])
        for shift in report["shifts"]:
            writer.writerow([safe_export_text(shift["employee_code"]), safe_export_text(f"{shift['first_name']} {shift['last_name']}".strip()), safe_export_text(shift["post_name"]), safe_export_text(shift["municipality"]), safe_export_text(shift["province"]), shift["start_at"], shift["end_at"], shift["break_start_at"] or "", shift["break_end_at"] or "", "Sí" if shift["break_paid"] else "No", hhmm(shift["minutes"]), hhmm(shift["night_minutes"]), hhmm(shift["holiday_minutes"])])
        output.seek(0)
        from fastapi.responses import StreamingResponse
        filename = f"cuadrante-{year}-{month:02d}.csv" if month else f"cuadrante-{year}.csv"
        return StreamingResponse(iter(["\ufeff" + output.getvalue()]), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f"attachment; filename={filename}"})

    @app.get("/api/exports/shifts.xlsx")
    def export_shifts_xlsx(year: int, month: int | None = None, post_id: str = "") -> Response:
        if year < 2000 or year > 2200 or (month is not None and not 1 <= month <= 12):
            raise HTTPException(422, "Periodo no válido.")
        report = reports(year=year, month=month, q="", post_id=post_id)
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Alignment, Font, PatternFill
            from openpyxl.utils import get_column_letter
        except Exception as exc:
            raise HTTPException(500, "Falta openpyxl para exportar Excel. Instala las dependencias del proyecto.") from exc
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Cuadrante"
        headers = [
            "ID empleado", "Empleado", "Puesto", "Municipio", "Provincia", "Fecha",
            "Entrada", "Salida", "Inicio pausa", "Fin pausa", "Pausa remunerada",
            "Horas trabajadas HH:MM", "Horas nocturnas HH:MM", "Horas festivas HH:MM",
        ]
        sheet.append(headers)
        for shift in report["shifts"]:
            sheet.append([
                safe_export_text(shift["employee_code"]),
                safe_export_text(f"{shift['first_name']} {shift['last_name']}".strip()),
                safe_export_text(shift["post_name"]),
                safe_export_text(shift["municipality"]),
                safe_export_text(shift["province"]),
                shift["start_at"][:10],
                shift["start_at"][11:16],
                shift["end_at"][11:16],
                shift["break_start_at"][11:16] if shift["break_start_at"] else "",
                shift["break_end_at"][11:16] if shift["break_end_at"] else "",
                "Sí" if shift["break_paid"] else "No",
                hhmm(shift["minutes"]),
                hhmm(shift["night_minutes"]),
                hhmm(shift["holiday_minutes"]),
            ])
        header_fill = PatternFill("solid", fgColor="19344B")
        for cell in sheet[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center")
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        for index, width in enumerate([14, 28, 28, 22, 14, 12, 10, 10, 12, 12, 16, 20, 20, 18], start=1):
            sheet.column_dimensions[get_column_letter(index)].width = width
        buffer = io.BytesIO()
        workbook.save(buffer)
        filename = f"cuadrante-{year}-{month:02d}.xlsx" if month else f"cuadrante-{year}.xlsx"
        return Response(
            content=buffer.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    return app


app = create_app()
