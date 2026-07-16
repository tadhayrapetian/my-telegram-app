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

import tracker

SETTINGS_PATH = os.path.join(tracker.HISTORY_DIR, "_settings.json")

INTERVALS = {
    "каждые 30 минут": 30 * 60,
    "каждый час": 60 * 60,
    "каждые 3 часа": 3 * 60 * 60,
    "каждые 6 часов": 6 * 60 * 60,
}

BG = "#0F0F23"
CARD = "#1B1B3A"
FG = "#FFFFFF"
MUTED = "#9A9AC0"
ACCENT = "#7877C6"
GREEN = "#4CD97B"
RED = "#FF6B81"


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
        root.configure(bg=BG)
        root.geometry("420x640")
        root.minsize(380, 560)

        settings = load_settings()

        self.big = tkfont.Font(family="Helvetica Neue", size=44, weight="bold")
        h2 = tkfont.Font(family="Helvetica Neue", size=15, weight="bold")
        body = tkfont.Font(family="Helvetica Neue", size=13)
        small = tkfont.Font(family="Helvetica Neue", size=11)
        mono = tkfont.Font(family="Menlo", size=11)

        pad = {"padx": 24}

        tk.Label(root, text="Аккаунт Instagram (без @):", bg=BG, fg=MUTED,
                 font=small, anchor="w").pack(fill="x", pady=(20, 4), **pad)

        row = tk.Frame(root, bg=BG)
        row.pack(fill="x", **pad)
        self.username_var = tk.StringVar(value=settings.get("username", ""))
        entry = tk.Entry(row, textvariable=self.username_var, font=body,
                         bg=CARD, fg=FG, insertbackground=FG, relief="flat",
                         highlightthickness=1, highlightbackground=CARD,
                         highlightcolor=ACCENT)
        entry.pack(side="left", fill="x", expand=True, ipady=8, ipadx=8)
        entry.bind("<Return>", lambda e: self.check())

        self.check_btn = tk.Button(row, text="Проверить", command=self.check,
                                   font=h2, bg=ACCENT, fg=FG,
                                   activebackground=ACCENT, activeforeground=FG,
                                   relief="flat", padx=14, pady=6, cursor="hand2")
        self.check_btn.pack(side="left", padx=(10, 0))

        card = tk.Frame(root, bg=CARD)
        card.pack(fill="x", pady=(20, 0), **pad)

        self.name_label = tk.Label(card, text="—", bg=CARD, fg=MUTED, font=body)
        self.name_label.pack(pady=(18, 0))

        self.count_label = tk.Label(card, text="· · ·", bg=CARD, fg=FG,
                                    font=self.big)
        self.count_label.pack()

        self.delta_label = tk.Label(card, text="подписчиков", bg=CARD,
                                    fg=MUTED, font=body)
        self.delta_label.pack()

        self.extra_label = tk.Label(card, text="", bg=CARD, fg=MUTED, font=small)
        self.extra_label.pack(pady=(6, 18))

        auto_row = tk.Frame(root, bg=BG)
        auto_row.pack(fill="x", pady=(16, 0), **pad)

        self.auto_var = tk.BooleanVar(value=settings.get("auto", False))
        tk.Checkbutton(auto_row, text="Обновлять автоматически",
                       variable=self.auto_var, command=self.toggle_auto,
                       bg=BG, fg=FG, font=body, selectcolor=CARD,
                       activebackground=BG, activeforeground=FG
                       ).pack(side="left")

        self.interval_var = tk.StringVar(
            value=settings.get("interval", "каждый час"))
        opt = tk.OptionMenu(auto_row, self.interval_var, *INTERVALS,
                            command=lambda _: self.toggle_auto())
        opt.configure(bg=CARD, fg=FG, font=small, relief="flat",
                      highlightthickness=0, activebackground=CARD,
                      activeforeground=FG)
        opt.pack(side="left", padx=(8, 0))

        tk.Label(root, text="История проверок", bg=BG, fg=MUTED, font=small,
                 anchor="w").pack(fill="x", pady=(18, 4), **pad)

        hist_frame = tk.Frame(root, bg=CARD)
        hist_frame.pack(fill="both", expand=True, pady=(0, 8), **pad)
        self.history_text = tk.Text(hist_frame, bg=CARD, fg=FG, font=mono,
                                    relief="flat", height=8, state="disabled",
                                    padx=12, pady=10, cursor="arrow",
                                    wrap="none")
        self.history_text.tag_configure("up", foreground=GREEN)
        self.history_text.tag_configure("down", foreground=RED)
        self.history_text.tag_configure("muted", foreground=MUTED)
        self.history_text.pack(fill="both", expand=True)

        self.status_label = tk.Label(root, text="", bg=BG, fg=MUTED,
                                     font=small, wraplength=370, justify="left")
        self.status_label.pack(fill="x", pady=(0, 14), **pad)

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
                self.set_status("Введите имя аккаунта — например, cristiano.", RED)
            return
        self.busy = True
        self.check_btn.configure(state="disabled")
        self.set_status("Проверяю…", MUTED)
        threading.Thread(target=self._fetch, args=(username,), daemon=True).start()

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
            "Обновлено " + profile["checked_at"].replace("T", " в ")[:19], MUTED)
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
        max_width = max(self.root.winfo_width() - 90, 280)
        probe = tkfont.Font(family="Helvetica Neue", size=size, weight="bold")
        while size > 18 and probe.measure(text) > max_width:
            size -= 2
            probe.configure(size=size)
        self.big.configure(size=size)
        self.count_label.configure(text=text)

        if prev is None or profile["followers"] == prev:
            self.delta_label.configure(text="подписчиков", fg=MUTED)
        else:
            d = profile["followers"] - prev
            color = GREEN if d > 0 else RED
            self.delta_label.configure(
                text=f"подписчиков  ({tracker.fmt_delta(d)})", fg=color)

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
        for i, r in enumerate(reversed(records[-50:])):
            idx = len(records[-50:]) - 1 - i
            when = r["checked_at"].replace("T", " ")[:16]
            line = f"{when}  {tracker.fmt(r['followers']):>14}"
            self.history_text.insert("end", line)
            if idx > 0:
                d = r["followers"] - records[-50:][idx - 1]["followers"]
                if d:
                    tag = "up" if d > 0 else "down"
                    self.history_text.insert("end", f"  {tracker.fmt_delta(d)}", tag)
            self.history_text.insert("end", "\n")
        self.history_text.configure(state="disabled")

    def set_status(self, text: str, color: str):
        self.status_label.configure(text=text, fg=color)


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
