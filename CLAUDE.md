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

### 4.3. Конфигурация станции (.env)

```bash
cp .env.example .env
```

Заполни `.env` (полная таблица переменных — в [README.md](./README.md)):

```ini
STATION_ID=6a2699575a677a6355883ea2     # ObjectId станции в cannect-web
STATION_TOKEN=<секрет станции>           # ОБЯЗАН совпадать с .env камеры на этом ПК
API_BASE=https://cannect.kz
CAMERA_BASE=http://127.0.0.1:8080
```

> ⚠️ `STATION_ID` и `STATION_TOKEN` **обязаны совпадать** с `.env` модуля
> cannect-camera на этой же банке — иначе аналитика и плейбэк не сольются на
> сервере, а вызовы камеры вернут 401. `.env` в git не коммитится (секрет).

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

---

## 5. Архитектура кода

```
src/
  main/             main-процесс (Node) — вся логика и сеть
    index.ts         окно kiosk + autoplay-флаг + IPC + хоткеи выхода + single-instance
    config.ts        конфиг из .env (+ безопасный срез для renderer, без секретов)
    api.ts           cannect-web: queue / report / current-playback
    camera.ts        локальная камера: POST /current-ad (fire-and-forget, X-Station-Token)
    cache.ts         кэш видео: скачать весь плейлист → file://, атомарно, + чистка
    billable.ts      учёт бонус-петель (billable=false сверх showsPerHour в часе)
    orchestrator.ts  опрос queue → прогрев кэша → fan-out событий плейбэка
    logger.ts
  preload/
    index.ts         мост window.cannect (contextBridge) — узкий типизированный API
  renderer/          React-плеер (показ)
    App.tsx           подписка на плейлист/конфиг
    Player.tsx        движок: двойная буферизация, зацикливание, эмиссия событий
    Deck.tsx          визуал клипа: 16:9 одно видео / 9:16 — 4 полосы + разделители
    styles.css
  shared/types.ts    общий контракт типов main ↔ renderer
```

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
- Тело: `{ event, campaignId, videoId, startedAt, expectedDuration }`.
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

**Решено:**
- Electron + `<video>`, **mpv не берём** (железо мощное, не узкое место).
- Интеграция с камерой — **вариант A** (плеер только шлёт current-ad).
- Репозиторий: `github.com/k-batyrbek/cannect-player`.

**Осталось (next steps):**
1. **systemd-юнит** автозапуска плеера + kiosk на загрузке банки.
2. **Удалёнка:** Tailscale (рекомендация) vs Netbird — поставить на банки + Mac.
3. **Авто-апдейт:** electron-updater с GitHub Releases (репо приватный/публичный —
   уточнить; для приватного нужен токен на банке).
4. Доработки плеера: report для оборванного при смене плейлиста клипа; выбор
   аудио-устройства (флаг заложен, не доведён); current-playback `playback_ended`
   при остановке.

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
