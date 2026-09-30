"""Кабинет ученика и переписка.

Ученик открывает свою страницу по ссылке /s/<токен> и вводит код из карточки.
После этого в браузере остаётся подписанная cookie на неделю — код больше
не спрашивают. Никаких паролей и регистраций.
"""

import hashlib
import hmac
import secrets
import time
from datetime import datetime

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel

from ..db import FILES_DIR, connect, get_settings, set_settings
from ..logic import PLANNED, packages_of, student_money, today_iso
from .materials import safe_name

router = APIRouter(prefix="/api/portal", tags=["portal"])

COOKIE = "slate_portal"
COOKIE_DAYS = 7
MAX_FILE = 50 * 1024 * 1024


def _secret() -> str:
    """Ключ для подписи cookie. Создаётся один раз и живёт в настройках."""
    s = get_settings()
    key = s.get("portal_secret") or ""
    if not key:
        key = secrets.token_urlsafe(32)
        with connect() as conn:
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('portal_secret', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key,))
            conn.commit()
    return key


def _sign(student_id: int, until: int) -> str:
    raw = f"{student_id}.{until}"
    mac = hmac.new(_secret().encode(), raw.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{raw}.{mac}"


def _check(value: str):
    try:
        sid, until, mac = value.split(".")
        if int(until) < int(time.time()):
            return None
        expect = hmac.new(_secret().encode(), f"{sid}.{until}".encode(), hashlib.sha256).hexdigest()[:32]
        return int(sid) if hmac.compare_digest(mac, expect) else None
    except Exception:
        return None


def current_student(request: Request):
    raw = request.cookies.get(COOKIE)
    return _check(raw) if raw else None


# ------------------------------------------------------------------ данные ---

def portal_payload(conn, student_id: int) -> dict:
    row = conn.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
    if not row:
        return None
    student = dict(row)
    packs = packages_of(conn, student_id)
    active = next((p for p in packs if p["status"] == "active"), None)
    upcoming = [dict(r) for r in conn.execute(
        "SELECT date, time, topic, homework, duration FROM lessons "
        "WHERE student_id = ? AND date >= ? AND status = ? ORDER BY date, time LIMIT 6",
        (student_id, today_iso(), PLANNED))]
    payments = [dict(r) for r in conn.execute(
        "SELECT amount, paid_on, method, status FROM payments WHERE student_id = ? "
        "ORDER BY paid_on DESC LIMIT 6", (student_id,))]
    materials = [dict(r) for r in conn.execute(
        "SELECT id, title, kind, url, mime, size, created_at FROM materials "
        "WHERE student_id = ? AND kind != 'photo' ORDER BY created_at DESC", (student_id,))]
    for m in materials:
        m["open_url"] = f"/api/materials/{m['id']}/file" if m["kind"] == "file" else m["url"]
    photo = conn.execute(
        "SELECT id FROM materials WHERE student_id = ? AND kind = 'photo' ORDER BY created_at DESC LIMIT 1",
        (student_id,)).fetchone()
    messages = []
    for r in conn.execute("SELECT * FROM messages WHERE student_id = ? ORDER BY created_at", (student_id,)):
        m = dict(r)
        item = {"id": m["id"], "author": m["author"], "text": m["text"], "created": m["created_at"], "file": None}
        if m["material_id"]:
            f = conn.execute("SELECT id, title, kind, mime FROM materials WHERE id = ?", (m["material_id"],)).fetchone()
            if f:
                item["file"] = {"id": f["id"], "title": f["title"], "mime": f["mime"],
                                "open_url": f"/api/materials/{f['id']}/file"}
        messages.append(item)

    settings = get_settings()
    return {
        "student": {"name": student["name"], "level": student["level"], "goals": student["goals"]},
        "teacher": settings.get("teacher_name", ""),
        "currency": settings.get("currency", "֏"),
        "lessons_left": active["left"] if active else 0,
        "pack_until": active["expires_on"] if active else None,
        "debt": student_money(conn, student_id)["debt"],
        "upcoming": upcoming,
        "payments": payments,
        "materials": materials,
        "messages": messages,
        "photo_url": f"/api/materials/{photo['id']}/file" if photo else None,
    }


# ------------------------------------------------------------------- вход ---

class EnterIn(BaseModel):
    token: str
    code: str


@router.post("")
def enter(data: EnterIn, response: Response):
    with connect() as conn:
        row = conn.execute("SELECT * FROM students WHERE portal_token = ?", (data.token.strip(),)).fetchone()
        if not row:
            raise HTTPException(404, "Ссылка не работает")
        if str(row["portal_code"]) != data.code.strip():
            raise HTTPException(403, "Неверный код")
        payload = portal_payload(conn, row["id"])
    until = int(time.time()) + COOKIE_DAYS * 86400
    response.set_cookie(COOKIE, _sign(row["id"], until), max_age=COOKIE_DAYS * 86400,
                        httponly=True, samesite="lax")
    return payload


@router.get("/data")
def data(request: Request):
    sid = current_student(request)
    if not sid:
        raise HTTPException(401, "Нужен код")
    with connect() as conn:
        payload = portal_payload(conn, sid)
    if not payload:
        raise HTTPException(404, "Не найдено")
    return payload


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE)
    return {"ok": True}


