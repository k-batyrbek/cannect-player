// Оркестратор плеера (main-процесс).
//
// Ответственность:
//   1. Периодически опрашивать /queue.
//   2. Прогревать в кэш ВЕСЬ плейлист, затем слать его renderer'у (с file:// путями).
//   3. Принимать события плейбэка от renderer (started/changed/ended) и делать fan-out:
//        - cannect-web  POST /current-playback
//        - камера       POST /current-ad   (та же семантика, локально)
//        - cannect-web  POST /report       (на ended, с duration/completed/billable)
//
// Плейбэк-цикл (что играть, зацикливание, переходы) живёт в renderer — здесь только
// сеть, кэш и атрибуция.

import type { BrowserWindow } from 'electron'
import { fetchQueue, sendCurrentPlayback, sendReport } from './api'
import { notifyCamera } from './camera'
import { VideoCache } from './cache'
import { BillableTracker } from './billable'
import { getConfig } from './config'
import { log } from './logger'
import type {
  PlaybackEvent,
  PlaybackEventType,
  PlaylistEntry,
  PlaylistUpdate,
  QueueItem
} from '@shared/types'

export class Orchestrator {
  private win: BrowserWindow
  private cache = new VideoCache()
  private billable = new BillableTracker()
  private pollTimer: NodeJS.Timeout | null = null
  private lastQueueKey = ''
  /** videoId → QueueItem из последнего плейлиста, чтобы обогащать события report'ом. */
  private items = new Map<string, QueueItem>()

  constructor(win: BrowserWindow) {
    this.win = win
  }

  async start(): Promise<void> {
    await this.cache.init()
    await this.poll()
    const { pollIntervalMs } = getConfig()
    this.pollTimer = setInterval(() => void this.poll(), pollIntervalMs)
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  /** Один цикл опроса: queue → прогрев кэша → отправка плейлиста renderer'у. */
  private async poll(): Promise<void> {
    try {
      const { queue, operating, timezone } = await fetchQueue()
      const isDefault = queue.length === 0

      // Запоминаем элементы для report по videoId.
      this.items.clear()
      for (const it of queue) this.items.set(it.videoId, it)

      // Прогреваем весь плейлист и чистим устаревшее.
      const urls = queue.map((q) => q.videoUrl)
      const cached = await this.cache.prefetchAll(urls)
      void this.cache.cleanup(urls)

      const entries: PlaylistEntry[] = queue.map((q) => ({
        ...q,
        localUrl: cached.get(q.videoUrl) ?? null
      }))

      const update: PlaylistUpdate = { entries, operating, timezone, isDefault }

      // Шлём в renderer только если плейлист реально изменился (или это первый раз).
      const key = JSON.stringify(entries.map((e) => [e.videoId, e.localUrl]))
      if (key !== this.lastQueueKey) {
        this.lastQueueKey = key
        this.send(update)
        log('info', `playlist updated: ${entries.length} item(s), operating=${operating}`)
      }
    } catch (err) {
      log('error', `queue poll failed: ${(err as Error).message}`)
      // Сеть упала — renderer продолжает крутить то, что уже в кэше (офлайн).
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
