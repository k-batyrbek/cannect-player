// Общие типы — контракт между main / preload / renderer.
// Поля основаны на API cannect-web (см. CLAUDE.md) и камеры (current-ad).

export type AspectRatio = '16:9' | '9:16'
export type VideoSource = 'smb' | 'agency'

/** Элемент плейлиста, как его отдаёт GET /api/stations/<id>/queue → data.queue[]. */
export interface QueueItem {
  videoId: string
  videoTitle: string
  videoUrl: string
  duration: number // секунды
  aspectRatio: AspectRatio
  source: VideoSource
  campaignId?: string
  bookingId?: string
  /** Сколько раз за час этот ролик должен быть оплачиваемым (бонус-петли сверх — billable:false). */
  showsPerHour?: number
}

/** Ответ GET /api/stations/<id>/queue → data. */
export interface QueueResponse {
  queue: QueueItem[]
  operating: boolean // в рабочих ли часах сейчас
  timezone: string
}

/** Элемент плейлиста, обогащённый локальным путём из кэша (main → renderer). */
export interface PlaylistEntry extends QueueItem {
  /** file:// URL прогретого в кэше файла, либо null если ещё качается / не удалось. */
  localUrl: string | null
}

export interface PlaylistUpdate {
  entries: PlaylistEntry[]
  operating: boolean
  timezone: string
  /** Дефолтный (заглушка) плейбэк — когда очередь пуста или вне рабочих часов. */
  isDefault: boolean
}

/** Имена событий в проводе cannect-web /current-playback и камеры /current-ad. */
export type PlaybackEventType = 'playback_started' | 'playback_changed' | 'playback_ended'

interface ClipRef {
  videoId: string
  videoTitle: string
  campaignId?: string
  bookingId?: string
  expectedDuration: number
  startedAt: string // ISO-8601 момента старта показа
  isDefault: boolean
}

/** Клип начал играть. main: current-playback (started если isFirst, иначе changed) + камера. */
export interface ClipStartEvent extends ClipRef {
  type: 'start'
  /** Первый клип после загрузки плейлиста → playback_started; иначе playback_changed. */
  isFirst: boolean
}

/** Клип доиграл/прервался. main: /report. */
export interface ClipEndEvent extends ClipRef {
  type: 'end'
  completed: boolean // доиграл до конца
}

/** Внутреннее событие renderer → main. */
export type PlaybackEvent = ClipStartEvent | ClipEndEvent

/** API, доступное в renderer через preload (window.cannect). */
export interface CannectBridge {
  getConfig(): Promise<RendererConfig>
  onPlaylist(cb: (playlist: PlaylistUpdate) => void): () => void
  sendPlaybackEvent(ev: PlaybackEvent): void
  log(level: 'info' | 'warn' | 'error', message: string): void
}

/** Безопасный для renderer срез конфига (без секретов). */
export interface RendererConfig {
  stationId: string
  stripDividerPx: number
  bufferGateSec: number
}
