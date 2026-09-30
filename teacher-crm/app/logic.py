"""Общая логика поверх базы: расчёт абонементов, задолженностей, сводок.

Держим здесь всё, что считается из нескольких таблиц, чтобы роутеры остались
тонкими, а правила счёта жили в одном месте.
"""

from datetime import date, datetime, timedelta

from .db import connect, get_settings

DONE = "done"
PLANNED = "planned"
CANCELLED = "cancelled"
NO_SHOW = "no_show"                 # ученик не пришёл и не предупредил
MOVED_TEACHER = "moved_teacher"     # перенесено преподавателем
MOVED_STUDENT = "moved_student"     # перенесено учеником
MOVED = "moved"                     # старый общий статус — остаётся ради прежних записей

MOVED_ANY = (MOVED, MOVED_TEACHER, MOVED_STUDENT)
STATUS_LIST = (PLANNED, DONE, MOVED_TEACHER, MOVED_STUDENT, NO_SHOW, CANCELLED, MOVED)


def no_show_counts() -> bool:
    """Считать ли пропуск проведённым занятием. Настраивается в «Настройках»."""
    return str(get_settings().get("no_show_counts", "1")) not in ("", "0", "false")


def spent_statuses() -> tuple:
    """Статусы, которые списывают занятие с абонемента и попадают в начисление."""
    return (DONE, NO_SHOW) if no_show_counts() else (DONE,)


def today_iso() -> str:
    return date.today().isoformat()


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def week_start(value: str) -> str:
    d = parse_date(value)
    return (d - timedelta(days=d.weekday())).isoformat()


def add_days(value: str, days: int) -> str:
    return (parse_date(value) + timedelta(days=days)).isoformat()


def parse_weekdays(value) -> list:
    """Дни недели абонемента. Хранятся строкой «1,3,5», где 1 — понедельник."""
    if value is None or value == "":
        return []
    items = value if isinstance(value, (list, tuple)) else str(value).split(",")
    out = []
    for item in items:
        item = str(item).strip()
        if item.isdigit() and 1 <= int(item) <= 7 and int(item) not in out:
            out.append(int(item))
    return sorted(out)


def package_dates(start: str, weekdays, count: int) -> list:
    """Даты занятий абонемента: от даты начала по выбранным дням недели.

    Считаем ровно столько дат, сколько занятий в абонементе, — последняя из них
    и есть день окончания. Дата начала участвует, если попадает в выбранный день.
    """
    days = parse_weekdays(weekdays)
    count = int(count or 0)
    if not days or count <= 0:
        return []
    out, cursor, guard = [], parse_date(start), 0
    while len(out) < count and guard < 4000:
        if cursor.isoweekday() in days:
            out.append(cursor.isoformat())
        cursor += timedelta(days=1)
        guard += 1
    return out


# --------------------------------------------------------------- абонементы ---

def package_state(conn, package: dict) -> dict:
    """Сколько занятий списано, сколько осталось и в каком абонемент состоянии.

    Списываются проведённые занятия и — если так настроено — пропуски.
    Отменённое или перенесённое занятие возвращается в абонемент само собой:
    оно просто не считается.
    """
    spent = spent_statuses()
    used = conn.execute(
        f"SELECT COUNT(*) AS n FROM lessons WHERE package_id = ? AND status IN ({','.join('?' * len(spent))})",
        (package["id"], *spent),
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
    spent = spent_statuses()
    charged_single = conn.execute(
        "SELECT COALESCE(SUM(price), 0) AS s FROM lessons "
        f"WHERE student_id = ? AND package_id IS NULL AND price IS NOT NULL "
        f"AND status IN ({','.join('?' * len(spent))})",
        (student_id, *spent),
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
