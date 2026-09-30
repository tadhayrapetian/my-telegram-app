"""Материалы: файлы и ссылки, привязанные к ученику и занятию."""

import shutil
import unicodedata
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..db import FILES_DIR, connect

router = APIRouter(prefix="/api/materials", tags=["materials"])

MAX_FILE = 50 * 1024 * 1024  # 50 МБ на файл — всё лежит на своём компьютере


class MaterialIn(BaseModel):
    title: str
    url: str = ""
    student_id: int | None = None
    lesson_id: int | None = None
    note: str = ""


def safe_name(name: str) -> str:
    """Оставляем понятное имя файла, но без сюрпризов вроде ../ и слэшей."""
    name = unicodedata.normalize("NFC", name or "файл")
    name = name.replace("\\", "/").split("/")[-1]
    return name[:120] or "файл"


def _decorate(conn, rows) -> list:
    out = []
    for r in rows:
        item = dict(r)
        if item.get("student_id"):
            st = conn.execute("SELECT name FROM students WHERE id = ?", (item["student_id"],)).fetchone()
            item["student_name"] = st["name"] if st else None
        else:
            item["student_name"] = None
        if item.get("lesson_id"):
            ls = conn.execute("SELECT date, time, topic FROM lessons WHERE id = ?", (item["lesson_id"],)).fetchone()
            item["lesson"] = dict(ls) if ls else None
        else:
            item["lesson"] = None
        item["download_url"] = f"/api/materials/{item['id']}/file" if item["kind"] == "file" else item["url"]
        out.append(item)
    return out


@router.get("")
def list_materials(student_id: int = 0, lesson_id: int = 0, q: str = ""):
    sql = "SELECT * FROM materials WHERE 1=1"
    args = []
    if student_id:
        sql += " AND student_id = ?"
        args.append(student_id)
    if lesson_id:
        sql += " AND lesson_id = ?"
        args.append(lesson_id)
    if q.strip():
        sql += " AND (title LIKE ? OR note LIKE ? OR filename LIKE ?)"
        like = f"%{q.strip()}%"
        args += [like, like, like]
    sql += " ORDER BY created_at DESC"
    with connect() as conn:
        return _decorate(conn, conn.execute(sql, args).fetchall())


@router.post("/link")
def add_link(data: MaterialIn):
    if not data.title.strip():
        raise HTTPException(400, "Название обязательно")
    if not data.url.strip():
        raise HTTPException(400, "Ссылка обязательна")
    url = data.url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url.lstrip("/")
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO materials (student_id, lesson_id, title, kind, url, note, created_at) "
            "VALUES (?,?,?,'link',?,?,?)",
            (data.student_id, data.lesson_id, data.title.strip(), url, data.note,
             datetime.now().isoformat(timespec="seconds")),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM materials WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _decorate(conn, [row])[0]


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    title: str = Form(""),
    student_id: int = Form(0),
    lesson_id: int = Form(0),
    note: str = Form(""),
):
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    name = safe_name(file.filename)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = FILES_DIR / f"{stamp}-{name}"
    n = 2
    while target.exists():
        target = FILES_DIR / f"{stamp}-{n}-{name}"
        n += 1

    size = 0
    with target.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_FILE:
                out.close()
                target.unlink(missing_ok=True)
                raise HTTPException(413, "Файл больше 50 МБ")
            out.write(chunk)

    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO materials (student_id, lesson_id, title, kind, url, filename, mime, size, note, created_at) "
            "VALUES (?,?,?,'file','',?,?,?,?,?)",
            (student_id or None, lesson_id or None, (title.strip() or name), target.name,
             file.content_type or "application/octet-stream", size, note,
             datetime.now().isoformat(timespec="seconds")),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM materials WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _decorate(conn, [row])[0]


@router.get("/{material_id}/file")
def get_file(material_id: int):
    with connect() as conn:
        row = conn.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
    if not row or row["kind"] != "file":
        raise HTTPException(404, "Файл не найден")
    path = FILES_DIR / row["filename"]
    if not path.exists():
        raise HTTPException(404, "Файл не найден на диске")
    return FileResponse(path, media_type=row["mime"] or "application/octet-stream",
                        filename=row["title"] or row["filename"])


@router.delete("/{material_id}")
def delete_material(material_id: int):
    with connect() as conn:
        row = conn.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
        if row and row["kind"] == "file" and row["filename"]:
            (FILES_DIR / row["filename"]).unlink(missing_ok=True)
        conn.execute("DELETE FROM materials WHERE id = ?", (material_id,))
        conn.commit()
    return {"ok": True}
