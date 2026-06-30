# cannect-player — нативный Linux-плеер для LED-вендинг «банок»

> Контекст-хендофф для Claude Code и для человека, разворачивающего проект.
> Прочитай целиком: что строим, зачем, как развернуть с нуля, архитектура,
> контракты сервера, интеграция с камерой и зафиксированные решения.

---

## 1. Что это

Десктоп-приложение под **Ubuntu Linux**, ставится на мини-ПК внутри «банки» —
цилиндрической LED-вендинг-машины. Проигрывает рекламный плейлист на весь экран
(LED-поверхность банки): **офлайн-устойчиво, со звуком, с удалённым обновлением
контента**. Заменяет старый костыль — Chromium-киоск с вкладкой
`https://cannect.kz/vending/<id>`.

**Текущий статус:** рабочий скелет, проверен end-to-end против прода cannect.kz —
тянет очередь, кэширует весь плейлист, играет 16:9 и 9:16, переходы без артефактов,
горячо подхватывает новый контент (≤60с), шлёт атрибуцию в локальную камеру.
Осталось: systemd-автозапуск, VPN, авто-апдейт (см. §10).

## 2. Зачем (проблемы старого Chromium-киоска)

1. **Звук не играл** — Chromium требует жест юзера для autoplay со звуком.
   В Electron снимается флагом `autoplay-policy=no-user-gesture-required`.
   **Это главная причина перехода.** (ffprobe подтвердил: аудиодорожка ~-17dB
   нормальная, проблема была в браузере.)
2. **Нет офлайна** — при обрыве сети плейбэк рушился. Нужен локальный кэш видео.
3. **Лаги переходов** на первом незакэшированном показе (висел последний кадр).
4. **Обновление = выезд на точку** жать F5. Нужна удалёнка + авто-апдейт.

## 3. Стек

Electron 31 · electron-vite · React 18 · TypeScript · Node 20 LTS.
Renderer = плеер-UI (React), main = Node-логика (сеть, кэш, окно).

---

## 4. Развёртывание с нуля (на новом мини-ПК)

Предполагается свежая Ubuntu. По шагам:

### 4.1. Зависимости системы

```bash
# git (если нет)
sudo apt update && sudo apt install -y git

# Node 20 LTS через NodeSource (apt-версия Node 18 старовата для тулчейна)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # должно быть v20.x
```

### 4.2. Клонирование и установка

```bash
git clone https://github.com/k-batyrbek/cannect-player.git
cd cannect-player
npm install
```

### 4.3. Конфигурация станции

Один AppImage на все банки; уникальны только `STATION_ID` + `STATION_TOKEN`
(дефолтов нет — пусто = «не настроена»). Источники по приоритету:
`process.env` → `/etc/cannect-player/station.env` → `<userData>/station.env` → `./.env`.

**На банке — мастер первого запуска (основной способ).** При старте без
идентичности плеер показывает форму (`Wizard.tsx`): `STATION_ID`, `STATION_TOKEN`,
число камер / «Пропустить». Плеер сохраняет идентичность в `<userData>/station.env`,
прописывает её же в `.env` камеры, перезапускает камеру и стартует показ.
Ручных файлов на новом ПК не нужно.

**Массово/неинтерактивно:** `sudo ./scripts/provision-station.sh <ID> <TOKEN>`
(пишет `/etc/cannect-player/station.env`).

**Разработка:** `cp .env.example .env` и заполнить. Полная таблица переменных — в
[README.md](./README.md).

> ⚠️ `STATION_ID` и `STATION_TOKEN` **обязаны совпадать** с `.env` модуля
> cannect-camera на этой же банке — иначе аналитика и плейбэк не сольются на
> сервере, а вызовы камеры вернут 401.

### 4.4. Запуск

```bash
npm run dev                     # kiosk fullscreen (боевой вид). Выход: Ctrl+Q / Esc
PLAYER_WINDOWED=1 npm run dev    # оконный режим 960×540 — для разработки/теста
npm run typecheck                # проверка типов (main + renderer)
npm run build                    # сборка в ./out
npm run build:linux              # дистрибутив через electron-builder
```

**Аварийный выход из kiosk:** `Ctrl+Q` (всегда), `Esc` (только в dev/неупакованном
билде; в проде Esc отключён, чтобы случайный ввод не закрыл плеер).
`PLAYER_WINDOWED=1` — оконный режим, не захватывает экран.

