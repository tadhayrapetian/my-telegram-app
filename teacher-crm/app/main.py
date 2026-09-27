"""Точка входа: FastAPI, статика, подключение роутеров.

Запуск для разработки:  uvicorn app.main:app --reload
Обычный запуск:         двойной клик по start.command
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .db import BASE_DIR, get_settings, init_db, set_settings
from .routers import dashboard, lessons, materials, packages, payments, students

app = FastAPI(title="CRM преподавателя английского", docs_url="/api/docs", redoc_url=None)

STATIC_DIR = BASE_DIR / "static"


@app.on_event("startup")
def on_startup() -> None:
    init_db()


app.include_router(students.router)
app.include_router(lessons.router)
app.include_router(packages.router)
app.include_router(payments.router)
app.include_router(materials.router)
app.include_router(dashboard.router)


@app.get("/api/settings")
def read_settings():
    return get_settings()


@app.put("/api/settings")
def write_settings(values: dict):
    return set_settings(values)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
