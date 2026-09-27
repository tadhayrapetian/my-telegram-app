#!/bin/bash
# ============================================================================
#  CRM преподавателя английского — запуск на macOS.
#
#  Двойной клик по этому файлу: программа поднимает локальный сервер
#  и сама открывает браузер. Окно Терминала должно оставаться открытым,
#  пока вы работаете — оно и есть сервер. Закрыли окно — программа закрылась.
#
#  Если файл не запускается двойным кликом, один раз выполните в Терминале:
#      chmod +x "$(pwd)/start.command"
# ============================================================================

cd "$(dirname "$0")" || exit 1

PORT="${CRM_PORT:-8765}"
VENV=".venv"

echo ""
echo "  CRM преподавателя английского"
echo "  ------------------------------"
echo ""

# --- 1. есть ли Python -------------------------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
  echo "  Не найден Python 3."
  echo ""
  echo "  Установите его одним из способов:"
  echo "    • скачайте с python.org (кнопка Download Python) и установите;"
  echo "    • или выполните в Терминале:  xcode-select --install"
  echo ""
  echo "  После установки запустите этот файл ещё раз."
  command -v open >/dev/null 2>&1 && open "https://www.python.org/downloads/"
  echo ""
  read -r -p "  Нажмите Enter, чтобы закрыть..." _
  exit 1
fi

PY_OK=$(python3 -c 'import sys; print(1 if sys.version_info >= (3, 9) else 0)' 2>/dev/null)
if [ "$PY_OK" != "1" ]; then
  echo "  Нужен Python 3.9 или новее. Сейчас: $(python3 -V 2>&1)"
  echo "  Обновите Python с python.org и запустите файл снова."
  read -r -p "  Нажмите Enter, чтобы закрыть..." _
  exit 1
fi

# --- 2. окружение и зависимости (только при первом запуске) ------------------
if [ ! -d "$VENV" ]; then
  echo "  Первый запуск: готовлю окружение, это займёт минуту..."
  python3 -m venv "$VENV" || {
    echo "  Не удалось создать окружение."
    read -r -p "  Нажмите Enter, чтобы закрыть..." _
    exit 1
  }
fi

PYBIN="$VENV/bin/python"
if ! "$PYBIN" -c "import fastapi, uvicorn, multipart" >/dev/null 2>&1; then
  echo "  Устанавливаю библиотеки..."
  "$PYBIN" -m pip install --quiet --upgrade pip
  "$PYBIN" -m pip install --quiet -r requirements.txt || {
    echo ""
    echo "  Не удалось установить библиотеки. Проверьте интернет и запустите снова."
    read -r -p "  Нажмите Enter, чтобы закрыть..." _
    exit 1
  }
fi

# --- 3. свободный порт -------------------------------------------------------
port_busy() { "$PYBIN" - "$1" <<'PYEOF'
import socket, sys
s = socket.socket()
try:
    s.bind(("127.0.0.1", int(sys.argv[1])))
    print("free")
except OSError:
    print("busy")
finally:
    s.close()
PYEOF
}

TRY=0
while [ "$(port_busy "$PORT")" = "busy" ] && [ "$TRY" -lt 20 ]; do
  PORT=$((PORT + 1))
  TRY=$((TRY + 1))
done

URL="http://127.0.0.1:$PORT"

# --- 4. запуск ---------------------------------------------------------------
echo "  Адрес: $URL"
echo "  База:  $(pwd)/data/crm.sqlite3"
echo ""
echo "  Не закрывайте это окно, пока работаете с программой."
echo "  Чтобы закончить — закройте окно или нажмите Control+C."
echo ""

"$PYBIN" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" --log-level warning &
SERVER_PID=$!

cleanup() {
  echo ""
  echo "  Останавливаю..."
  kill "$SERVER_PID" 2>/dev/null
  wait "$SERVER_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# ждём, пока сервер поднимется, и открываем браузер
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "$URL/api/health"; then
    if command -v open >/dev/null 2>&1; then open "$URL"; fi
    break
  fi
  sleep 0.5
done

wait "$SERVER_PID"
