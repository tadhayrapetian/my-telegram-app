"""Ученики: список с поиском, карточка, создание, правка, архив, удаление."""

from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import connect
from ..logic import student_brief, student_card

router = APIRouter(prefix="/api/students", tags=["students"])


class StudentIn(BaseModel):
    name: str
    contact: str = ""
    level: str = ""
    schedule: str = ""
    goals: str = ""
    notes: str = ""
    archived: bool = False


@router.get("")
def list_students(q: str = "", archived: int = 0):
    """Список учеников. q ищет по имени, контакту, уровню и целям."""
    sql = "SELECT * FROM students WHERE archived = ?"
    args = [1 if archived else 0]
    if q.strip():
        sql += " AND (name LIKE ? OR contact LIKE ? OR level LIKE ? OR goals LIKE ?)"
        like = f"%{q.strip()}%"
        args += [like, like, like, like]
    sql += " ORDER BY name COLLATE NOCASE"
    with connect() as conn:
        rows = conn.execute(sql, args).fetchall()
        return [student_brief(conn, r) for r in rows]


@router.get("/{student_id}")
def get_student(student_id: int):
    with connect() as conn:
        card = student_card(conn, student_id)
    if not card:
        raise HTTPException(404, "Ученик не найден")
    return card


@router.post("")
def create_student(data: StudentIn):
    if not data.name.strip():
        raise HTTPException(400, "Имя обязательно")
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO students (name, contact, level, schedule, goals, notes, archived, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (data.name.strip(), data.contact, data.level, data.schedule, data.goals,
             data.notes, int(data.archived), datetime.now().isoformat(timespec="seconds")),
        )
        conn.commit()
        return student_card(conn, cur.lastrowid)


@router.put("/{student_id}")
def update_student(student_id: int, data: StudentIn):
    with connect() as conn:
        exists = conn.execute("SELECT 1 FROM students WHERE id = ?", (student_id,)).fetchone()
        if not exists:
            raise HTTPException(404, "Ученик не найден")
        conn.execute(
            "UPDATE students SET name=?, contact=?, level=?, schedule=?, goals=?, notes=?, archived=? "
            "WHERE id=?",
            (data.name.strip(), data.contact, data.level, data.schedule, data.goals,
             data.notes, int(data.archived), student_id),
        )
        conn.commit()
        return student_card(conn, student_id)


@router.delete("/{student_id}")
def delete_student(student_id: int):
    """Удаляет ученика со всем, что к нему привязано. Действие необратимо."""
    with connect() as conn:
        conn.execute("DELETE FROM students WHERE id = ?", (student_id,))
        conn.commit()
    return {"ok": True}
