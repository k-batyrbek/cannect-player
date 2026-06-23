#!/usr/bin/env bash
#
# install.sh — разовая установка банки (запускать через sudo).
#
# Делает автозапуск при включении компьютера в порядке:
#   boot → cannect-camera (системный systemd-юнит) → графическая сессия →
#   cannect-player (kiosk, ждёт камеру и стартует).
#
# Идемпотентно — можно перезапускать. Что настраивает:
#   • launcher плеера + автозапуск в графической сессии;
#   • AppImage плеера в ~/Applications (записываемое место → автообновление работает);
#   • NOPASSWD sudoers для рестарта камеры из плеера;
#   • пользователь в группе video (доступ к камерам);
#   • автологин в графику (для запуска без рук); отключить флагом --no-autologin.
#
# Использование:
#   sudo ./scripts/install.sh                 # с автологином
#   sudo ./scripts/install.sh --no-autologin  # без автологина
#   PLAYER_USER=cannect CAMERA_DIR=... sudo -E ./scripts/install.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Запусти через sudo: sudo $0" >&2; exit 1; fi

PLAYER_USER="${PLAYER_USER:-cannect}"
USER_HOME="$(getent passwd "$PLAYER_USER" | cut -d: -f6)"
CAMERA_DIR="${CAMERA_DIR:-$USER_HOME/Рабочий стол/cannect-camera}"
CAMERA_SERVICE="cv-analytics"
REPO="k-batyrbek/cannect-player"
APP_DIR="$USER_HOME/Applications"
APP_PATH="$APP_DIR/cannect-player.AppImage"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOLOGIN=1
[[ "${1:-}" == "--no-autologin" ]] && AUTOLOGIN=0

say() { echo -e "\n=== $* ==="; }
as_user() { sudo -u "$PLAYER_USER" "$@"; }

say "Пользователь: $PLAYER_USER  ($USER_HOME)"
say "Каталог камеры: $CAMERA_DIR"

# --- 1. Системные зависимости -------------------------------------------------
say "Зависимости (libfuse2, x11-xserver-utils, curl, v4l-utils)"
apt-get update -qq || true
apt-get install -y libfuse2t64 x11-xserver-utils curl v4l-utils 2>/dev/null \
  || apt-get install -y libfuse2 x11-xserver-utils curl v4l-utils

