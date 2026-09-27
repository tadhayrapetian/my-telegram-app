"""Оплаты: приход денег, привязка к абонементу или занятию, задолженности."""

from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import connect
from ..logic import student_money

router = APIRouter(prefix="/api/payments", tags=["payments"])

METHODS = ["наличные", "перевод", "карта", "другое"]


class PaymentIn(BaseModel):
    student_id: int
    amount: float
    paid_on: str
    method: str = ""
    status: str = "paid"          # paid | pending
    package_id: int | None = None
    lesson_id: int | None = None
    note: str = ""


def _decorate(conn, rows) -> list:
    out = []
    for r in rows:
        item = dict(r)
        st = conn.execute("SELECT name FROM students WHERE id = ?", (item["student_id"],)).fetchone()
        item["student_name"] = st["name"] if st else "—"
        if item.get("package_id"):
            pk = conn.execute("SELECT lessons_total FROM packages WHERE id = ?", (item["package_id"],)).fetchone()
            item["package_lessons"] = pk["lessons_total"] if pk else None
        out.append(item)
    return out


@router.get("")
def list_payments(student_id: int = 0, status: str = "", start: str = "", end: str = "", q: str = ""):
    sql = "SELECT * FROM payments WHERE 1=1"
    args = []
    if student_id:
        sql += " AND student_id = ?"
        args.append(student_id)
    if status:
        sql += " AND status = ?"
        args.append(status)
    if start:
        sql += " AND paid_on >= ?"
        args.append(start)
    if end:
        sql += " AND paid_on <= ?"
        args.append(end)
    if q.strip():
        sql += " AND (note LIKE ? OR method LIKE ?)"
        like = f"%{q.strip()}%"
        args += [like, like]
    sql += " ORDER BY paid_on DESC, id DESC"
    with connect() as conn:
        return _decorate(conn, conn.execute(sql, args).fetchall())


@router.get("/debts")
def debts():
    """Кто сколько должен. Считаем по всем неархивным ученикам."""
    out = []
    with connect() as conn:
        for row in conn.execute("SELECT id, name FROM students WHERE archived = 0 ORDER BY name COLLATE NOCASE"):
            money = student_money(conn, row["id"])
            if money["debt"] > 0.004 or money["pending"] > 0.004:
                out.append({"student_id": row["id"], "student_name": row["name"], **money})
    out.sort(key=lambda x: -x["debt"])
    return out


@router.get("/summary")
def summary(start: str = "", end: str = ""):
    sql = "SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status='paid'"
    args = []
    if start:
        sql += " AND paid_on >= ?"
        args.append(start)
    if end:
        sql += " AND paid_on <= ?"
        args.append(end)
    with connect() as conn:
        total = conn.execute(sql, args).fetchone()["s"]
        by_month = [
            dict(r) for r in conn.execute(
                "SELECT substr(paid_on,1,7) AS month, COALESCE(SUM(amount),0) AS total "
                "FROM payments WHERE status='paid' GROUP BY month ORDER BY month DESC LIMIT 12")
        ]
    return {"total": round(total, 2), "by_month": by_month}


@router.post("")
def create_payment(data: PaymentIn):
    if data.status not in ("paid", "pending"):
        raise HTTPException(400, "Статус может быть paid или pending")
    with connect() as conn:
        if not conn.execute("SELECT 1 FROM students WHERE id = ?", (data.student_id,)).fetchone():
            raise HTTPException(404, "Ученик не найден")
        cur = conn.execute(
            "INSERT INTO payments (student_id, package_id, lesson_id, amount, paid_on, method, status, note, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (data.student_id, data.package_id, data.lesson_id, data.amount, data.paid_on,
             data.method, data.status, data.note, datetime.now().isoformat(timespec="seconds")),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM payments WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _decorate(conn, [row])[0]


@router.put("/{payment_id}")
def update_payment(payment_id: int, data: PaymentIn):
    with connect() as conn:
        if not conn.execute("SELECT 1 FROM payments WHERE id = ?", (payment_id,)).fetchone():
            raise HTTPException(404, "Оплата не найдена")
        conn.execute(
            "UPDATE payments SET student_id=?, package_id=?, lesson_id=?, amount=?, paid_on=?, "
            "method=?, status=?, note=? WHERE id=?",
            (data.student_id, data.package_id, data.lesson_id, data.amount, data.paid_on,
             data.method, data.status, data.note, payment_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM payments WHERE id = ?", (payment_id,)).fetchone()
        return _decorate(conn, [row])[0]


@router.delete("/{payment_id}")
def delete_payment(payment_id: int):
    with connect() as conn:
        conn.execute("DELETE FROM payments WHERE id = ?", (payment_id,))
        conn.commit()
    return {"ok": True}
