# cannect-player

Нативный **Linux (Electron)** плеер для cannect LED-вендинг «банок» —
цилиндрических вендинг-машин с LED-поверхностью. Ставится на мини-ПК внутри
банки, проигрывает рекламный плейлист на весь экран: офлайн-устойчиво, со
звуком, с удалённым обновлением контента. Заменяет старый Chromium-киоск.

Полный контекст и история решений — см. [CLAUDE.md](./CLAUDE.md).

---

## Что делает

1. Опрашивает `GET https://cannect.kz/api/stations/<STATION_ID>/queue` → плейлист.
2. **Качает весь плейлист в локальный кэш** (на диск, по хэшу URL) и играет из
   `file://` → офлайн-устойчивость и плавные переходы.
3. Играет на весь экран, зациклено:
   - **16:9** — одно видео на весь экран.
   - **9:16** — 4 вертикальные полосы одного видео + чёрные разделители (так
     свёрстана реальная LED-поверхность банки). Звук — только у 1-й полосы.
   - Переходы без чёрного кадра (двойная буферизация деков).
4. **Репортит показы**: `POST /api/stations/<id>/report`
   (`billable=false` для бонус-петель сверх `showsPerHour`; вне рабочих часов
   сервер занулит биллинг сам).
5. **Сообщает текущий плейбэк** в два места одним событием (fan-out):
   - `POST /api/stations/<id>/current-playback` (cannect-web, для CV-атрибуции);
   - `POST http://127.0.0.1:8080/current-ad` (локальный CV-модуль cannect-camera).

Главная причина перехода на Electron — **autoplay со звуком без жеста юзера**
(`autoplay-policy=no-user-gesture-required`), чего нельзя в Chromium-киоске.

---

## Стек

Electron 31 · electron-vite · React 18 · TypeScript · Node 20 LTS.

---

## Архитектура кода

```
src/
  main/            main-процесс (Node) — вся логика и сеть
    index.ts        окно kiosk + autoplay-флаг + IPC + хоткеи выхода + single-instance
    config.ts       загрузка конфига из .env (+ безопасный срез для renderer)
    api.ts          cannect-web: queue / report / current-playback
    camera.ts       локальная камера: POST /current-ad (fire-and-forget, X-Station-Token)
    cache.ts        кэш видео: скачать весь плейлист → file://, атомарно, + чистка
    billable.ts     учёт бонус-петель (billable=false сверх showsPerHour в часе)
    orchestrator.ts опрос queue + прогрев кэша + fan-out событий плейбэка
    logger.ts
  preload/
    index.ts        мост window.cannect (contextBridge) — узкий типизированный API
  renderer/         React-плеер (показ)
    App.tsx          подписка на плейлист/конфиг
    Player.tsx       движок: двойная буферизация, зацикливание, эмиссия событий
    Deck.tsx         визуал клипа: 16:9 одно видео / 9:16 — 4 полосы + разделители
    styles.css
  shared/types.ts   общий контракт типов main ↔ renderer
```

**Поток данных:** `main/orchestrator` тянет `/queue`, греет кэш, шлёт плейлист в
renderer через IPC. Renderer играет и на каждом старте/конце клипа шлёт событие
обратно в main, который раскидывает его в cannect-web и камеру. Сеть и кэш живут
только в main; renderer только показывает.

---

## Интеграция с cannect-camera

Камера (CV-аналитика, отдельный проект) крутится на **том же мини-ПК**, FastAPI
на `:8080`. Плеер **только уведомляет** её о текущей рекламе — аналитику в Mongo
камера шлёт сама. Подробности и обоснование — в CLAUDE.md.

- Эндпоинт: `POST http://127.0.0.1:8080/current-ad`, заголовок `X-Station-Token`.
- Принцип **fire-and-forget**: камера лежит/тормозит → плеер продолжает играть,
  вызов с таймаутом 2с, ошибки только логируются.
- Проверка линка: `curl -H "X-Station-Token: <TOKEN>" http://127.0.0.1:8080/metrics`
  → поле `currentAd.videoId` должно совпадать с тем, что играет сейчас.

> ⚠️ `STATION_ID` и `STATION_TOKEN` в `.env` плеера **обязаны совпадать** с
> `.env` камеры на этой же банке — иначе аналитика и плейбэк не сольются на
> сервере, а вызовы `/current-ad` вернут 401.

---

## Конфигурация (.env)

Скопируй шаблон и заполни:

```bash
cp .env.example .env
```

`.env` в git **не коммитится** (содержит секрет). В репо лежит только
`.env.example`. Все переменные:

| Переменная | Обяз. | Дефолт | Что это и откуда взять |
|---|---|---|---|
| `STATION_ID` | да | `6a2699575a677a6355883ea2` | MongoDB ObjectId станции в cannect-web. **Должен совпадать со `STATION_ID` камеры.** Дефолт = ALM-002 · SmArt.Point. |
| `STATION_TOKEN` | да | *(пусто)* | Общий секрет станции. **Тот же, что в `.env` камеры** (`stations.{_id}.edge.token` в Mongo). Нужен для авторизованного вызова камеры `/current-ad`. Пустой → вызовы без авторизации (камера примет только если у неё токен тоже пуст). |
| `API_BASE` | — | `https://cannect.kz` | База cannect-web API (queue/report/current-playback). |
| `CAMERA_BASE` | — | `http://127.0.0.1:8080` | Локальный edge-сервер камеры на этом же ПК. |
| `POLL_INTERVAL_MS` | — | `60000` | Период опроса `/queue`, мс. Новый контент подхватывается на следующем опросе. |
| `BUFFER_GATE_SEC` | — | `6` | За сколько секунд до конца текущего клипа следующий обязан быть прогрет в кэше. |
| `STRIP_DIVIDER_PX` | — | `20` | Ширина чёрного разделителя между полосами в режиме 9:16, px. |
| `CACHE_DIR` | — | `<userData>/videos-cache` | Каталог кэша видео. По умолчанию в профиле приложения. |
| `AUDIO_DEVICE` | — | *(пусто)* | ID аудио-устройства вывода. Пусто = системное по умолчанию. |

Минимальный рабочий `.env` для банки:

```ini
STATION_ID=6a2699575a677a6355883ea2
STATION_TOKEN=<тот же токен, что в .env камеры>
API_BASE=https://cannect.kz
CAMERA_BASE=http://127.0.0.1:8080
```

---

## Запуск и сборка

```bash
npm install

npm run dev                     # dev с HMR (kiosk fullscreen!)
PLAYER_WINDOWED=1 npm run dev    # оконный режим 960×540 — для разработки, не на весь экран

npm run typecheck                # проверка типов (main + renderer)
npm run build                    # сборка в ./out
npm run build:linux              # дистрибутив через electron-builder
```

**Аварийный выход из kiosk:** `Ctrl+Q` (всегда) или `Esc` (только в
неупакованном/dev-билде). В упакованном проде Esc отключён, чтобы случайный
ввод не закрыл плеер.

`PLAYER_WINDOWED=1` — оконный режим для теста переходов без захвата экрана.

---

## Автозапуск на банке (TODO)

Планируется systemd-юнит + kiosk на загрузке + Tailscale для удалённого SSH +
electron-updater для авто-обновлений. См. «Следующие шаги» в CLAUDE.md.