### 4.5. Релизы и автообновление

Автообновление через **electron-updater**. Релизы лежат на **GitHub Releases
публичного репо** `k-batyrbek/cannect-player`, поэтому **на банке НЕ нужен токен** —
устройство просто скачивает обновления. Заливка релизов идёт с Mac/CI.

**Важно:** автообновление работает **только в упакованном AppImage**. `npm run dev`
(запуск из исходников) НЕ обновляется. Значит на банке в проде должен крутиться
**AppImage**, а не dev-режим (его стартует systemd — см. автозапуск).

**Конфиг:** `electron-builder.yml` (target AppImage, publish → github
k-batyrbek/cannect-player). Логика обновления: `src/main/updater.ts` —
проверка на старте и каждые 6ч, авто-загрузка, установка сразу по загрузке
(`quitAndInstall`; банка перезапустится за секунды, плейбэк возобновится из кэша).
В dev — no-op (`app.isPackaged` false).

**Как выпустить новую версию (с Linux-машины или CI):**
```bash
# 1) поднять версию в package.json (semver), закоммитить, запушить
# 2) собрать и опубликовать релиз на GitHub:
GH_TOKEN=<github token с правом на repo> npm run release
```
`npm run release` = `electron-vite build && electron-builder --linux --publish always`.
Он создаёт GitHub Release с тегом `v<version>` и файлами `cannect-player-<version>.AppImage`
и `latest-linux.yml` (метаданные, которые читает updater на банках).

**Что происходит на банках:** каждые 6ч (и на старте) electron-updater читает
`latest-linux.yml` из последнего релиза; если версия выше — качает AppImage,
проверяет sha512 и перезапускает плеер на новой версии. Контента это не касается —
он обновляется отдельно через `/queue`.

> Токен нужен ТОЛЬКО для публикации (заливки) и живёт на Mac/CI, не на банке.
> Для публикации хватает классического PAT со скоупом `repo` или fine-grained с
> доступом к этому репо (Contents: RW). На устройства токен не попадает.

### 4.6. Автозапуск на банке (`scripts/install.sh`)

Разовая установка (под root): `sudo ./scripts/install.sh` (или `--no-autologin`).
Порядок загрузки: **boot → камера → автологин в графику → плеер в kiosk**.

- **Камера** — системный сервис `cv-analytics` (стартует на `multi-user.target`,
  раньше графики). **Юнит ставит и владеет им репозиторий cannect-camera** (свой
  entrypoint `run.sh`), плеерный `install.sh` его НЕ создаёт — только проверяет
  наличие и включает в автозапуск. (Запускать камеру руками `./run.sh` и под
  systemd одновременно нельзя — будет конфликт за `:8080`.)
- **Плеер** — автозапуск графической сессии: `~/.config/autostart/cannect-player.desktop`
  → `~/.local/bin/cannect-player-launch.sh`, который **ждёт камеру на `:8080`**, гасит
  блокировку экрана/простой/сон (`gsettings` + `xset`) и запускает AppImage в kiosk
  с **`--no-sandbox`**. ⚠️ Флаг обязателен: chrome-sandbox в AppImage не может быть
  SUID-root → без него Electron падает (`setuid_sandbox_host.cc`) и автозапуск молча
  не работает (камера и автологин при этом исправны — обманчиво).
- **AppImage** — в `~/Applications/cannect-player.AppImage` (записываемо юзером →
  автообновление может перезаписать на месте).
- **sudoers** `/etc/sudoers.d/cannect-player` — `cannect` может
  `systemctl restart/start/stop cv-analytics` без пароля (мастер/плеер так
  перезапускают камеру).
- **Автологин** — GDM `custom.conf` (`AutomaticLogin=cannect`), чтобы сессия
  поднималась без рук при включении.
- **GRUB** — `GRUB_RECORDFAIL_TIMEOUT=0` + `update-grub`: после неаккуратного
  выключения Ubuntu иначе показывает меню с 30-сек ожиданием; для банки грузим сразу.
