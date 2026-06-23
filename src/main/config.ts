// Конфигурация плеера.
//
// Идентичность станции (STATION_ID / STATION_TOKEN) ХРАНИТСЯ СНАРУЖИ приложения,
// чтобы один и тот же AppImage работал на всех банках, а провижининг сводился к
// записи одного файла. Порядок источников (выигрывает тот, что задан раньше —
// dotenv не перетирает уже выставленные переменные):
//   1. process.env             — то, что инжектит systemd (EnvironmentFile) или шелл;
//   2. /etc/cannect-player/station.env  — прод-конфиг банки (см. провижининг);
//   3. ./.env                  — локальная разработка.
//
// Секреты (STATION_TOKEN) НЕ должны попадать в renderer — отдаём наружу
// только безопасный срез (getRendererConfig).

import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { config as loadDotenv } from 'dotenv'
import type { RendererConfig } from '@shared/types'

/** Прод-файл идентичности станции. Задаётся при провижининге, переживает авто-апдейт. */
export const STATION_ENV_PATH = '/etc/cannect-player/station.env'

if (existsSync(STATION_ENV_PATH)) loadDotenv({ path: STATION_ENV_PATH })
loadDotenv() // локальный .env (dev) — не перетирает уже загруженное

function env(key: string, fallback: string): string {
  const v = process.env[key]
  return v && v.trim() !== '' ? v.trim() : fallback
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key]
  const n = v ? Number.parseInt(v, 10) : NaN
  return Number.isFinite(n) ? n : fallback
}

export interface AppConfig {
  /** MongoDB ObjectId станции в cannect-web. ДОЛЖЕН совпадать со STATION_ID камеры. */
  stationId: string
  /** Общий секрет станции — тот же, что в env камеры. Нужен для вызова камеры /current-ad. */
  stationToken: string
  /** База cannect-web API. */
  apiBase: string
  /** Локальный edge-сервер камеры (тот же мини-ПК). */
  cameraBase: string
  /** Куда складывать прогретые видео. */
  cacheDir: string
  /** Период опроса /queue, мс. */
  pollIntervalMs: number
  /** За сколько секунд до конца текущего клипа считаем следующий «обязан быть прогрет». */
  bufferGateSec: number
  /** Ширина чёрного разделителя между полосами в 9:16, px. */
  stripDividerPx: number
  /** Имя/ID аудио-устройства вывода (пусто = системное по умолчанию). */
  audioDevice: string
}

let cached: AppConfig | null = null

export function getConfig(): AppConfig {
  if (cached) return cached
  cached = {
    stationId: env('STATION_ID', '6a2699575a677a6355883ea2'), // ALM-002 SmArt.Point
    stationToken: env('STATION_TOKEN', ''),
    apiBase: env('API_BASE', 'https://cannect.kz'),
    cameraBase: env('CAMERA_BASE', 'http://127.0.0.1:8080'),
    cacheDir: env('CACHE_DIR', join(app.getPath('userData'), 'videos-cache')),
    pollIntervalMs: envInt('POLL_INTERVAL_MS', 60_000),
    bufferGateSec: envInt('BUFFER_GATE_SEC', 6),
    stripDividerPx: envInt('STRIP_DIVIDER_PX', 20),
    audioDevice: env('AUDIO_DEVICE', '')
  }
  return cached
}

/** Безопасный срез конфига для renderer — без секретов. */
export function getRendererConfig(): RendererConfig {
  const c = getConfig()
  return {
    stationId: c.stationId,
    stripDividerPx: c.stripDividerPx,
    bufferGateSec: c.bufferGateSec
  }
}
