// Конфигурация плеера.
//
// Идентичность станции (STATION_ID / STATION_TOKEN) ХРАНИТСЯ СНАРУЖИ кода, чтобы
// один и тот же AppImage работал на всех банках. Источники (выигрывает тот, что
// задан РАНЬШЕ — dotenv не перетирает уже выставленные переменные):
//   1. process.env                       — инжектит systemd (EnvironmentFile) / шелл;
//   2. /etc/cannect-player/station.env   — массовый провижининг скриптом (root);
//   3. <userData>/station.env            — мастер первого запуска (пишет сам плеер, без root);
//   4. ./.env                            — локальная разработка.
//
// STATION_ID/TOKEN НЕ имеют дефолтов: пока их нет — станция «не настроена»
// (isProvisioned()=false) и плеер показывает мастер первого запуска.
//
// Секреты (STATION_TOKEN) в renderer не уходят — только безопасный срез.

import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { config as loadDotenv } from 'dotenv'
import type { RendererConfig } from '@shared/types'

/** Файл идентичности для массового провижининга скриптом (см. scripts/provision-station.sh). */
export const SYSTEM_ENV_PATH = '/etc/cannect-player/station.env'

let sourcesLoaded = false
let cached: AppConfig | null = null

/** Путь к идентичности, которую пишет мастер первого запуска (в профиле приложения). */
function userStationEnvPath(): string {
  return join(app.getPath('userData'), 'station.env')
}

/** Загрузить все источники env один раз (после app ready — нужен userData path). */
function loadEnvSources(): void {
  if (sourcesLoaded) return
  if (existsSync(SYSTEM_ENV_PATH)) loadDotenv({ path: SYSTEM_ENV_PATH })
  const userPath = userStationEnvPath()
  if (existsSync(userPath)) loadDotenv({ path: userPath })
  loadDotenv() // ./.env (dev) — не перетирает уже загруженное
  sourcesLoaded = true
}

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
  /** MongoDB ObjectId станции в cannect-web. ДОЛЖЕН совпадать со STATION_ID камеры. Пусто = не настроено. */
  stationId: string
  /** Общий секрет станции — тот же, что в env камеры. Пусто = не настроено. */
  stationToken: string
  /** База cannect-web API. */
  apiBase: string
  /** Локальный edge-сервер камеры (тот же мини-ПК). */
  cameraBase: string
  /** Каталог cannect-camera на этой банке (плеер пишет туда .env). */
  cameraDir: string
  /** systemd-юнит камеры (плеер перезапускает его после смены env). */
  cameraService: string
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

export function getConfig(): AppConfig {
  if (cached) return cached
  loadEnvSources()
  cached = {
    stationId: env('STATION_ID', ''), // без дефолта — пусто = станция не настроена
    stationToken: env('STATION_TOKEN', ''),
    apiBase: env('API_BASE', 'https://cannect.kz'),
    cameraBase: env('CAMERA_BASE', 'http://127.0.0.1:8080'),
    cameraDir: env('CAMERA_DIR', join(app.getPath('home'), 'Рабочий стол', 'cannect-camera')),
    cameraService: env('CAMERA_SERVICE', 'cv-analytics'),
    cacheDir: env('CACHE_DIR', join(app.getPath('userData'), 'videos-cache')),
    pollIntervalMs: envInt('POLL_INTERVAL_MS', 60_000),
    bufferGateSec: envInt('BUFFER_GATE_SEC', 6),
    stripDividerPx: envInt('STRIP_DIVIDER_PX', 20),
    audioDevice: env('AUDIO_DEVICE', '')
  }
  return cached
}

/** Настроена ли станция (есть и ID, и токен). Иначе показываем мастер первого запуска. */
export function isProvisioned(): boolean {
  const c = getConfig()
  return Boolean(c.stationId && c.stationToken)
}

/**
 * Сохранить идентичность станции (из мастера первого запуска) в userData/station.env
 * и обновить кэш конфига. Без root — пишет в профиль пользователя.
 */
export function persistIdentity(stationId: string, stationToken: string): void {
  const id = stationId.trim()
  const token = stationToken.trim()
  const path = userStationEnvPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    `# cannect-player — идентичность станции (мастер первого запуска).\n` +
      `# Должна совпадать с .env камеры на этой банке.\n` +
      `STATION_ID=${id}\nSTATION_TOKEN=${token}\n`,
    { mode: 0o600 }
  )
  // Обновляем рантайм без перезапуска.
  process.env['STATION_ID'] = id
  process.env['STATION_TOKEN'] = token
  cached = null
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
