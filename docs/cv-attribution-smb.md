# Вопрос по атрибуции CV-аналитики для SMB-контента (cannect-web)

> Адресовано: ассистенту в контексте репозитория **cannect-web** (`https://cannect.kz`).
> От: команды **cannect-player** (Electron-плеер на банке) + **cannect-camera** (CV edge-модуль).
> Станция для примера: **ALM-002 · SmArt.Point**, `STATION_ID = 6a2699575a677a6355883ea2`.

## TL;DR — что нужно подтвердить

Весь текущий плейлист станции — это **SMB-брони** (`source: "smb"`, есть `bookingId`,
**нет `campaignId`**). CV-модуль (камера) умеет привязывать метрики только по
`campaignId`, поэтому для SMB у него `currentAd.campaignId = null` и он пушит в
`/api/analytics/events` события с `campaignId: null`.

**Вопрос: как cannect-web должен атрибутировать CV-метрики для SMB-показов?**
От ответа зависит, нужно ли нам дорабатывать связку плеер↔камера (добавлять
`bookingId`), или бэкенд уже сшивает это сам.

---

## Контекст системы (коротко)

На мини-ПК внутри банки крутятся два процесса:

- **cannect-player** — играет плейлист, репортит показы и шлёт «что играет сейчас».
- **cannect-camera** — CV-аналитика (трафик/внимание/демография), сама пушит
  агрегаты в cannect-web на `POST /api/analytics/events` каждые 30с.

Плеер на каждом старте/смене клипа делает fan-out одного события в два места:

1. `POST /api/stations/<id>/current-playback` — в cannect-web (тут `bookingId` **есть**);
2. `POST http://127.0.0.1:8080/current-ad` — в локальную камеру (для привязки CV
   к контенту). **Тут поля `bookingId` в контракте камеры нет — только `campaignId`.**

Камера, зная «что играет», тегает свои метрики и пушит их в cannect-web.

---

## Наблюдаемое поведение (с фактами)

### 1. Реальный ответ `GET /api/stations/6a2699575a677a6355883ea2/queue`

Все 3 элемента — SMB, с `bookingId`, **без `campaignId`**:

```
item 0: videoId=6a327ed65f7292cdb892df3d  source=smb  bookingId=6a3799862c87deed0a0d8567  (campaignId отсутствует)
item 1: videoId=6a38e7302c87deed0a0f774f  source=smb  bookingId=6a38e74c2c87deed0a0f780b  (campaignId отсутствует)
item 2: videoId=6a31b26b47fd3b0f056d46b8  source=smb  bookingId=6a39de3b8fe1396c02ad0f5f  (campaignId отсутствует)
```

Ключи элемента очереди: `videoId, videoTitle, videoUrl, thumbnailUrl, duration,
aspectRatio, source, bookingId`. Поля `campaignId` в SMB-элементах нет вообще.

### 2. Камера `GET http://127.0.0.1:8080/metrics` → `currentAd`

```json
{ "campaignId": null, "videoId": "6a327ed65f7292cdb892df3d", "playbackStartedAt": "..." }
```

`videoId` доходит корректно и обновляется на каждом переходе. `campaignId` всегда
`null`, потому что в SMB-данных его нет.

### 3. Контракт камеры `POST /current-ad` (`CurrentAdPayload`)

```
event, campaignId, videoId, startedAt, expectedDuration   # bookingId НЕ принимается
```

`ad_tracker` строит привязку на `campaign_id` → `counter_store.set_current_campaign(campaign_id, video_id)`.
Итог: SMB-показы попадают в «null-кампанию».

### 4. Что камера пушит в cannect-web

`POST /api/analytics/events` с полем `campaignId`, взятым из текущего ad-трекера.
Для SMB это `campaignId: null`. (Поля `bookingId` в этом пуше тоже нет.)

---

## Вопросы к cannect-web (проверить в коде бэкенда)

1. **Эндпоинт `POST /api/analytics/events`**: как обрабатывается событие с
   `campaignId: null`? Есть ли путь атрибуции через `bookingId`, или такие события
   падают в «неизвестно/null»?

2. **SMB-атрибуция**: предполагается ли, что бэкенд **сам сшивает** CV-события
   камеры с конкретной бронью — например, по `stationId` + времени, сопоставляя с
   тем, что плеер прислал в `/current-playback` (там `bookingId` есть)? Или камера
   **обязана нести ключ брони** в своём пуше?

3. **Дашборд `/dashboard/analytics`**: по какому ключу строится разбивка метрик —
   по `campaignId`, по `bookingId`, или по обоим? На что джойнится CV-аналитика для
   SMB-броней?

4. **Контракт**: если для SMB нужен ключ брони на стороне камеры — в каком поле и
   формате бэкенд его ждёт (`bookingId`? и в `/current-ad`, и в `/api/analytics/events`)?

---

## К какому решению это ведёт

- **Если бэкенд уже сшивает SMB по времени/`current-playback`** → менять ничего не
  надо, `campaignId: null` в камере — это норма. Закрываем вопрос.
- **Если камера должна нести `bookingId`** → мы доработаем связку:
  - **плеер**: добавит `bookingId` в `POST /current-ad` (данные уже есть, тривиально);
  - **камера**: примет `bookingId` в `CurrentAdPayload`, и `ad_tracker`/`counter_store`
    будут ключевать атрибуцию по `campaignId` **или** `bookingId`, и пробрасывать
    ключ брони в `/api/analytics/events`.

  (Сам cannect-web при этом, скорее всего, тоже должен уметь принять `bookingId` в
  `/api/analytics/events` — подтвердите.)

## Важное уточнение

Это **не баг плеера**: `bookingId` он уже корректно шлёт в cannect-web
(`/current-playback`, `/report`). Разрыв — только в линке плеер→камера, который
исторически заточен под `campaignId`. Нужен ваш ответ по пунктам выше, чтобы решить,
дорабатывать ли его.