- Юзер в группе `video` (доступ к камерам), `libfuse2` для запуска AppImage.
- Звук: PipeWire сам шлёт на аналоговый выход (зелёный 3.5мм line-out); громкость и
  выбор выхода запоминаются (wireplumber). HDMI-аудио (видеокарта) не использовать.

Полный цикл провижининга новой банки: поставить camera + venv, `install.sh`, затем
идентичность (мастер первого запуска или `provision-station.sh`), `reboot`.

---

## 5. Архитектура кода

```
src/
  main/             main-процесс (Node) — вся логика и сеть
    index.ts         окно kiosk + autoplay-флаг + IPC + хоткеи выхода + single-instance
    config.ts        идентичность станции (env/etc/userData) + isProvisioned + persist
    provisioning.ts  мастер: запись .env камеры, детект /dev/video*, рестарт камеры
    api.ts           cannect-web: queue / report / current-playback
    camera.ts        локальная камера: POST /current-ad (fire-and-forget, X-Station-Token)
    cache.ts         кэш видео: скачать весь плейлист → file://, атомарно, + чистка
    billable.ts      учёт бонус-петель (billable=false сверх showsPerHour в часе)
    orchestrator.ts  опрос queue → прогрев кэша → персист плейлиста → fan-out событий
    defaults.ts      5 дефолтных роликов (крутятся, когда рекламы нет)
    updater.ts       автообновление (electron-updater, публичные GitHub Releases)
    logger.ts
  preload/
    index.ts         мост window.cannect (contextBridge) — узкий типизированный API
  renderer/          React-плеер (показ)
    App.tsx           гейтинг: мастер (если станция не настроена) либо плеер
    Wizard.tsx        мастер первого запуска: идентичность + камеры
    Player.tsx        движок: двойная буферизация, зацикливание, эмиссия событий
    Deck.tsx          визуал клипа: 16:9 одно видео / 9:16 — 4 полосы + разделители
    styles.css
  shared/types.ts    общий контракт типов main ↔ renderer
```

**Первый запуск:** если `isProvisioned()` ложно (нет STATION_ID/TOKEN) — main не
стартует runtime, renderer показывает `Wizard`. По завершении мастера main пишет
идентичность, (опц.) `.env` камеры + рестарт, и поднимает runtime (`startRuntime`).

**Поток данных:** `orchestrator` (main) опрашивает `/queue`, греет кэш, шлёт
плейлист в renderer через IPC. Renderer играет и на каждом старте/конце клипа шлёт
событие обратно в main, который раскидывает его в cannect-web и камеру. Сеть и кэш
живут только в main; renderer только показывает.

### Движок плеера (важные детали)

- **Двойная буферизация:** два «дека» наложены. Активный играет и виден,
  неактивный держит СЛЕДУЮЩИЙ клип прогретым (загружен, пауза, 1-й кадр).
  По концу клипа — мгновенный свап с кроссфейдом 250ms, без чёрного кадра.
- **Перенаведение освободившегося дека на клип «через один» откладывается до
  конца кроссфейда** (`FADE_MS` в Player.tsx). Иначе его новый `src` на миг
  показывал первый кадр чужого ролика поверх перехода — известный баг, исправлен.
- **16:9** → одно видео, `object-fit: cover` (заполняет экран без чёрных полей;
  `contain` давал леттербокс).
- **9:16** → 4 вертикальные полосы одного видео + чёрные разделители
  (`STRIP_DIVIDER_PX`, дефолт 20px). Звук только у 1-й полосы, остальные muted-зеркала,
  подтягиваются к её `currentTime` при дрейфе.
- **Прогрев всего плейлиста** (не только следующего клипа) — `cache.prefetchAll`.

### Офлайн-устойчивость и дефолты (orchestrator)

- **Видео хранятся на диске** (кэш в `<userData>/videos-cache`), играются из `file://`.
- **Плейлист персистится** в `<cache>/last-playlist.json` при каждом успешном `/queue`.
  Если на старте бэкенд недоступен — поднимаем последний сохранённый плейлист (видео
  уже в кэше), а не зависаем на «загрузка плейлиста». Закрывает дыру простоя бэкенда.
- **Дефолтные ролики** (`defaults.ts`, 5 шт., хардкод, aspect 16:9) крутятся, когда:
  очередь пуста, ИЛИ бэкенд недоступен и нет сохранённого плейлиста. `isDefault=true` →
  в cannect-web/камеру атрибуция НЕ шлётся. Дефолты всегда в кэше и не вычищаются.
