#!/bin/bash
# =============================================================================
# Slate — постоянный бесплатный адрес через Tailscale Funnel.
#
# Отличие от share.command: адрес не меняется от запуска к запуску.
# Получается что-то вроде https://macbookpro.ваша-сеть.ts.net — его можно
# дать ученикам один раз. Ни карты, ни домена, ни белого IP не нужно.
#
# Плата за бесплатность: адрес живёт, пока включён ваш компьютер
# и открыто это окно. Нужен круглосуточный — нужен сервер.
#
# Что нужно один раз:
#     brew install tailscale     (или приложение Tailscale из App Store)
#     tailscale up               (вход через Google или GitHub, карта не нужна)
#
# Дальше — двойной клик по этому файлу.
# =============================================================================
cd "$(dirname "$0")"

PORT="${PORT:-3000}"

say() { printf '%s\n' "$1"; }
line() { say "------------------------------------------------------------"; }

line
say "  Slate — постоянный адрес"
line

# --- Node -------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  say "Не найден Node. Установите с https://nodejs.org (кнопка LTS) и запустите снова."
  say ""
  read -r -p "Нажмите Enter, чтобы закрыть."
  exit 1
fi

# --- Tailscale --------------------------------------------------------------
TS=""
for candidate in \
  "$(command -v tailscale 2>/dev/null)" \
  /Applications/Tailscale.app/Contents/MacOS/Tailscale \
  /opt/homebrew/bin/tailscale \
  /usr/local/bin/tailscale
do
  if [ -n "${candidate}" ] && [ -x "${candidate}" ]; then TS="${candidate}"; break; fi
done

if [ -z "${TS}" ]; then
  say "Не найден Tailscale — он и даёт постоянный адрес."
  say "Установите одной командой (нужен Homebrew с brew.sh):"
  say ""
  say "    brew install tailscale"
  say ""
  say "потом войдите — откроется браузер, карта не нужна:"
  say ""
  say "    sudo tailscale up"
  say ""
  read -r -p "Нажмите Enter, чтобы закрыть."
  exit 1
fi

if ! "${TS}" status >/dev/null 2>&1; then
  say "Tailscale установлен, но вы ещё не вошли. Выполните:"
  say ""
  say "    sudo ${TS} up"
  say ""
  say "Откроется браузер — войдите через Google или GitHub. Потом запустите этот файл снова."
  say ""
  read -r -p "Нажмите Enter, чтобы закрыть."
  exit 1
fi

# --- запуск -----------------------------------------------------------------
cleanup() {
  say ""
  say "Останавливаю…"
  "${TS}" funnel --https=443 off >/dev/null 2>&1
  [ -n "${SRV_PID:-}" ] && kill "${SRV_PID}" 2>/dev/null
}
trap cleanup EXIT INT TERM

say "Запускаю Slate на порту ${PORT}…"
PORT="${PORT}" node --no-warnings server.js &
SRV_PID=$!
sleep 2
if ! kill -0 "${SRV_PID}" 2>/dev/null; then
  say "Slate не запустился — посмотрите сообщения выше."
  read -r -p "Нажмите Enter, чтобы закрыть."
  exit 1
fi

HOST="$("${TS}" status --json 2>/dev/null | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    try {
      const j = JSON.parse(s);
      const name = (j.Self && j.Self.DNSName || "").replace(/\.$/, "");
      process.stdout.write(name);
    } catch (e) {}
  });')"

if [ -n "${HOST}" ]; then
  line
  say "  Ваш постоянный адрес:"
  say ""
  say "    https://${HOST}"
  say ""
  say "  Регистрация:  https://${HOST}/app#signup"
  say ""
  say "  Адрес не меняется — его можно дать ученикам один раз."
  say "  Работает, пока включён компьютер и открыто это окно."
  line
fi

say "Включаю доступ из интернета (первый раз Tailscale попросит подтвердить в браузере)…"
"${TS}" funnel "${PORT}"
