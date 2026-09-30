"""Абонементы: покупка, правка, остаток, предупреждения.

Остаток считается «всего минус проведённые» — поэтому отмена занятия
возвращает его в абонемент сама, без отдельной операции возврата.
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import connect, get_settings
from ..logic import PLANNED, package_dates, package_state, packages_of, parse_date, parse_weekdays, today_iso

router = APIRouter(prefix="/api/packages", tags=["packages"])

WARN_LESSONS = 2   # считаем «на исходе», когда осталось столько или меньше
WARN_DAYS = 7      # и когда до конца срока осталось столько дней или меньше


class PackageIn(BaseModel):
    student_id: int
    lessons_total: int
    purchased_on: str               # день начала абонемента
    expires_on: str | None = None   # считается сам, если заданы дни недели
    price: float = 0
    note: str = ""
    pay_now: bool = False           # сразу записать оплату на всю сумму
    payment_method: str = ""
    weekdays: list[int] = []        # 1 — понедельник … 7 — воскресенье
    lesson_time: str = ""           # время занятий, например 17:00
    create_lessons: bool = True     # поставить занятия в расписание


class PreviewIn(BaseModel):
    lessons_total: int
    purchased_on: str
    weekdays: list[int] = []


@router.post("/preview")
def preview(data: PreviewIn):
    """Даты занятий и последний день — чтобы показать их ещё до сохранения."""
    dates = package_dates(data.purchased_on, data.weekdays, data.lessons_total)
    return {"dates": dates, "last": dates[-1] if dates else None, "count": len(dates)}


@router.get("")
def list_packages(student_id: int = 0, status: str = ""):
    with connect() as conn:
        if student_id:
            rows = conn.execute("SELECT * FROM packages WHERE student_id = ? ORDER BY purchased_on DESC", (student_id,))
        else:
            rows = conn.execute("SELECT * FROM packages ORDER BY purchased_on DESC")
        packs = [package_state(conn, dict(r)) for r in rows]
        for p in packs:
            st = conn.execute("SELECT name FROM students WHERE id = ?", (p["student_id"],)).fetchone()
            p["student_name"] = st["name"] if st else "—"
    if status:
        packs = [p for p in packs if p["status"] == status]
    return packs


@router.get("/warnings")
def warnings():
    """Абонементы на исходе: мало занятий или скоро кончается срок."""
    out = []
    for p in list_packages():
        if p["status"] != "active":
            continue
        low_lessons = p["left"] <= WARN_LESSONS
        soon_expiry = p["days_left"] is not None and p["days_left"] <= WARN_DAYS
        if low_lessons or soon_expiry:
            p["reason"] = "lessons" if low_lessons and not soon_expiry else ("expiry" if soon_expiry and not low_lessons else "both")
            out.append(p)
    out.sort(key=lambda p: (p["left"], p["days_left"] if p["days_left"] is not None else 999))
    return out


@router.post("")
def create_package(data: PackageIn):
    if data.lessons_total <= 0:
        raise HTTPException(400, "Количество занятий должно быть больше нуля")
    if data.expires_on:
        try:
            parse_date(data.expires_on)
        except ValueError:
            raise HTTPException(400, "Неверная дата окончания")
    days = parse_weekdays(data.weekdays)
    dates = package_dates(data.purchased_on, days, data.lessons_total)
    # дни недели заданы — последний день считаем сами, руками его задавать не нужно
    expires_on = (dates[-1] if dates else None) or data.expires_on or None
    now = datetime.now().isoformat(timespec="seconds")
    settings = get_settings()
    with connect() as conn:
        student = conn.execute("SELECT 1 FROM students WHERE id = ?", (data.student_id,)).fetchone()
        if not student:
            raise HTTPException(404, "Ученик не найден")
        cur = conn.execute(
            "INSERT INTO packages (student_id, lessons_total, purchased_on, expires_on, price, note, "
            "weekdays, lesson_time, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (data.student_id, data.lessons_total, data.purchased_on, expires_on,
             data.price, data.note, ",".join(str(d) for d in days), data.lesson_time, now),
        )
        pack_id = cur.lastrowid
        if data.pay_now and data.price:
            conn.execute(
                "INSERT INTO payments (student_id, package_id, amount, paid_on, method, status, note, created_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (data.student_id, pack_id, data.price, data.purchased_on, data.payment_method,
                 "paid", "Оплата абонемента", now),
            )
        created = 0
        if dates and data.create_lessons:
            # занятия абонемента сразу встают в расписание — по выбранным дням
            time_value = data.lesson_time or "17:00"
            duration = int(settings.get("default_duration") or 60)
            busy = {
                r["date"] for r in conn.execute(
                    "SELECT date FROM lessons WHERE student_id = ? AND time = ? AND status != 'cancelled'",
                    (data.student_id, time_value),
                )
            }
            for day in dates:
                if day in busy:      # занятие в этот день и час уже есть — не дублируем
                    continue
                conn.execute(
                    "INSERT INTO lessons (student_id, package_id, date, time, duration, status, created_at) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (data.student_id, pack_id, day, time_value, duration, PLANNED, now),
                )
                created += 1
        else:
            # без дней недели поведение прежнее: подхватываем занятия без абонемента
            conn.execute(
                "UPDATE lessons SET package_id = ? WHERE student_id = ? AND package_id IS NULL "
                "AND status = 'planned' AND date >= ?",
                (pack_id, data.student_id, data.purchased_on),
            )
        conn.commit()
        row = conn.execute("SELECT * FROM packages WHERE id = ?", (pack_id,)).fetchone()
        out = package_state(conn, dict(row))
        out["lessons_created"] = created
        out["dates"] = dates
        return out


@router.put("/{package_id}")
def update_package(package_id: int, data: PackageIn):
    with connect() as conn:
        row = conn.execute("SELECT * FROM packages WHERE id = ?", (package_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Абонемент не найден")
        days = parse_weekdays(data.weekdays)
        dates = package_dates(data.purchased_on, days, data.lessons_total)
        expires_on = (dates[-1] if dates else None) or data.expires_on or None
        conn.execute(
            "UPDATE packages SET lessons_total=?, purchased_on=?, expires_on=?, price=?, note=?, "
            "weekdays=?, lesson_time=? WHERE id=?",
            (data.lessons_total, data.purchased_on, expires_on, data.price, data.note,
             ",".join(str(d) for d in days), data.lesson_time, package_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM packages WHERE id = ?", (package_id,)).fetchone()
        return package_state(conn, dict(row))


@router.get("/{package_id}")
def get_package(package_id: int):
    with connect() as conn:
        row = conn.execute("SELECT * FROM packages WHERE id = ?", (package_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Абонемент не найден")
        pack = package_state(conn, dict(row))
        pack["lessons"] = [
            dict(r) for r in conn.execute(
                "SELECT * FROM lessons WHERE package_id = ? ORDER BY date, time", (package_id,))
        ]
        return pack


@router.delete("/{package_id}")
def delete_package(package_id: int):
    """Удаляет абонемент. Занятия остаются, но перестают быть к нему привязаны."""
    with connect() as conn:
        conn.execute("UPDATE lessons SET package_id = NULL WHERE package_id = ?", (package_id,))
        conn.execute("DELETE FROM packages WHERE id = ?", (package_id,))
        conn.commit()
    return {"ok": True}