- **Чистка кэша** удаляет только то, чего нет в (текущий плейлист ∪ дефолты ∪
  сохранённый плейлист) — реклама не теряется при временном переключении на дефолты.
- TODO: редактирование списка дефолтов из админки cannect-web (пока хардкод).

---

## 6. Контракты cannect-web (мы их ПОТРЕБЛЯЕМ, сервер не меняем)

1. **`GET /api/stations/<id>/queue`** → `data.queue[]` с полями:
   `videoId, videoTitle, videoUrl, thumbnailUrl, duration,
   aspectRatio ('16:9'|'9:16'), source ('smb'|'agency'), bookingId` и **опционально**
   `campaignId`; плюс `data.operating` (в рабочих ли часах) и `data.timezone`.
   ⚠️ У SMB-контента есть `bookingId`, но **нет `campaignId`** (см. §8).
2. **`POST /api/stations/<id>/report`**
   `{ videoId, campaignId|bookingId, timestamp, duration, completed, billable }`.
   `billable=false` для бонус-петель (повторы сверх `showsPerHour`). Сервер сам
   занулит billable вне рабочих часов (показ 24/7, биллинг 9–22).
3. **`POST /api/stations/<id>/current-playback`**
   `{ event:'playback_started'|'playback_changed'|'playback_ended', campaignId,
   bookingId, videoId, videoTitle, expectedDuration, isDefault, startedAt }`.

## 7. Интеграция с cannect-camera (CV-аналитика)

Камера — отдельный проект (Python/FastAPI) на **том же мини-ПК**, слушает `:8080`.
**Решение (вариант A): плеер ТОЛЬКО уведомляет камеру о текущей рекламе** —
аналитику в Mongo камера шлёт сама (свой push-loop). Плеер CV-данные не relay'ит.

- Эндпоинт: `POST http://127.0.0.1:8080/current-ad`, заголовок `X-Station-Token`.
- Тело: `{ event, campaignId, bookingId, videoId, startedAt, expectedDuration }`
  (плеер шлёт `bookingId` для SMB — см. §8; камера принимает его по своему ТЗ).
- **Fire-and-forget**, таймаут 2с: камера лежит/тормозит → плеер продолжает играть.
- Плеер генерит ОДНО событие плейбэка и раскидывает его в два sink'а:
  `current-playback` (cannect-web) + `current-ad` (камера).
- Проверка линка:
  `curl -H "X-Station-Token: <TOKEN>" http://127.0.0.1:8080/metrics`
  → `currentAd.videoId` должен совпадать с тем, что играет.

> Камера читает свой `.env` (не файл `env`!). Её `src.main` сейчас **завершает
> пайплайн, если ни одна камера не подключилась** — для headless-теста без камер
> учитывай это (в проде systemd с `Restart=always` будет рестартить).

## 8. Открытый вопрос: атрибуция SMB (campaignId)

Текущая прод-очередь — на 100% **SMB-брони** (`source:'smb'`, есть `bookingId`,
нет `campaignId`). Контракт камеры `/current-ad` принимает только `campaignId`,
поэтому `currentAd.campaignId = null` для SMB. **Это не баг плеера** — он уже шлёт
`bookingId` в cannect-web. Вопрос — как бэкенд атрибутирует SMB CV-метрики (сам
сшивает по времени, или камера должна нести `bookingId`). Подробности и вопросы к
бэкенду: **[docs/cv-attribution-smb.md](./docs/cv-attribution-smb.md)**.

## 9. Железо банки (ALM-002)

Не «слабый мини-ПК», а рабочая станция:
- CPU **Intel i7-13700F** (16 ядер / 24 потока, до 5.2 GHz) — индекс «F», **без iGPU**.
- RAM **32 GB**. Диск SSD 512 GB. Плата ASRock H610M-HVS.
- GPU **NVIDIA RTX 3060 12 GB** — **делится с камерой** (её CV-инференс крутится
  на этой же 3060). Плеер должен быть GPU-скромным; CV — приоритет.
- Замер: плеер+камера (без живых камер) ели ~14% CPU, ~2 GB RAM, GPU ~почти ноль.
  Запас огромный. Реальную нагрузку GPU мерить на банке с подключёнными камерами.
