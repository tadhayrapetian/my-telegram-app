"""Общая логика поверх базы: расчёт абонементов, задолженностей, сводок.

Держим здесь всё, что считается из нескольких таблиц, чтобы роутеры остались
тонкими, а правила счёта жили в одном месте.
"""

from datetime import date, datetime, timedelta

from .db import connect

DONE = "done"
PLANNED = "planned"
CANCELLED = "cancelled"
MOVED = "moved"


def today_iso() -> str:
    return date.today().isoformat()


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def week_start(value: str) -> str:
    d = parse_date(value)
    return (d - timedelta(days=d.weekday())).isoformat()


def add_days(value: str, days: int) -> str:
    return (parse_date(value) + timedelta(days=days)).isoformat()


# --------------------------------------------------------------- абонементы ---

def package_state(conn, package: dict) -> dict:
    """Сколько занятий списано, сколько осталось и в каком абонемент состоянии.

    Списываются только проведённые занятия. Отменённое или перенесённое
    занятие возвращается в абонемент само собой — оно просто не считается.
    """
    used = conn.execute(
        "SELECT COUNT(*) AS n FROM lessons WHERE package_id = ? AND status = ?",
        (package["id"], DONE),
    ).fetchone()["n"]
    planned = conn.execute(
        "SELECT COUNT(*) AS n FROM lessons WHERE package_id = ? AND status = ?",
        (package["id"], PLANNED),
    ).fetchone()["n"]
    total = int(package["lessons_total"] or 0)
    left = total - used
    expires = package.get("expires_on") or ""

    if left <= 0:
        status = "finished"
    elif expires and expires < today_iso():
        status = "expired"
    else:
        status = "active"

    days_left = None
    if expires:
        days_left = (parse_date(expires) - date.today()).days

    out = dict(package)
    out.update(used=used, planned=planned, left=left, status=status, days_left=days_left)
    return out


def packages_of(conn, student_id: int) -> list:
    rows = conn.execute(
        "SELECT * FROM packages WHERE student_id = ? ORDER BY purchased_on DESC, id DESC",
        (student_id,),
    ).fetchall()
    return [package_state(conn, dict(r)) for r in rows]


def active_package(conn, student_id: int):
    """Абонемент, с которого логично списывать следующее занятие."""
    for pack in packages_of(conn, student_id):
        if pack["status"] == "active":
            return pack
    return None


# ------------------------------------------------------------------- деньги ---

def student_money(conn, student_id: int) -> dict:
    """Начислено, оплачено, долг.

    Начисление = цена всех абонементов + цена разовых проведённых занятий
    (тех, что не привязаны к абонементу и имеют свою цену).
    """
    charged_packs = conn.execute(
        "SELECT COALESCE(SUM(price), 0) AS s FROM packages WHERE student_id = ?", (student_id,)
    ).fetchone()["s"]
    charged_single = conn.execute(
        "SELECT COALESCE(SUM(price), 0) AS s FROM lessons "
        "WHERE student_id = ? AND package_id IS NULL AND status = ? AND price IS NOT NULL",
        (student_id, DONE),
    ).fetchone()["s"]
    paid = conn.execute(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE student_id = ? AND status = 'paid'",
        (student_id,),
    ).fetchone()["s"]
    pending = conn.execute(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE student_id = ? AND status = 'pending'",
        (student_id,),
    ).fetchone()["s"]
    charged = round(charged_packs + charged_single, 2)
    paid = round(paid, 2)
    return {
        "charged": charged,
        "paid": paid,
        "pending": round(pending, 2),
        "debt": round(charged - paid, 2),
    }


# ------------------------------------------------------------------ ученики ---

def student_card(conn, student_id: int) -> dict:
    row = conn.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
    if not row:
        return None
    student = dict(row)
    packs = packages_of(conn, student_id)
    active = next((p for p in packs if p["status"] == "active"), None)
    student["packages"] = packs
    student["active_package"] = active
    student["lessons_left"] = active["left"] if active else 0
    student["money"] = student_money(conn, student_id)
    student["lessons"] = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM lessons WHERE student_id = ? ORDER BY date DESC, time DESC LIMIT 200",
            (student_id,),
        )
    ]
    student["payments"] = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM payments WHERE student_id = ? ORDER BY paid_on DESC, id DESC",
            (student_id,),
        )
    ]
    student["materials"] = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM materials WHERE student_id = ? ORDER BY created_at DESC",
            (student_id,),
        )
    ]
    upcoming = conn.execute(
        "SELECT * FROM lessons WHERE student_id = ? AND date >= ? AND status = ? "
        "ORDER BY date, time LIMIT 5",
        (student_id, today_iso(), PLANNED),
    ).fetchall()
    student["upcoming"] = [dict(r) for r in upcoming]
    return student


def student_brief(conn, row) -> dict:
    """Строка списка учеников: остаток по абонементу, долг, ближайшее занятие."""
    student = dict(row)
    active = active_package(conn, student["id"])
    money = student_money(conn, student["id"])
    nxt = conn.execute(
        "SELECT date, time FROM lessons WHERE student_id = ? AND date >= ? AND status = ? "
        "ORDER BY date, time LIMIT 1",
        (student["id"], today_iso(), PLANNED),
    ).fetchone()
    student["lessons_left"] = active["left"] if active else 0
    student["package_expires"] = active["expires_on"] if active else None
    student["debt"] = money["debt"]
    student["next_lesson"] = dict(nxt) if nxt else None
    return student
