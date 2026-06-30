// Оркестратор плеера (main-процесс).
//
// Ответственность:
//   1. Периодически опрашивать /queue.
//   2. Прогревать в кэш ВЕСЬ плейлист, затем слать его renderer'у (с file:// путями).
//   3. Персистить последний реальный плейлист на диск — чтобы перезапуск во время
//      простоя бэкенда не оставлял банку без плейлиста (видео уже в кэше).
//   4. Фолбэк на дефолтные ролики, когда рекламы нет (пустая очередь, либо бэкенд
//      недоступен и нет сохранённого плейлиста).
//   5. Принимать события плейбэка от renderer и делать fan-out:
//        - cannect-web  POST /current-playback
//        - камера       POST /current-ad   (та же семантика, локально)
//        - cannect-web  POST /report       (на ended, с duration/completed/billable)
//
// Плейбэк-цикл (что играть, зацикливание, переходы) живёт в renderer — здесь только
// сеть, кэш и атрибуция.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { fetchQueue, sendCurrentPlayback, sendReport } from './api'
import { notifyCamera } from './camera'
import { VideoCache } from './cache'
import { BillableTracker } from './billable'
import { getConfig } from './config'
import { DEFAULT_VIDEOS } from './defaults'
import { log } from './logger'
import type {
  PlaybackEvent,
  PlaybackEventType,
  PlaylistEntry,
  PlaylistUpdate,
  QueueItem,
  QueueResponse
} from '@shared/types'

export class Orchestrator {
  private win: BrowserWindow
  private cache = new VideoCache()
  private billable = new BillableTracker()
  private pollTimer: NodeJS.Timeout | null = null
  private lastQueueKey = ''
  /** videoId → QueueItem из последнего плейлиста, чтобы обогащать события report'ом. */
  private items = new Map<string, QueueItem>()
  /** Файл с последним реальным плейлистом (переживает перезапуск при простое бэкенда). */
  private playlistFile = join(getConfig().cacheDir, 'last-playlist.json')

  constructor(win: BrowserWindow) {
    this.win = win
  }

