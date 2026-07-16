#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Instagram Follower Tracker — версия с окном (без терминала).

Запуск двойным щелчком по файлу «Запустить трекер.command» (macOS)
или командой: python3 app.py
"""

import json
import os
import threading
import tkinter as tk
from tkinter import font as tkfont
from tkinter import ttk

import tracker

SETTINGS_PATH = os.path.join(tracker.HISTORY_DIR, "_settings.json")

INTERVALS = {
    "каждые 30 минут": 30 * 60,
    "каждый час": 60 * 60,
    "каждые 3 часа": 3 * 60 * 60,
    "каждые 6 часов": 6 * 60 * 60,
}

# Цвета только для акцентов — фон и текст оставляем системными,
# чтобы окно корректно выглядело на любой версии macOS.
GREEN = "#1E8E3E"
RED = "#D93025"
MUTED = "#777777"


def load_settings() -> dict:
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_settings(settings: dict) -> None:
    os.makedirs(tracker.HISTORY_DIR, exist_ok=True)
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.timer_id = None
        self.busy = False

        root.title("Подписчики Instagram")
        root.geometry("440x640")
        root.minsize(400, 560)

        settings = load_settings()

        self.big = tkfont.Font(size=44, weight="bold")
        body = tkfont.Font(size=13)
        small = tkfont.Font(size=11)
        mono = tkfont.Font(family="Menlo", size=12)

        outer = ttk.Frame(root, padding=20)
        outer.pack(fill="both", expand=True)

        ttk.Label(outer, text="Аккаунт Instagram (без @):",
                  foreground=MUTED, font=small).pack(anchor="w")

        row = ttk.Frame(outer)
        row.pack(fill="x", pady=(4, 0))
        self.username_var = tk.StringVar(value=settings.get("username", ""))
        entry = ttk.Entry(row, textvariable=self.username_var, font=body)
        entry.pack(side="left", fill="x", expand=True, ipady=4)
        entry.bind("<Return>", lambda e: self.check())

        self.check_btn = ttk.Button(row, text="Проверить", command=self.check)
        self.check_btn.pack(side="left", padx=(10, 0))

        self.name_label = ttk.Label(outer, text="—", foreground=MUTED,
                                    font=body, anchor="center")
        self.name_label.pack(fill="x", pady=(24, 0))

        self.count_label = ttk.Label(outer, text="· · ·", font=self.big,
                                     anchor="center")
        self.count_label.pack(fill="x")

        self.delta_label = ttk.Label(outer, text="подписчиков",
                                     foreground=MUTED, font=body,
                                     anchor="center")
        self.delta_label.pack(fill="x")

        self.extra_label = ttk.Label(outer, text="", foreground=MUTED,
                                     font=small, anchor="center")
        self.extra_label.pack(fill="x", pady=(4, 20))

        auto_row = ttk.Frame(outer)
        auto_row.pack(fill="x")
        self.auto_var = tk.BooleanVar(value=settings.get("auto", False))
        ttk.Checkbutton(auto_row, text="Обновлять автоматически",
                        variable=self.auto_var,
                        command=self.toggle_auto).pack(side="left")
        self.interval_var = tk.StringVar(
            value=settings.get("interval", "каждый час"))
        combo = ttk.Combobox(auto_row, textvariable=self.interval_var,
                             values=list(INTERVALS), state="readonly",
                             width=16)
        combo.bind("<<ComboboxSelected>>", lambda e: self.toggle_auto())
        combo.pack(side="left", padx=(8, 0))

        ttk.Label(outer, text="История проверок", foreground=MUTED,
                  font=small).pack(anchor="w", pady=(20, 4))

        hist_frame = ttk.Frame(outer, borderwidth=1, relief="solid")
        hist_frame.pack(fill="both", expand=True)
        self.history_text = tk.Text(hist_frame, font=mono, relief="flat",
                                    height=8, state="disabled", padx=10,
                                    pady=8, cursor="arrow", wrap="none",
                                    borderwidth=0, highlightthickness=0)
        self.history_text.tag_configure("up", foreground=GREEN)
        self.history_text.tag_configure("down", foreground=RED)
        self.history_text.tag_configure("muted", foreground=MUTED)
        self.history_text.pack(fill="both", expand=True)

        self.status_label = ttk.Label(outer, text="", foreground=MUTED,
                                      font=small, wraplength=390,
                                      justify="left")
        self.status_label.pack(fill="x", pady=(10, 0))

        if self.username_var.get():
            self.show_history(self.username_var.get())
            self.show_last_record(self.username_var.get())
        if self.auto_var.get() and self.username_var.get():
            self.check()

    # ------------------------------------------------------------- действия

    def check(self):
        username = self.username_var.get().lstrip("@").strip()
        if not username or self.busy:
            if not username:
                self.set_status("Введите имя аккаунта — например, cristiano.",
                                RED)
            return
        self.busy = True
        self.check_btn.configure(state="disabled")
        self.set_status("Проверяю…", MUTED)
        threading.Thread(target=self._fetch, args=(username,),
                         daemon=True).start()

    def _fetch(self, username: str):
        try:
            records = tracker.load_history(username)
            prev = records[-1]["followers"] if records else None
            profile = tracker.fetch_profile(username)
            records.append(profile)
            tracker.save_history(username, records)
            self.root.after(0, self._on_success, profile, prev)
        except tracker.FetchError as e:
            self.root.after(0, self._on_error, str(e))
        except Exception as e:  # noqa: BLE001
            self.root.after(0, self._on_error, f"Неожиданная ошибка: {e}")

    def _on_success(self, profile: dict, prev):
        self.busy = False
        self.check_btn.configure(state="normal")
        self.render_profile(profile, prev)
        self.show_history(profile["username"])
        self.set_status(
            "Обновлено " + profile["checked_at"].replace("T", " в ")[:19],
            MUTED)
        save_settings({"username": self.username_var.get().strip(),
                       "auto": self.auto_var.get(),
                       "interval": self.interval_var.get()})
        self.schedule_next()

    def _on_error(self, message: str):
        self.busy = False
        self.check_btn.configure(state="normal")
        self.set_status(message, RED)
        self.schedule_next()

    # --------------------------------------------------------- автообновление

    def toggle_auto(self):
        save_settings({"username": self.username_var.get().strip(),
                       "auto": self.auto_var.get(),
                       "interval": self.interval_var.get()})
        self.schedule_next()

    def schedule_next(self):
        if self.timer_id:
            self.root.after_cancel(self.timer_id)
            self.timer_id = None
        if self.auto_var.get():
            seconds = INTERVALS.get(self.interval_var.get(), 3600)
            self.timer_id = self.root.after(seconds * 1000, self.check)

    # ----------------------------------------------------------------- вывод

    def render_profile(self, profile: dict, prev):
        name = "@" + profile["username"]
        if profile.get("full_name"):
            name += "  ·  " + profile["full_name"]
        self.name_label.configure(text=name)

        text = tracker.fmt(profile["followers"])
        # подгоняем размер шрифта, чтобы длинное число влезало в окно
        size = 44
        max_width = max(self.root.winfo_width() - 80, 300)
        probe = tkfont.Font(size=size, weight="bold")
        while size > 18 and probe.measure(text) > max_width:
            size -= 2
            probe.configure(size=size)
        self.big.configure(size=size)
        self.count_label.configure(text=text)

        if prev is None or profile["followers"] == prev:
            self.delta_label.configure(text="подписчиков", foreground=MUTED)
        else:
            d = profile["followers"] - prev
            color = GREEN if d > 0 else RED
            self.delta_label.configure(
                text=f"подписчиков  ({tracker.fmt_delta(d)})",
                foreground=color)

        self.extra_label.configure(
            text=f"подписки: {tracker.fmt(profile['following'])}   "
                 f"посты: {tracker.fmt(profile['posts'])}")

    def show_last_record(self, username: str):
        records = tracker.load_history(username)
        if records:
            prev = records[-2]["followers"] if len(records) > 1 else None
            self.render_profile(records[-1], prev)
            self.set_status("Показаны данные последней проверки. "
                            "Нажмите «Проверить», чтобы обновить.", MUTED)

    def show_history(self, username: str):
        records = tracker.load_history(username)
        self.history_text.configure(state="normal")
        self.history_text.delete("1.0", "end")
        if not records:
            self.history_text.insert("end", "Проверок ещё не было.", "muted")
        recent = records[-50:]
        for idx in range(len(recent) - 1, -1, -1):
            r = recent[idx]
            when = r["checked_at"].replace("T", " ")[:16]
            line = f"{when}  {tracker.fmt(r['followers']):>14}"
            self.history_text.insert("end", line)
            if idx > 0:
                d = r["followers"] - recent[idx - 1]["followers"]
                if d:
                    tag = "up" if d > 0 else "down"
                    self.history_text.insert("end",
                                             f"  {tracker.fmt_delta(d)}", tag)
            self.history_text.insert("end", "\n")
        self.history_text.configure(state="disabled")

    def set_status(self, text: str, color: str):
        self.status_label.configure(text=text, foreground=color)


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
