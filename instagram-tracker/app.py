#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Instagram Follower Tracker — версия с окном в браузере.

Запуск двойным щелчком по файлу «Запустить трекер.command» (macOS)
или командой: python3 app.py

Скрипт поднимает локальный мини-сервер (только на этом компьютере,
наружу ничего не открывается) и открывает страницу трекера в браузере.
"""

import http.server
import json
import threading
import urllib.parse
import webbrowser

import tracker

PAGE = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Подписчики Instagram</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0F0F23; color: #fff; min-height: 100vh;
  }
  body::before {
    content: ''; position: fixed; inset: 0; z-index: -1;
    background:
      radial-gradient(circle at 20% 80%, rgba(120,119,198,.3) 0%, transparent 50%),
      radial-gradient(circle at 80% 20%, rgba(255,119,198,.3) 0%, transparent 50%);
  }
  .wrap { max-width: 460px; margin: 0 auto; padding: 28px 20px; }
  h1 { font-size: 1.15rem; font-weight: 600; margin-bottom: 18px; text-align: center; }
  .row { display: flex; gap: 8px; }
  input[type=text] {
    flex: 1; padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,.2);
    background: rgba(255,255,255,.08); color: #fff; font-size: 1rem; outline: none;
  }
  input[type=text]:focus { border-color: #7877C6; }
  button {
    padding: 12px 18px; border: none; border-radius: 12px; cursor: pointer;
    background: #7877C6; color: #fff; font-size: 1rem; font-weight: 600;
  }
  button:disabled { opacity: .5; cursor: default; }
  .card {
    margin-top: 20px; padding: 24px 16px; border-radius: 16px; text-align: center;
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
  }
  .name { color: #9A9AC0; font-size: .95rem; min-height: 1.2em; }
  .count { font-size: 2.9rem; font-weight: 800; letter-spacing: .5px; margin: 6px 0 2px;
           word-break: break-all; }
  .delta { color: #9A9AC0; font-size: 1rem; min-height: 1.3em; }
  .delta.up { color: #4CD97B; } .delta.down { color: #FF6B81; }
  .extra { color: #9A9AC0; font-size: .85rem; margin-top: 8px; }
  .auto { display: flex; align-items: center; gap: 8px; margin-top: 18px;
          font-size: .95rem; color: #ddd; flex-wrap: wrap; }
  select {
    padding: 6px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,.2);
    background: rgba(255,255,255,.08); color: #fff; font-size: .9rem;
  }
  select option { color: #000; }
  .note { margin-top: 8px; font-size: .8rem; color: #C9A0FF; line-height: 1.4; }
  .btn2 {
    margin-top: 18px; width: 100%; background: rgba(255,255,255,.1);
    border: 1px solid rgba(255,255,255,.2);
  }
  .people { margin-top: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .people .col {
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
    border-radius: 12px; padding: 10px 12px; min-height: 60px;
  }
  .people .col h3 { font-size: .8rem; margin-bottom: 6px; font-weight: 600; }
  .people .col.gained h3 { color: #4CD97B; }
  .people .col.lost h3 { color: #FF6B81; }
  .people a { display: block; color: #ddd; font-size: .85rem; padding: 2px 0;
              text-decoration: none; word-break: break-all; }
  .people a:hover { color: #fff; text-decoration: underline; }
  .people .none { color: #9A9AC0; font-size: .8rem; }
  .hist-title { margin: 22px 0 8px; color: #9A9AC0; font-size: .85rem; }
  .hist {
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
    border-radius: 14px; padding: 8px 0; max-height: 300px; overflow-y: auto;
    font-variant-numeric: tabular-nums;
  }
  .hist .line { display: flex; justify-content: space-between; gap: 10px;
                padding: 6px 14px; font-size: .9rem; }
  .hist .line:not(:last-child) { border-bottom: 1px solid rgba(255,255,255,.06); }
  .hist .when { color: #9A9AC0; white-space: nowrap; }
  .hist .n { font-weight: 600; }
  .hist .d.up { color: #4CD97B; } .hist .d.down { color: #FF6B81; }
  .hist .empty { color: #9A9AC0; padding: 10px 14px; font-size: .9rem; }
  .status { margin-top: 14px; color: #9A9AC0; font-size: .85rem; min-height: 1.3em; }
  .status.error { color: #FF6B81; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Подписчики Instagram</h1>
  <div class="row">
    <input type="text" id="username" placeholder="аккаунт, например cristiano">
    <button id="checkBtn" onclick="check()">Проверить</button>
  </div>
  <div class="card">
    <div class="name" id="name">&nbsp;</div>
    <div class="count" id="count">· · ·</div>
    <div class="delta" id="delta">подписчиков</div>
    <div class="extra" id="extra"></div>
  </div>
  <label class="auto">
    <input type="checkbox" id="auto" onchange="saveAndSchedule()">
    Обновлять автоматически
    <select id="interval" onchange="saveAndSchedule()">
      <option value="60">каждую минуту</option>
      <option value="300" selected>каждые 5 минут</option>
      <option value="900">каждые 15 минут</option>
      <option value="3600">каждый час</option>
    </select>
  </label>
  <div class="note" id="fastNote"></div>

  <button class="btn2" id="peopleBtn" onclick="loadPeople()">
    Показать, кто подписался и отписался
  </button>
  <div class="people" id="people" style="display:none">
    <div class="col gained"><h3>➕ Новые подписчики</h3><div id="gained"></div></div>
    <div class="col lost"><h3>➖ Отписались</h3><div id="lost"></div></div>
  </div>
  <div class="note" id="peopleNote"></div>

  <div class="hist-title">История проверок</div>
  <div class="hist" id="history"><div class="empty">Проверок ещё не было.</div></div>
  <div class="status" id="status"></div>
</div>
<script>
const $ = id => document.getElementById(id);
let timer = null, busy = false;

const fmt = n => n.toLocaleString('ru-RU');
const fmtDelta = d => (d > 0 ? '+' : '−') + fmt(Math.abs(d)) + (d > 0 ? ' ▲' : ' ▼');

function setStatus(text, isError) {
  $('status').textContent = text;
  $('status').className = 'status' + (isError ? ' error' : '');
}

function renderProfile(p, prev) {
  $('name').textContent = '@' + p.username + (p.full_name ? '  ·  ' + p.full_name : '');
  $('count').textContent = fmt(p.followers);
  if (prev == null || p.followers === prev) {
    $('delta').textContent = 'подписчиков';
    $('delta').className = 'delta';
  } else {
    const d = p.followers - prev;
    $('delta').textContent = 'подписчиков  (' + fmtDelta(d) + ')';
    $('delta').className = 'delta ' + (d > 0 ? 'up' : 'down');
  }
  $('extra').textContent = 'подписки: ' + fmt(p.following) + '   посты: ' + fmt(p.posts);
}

function renderHistory(records) {
  const box = $('history');
  if (!records.length) {
    box.innerHTML = '<div class="empty">Проверок ещё не было.</div>';
    return;
  }
  box.innerHTML = '';
  const recent = records.slice(-100);
  for (let i = recent.length - 1; i >= 0; i--) {
    const r = recent[i];
    const line = document.createElement('div');
    line.className = 'line';
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = r.checked_at.replace('T', ' ').slice(0, 16);
    const right = document.createElement('span');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = fmt(r.followers);
    right.appendChild(n);
    if (i > 0) {
      const d = r.followers - recent[i - 1].followers;
      if (d !== 0) {
        const ds = document.createElement('span');
        ds.className = 'd ' + (d > 0 ? 'up' : 'down');
        ds.textContent = '  ' + fmtDelta(d);
        right.appendChild(ds);
      }
    }
    line.appendChild(when);
    line.appendChild(right);
    box.appendChild(line);
  }
}

async function check() {
  const username = $('username').value.replace(/^@/, '').trim();
  if (!username) { setStatus('Введите имя аккаунта — например, cristiano.', true); return; }
  if (busy) return;
  busy = true;
  $('checkBtn').disabled = true;
  setStatus('Проверяю…', false);
  try {
    const resp = await fetch('/api/check?username=' + encodeURIComponent(username));
    const data = await resp.json();
    if (data.error) { setStatus(data.error, true); }
    else {
      renderProfile(data.profile, data.prev);
      renderHistory(data.records);
      setStatus('Обновлено ' + data.profile.checked_at.replace('T', ' в ').slice(0, 19), false);
      save();
    }
  } catch (e) {
    setStatus('Трекер закрыт? Не закрывайте маленькое окно Терминала, пока пользуетесь страницей.', true);
  }
  busy = false;
  $('checkBtn').disabled = false;
}

function renderPeopleList(boxId, people) {
  const box = $(boxId);
  box.innerHTML = '';
  if (!people.length) {
    box.innerHTML = '<div class="none">никого</div>';
    return;
  }
  for (const u of people) {
    const a = document.createElement('a');
    a.href = 'https://www.instagram.com/' + u.username + '/';
    a.target = '_blank';
    a.textContent = '@' + u.username + (u.full_name ? '  ·  ' + u.full_name : '');
    box.appendChild(a);
  }
}

async function loadPeople() {
  const username = $('username').value.replace(/^@/, '').trim();
  if (!username) { setStatus('Сначала впишите аккаунт.', true); return; }
  $('peopleBtn').disabled = true;
  $('peopleNote').textContent = 'Загружаю список подписчиков… это может занять до минуты.';
  try {
    const resp = await fetch('/api/followers?username=' + encodeURIComponent(username));
    const data = await resp.json();
    if (data.error) {
      $('peopleNote').textContent = data.error;
      $('peopleNote').style.color = '#FF6B81';
      $('people').style.display = 'none';
    } else {
      $('people').style.display = 'grid';
      renderPeopleList('gained', data.gained);
      renderPeopleList('lost', data.lost);
      $('peopleNote').style.color = '#C9A0FF';
      if (data.first_time) {
        $('peopleNote').textContent = 'Сохранил текущий список из ' + data.total +
          ' подписчиков. При следующей проверке покажу, кто пришёл и ушёл.';
      } else {
        $('peopleNote').textContent = 'Всего подписчиков в списке: ' + data.total +
          '. Сравнил с прошлым разом.';
      }
    }
  } catch (e) {
    $('peopleNote').textContent = 'Не удалось связаться с трекером. Не закрывайте окно Терминала.';
    $('peopleNote').style.color = '#FF6B81';
  }
  $('peopleBtn').disabled = false;
}

function updateFastNote() {
  const v = parseInt($('interval').value, 10);
  const note = $('fastNote');
  if ($('auto').checked && v <= 60) {
    note.textContent = '⚠ Instagram блокирует слишком частые запросы. ' +
      'Раз в минуту — уже смелый режим; при блокировке (ошибка 429) поставьте реже. ' +
      'Обновлять каждые несколько секунд Instagram не даёт — забанит аккаунт.';
  } else {
    note.textContent = '';
  }
}

async function loadSaved() {
  const username = localStorage.getItem('ig_username') || '';
  $('username').value = username;
  $('auto').checked = localStorage.getItem('ig_auto') === '1';
  $('interval').value = localStorage.getItem('ig_interval') || '3600';
  if (username) {
    try {
      const resp = await fetch('/api/history?username=' + encodeURIComponent(username));
      const data = await resp.json();
      if (data.records && data.records.length) {
        const rs = data.records;
        renderProfile(rs[rs.length - 1], rs.length > 1 ? rs[rs.length - 2].followers : null);
        renderHistory(rs);
        setStatus('Показаны данные последней проверки. Нажмите «Проверить», чтобы обновить.', false);
      }
    } catch (e) {}
  }
  schedule();
  updateFastNote();
  if ($('auto').checked && username) check();
}

function save() {
  localStorage.setItem('ig_username', $('username').value.replace(/^@/, '').trim());
  localStorage.setItem('ig_auto', $('auto').checked ? '1' : '0');
  localStorage.setItem('ig_interval', $('interval').value);
}

function schedule() {
  if (timer) { clearInterval(timer); timer = null; }
  if ($('auto').checked) {
    timer = setInterval(check, parseInt($('interval').value, 10) * 1000);
  }
}

function saveAndSchedule() { save(); schedule(); updateFastNote(); }

$('username').addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
loadSaved();
</script>
</body>
</html>"""


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):  # не засорять терминал
        pass

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, payload: dict) -> None:
        self._send(200, json.dumps(payload, ensure_ascii=False).encode(),
                   "application/json; charset=utf-8")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        username = (qs.get("username") or [""])[0].lstrip("@").strip()

        if parsed.path == "/":
            self._send(200, PAGE.encode(), "text/html; charset=utf-8")
        elif parsed.path == "/api/check":
            if not username:
                self._send_json({"error": "Не указан аккаунт."})
                return
            try:
                records = tracker.load_history(username)
                prev = records[-1]["followers"] if records else None
                profile = tracker.fetch_profile(username)
                records.append(profile)
                tracker.save_history(username, records)
                self._send_json({"profile": profile, "prev": prev,
                                 "records": records[-100:]})
            except tracker.FetchError as e:
                self._send_json({"error": str(e)})
            except Exception as e:  # noqa: BLE001
                self._send_json({"error": f"Неожиданная ошибка: {e}"})
        elif parsed.path == "/api/followers":
            if not username:
                self._send_json({"error": "Не указан аккаунт."})
                return
            try:
                profile = tracker.fetch_profile(username)
                new_list = tracker.fetch_followers(profile["user_id"])
                old_list = tracker.load_followers(username)
                first_time = not old_list
                diff = tracker.diff_followers(old_list, new_list)
                tracker.save_followers(username, new_list)
                self._send_json({
                    "total": len(new_list),
                    "gained": diff["gained"] if not first_time else [],
                    "lost": diff["lost"] if not first_time else [],
                    "first_time": first_time,
                })
            except tracker.FetchError as e:
                self._send_json({"error": str(e)})
            except Exception as e:  # noqa: BLE001
                self._send_json({"error": f"Неожиданная ошибка: {e}"})
        elif parsed.path == "/api/history":
            self._send_json({"records": tracker.load_history(username)[-100:]})
        else:
            self._send(404, b"not found", "text/plain")


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print()
    print("  Трекер подписчиков Instagram запущен!")
    print(f"  Страница открылась в браузере: {url}")
    print()
    print("  НЕ закрывайте это окно, пока пользуетесь трекером.")
    print("  Чтобы выйти — просто закройте это окно.")
    threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
