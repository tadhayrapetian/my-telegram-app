#!/bin/bash
# =============================================================================
# Slate — открыть доступ к своему компьютеру по временной ссылке.
#
# Домен и сервер для этого не нужны: Cloudflare выдаёт адрес вида
# https://что-то-случайное.trycloudflare.com, который ведёт на вашу программу.
# По нему Slate открывается с айпада, телефона и у любого, кому вы дали ссылку.
#
# Пока это окно открыто — ссылка работает. Закрыли окно или выключили
# компьютер — перестала. Для постоянного адреса нужен сервер (см. README).
#
# Первый запуск: chmod +x share.command, дальше — двойной клик.
# =============================================================================
cd "$(dirname "$0")"

PORT="${PORT:-3000}"

say() { printf '%s\n' "$1"; }
line() { say "------------------------------------------------------------"; }

line
say "  Slate — временная ссылка"
line

# --- Node -------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  say "Не найден Node. Установите его с https://nodejs.org (кнопка LTS),"
  say "потом запустите этот файл ещё раз."
  say ""
  read -r -p "Нажмите Enter, чтобы закрыть."
  exit 1
fi
MAJOR=$(node -p "process.versions.node.split('.')[0]")
MINOR=$(node -p "process.versions.node.split('.')[1]")
if [[ "${MAJOR}" -lt 22 || ( "${MAJOR}" -eq 22 && "${MINOR}" -lt 5 ) ]]; then
  say "Нужен Node 22.5 или новее, а стоит $(node -v)."
  say "Обновите с https://nodejs.org и запустите файл ещё раз."
  say ""
  read -r -p "Нажмите Enter, чтобы закрыть."
  exit 1
fi

# --- cloudflared ------------------------------------------------------------
if ! command -v cloudflared >/dev/null 2>&1; then
  say "Не найдена программа cloudflared — она и делает ссылку."
  say "Установите одной командой (нужен Homebrew с brew.sh):"
  say ""
  say "    brew install cloudflared"
  say ""
  say "Потом запустите этот файл ещё раз."
  say ""
  read -r -p "Нажмите Enter, чтобы закрыть."
  exit 1
fi

# --- запуск -----------------------------------------------------------------
LOG="$(mktemp "${TMPDIR:-/tmp}/slate-tunnel.XXXXXX")"
cleanup() {
  say ""
  say "Останавливаю…"
  [[ -n "${TUN_PID:-}" ]] && kill "${TUN_PID}" 2>/dev/null
  [[ -n "${SRV_PID:-}" ]] && kill "${SRV_PID}" 2>/dev/null
  rm -f "${LOG}"
}
trap cleanup EXIT INT TERM

say "Запускаю Slate на порту ${PORT}…"
PORT="${PORT}" node --no-warnings server.js &
SRV_PID=$!
sleep 2
if ! kill -0 "${SRV_PID}" 2>/dev/null; then
  say "Slate не запустился. Проверьте сообщения выше."
  read -r -p "Нажмите Enter, чтобы закрыть."
  exit 1
fi

say "Спрашиваю ссылку у Cloudflare…"
cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" >"${LOG}" 2>&1 &
TUN_PID=$!

URL=""
for _ in $(seq 1 40); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "${LOG}" | head -1)
  [[ -n "${URL}" ]] && break
  sleep 1
done

line
if [[ -z "${URL}" ]]; then
  say "Ссылку получить не удалось. Последние строки:"
  tail -n 12 "${LOG}"
else
  say "  Готово. Ссылка на вашу программу:"
  say ""
  say "    ${URL}"
  say ""
  say "  Регистрация:        ${URL}/app#signup"
  say "  Кабинет ученика — кнопка «Кабинет» в карточке ученика."
  say ""
  say "  Пока это окно открыто — ссылка работает."
  say "  Закроете окно — перестанет, и адрес в следующий раз будет другой."
fi
line
say "Остановить: закройте окно или нажмите Control+C."
wait "${SRV_PID}"
