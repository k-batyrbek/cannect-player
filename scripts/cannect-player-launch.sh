#!/usr/bin/env bash
#
# Launcher плеера для автозапуска графической сессии банки.
# Порядок: дождаться камеры (cannect-camera на :8080) → запустить плеер в kiosk.
# Камера поднимается раньше системным юнитом cv-analytics; здесь — явное ожидание,
# чтобы атрибуция работала с первого кадра. Если камера не встала за таймаут —
# плеер всё равно стартует (показ важнее, камера подключится позже сама).

set -u

export DISPLAY="${DISPLAY:-:0}"

# Отключить гашение экрана/скринсейвер на банке.
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true

# Никаких блокировок/простоя/сна — на банке не должно быть запроса пароля.
gsettings set org.gnome.desktop.screensaver lock-enabled false 2>/dev/null || true
gsettings set org.gnome.desktop.lockdown disable-lock-screen true 2>/dev/null || true
gsettings set org.gnome.desktop.session idle-delay 0 2>/dev/null || true
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing' 2>/dev/null || true

# Ждать камеру до 30с (любой HTTP-ответ на :8080, в т.ч. 401, = сервис поднят).
CAMERA_URL="${CAMERA_BASE:-http://127.0.0.1:8080}/health"
for _ in $(seq 1 30); do
  if curl -s -m 1 -o /dev/null "$CAMERA_URL" 2>/dev/null; then
    echo "[launch] камера на связи"
    break
  fi
  sleep 1
done

APP="$HOME/Applications/cannect-player.AppImage"
echo "[launch] старт плеера: $APP"
exec "$APP"