# --- 2. AppImage плеера в ~/Applications (записываемое → автообновление) -------
say "AppImage плеера → $APP_PATH"
as_user mkdir -p "$APP_DIR"
shopt -s nullglob
LOCAL_APPIMAGES=("$SCRIPT_DIR/../dist/"cannect-player*.AppImage)
shopt -u nullglob
if (( ${#LOCAL_APPIMAGES[@]} > 0 )); then
  echo "Беру локальный билд: ${LOCAL_APPIMAGES[-1]}"
  cp -f "${LOCAL_APPIMAGES[-1]}" "$APP_PATH"
else
  URL="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
        | grep browser_download_url | grep -i AppImage | head -1 | cut -d'"' -f4)"
  [[ -n "$URL" ]] || { echo "Не нашёл AppImage в релизах $REPO" >&2; exit 1; }
  echo "Качаю $URL"
  curl -fL "$URL" -o "$APP_PATH"
fi
chown "$PLAYER_USER:$PLAYER_USER" "$APP_PATH"
chmod +x "$APP_PATH"

# --- 3. Launcher + автозапуск графической сессии ------------------------------
say "Launcher плеера + автозапуск"
as_user mkdir -p "$USER_HOME/.local/bin" "$USER_HOME/.config/autostart"
install -m 0755 -o "$PLAYER_USER" -g "$PLAYER_USER" \
  "$SCRIPT_DIR/cannect-player-launch.sh" "$USER_HOME/.local/bin/cannect-player-launch.sh"

cat > "$USER_HOME/.config/autostart/cannect-player.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=cannect-player
Comment=LED-вендинг плеер банки
Exec=$USER_HOME/.local/bin/cannect-player-launch.sh
X-GNOME-Autostart-enabled=true
Terminal=false
EOF
chown "$PLAYER_USER:$PLAYER_USER" "$USER_HOME/.config/autostart/cannect-player.desktop"

# --- 4. Сервис камеры — ВЛАДЕЕТ репозиторий cannect-camera --------------------
# Плеер НЕ создаёт юнит камеры: у камеры свой entrypoint (run.sh) и установка.
# Здесь только убеждаемся, что сервис есть и включён в автозапуск (порядок boot:
# камера → графика → плеер). Если юнита нет — его ставит установщик камеры.
say "Проверка сервиса камеры: $CAMERA_SERVICE (юнит — за cannect-camera)"
if systemctl list-unit-files "$CAMERA_SERVICE.service" --no-legend 2>/dev/null | grep -q "$CAMERA_SERVICE"; then
  systemctl enable "$CAMERA_SERVICE" >/dev/null 2>&1 || true
  echo "Сервис $CAMERA_SERVICE найден и включён в автозапуск."
else
  echo "⚠️  Сервис $CAMERA_SERVICE НЕ установлен — его ставит установщик cannect-camera."
  echo "    Без него камера не поднимется при загрузке. Плеер всё равно стартует:"
  echo "    launcher подождёт :8080 до 30с и пойдёт играть (без CV-атрибуции)."
fi

# --- 5. NOPASSWD sudoers для рестарта камеры из плеера ------------------------
say "sudoers: $PLAYER_USER может перезапускать камеру без пароля"
SYSCTL="$(command -v systemctl)"
cat > "/etc/sudoers.d/cannect-player" <<EOF
$PLAYER_USER ALL=(root) NOPASSWD: $SYSCTL restart $CAMERA_SERVICE, $SYSCTL start $CAMERA_SERVICE, $SYSCTL stop $CAMERA_SERVICE
EOF
chmod 0440 "/etc/sudoers.d/cannect-player"
visudo -cf "/etc/sudoers.d/cannect-player" >/dev/null

# --- 6. Группа video (доступ к камерам) --------------------------------------
say "Группа video для $PLAYER_USER"
usermod -aG video "$PLAYER_USER" || true

# --- 6b. Быстрая загрузка GRUB (без 30с-меню после сбойного выключения) -------
say "GRUB: не ждать после сбойной загрузки (recordfail timeout 0)"
if grep -q "GRUB_RECORDFAIL_TIMEOUT" /etc/default/grub 2>/dev/null; then
  sed -i "s/^.*GRUB_RECORDFAIL_TIMEOUT.*/GRUB_RECORDFAIL_TIMEOUT=0/" /etc/default/grub
else
  echo "GRUB_RECORDFAIL_TIMEOUT=0" >> /etc/default/grub
fi
update-grub 2>/dev/null || echo "⚠️  update-grub не выполнен (не GRUB-система?)"

# --- 7. Автологин в графику (для запуска без рук при включении) ---------------
if [[ "$AUTOLOGIN" -eq 1 ]]; then
  say "Автологин в графику для $PLAYER_USER (GDM)"
  if [[ -f /etc/gdm3/custom.conf ]]; then
    python3 - "$PLAYER_USER" <<'PY'
import re, sys
p = "/etc/gdm3/custom.conf"
user = sys.argv[1]
s = open(p).read()
if "[daemon]" not in s:
    s = "[daemon]\n" + s
def setkey(s, key, val):
    if re.search(rf"(?m)^\s*#?\s*{key}\s*=.*$", s):
        return re.sub(rf"(?m)^\s*#?\s*{key}\s*=.*$", f"{key}={val}", s, count=1)
    return s.replace("[daemon]", f"[daemon]\n{key}={val}", 1)
s = setkey(s, "AutomaticLoginEnable", "true")
s = setkey(s, "AutomaticLogin", user)
open(p, "w").write(s)
print("GDM автологин включён")
PY
  else
    echo "⚠️  /etc/gdm3/custom.conf не найден — настрой автологин под свой DM вручную."
  fi
else
  echo "Автологин пропущен (--no-autologin)."
fi

say "Готово"
echo "Камера:  systemctl status $CAMERA_SERVICE"
echo "Плеер:   стартует при входе в графику (автозапуск), ждёт камеру и идёт в kiosk."
echo "Идентичность станции (если ещё не задана) спросит мастер при первом запуске,"
echo "либо: sudo $SCRIPT_DIR/provision-station.sh <STATION_ID> <STATION_TOKEN>"
echo "Перезагрузи банку для проверки полного цикла: sudo reboot"
