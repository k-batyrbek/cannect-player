// Клиент cannect-web API. Только потребляем существующие эндпоинты — сервер не трогаем.
//   GET  /api/stations/<id>/queue
//   POST /api/stations/<id>/report
//   POST /api/stations/<id>/current-playback
//
// Node 18+ / Electron: глобальный fetch доступен.

import { getConfig } from './config'
import { log } from './logger'
import type { QueueItem, QueueResponse } from '@shared/types'

const TIMEOUT_MS = 15_000

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiBase } = getConfig()
  const url = `${apiBase}${path}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }
    })
    if (!res.ok) {
      throw new Error(`${init?.method ?? 'GET'} ${path} → HTTP ${res.status}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** GET /queue → нормализованный плейлист. Бросает при сетевой ошибке (вызывающий решает фолбэк). */
export async function fetchQueue(): Promise<QueueResponse> {
  const { stationId } = getConfig()
  const body = await request<{ data: QueueResponse }>(`/api/stations/${stationId}/queue`)
  const data = body.data ?? (body as unknown as QueueResponse)
  return {
    queue: Array.isArray(data.queue) ? data.queue : [],
    operating: Boolean(data.operating),
    timezone: data.timezone ?? 'Asia/Almaty'
  }
}

export interface ReportPayload {
  videoId: string
  campaignId?: string
  bookingId?: string
  timestamp: string
  duration: number
  completed: boolean
  /** false для бонус-петель сверх showsPerHour. Сервер сам занулит вне рабочих часов. */
  billable: boolean
}

export async function sendReport(payload: ReportPayload): Promise<void> {
  const { stationId } = getConfig()
  try {
    await request(`/api/stations/${stationId}/report`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  } catch (err) {
    log('warn', `report failed (${payload.videoId}): ${(err as Error).message}`)
  }
}

export interface CurrentPlaybackPayload {
  event: 'playback_started' | 'playback_changed' | 'playback_ended'
  campaignId?: string
  bookingId?: string
  videoId: string
  videoTitle: string
  expectedDuration: number
  isDefault: boolean
  startedAt: string
}

export async function sendCurrentPlayback(payload: CurrentPlaybackPayload): Promise<void> {
  const { stationId } = getConfig()
  try {
    await request(`/api/stations/${stationId}/current-playback`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  } catch (err) {
    log('warn', `current-playback failed (${payload.event}): ${(err as Error).message}`)
  }
}

export type { QueueItem }
