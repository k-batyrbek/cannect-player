#!/usr/bin/env bash
#
# Провижининг идентичности станции для cannect-player.
#
# Записывает /etc/cannect-player/station.env с STATION_ID и STATION_TOKEN.
# Эти значения ДОЛЖНЫ совпадать с .env модуля cannect-camera на этой же банке
# (берутся из cannect-web: stations.{_id} + edge.token, либо из .env камеры).
#
# AppImage плеера одинаков на всех банках; уникальна только эта пара значений.
# Файл переживает авто-апдейт приложения.
#
# Использование:
#   sudo ./provision-station.sh                         # спросит интерактивно
#   sudo ./provision-station.sh <STATION_ID> <TOKEN>    # неинтерактивно
#
set -euo pipefail

CONF_DIR=/etc/cannect-player
CONF_FILE="$CONF_DIR/station.env"

if [[ $EUID -ne 0 ]]; then
  echo "Запусти через sudo: sudo $0 ..." >&2
  exit 1
fi

STATION_ID="${1:-}"
STATION_TOKEN="${2:-}"

if [[ -z "$STATION_ID" ]]; then
  read -rp "STATION_ID (ObjectId станции в cannect-web): " STATION_ID
fi
if [[ -z "$STATION_TOKEN" ]]; then
  read -rsp "STATION_TOKEN (секрет станции, как у камеры): " STATION_TOKEN
  echo
fi

if [[ -z "$STATION_ID" || -z "$STATION_TOKEN" ]]; then
  echo "STATION_ID и STATION_TOKEN обязательны." >&2
  exit 1
fi

mkdir -p "$CONF_DIR"
cat > "$CONF_FILE" <<EOF
# cannect-player — идентичность станции. Сгенерировано provision-station.sh.
# Должно совпадать с .env модуля cannect-camera на этой банке.
STATION_ID=$STATION_ID
STATION_TOKEN=$STATION_TOKEN
EOF
# 644: плеер работает под пользователем (не root) и должен ПРОЧИТАТЬ файл —
# при 600 root-only плеер не видит идентичность и показывает мастер. Банка
# однопользовательская (kiosk), так что мировое чтение токена приемлемо.
chmod 644 "$CONF_FILE"

echo "✅ Записано $CONF_FILE"
echo "   STATION_ID=$STATION_ID"
echo "   STATION_TOKEN=*** (скрыт)"
echo
echo "Плеер подхватит это при следующем запуске. Прочие настройки (API_BASE,"
echo "CAMERA_BASE и т.д.) общие для всех станций — дефолты зашиты в приложении."
