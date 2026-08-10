#!/usr/bin/env bash
# =============================================================================
# Slate — установка на чистый сервер Ubuntu 22.04 / 24.04.
#
# Запускать на СЕРВЕРЕ под root, из папки, куда скопирован slate-server:
#     sudo bash install.sh getslate.com
#
# Что делает: ставит Node 22 и Caddy, кладёт программу в /opt/slate,
# поднимает её как системную службу, включает HTTPS с автоматическим
# сертификатом, закрывает лишние порты и настраивает ежедневный бэкап.
# Повторный запуск безопасен — обновляет уже установленное.
# =============================================================================
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR=/opt/slate
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "$DOMAIN" ]]; then
  echo "Укажите домен: sudo bash install.sh getslate.com" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Нужны права root: sudo bash install.sh $DOMAIN" >&2
  exit 1
fi
if [[ ! -f "$SRC_DIR/server.js" ]]; then
  echo "Рядом со скриптом нет server.js — скопируйте на сервер всю папку slate-server" >&2
  exit 1
fi

echo "==> 1/7 Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg sqlite3 ufw >/dev/null

echo "==> 2/7 Node 22"
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  V=$(node -p "process.versions.node.split('.').map(Number)" 2>/dev/null || echo "[0,0]")
  MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
  MINOR=$(node -p "process.versions.node.split('.')[1]" 2>/dev/null || echo 0)
  if [[ "$MAJOR" -gt 22 || ( "$MAJOR" -eq 22 && "$MINOR" -ge 5 ) ]]; then NEED_NODE=0; fi
fi
if [[ "$NEED_NODE" -eq 1 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "    node $(node -v)"

echo "==> 3/7 Caddy (HTTPS)"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

echo "==> 4/7 Программа в $APP_DIR"
id -u slate >/dev/null 2>&1 || adduser --system --group --home "$APP_DIR" slate
mkdir -p "$APP_DIR/public" "$APP_DIR/data" "$APP_DIR/backup"
install -m 644 "$SRC_DIR/server.js" "$APP_DIR/server.js"
install -m 644 "$SRC_DIR/package.json" "$APP_DIR/package.json" 2>/dev/null || true
install -m 644 "$SRC_DIR/public/index.html" "$APP_DIR/public/index.html"
install -m 644 "$SRC_DIR/public/portal.html" "$APP_DIR/public/portal.html"
chown -R slate:slate "$APP_DIR"
chmod 700 "$APP_DIR/data"

echo "==> 5/7 Служба"
cat > /etc/systemd/system/slate.service <<UNIT
[Unit]
Description=Slate
After=network.target

[Service]
Type=simple
User=slate
Group=slate
WorkingDirectory=$APP_DIR
Environment=PORT=3000
Environment=SLATE_DATA=$APP_DIR/data
Environment=SLATE_DEV_CODES=0
ExecStart=/usr/bin/node --no-warnings $APP_DIR/server.js
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR/data $APP_DIR/backup

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now slate >/dev/null
systemctl restart slate

echo "==> 6/7 Домен $DOMAIN"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:3000
}
CADDY
systemctl reload caddy || systemctl restart caddy

echo "==> 7/7 Бэкапы и порты"
cat > /etc/cron.daily/slate-backup <<'CRON'
#!/bin/sh
# ежедневная копия базы; храним 30 последних
sqlite3 /opt/slate/data/slate.db ".backup '/opt/slate/backup/slate-$(date +%F).db'" 2>/dev/null || exit 0
chown slate:slate /opt/slate/backup/slate-$(date +%F).db
ls -1t /opt/slate/backup/slate-*.db | tail -n +31 | xargs -r rm -f
CRON
chmod +x /etc/cron.daily/slate-backup

ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true

sleep 2
if systemctl is-active --quiet slate; then
  echo
  echo "Готово. Откройте https://$DOMAIN"
  echo
  echo "Доставка кодов входа ещё не подключена, поэтому код смотрите в логе:"
  echo "    journalctl -u slate -f | grep 'код входа'"
  echo
  echo "Полезное:"
  echo "    systemctl status slate      состояние"
  echo "    systemctl restart slate     перезапуск"
  echo "    ls /opt/slate/backup        бэкапы"
else
  echo "Служба не поднялась. Смотрите: journalctl -u slate -n 50" >&2
  exit 1
fi