- Вывод: **mpv не нужен** — Electron `<video>` декодит ролики с запасом.

---

## 10. Зафиксированные решения и что осталось

**Решено и сделано:**
- Electron + `<video>`, **mpv не берём** (железо мощное, не узкое место).
- Интеграция с камерой — **вариант A** (плеер только шлёт current-ad). Плеер уже
  шлёт и `bookingId` (см. §8); правка камеры — по её ТЗ.
- Репозиторий **`github.com/k-batyrbek/cannect-player` — публичный**.
- **Удалёнка: Tailscale** — банка в tailnet как `banka-alm-002` (см. §14), sshd поднят.
- **Авто-апдейт: electron-updater + публичные GitHub Releases**, без токена на
  банке (см. §4.5).
- **Провижининг станции: мастер первого запуска** (см. §4.3) — на новом ПК env
  руками не нужен.
- **Автозапуск на банке: `install.sh`** (см. §4.6) — boot → камера → плеер kiosk.
- **Офлайн-устойчивость (v0.1.3):** персист плейлиста на диск + дефолтные ролики,
  когда рекламы нет (см. §5). Парк ALM-001/002/004 на v0.1.3; ALM-003 догонит апдейтом.

**Осталось (next steps):**
1. Редактирование списка дефолтных роликов из админки cannect-web (сейчас хардкод
   в `src/main/defaults.ts`).
2. SSH на ключи + выключить парольный вход (сейчас вход по паролю).
3. Доработки плеера: report для оборванного при смене плейлиста клипа; выбор
   аудио-устройства (флаг заложен, не доведён); current-playback `playback_ended`
   при остановке; gate автообновления на нерабочие часы (сейчас ставит сразу).

> Перед релизом — смоук-тест упакованного AppImage: ESM/CJS-импорты (как
> electron-updater) валятся только в упакованном виде, не в `npm run dev`.

## 11. Что НЕ трогаем

- **cannect-web** не меняем — только потребляем API. (GitLab `cannect3/cannect-web`
  — прод+CI; GitHub `Batrbekk/cannect` — зеркало; прод `https://cannect.kz`,
  VPS `213.155.20.250`.)
- **cannect-camera** — соседний проект (CV). Координируем контракт, но это
  отдельный репозиторий.

## 12. Станции / факты

- ALM-001 · Cannect Station · Толе би → `6a2699575a677a6355883ea1`
- ALM-002 · SmArt.Point (Almaty) → `6a2699575a677a6355883ea2`
- Рабочие часы по умолчанию: 9:00–22:00, таймзона Asia/Almaty.
- Парк: сейчас ~6 банок (тест), скоро +11, +3 в Катаре.

## 13. Эталон UI (если нужно сверяться)

Логика плеера портирована из cannect-web `src/app/(vending)/vending/[id]/page.tsx`
(4 полосы для 9:16, разделители, буфер-гейт, report, current-playback). 3D-превью
банки НЕ нужно (это для дашборда-конфигуратора).

## 14. Удалённый доступ (Tailscale)

Банка за NAT на приватной LAN (`192.168.0.x`), белого IP нет → доступ через
**Tailscale** (mesh-VPN на WireGuard).

- Узел в tailnet: hostname **`banka-alm-002`**, tailnet-IP **`100.103.234.17`**,
  MagicDNS `banka-alm-002.tail5b9b07.ts.net`. Аккаунт tailnet — `k-batyrbek`.
- Поднято: `tailscale up --ssh --hostname=banka-alm-002`; `tailscaled` в автозапуске.
- SSH: `openssh-server` стоит, sshd на порту 22. Заход: `ssh cannect@100.103.234.17`
  (или по имени узла). Сейчас вход по паролю — для прода перейти на ключи и
  выключить `PasswordAuthentication`.
- На dev-Mac: поставить Tailscale, залогиниться в тот же аккаунт `k-batyrbek`.
- Tailscale SSH (`--ssh`) требует `ssh`-правило в ACL tailnet; обычный SSH поверх
  tailnet-IP работает в любом случае.

Развернуть Tailscale на новой банке: `curl -fsSL https://tailscale.com/install.sh | sh`
затем `sudo tailscale up --ssh --hostname=banka-<код-станции>`.
