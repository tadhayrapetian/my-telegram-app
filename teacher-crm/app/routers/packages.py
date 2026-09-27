"""Абонементы: покупка, правка, остаток, предупреждения.

Остаток считается «всего минус проведённые» — поэтому отмена занятия
возвращает его в абонемент сама, без отдельной операции возврата.
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import connect
from ..logic import package_state, packages_of, parse_date, today_iso

router = APIRouter(prefix="/api/packages", tags=["packages"])

WARN_LESSONS = 2   # считаем «на исходе», когда осталось столько или меньше
WARN_DAYS = 7      # и когда до конца срока осталось столько дней или меньше


class PackageIn(BaseModel):
    student_id: int
    lessons_total: int
    purchased_on: str
    expires_on: str | None = None
    price: float = 0
    note: str = ""
    pay_now: bool = False           # сразу записать оплату на всю сумму
    payment_method: str = ""


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
    now = datetime.now().isoformat(timespec="seconds")
    with connect() as conn:
        student = conn.execute("SELECT 1 FROM students WHERE id = ?", (data.student_id,)).fetchone()
        if not student:
            raise HTTPException(404, "Ученик не найден")
        cur = conn.execute(
            "INSERT INTO packages (student_id, lessons_total, purchased_on, expires_on, price, note, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (data.student_id, data.lessons_total, data.purchased_on, data.expires_on or None,
             data.price, data.note, now),
        )
        pack_id = cur.lastrowid
        if data.pay_now and data.price:
            conn.execute(
                "INSERT INTO payments (student_id, package_id, amount, paid_on, method, status, note, created_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (data.student_id, pack_id, data.price, data.purchased_on, data.payment_method,
                 "paid", "Оплата абонемента", now),
            )
        # запланированные занятия без абонемента подхватываем в новый
        conn.execute(
            "UPDATE lessons SET package_id = ? WHERE student_id = ? AND package_id IS NULL "
            "AND status = 'planned' AND date >= ?",
            (pack_id, data.student_id, data.purchased_on),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM packages WHERE id = ?", (pack_id,)).fetchone()
        return package_state(conn, dict(row))


@router.put("/{package_id}")
def update_package(package_id: int, data: PackageIn):
    with connect() as conn:
        row = conn.execute("SELECT * FROM packages WHERE id = ?", (package_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Абонемент не найден")
        conn.execute(
            "UPDATE packages SET lessons_total=?, purchased_on=?, expires_on=?, price=?, note=? WHERE id=?",
            (data.lessons_total, data.purchased_on, data.expires_on or None, data.price, data.note, package_id),
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
