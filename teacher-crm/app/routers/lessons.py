"""Занятия: календарь, создание, правка, статусы, перенос и отмена.

Правила, на которых всё держится:
  * из абонемента списываются только проведённые занятия;
  * отмена возвращает занятие в абонемент — просто потому, что отменённое
    не считается проведённым;
  * перенос не теряет историю: старое занятие получает статус moved, новое
    ссылается на него через moved_from_id и хранит причину переноса.
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import connect
from ..logic import CANCELLED, DONE, MOVED, PLANNED, active_package, add_days, today_iso, week_start

router = APIRouter(prefix="/api/lessons", tags=["lessons"])

STATUSES = {PLANNED, DONE, CANCELLED, MOVED}


class LessonIn(BaseModel):
    student_id: int
    date: str
    time: str = "17:00"
    duration: int = 60
    topic: str = ""
    materials_note: str = ""
    homework: str = ""
    notes: str = ""
    status: str = PLANNED
    price: float | None = None
    package_id: int | None = None
    use_package: bool = True          # привязать к активному абонементу автоматически
    repeat_weeks: int = 0             # повторить еженедельно N раз


class StatusIn(BaseModel):
    status: str
    notes: str | None = None
    homework: str | None = None


class MoveIn(BaseModel):
    date: str
    time: str | None = None
    reason: str = ""


def _with_student(conn, rows) -> list:
    out = []
    for r in rows:
        item = dict(r)
        st = conn.execute("SELECT name, level FROM students WHERE id = ?", (item["student_id"],)).fetchone()
        item["student_name"] = st["name"] if st else "—"
        item["student_level"] = st["level"] if st else ""
        out.append(item)
    return out


@router.get("")
def list_lessons(start: str = "", end: str = "", student_id: int = 0, status: str = "", q: str = ""):
    """Занятия за период. Без параметров — текущая неделя."""
    if not start:
        start = week_start(today_iso())
    if not end:
        end = add_days(start, 6)
    sql = "SELECT * FROM lessons WHERE date BETWEEN ? AND ?"
    args = [start, end]
    if student_id:
        sql += " AND student_id = ?"
        args.append(student_id)
    if status:
        sql += " AND status = ?"
        args.append(status)
    if q.strip():
        sql += " AND (topic LIKE ? OR homework LIKE ? OR notes LIKE ?)"
        like = f"%{q.strip()}%"
        args += [like, like, like]
    sql += " ORDER BY date, time"
    with connect() as conn:
        return _with_student(conn, conn.execute(sql, args).fetchall())


@router.get("/unmarked")
def unmarked():
    """Прошедшие занятия, которые всё ещё висят в планах — их надо отметить."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM lessons WHERE status = ? AND date < ? ORDER BY date DESC, time DESC",
            (PLANNED, today_iso()),
        ).fetchall()
        return _with_student(conn, rows)


@router.get("/{lesson_id}")
def get_lesson(lesson_id: int):
    with connect() as conn:
        row = conn.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Занятие не найдено")
        item = _with_student(conn, [row])[0]
        # цепочка переносов: откуда пришло и куда ушло
        item["moved_from"] = None
        if item.get("moved_from_id"):
            prev = conn.execute("SELECT id, date, time FROM lessons WHERE id = ?", (item["moved_from_id"],)).fetchone()
            item["moved_from"] = dict(prev) if prev else None
        nxt = conn.execute("SELECT id, date, time FROM lessons WHERE moved_from_id = ?", (lesson_id,)).fetchone()
        item["moved_to"] = dict(nxt) if nxt else None
        item["materials"] = [
            dict(r) for r in conn.execute("SELECT * FROM materials WHERE lesson_id = ?", (lesson_id,))
        ]
        return item


def _insert(conn, data: LessonIn, date_value: str, package_id):
    cur = conn.execute(
        "INSERT INTO lessons (student_id, package_id, date, time, duration, topic, materials_note, "
        "homework, notes, status, price, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (data.student_id, package_id, date_value, data.time, data.duration, data.topic,
         data.materials_note, data.homework, data.notes, data.status, data.price,
         datetime.now().isoformat(timespec="seconds")),
    )
    return cur.lastrowid


@router.post("")
def create_lesson(data: LessonIn):
    if data.status not in STATUSES:
        raise HTTPException(400, "Неизвестный статус")
    with connect() as conn:
        student = conn.execute("SELECT 1 FROM students WHERE id = ?", (data.student_id,)).fetchone()
        if not student:
            raise HTTPException(404, "Ученик не найден")

        package_id = data.package_id
        if package_id is None and data.use_package:
            pack = active_package(conn, data.student_id)
            package_id = pack["id"] if pack else None

        created = []
        for i in range(max(1, data.repeat_weeks + 1)):
            created.append(_insert(conn, data, add_days(data.date, i * 7), package_id))
        conn.commit()
        return {"ok": True, "ids": created, "count": len(created), "package_id": package_id}


@router.put("/{lesson_id}")
def update_lesson(lesson_id: int, data: LessonIn):
    with connect() as conn:
        row = conn.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Занятие не найдено")
        conn.execute(
            "UPDATE lessons SET student_id=?, package_id=?, date=?, time=?, duration=?, topic=?, "
            "materials_note=?, homework=?, notes=?, status=?, price=? WHERE id=?",
            (data.student_id, data.package_id, data.date, data.time, data.duration, data.topic,
             data.materials_note, data.homework, data.notes, data.status, data.price, lesson_id),
        )
        conn.commit()
    return get_lesson(lesson_id)


@router.post("/{lesson_id}/status")
def set_status(lesson_id: int, data: StatusIn):
    """Отметить занятие: проведено, отменено, вернуть в план.

    Списание с абонемента отдельной операции не требует: остаток считается
    как «всего минус проведённые», поэтому отмена сама возвращает занятие.
    """
    if data.status not in STATUSES:
        raise HTTPException(400, "Неизвестный статус")
    with connect() as conn:
        row = conn.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Занятие не найдено")
        fields = ["status = ?"]
        args = [data.status]
        if data.notes is not None:
            fields.append("notes = ?")
            args.append(data.notes)
        if data.homework is not None:
            fields.append("homework = ?")
            args.append(data.homework)
        args.append(lesson_id)
        conn.execute(f"UPDATE lessons SET {', '.join(fields)} WHERE id = ?", args)
        conn.commit()
    return get_lesson(lesson_id)


@router.post("/{lesson_id}/move")
def move_lesson(lesson_id: int, data: MoveIn):
    """Перенос: старое занятие помечается moved, создаётся новое со ссылкой на него."""
    with connect() as conn:
        row = conn.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Занятие не найдено")
        old = dict(row)
        cur = conn.execute(
            "INSERT INTO lessons (student_id, package_id, date, time, duration, topic, materials_note, "
            "homework, notes, status, price, moved_from_id, move_reason, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (old["student_id"], old["package_id"], data.date, data.time or old["time"], old["duration"],
             old["topic"], old["materials_note"], old["homework"], old["notes"], PLANNED, old["price"],
             lesson_id, data.reason, datetime.now().isoformat(timespec="seconds")),
        )
        new_id = cur.lastrowid
        conn.execute("UPDATE lessons SET status = ?, move_reason = ? WHERE id = ?",
                     (MOVED, data.reason, lesson_id))
        conn.commit()
    return get_lesson(new_id)


@router.delete("/{lesson_id}")
def delete_lesson(lesson_id: int):
    with connect() as conn:
        conn.execute("DELETE FROM lessons WHERE id = ?", (lesson_id,))
        conn.commit()
    return {"ok": True}