  async start(): Promise<void> {
    await this.cache.init()
    // Дефолты всегда держим в кэше — крайний фолбэк, доступный даже офлайн с первого старта.
    void this.cache.prefetchAll(DEFAULT_VIDEOS.map((v) => v.videoUrl))
    await this.poll()
    const { pollIntervalMs } = getConfig()
    this.pollTimer = setInterval(() => void this.poll(), pollIntervalMs)
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  /** Сохранить последний реальный плейлист (для переживания перезапуска при простое бэкенда). */
  private persistPlaylist(qr: QueueResponse): void {
    try {
      writeFileSync(this.playlistFile, JSON.stringify(qr))
    } catch (e) {
      log('warn', `persist playlist failed: ${(e as Error).message}`)
    }
  }

  private loadPlaylist(): QueueResponse | null {
    try {
      if (existsSync(this.playlistFile)) {
        return JSON.parse(readFileSync(this.playlistFile, 'utf8')) as QueueResponse
      }
    } catch (e) {
      log('warn', `load playlist failed: ${(e as Error).message}`)
    }
    return null
  }

  /**
   * Определить, что играть: реальная очередь / сохранённый плейлист / дефолты.
   * Реальную очередь персистим на диск.
   */
  private resolvePlaylist(): Promise<{
    queue: QueueItem[]
    operating: boolean
    timezone: string
    isDefault: boolean
  }> {
    return fetchQueue().then(
      (r) => {
        if (r.queue.length > 0) {
          this.persistPlaylist(r)
          return { queue: r.queue, operating: r.operating, timezone: r.timezone, isDefault: false }
        }
        log('info', 'очередь пуста → дефолтные ролики')
        return { queue: DEFAULT_VIDEOS, operating: r.operating, timezone: r.timezone, isDefault: true }
      },
      (err) => {
        log('error', `queue poll failed: ${(err as Error).message}`)
        const persisted = this.loadPlaylist()
        if (persisted && persisted.queue.length > 0) {
          log('info', `бэкенд недоступен → сохранённый плейлист (${persisted.queue.length})`)
          return {
            queue: persisted.queue,
            operating: persisted.operating,
            timezone: persisted.timezone,
            isDefault: false
          }
        }
        log('info', 'бэкенд недоступен и плейлиста нет → дефолтные ролики')
        return { queue: DEFAULT_VIDEOS, operating: false, timezone: 'Asia/Almaty', isDefault: true }
      }
    )
  }

  /** Один цикл опроса: resolve → прогрев кэша → отправка плейлиста renderer'у. */
  private async poll(): Promise<void> {
    const { queue, operating, timezone, isDefault } = await this.resolvePlaylist()

    // Запоминаем элементы для report по videoId.
    this.items.clear()
    for (const it of queue) this.items.set(it.videoId, it)

    // Прогреваем нужные ролики.
    const urls = queue.map((q) => q.videoUrl)
    const cached = await this.cache.prefetchAll(urls)

    // Чистим кэш, но НИКОГДА не удаляем дефолты и сохранённый реальный плейлист
    // (иначе при временном переключении на дефолты потеряли бы рекламу из кэша).
    const persisted = this.loadPlaylist()
    const keep = new Set<string>([
      ...urls,
      ...DEFAULT_VIDEOS.map((v) => v.videoUrl),
      ...(persisted?.queue.map((q) => q.videoUrl) ?? [])
    ])
    void this.cache.cleanup([...keep])

    const entries: PlaylistEntry[] = queue.map((q) => ({
      ...q,
      localUrl: cached.get(q.videoUrl) ?? null
    }))

    const update: PlaylistUpdate = { entries, operating, timezone, isDefault }

    // Шлём в renderer только если плейлист реально изменился (или это первый раз).
    const key = JSON.stringify([isDefault, ...entries.map((e) => [e.videoId, e.localUrl])])
    if (key !== this.lastQueueKey) {
      this.lastQueueKey = key
      this.send(update)
      log('info', `playlist updated: ${entries.length} item(s), default=${isDefault}, operating=${operating}`)
    }
  }

  private send(update: PlaylistUpdate): void {
    if (!this.win.isDestroyed()) this.win.webContents.send('playlist:update', update)
  }

  /** Событие плейбэка от renderer → fan-out. Вызывается из IPC-хендлера. */
  handlePlaybackEvent(ev: PlaybackEvent): void {
    if (ev.type === 'start') {
      // Старт клипа: первый после загрузки → started, переход в цикле → changed.
      const event: PlaybackEventType = ev.isFirst ? 'playback_started' : 'playback_changed'

      // 1) cannect-web /current-playback
      void sendCurrentPlayback({
        event,
        campaignId: ev.campaignId,
        bookingId: ev.bookingId,
        videoId: ev.videoId,
        videoTitle: ev.videoTitle,
        expectedDuration: ev.expectedDuration,
        isDefault: ev.isDefault,
        startedAt: ev.startedAt
      })

      // 2) Камера /current-ad (заглушку-дефолт не атрибутируем)
      if (!ev.isDefault) {
        notifyCamera({
          event,
          campaignId: ev.campaignId,
          bookingId: ev.bookingId,
          videoId: ev.videoId,
          startedAt: ev.startedAt,
          expectedDuration: ev.expectedDuration
        })
      }
      return
    }

    // ev.type === 'end' → report. Оплачиваемость считаем здесь (один register
    // на показ): первые showsPerHour в часе billable, сверх — бонус-петля.
    if (!ev.isDefault) {
      const item = this.items.get(ev.videoId)
      void sendReport({
        videoId: ev.videoId,
        campaignId: ev.campaignId,
        bookingId: ev.bookingId,
        timestamp: ev.startedAt,
        duration: ev.expectedDuration,
        completed: ev.completed,
        billable: item ? this.billable.register(item, ev.startedAt) : true
      })
    }
  }
}
