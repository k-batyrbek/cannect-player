// Клиент локального edge-сервера камеры (cannect-camera) на том же мини-ПК.
// Плеер ТОЛЬКО уведомляет камеру о том, что играет сейчас — для атрибуции
// CV-метрик к кампании. Аналитику камера шлёт на бэкенд сама.
//
// Контракт (см. cannect-camera src/server/api.py + auth.py):
//   POST http://127.0.0.1:8080/current-ad
//   Header: X-Station-Token: <STATION_TOKEN>
//   Body: { event, campaignId, videoId, startedAt, expectedDuration }
//
// Принцип: fire-and-forget. Камера может лежать/тормозить — это НИКОГДА
// не должно блокировать или ронять плейбэк. Короткий таймаут, ошибки глотаем.

import { getConfig } from './config'
import { log } from './logger'
import type { PlaybackEventType } from '@shared/types'

const TIMEOUT_MS = 2_000

export interface CurrentAdPayload {
  event: PlaybackEventType
  campaignId?: string
  /** SMB-брони идут с bookingId (без campaignId). Камера ключует показ по тому, что не null. */
  bookingId?: string
  videoId: string
  startedAt: string
  expectedDuration: number
}

export function notifyCamera(payload: CurrentAdPayload): void {
  const { cameraBase, stationToken } = getConfig()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

  fetch(`${cameraBase}/current-ad`, {
    method: 'POST',
    signal: ctrl.signal,
    headers: {
      'content-type': 'application/json',
      'X-Station-Token': stationToken
    },
    body: JSON.stringify(payload)
  })
    .then((res) => {
      if (!res.ok) log('warn', `camera /current-ad → HTTP ${res.status}`)
    })
    .catch((err) => {
      // Камера недоступна — норма, просто фиксируем на debug-уровне.
      log('warn', `camera /current-ad unreachable: ${(err as Error).message}`)
    })
    .finally(() => clearTimeout(timer))
}