# -------------------------------------------------------------- переписка ---

class MessageIn(BaseModel):
    text: str = ""
    material_id: int | None = None


@router.post("/message")
def portal_message(data: MessageIn, request: Request):
    sid = current_student(request)
    if not sid:
        raise HTTPException(401, "Нужен код")
    text = (data.text or "").strip()[:4000]
    if not text and not data.material_id:
        raise HTTPException(400, "Пустое сообщение")
    with connect() as conn:
        conn.execute(
            "INSERT INTO messages (student_id, author, text, material_id, created_at) VALUES (?,?,?,?,?)",
            (sid, "student", text, data.material_id, datetime.now().isoformat(timespec="seconds")))
        conn.commit()
    return {"ok": True}


@router.post("/upload")
async def portal_upload(request: Request, file: UploadFile = File(...), kind: str = Form("file")):
    """Ученик присылает файл или своё фото."""
    sid = current_student(request)
    if not sid:
        raise HTTPException(401, "Нужен код")
    kind = "photo" if kind == "photo" else "file"

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

    now = datetime.now().isoformat(timespec="seconds")
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO materials (student_id, title, kind, url, filename, mime, size, note, created_at) "
            "VALUES (?,?,?,'',?,?,?,?,?)",
            (sid, name, kind, target.name, file.content_type or "application/octet-stream",
             size, "от ученика", now))
        material_id = cur.lastrowid
        if kind == "file":
            conn.execute(
                "INSERT INTO messages (student_id, author, text, material_id, created_at) VALUES (?,?,?,?,?)",
                (sid, "student", "", material_id, now))
        conn.commit()
    return {"ok": True, "material_id": material_id}


# ------------------------------------------------- сторона преподавателя ---

teacher = APIRouter(prefix="/api/students", tags=["portal"])


class TeacherMessageIn(BaseModel):
    text: str = ""
    material_id: int | None = None


@teacher.get("/{student_id}/portal")
def portal_link(student_id: int):
    """Ссылка и код для ученика."""
    with connect() as conn:
        row = conn.execute("SELECT portal_token, portal_code, name FROM students WHERE id = ?",
                           (student_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Ученик не найден")
        token, code = row["portal_token"], row["portal_code"]
        if not token or not code:
            token = secrets.token_urlsafe(16)
            code = f"{secrets.randbelow(9000) + 1000}"
            conn.execute("UPDATE students SET portal_token = ?, portal_code = ? WHERE id = ?",
                         (token, code, student_id))
            conn.commit()
    return {"path": f"/s/{token}", "code": code, "name": row["name"]}


@teacher.post("/{student_id}/portal/reset")
def portal_reset(student_id: int):
    """Новый код и новая ссылка — если старую увидел кто-то посторонний."""
    with connect() as conn:
        token, code = secrets.token_urlsafe(16), f"{secrets.randbelow(9000) + 1000}"
        conn.execute("UPDATE students SET portal_token = ?, portal_code = ? WHERE id = ?",
                     (token, code, student_id))
        conn.commit()
    return {"path": f"/s/{token}", "code": code}


@teacher.get("/{student_id}/messages")
def list_messages(student_id: int):
    with connect() as conn:
        out = []
        for r in conn.execute("SELECT * FROM messages WHERE student_id = ? ORDER BY created_at", (student_id,)):
            m = dict(r)
            item = {"id": m["id"], "author": m["author"], "text": m["text"],
                    "created": m["created_at"], "file": None}
            if m["material_id"]:
                f = conn.execute("SELECT id, title, kind, mime FROM materials WHERE id = ?",
                                 (m["material_id"],)).fetchone()
                if f:
                    item["file"] = {"id": f["id"], "title": f["title"], "mime": f["mime"],
                                    "open_url": f"/api/materials/{f['id']}/file"}
            out.append(item)
        return out


@teacher.post("/{student_id}/messages")
def add_message(student_id: int, data: TeacherMessageIn):
    text = (data.text or "").strip()[:4000]
    if not text and not data.material_id:
        raise HTTPException(400, "Пустое сообщение")
    with connect() as conn:
        conn.execute(
            "INSERT INTO messages (student_id, author, text, material_id, created_at) VALUES (?,?,?,?,?)",
            (student_id, "teacher", text, data.material_id, datetime.now().isoformat(timespec="seconds")))
        conn.commit()
    return {"ok": True}
