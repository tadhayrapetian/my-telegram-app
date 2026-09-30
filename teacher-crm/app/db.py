"""Работа с базой: подключение, схема, маленькие помощники.

База — обычный файл SQLite в папке data/ рядом с проектом. Никаких миграций
через отдельные инструменты: схема создаётся при старте, новые колонки
добавляются функцией ensure_column, чтобы обновление программы не ломало
существующую базу.
"""

import os
import secrets
import shutil
import sqlite3
from datetime import date
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
# Обычно база лежит в data/ рядом с программой. Переменная CRM_DATA нужна,
# чтобы запустить вторую копию на других данных (например, для проверки).
DATA_DIR = Path(os.environ["CRM_DATA"]).resolve() if os.environ.get("CRM_DATA") else BASE_DIR / "data"
FILES_DIR = DATA_DIR / "files"
BACKUP_DIR = DATA_DIR / "backups"
DB_PATH = DATA_DIR / "crm.sqlite3"

SCHEMA = """
CREATE TABLE IF NOT EXISTS students (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    contact      TEXT DEFAULT '',
    level        TEXT DEFAULT '',
    schedule     TEXT DEFAULT '',
    goals        TEXT DEFAULT '',
    notes        TEXT DEFAULT '',
    archived     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS packages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    lessons_total INTEGER NOT NULL,
    purchased_on  TEXT NOT NULL,
    expires_on    TEXT,
    price         REAL NOT NULL DEFAULT 0,
    note          TEXT DEFAULT '',
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    package_id     INTEGER REFERENCES packages(id) ON DELETE SET NULL,
    date           TEXT NOT NULL,
    time           TEXT NOT NULL DEFAULT '17:00',
    duration       INTEGER NOT NULL DEFAULT 60,
    topic          TEXT DEFAULT '',
    materials_note TEXT DEFAULT '',
    homework       TEXT DEFAULT '',
    notes          TEXT DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'planned',
    price          REAL,
    moved_from_id  INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
    move_reason    TEXT DEFAULT '',
    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL,
    lesson_id  INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
    amount     REAL NOT NULL DEFAULT 0,
    paid_on    TEXT NOT NULL,
    method     TEXT DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'paid',
    note       TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS materials (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    lesson_id  INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
    title      TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'link',
    url        TEXT DEFAULT '',
    filename   TEXT DEFAULT '',
    mime       TEXT DEFAULT '',
    size       INTEGER DEFAULT 0,
    note       TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    author      TEXT NOT NULL,              -- teacher | student
    text        TEXT DEFAULT '',
    material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE INDEX IF NOT EXISTS idx_lessons_date    ON lessons(date);
CREATE INDEX IF NOT EXISTS idx_lessons_student ON lessons(student_id);
CREATE INDEX IF NOT EXISTS idx_pack_student    ON packages(student_id);
CREATE INDEX IF NOT EXISTS idx_pay_student     ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_mat_student     ON materials(student_id);
CREATE INDEX IF NOT EXISTS idx_msg_student     ON messages(student_id, created_at);
"""

DEFAULT_SETTINGS = {
    "currency": "֏",
    "default_duration": "60",
    "default_price": "0",
    "teacher_name": "",
    # пропуск без предупреждения по умолчанию считается проведённым занятием
    "no_show_counts": "1",
}


def connect() -> sqlite3.Connection:
    """Новое подключение. Каждый запрос работает со своим — так проще и безопаснее."""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def ensure_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    """Добавляет колонку, если её ещё нет — чтобы старая база пережила обновление."""
    have = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in have:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)
        # кабинет ученика: код для входа и адрес страницы
        ensure_column(conn, "students", "portal_code", "TEXT DEFAULT ''")
        ensure_column(conn, "students", "portal_token", "TEXT DEFAULT ''")
        for row in conn.execute("SELECT id FROM students WHERE portal_code IS NULL OR portal_code = ''"):
            conn.execute(
                "UPDATE students SET portal_code = ?, portal_token = ? WHERE id = ?",
                (f"{secrets.randbelow(9000) + 1000}", secrets.token_urlsafe(16), row["id"]),
            )
        # абонемент знает свои дни недели и время — по ним считается последний день
        ensure_column(conn, "packages", "weekdays", "TEXT DEFAULT ''")
        ensure_column(conn, "packages", "lesson_time", "TEXT DEFAULT ''")
        # кто перенёс занятие: teacher или student
        ensure_column(conn, "lessons", "moved_by", "TEXT DEFAULT ''")
        for key, value in DEFAULT_SETTINGS.items():
            conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, value))
        conn.commit()


def get_settings() -> dict:
    with connect() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    out = dict(DEFAULT_SETTINGS)
    out.update({r["key"]: r["value"] for r in rows})
    return out


def set_settings(values: dict) -> dict:
    with connect() as conn:
        for key, value in values.items():
            if key in DEFAULT_SETTINGS:
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (key, str(value)),
                )
        conn.commit()
    return get_settings()


def backup_db() -> Path:
    """Копия базы одной кнопкой. Используем API бэкапа SQLite — безопасно на ходу."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = date.today().isoformat()
    target = BACKUP_DIR / f"crm-{stamp}.sqlite3"
    n = 2
    while target.exists():
        target = BACKUP_DIR / f"crm-{stamp}-{n}.sqlite3"
        n += 1
    with connect() as src, sqlite3.connect(target) as dst:
        src.backup(dst)
    # держим последние 30 копий
    copies = sorted(BACKUP_DIR.glob("crm-*.sqlite3"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in copies[30:]:
        old.unlink(missing_ok=True)
    return target


def restore_db(path: Path) -> None:
    shutil.copy2(path, DB_PATH)


def rows_to_dicts(rows) -> list:
    return [dict(r) for r in rows]
