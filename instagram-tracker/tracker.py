#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Instagram Follower Tracker — отслеживание реального числа подписчиков.

Instagram на странице профиля показывает округлённое число («1,2 млн»),
а этот скрипт запрашивает внутренний web-API Instagram и получает точное
значение (например, 1 203 417). История сохраняется в JSON-файл, при
каждой проверке показывается прирост/убыль. Опционально — уведомления
в Telegram при изменении числа подписчиков.

Использование:
    python tracker.py check <username>              одна проверка
    python tracker.py watch <username> [-i 3600]    проверка по кругу
    python tracker.py history <username>            история изменений

Переменные окружения (необязательно):
    IG_SESSIONID        sessionid из cookies вашего браузера — нужен, если
                        Instagram блокирует анонимные запросы
    TG_BOT_TOKEN        токен Telegram-бота для уведомлений
    TG_CHAT_ID          chat_id, куда слать уведомления
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# Заголовки, с которыми веб-версия Instagram сама ходит в свой API.
IG_APP_ID = "936619743392459"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

HISTORY_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "history")


class FetchError(Exception):
    pass


def fetch_profile(username: str) -> dict:
    """Возвращает данные профиля: точное число подписчиков, подписок, постов."""
    url = (
        "https://i.instagram.com/api/v1/users/web_profile_info/?"
        + urllib.parse.urlencode({"username": username})
    )
    headers = {
        "User-Agent": USER_AGENT,
        "X-IG-App-ID": IG_APP_ID,
        "Accept": "*/*",
        "Referer": f"https://www.instagram.com/{username}/",
    }
    sessionid = os.environ.get("IG_SESSIONID")
    if sessionid:
        headers["Cookie"] = f"sessionid={sessionid}"

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 429):
            raise FetchError(
                f"Instagram отклонил запрос (HTTP {e.code}). "
                "Обычно помогает переменная окружения IG_SESSIONID "
                "(значение cookie sessionid из вашего браузера) "
                "или просто подождать — сработал лимит запросов."
            )
        if e.code == 404:
            raise FetchError(f"Профиль @{username} не найден.")
        raise FetchError(f"HTTP-ошибка {e.code} при запросе к Instagram.")
    except (urllib.error.URLError, TimeoutError) as e:
        raise FetchError(f"Сетевая ошибка: {e}")

    user = (data.get("data") or {}).get("user")
    if not user:
        raise FetchError(
            "Instagram вернул ответ без данных профиля. "
            "Профиль закрыт/не существует, либо нужен IG_SESSIONID."
        )

    return {
        "username": user.get("username", username),
        "full_name": user.get("full_name", ""),
        "followers": user["edge_followed_by"]["count"],
        "following": user["edge_follow"]["count"],
        "posts": user["edge_owner_to_timeline_media"]["count"],
        "is_private": user.get("is_private", False),
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


# ---------------------------------------------------------------- история

def history_path(username: str) -> str:
    return os.path.join(HISTORY_DIR, f"{username.lower()}.json")


def load_history(username: str) -> list:
    try:
        with open(history_path(username), encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_history(username: str, records: list) -> None:
    os.makedirs(HISTORY_DIR, exist_ok=True)
    with open(history_path(username), "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)


# ------------------------------------------------------------- уведомления

def notify_telegram(text: str) -> None:
    token = os.environ.get("TG_BOT_TOKEN")
    chat_id = os.environ.get("TG_CHAT_ID")
    if not token or not chat_id:
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode()
    try:
        urllib.request.urlopen(
            urllib.request.Request(url, data=payload), timeout=30
        ).read()
    except Exception as e:  # уведомление не должно ронять трекер
        print(f"  (не удалось отправить в Telegram: {e})", file=sys.stderr)


# ------------------------------------------------------------------ вывод

def fmt(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def fmt_delta(d: int) -> str:
    if d > 0:
        return f"+{fmt(d)} 📈"
    if d < 0:
        return f"-{fmt(-d)} 📉"
    return "без изменений"


def do_check(username: str, quiet: bool = False) -> dict:
    profile = fetch_profile(username)
    records = load_history(username)
    prev = records[-1] if records else None

    records.append(profile)
    save_history(username, records)

    delta = profile["followers"] - prev["followers"] if prev else None

    if not quiet or delta:
        name = f"@{profile['username']}"
        if profile["full_name"]:
            name += f" ({profile['full_name']})"
        print(f"\n{name}")
        print(f"  Подписчики: {fmt(profile['followers'])}"
              + (f"  ({fmt_delta(delta)})" if delta is not None else ""))
        print(f"  Подписки:   {fmt(profile['following'])}")
        print(f"  Посты:      {fmt(profile['posts'])}")
        print(f"  Проверено:  {profile['checked_at']}")

    if delta:
        notify_telegram(
            f"Instagram @{profile['username']}: "
            f"{fmt(profile['followers'])} подписчиков ({fmt_delta(delta)})"
        )
    return profile


def do_watch(username: str, interval: int) -> None:
    print(f"Слежу за @{username}, проверка каждые {interval} с. Ctrl+C — выход.")
    while True:
        try:
            do_check(username)
        except FetchError as e:
            print(f"[{datetime.now():%H:%M:%S}] Ошибка: {e}", file=sys.stderr)
        try:
            time.sleep(interval)
        except KeyboardInterrupt:
            print("\nОстановлено.")
            return


def do_history(username: str) -> None:
    records = load_history(username)
    if not records:
        print(f"Истории для @{username} пока нет — сначала выполните "
              f"`python tracker.py check {username}`.")
        return
    print(f"\nИстория @{username} ({len(records)} записей):\n")
    prev = None
    for r in records:
        delta = f"  {fmt_delta(r['followers'] - prev)}" if prev is not None else ""
        print(f"  {r['checked_at']}  {fmt(r['followers']):>12}{delta}")
        prev = r["followers"]
    total = records[-1]["followers"] - records[0]["followers"]
    print(f"\nИтого за период: {fmt_delta(total)}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Отслеживание реального числа подписчиков в Instagram."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_check = sub.add_parser("check", help="одна проверка")
    p_check.add_argument("username", help="имя пользователя Instagram (без @)")

    p_watch = sub.add_parser("watch", help="проверять по кругу")
    p_watch.add_argument("username", help="имя пользователя Instagram (без @)")
    p_watch.add_argument(
        "-i", "--interval", type=int, default=3600,
        help="интервал между проверками в секундах (по умолчанию 3600)",
    )

    p_hist = sub.add_parser("history", help="показать историю")
    p_hist.add_argument("username", help="имя пользователя Instagram (без @)")

    args = parser.parse_args()
    username = getattr(args, "username", "").lstrip("@").strip()

    try:
        if args.command == "check":
            do_check(username)
        elif args.command == "watch":
            interval = max(args.interval, 300)  # не чаще раза в 5 минут
            if interval != args.interval:
                print("Интервал меньше 300 с приведёт к блокировке — "
                      "использую 300 с.")
            do_watch(username, interval)
        elif args.command == "history":
            do_history(username)
    except FetchError as e:
        print(f"Ошибка: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
