"""Сводка на главной и служебные операции: экспорт в CSV, резервная копия."""

import csv
import io
from datetime import date

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..db import BACKUP_DIR, backup_db, connect
from ..logic import PLANNED, add_days, student_money, today_iso, week_start
from .packages import warnings as package_warnings
from .payments import debts as payment_debts

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard")
def dashboard():
    td = today_iso()
    ws = week_start(td)
    month = td[:7]

    with connect() as conn:
        upcoming = [dict(r) for r in conn.execute(
            "SELECT l.*, s.name AS student_name FROM lessons l JOIN students s ON s.id = l.student_id "
            "WHERE l.date >= ? AND l.status = ? ORDER BY l.date, l.time LIMIT 8", (td, PLANNED))]
        today_lessons = [dict(r) for r in conn.execute(
            "SELECT l.*, s.name AS student_name FROM lessons l JOIN students s ON s.id = l.student_id "
            "WHERE l.date = ? ORDER BY l.time", (td,))]
        week_count = conn.execute(
            "SELECT COUNT(*) AS n FROM lessons WHERE date BETWEEN ? AND ? AND status != 'cancelled'",
            (ws, add_days(ws, 6))).fetchone()["n"]
        done_month = conn.execute(
            "SELECT COUNT(*) AS n FROM lessons WHERE substr(date,1,7) = ? AND status = 'done'", (month,)
        ).fetchone()["n"]
        hours_month = conn.execute(
            "SELECT COALESCE(SUM(duration),0) AS m FROM lessons WHERE substr(date,1,7) = ? AND status = 'done'",
            (month,)).fetchone()["m"]
        income_month = conn.execute(
            "SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status='paid' AND substr(paid_on,1,7) = ?",
            (month,)).fetchone()["s"]
        students_count = conn.execute("SELECT COUNT(*) AS n FROM students WHERE archived = 0").fetchone()["n"]
        unmarked = conn.execute(
            "SELECT COUNT(*) AS n FROM lessons WHERE status = ? AND date < ?", (PLANNED, td)).fetchone()["n"]
        by_month = [dict(r) for r in conn.execute(
            "SELECT substr(paid_on,1,7) AS month, COALESCE(SUM(amount),0) AS total FROM payments "
            "WHERE status='paid' GROUP BY month ORDER BY month DESC LIMIT 6")]

    return {
        "today": td,
        "today_lessons": today_lessons,
        "upcoming": upcoming,
        "week_count": week_count,
        "done_month": done_month,
        "hours_month": round(hours_month / 60, 1),
        "income_month": round(income_month, 2),
        "students_count": students_count,
        "unmarked": unmarked,
        "debts": payment_debts(),
        "package_warnings": package_warnings(),
        "income_by_month": list(reversed(by_month)),
    }


# ------------------------------------------------------------------ CSV ---

EXPORTS = {
    "students": ("SELECT id, name, contact, level, schedule, goals, notes, archived, created_at FROM students",
                 ["id", "имя", "контакт", "уровень", "расписание", "цели", "заметки", "в архиве", "создан"]),
    "lessons": ("SELECT l.id, s.name AS student, l.date, l.time, l.duration, l.topic, l.homework, "
                "l.notes, l.status, l.price, l.package_id, l.moved_from_id, l.move_reason "
                "FROM lessons l LEFT JOIN students s ON s.id = l.student_id ORDER BY l.date, l.time",
                ["id", "ученик", "дата", "время", "минут", "тема", "домашнее задание", "заметки",
                 "статус", "цена", "абонемент", "перенесено с", "причина"]),
    "packages": ("SELECT p.id, s.name AS student, p.lessons_total, p.purchased_on, p.expires_on, p.price, p.note "
                 "FROM packages p LEFT JOIN students s ON s.id = p.student_id ORDER BY p.purchased_on",
                 ["id", "ученик", "занятий", "куплен", "действует до", "цена", "заметка"]),
    "payments": ("SELECT p.id, s.name AS student, p.amount, p.paid_on, p.method, p.status, p.note, p.package_id "
                 "FROM payments p LEFT JOIN students s ON s.id = p.student_id ORDER BY p.paid_on",
                 ["id", "ученик", "сумма", "дата", "способ", "статус", "комментарий", "абонемент"]),
    "materials": ("SELECT m.id, s.name AS student, m.title, m.kind, m.url, m.filename, m.note, m.created_at "
                  "FROM materials m LEFT JOIN students s ON s.id = m.student_id ORDER BY m.created_at",
                  ["id", "ученик", "название", "тип", "ссылка", "файл", "заметка", "добавлено"]),
}


@router.get("/export/{what}.csv")
def export_csv(what: str):
    if what not in EXPORTS:
        raise HTTPException(404, "Нечего выгружать")
    sql, headers = EXPORTS[what]
    with connect() as conn:
        rows = conn.execute(sql).fetchall()

    buf = io.StringIO()
    buf.write("﻿")  # чтобы Excel на Mac открыл кириллицу правильно
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(headers)
    for r in rows:
        writer.writerow(["" if v is None else v for v in tuple(r)])
    buf.seek(0)

    name = f"{what}-{date.today().isoformat()}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


# --------------------------------------------------------------- бэкапы ---

@router.post("/backup")
def make_backup():
    path = backup_db()
    return {"ok": True, "file": path.name, "folder": str(BACKUP_DIR), "size": path.stat().st_size}


@router.get("/backups")
def list_backups():
    files = sorted(BACKUP_DIR.glob("crm-*.sqlite3"), key=lambda p: p.stat().st_mtime, reverse=True)
    return {
        "folder": str(BACKUP_DIR),
        "items": [{"file": f.name, "size": f.stat().st_size,
                   "made": date.fromtimestamp(f.stat().st_mtime).isoformat()} for f in files[:20]],
    }
