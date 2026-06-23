import { useEffect, useRef } from 'react'
import type { PlaylistEntry } from '@shared/types'

const PORTRAIT_STRIPS = 4
const SYNC_DRIFT_SEC = 0.3

interface DeckProps {
  entry: PlaylistEntry
  active: boolean
  dividerPx: number
  /** Вызывается, когда основное видео доиграло до конца. */
  onEnded: () => void
  /** Вызывается в момент фактического старта воспроизведения (для startedAt). */
  onStarted: () => void
}

/**
 * Один «дек» — визуал одного клипа.
 *   16:9 → одно видео на весь экран (со звуком).
 *   9:16 → 4 вертикальные полосы одного видео + чёрные разделители; звук только у 1-й.
 *
 * Неактивный дек держит видео загруженным и на паузе (прогрев), активный — играет.
 * Полосы 2–4 — немые зеркала 1-й, подтягиваются к её currentTime при дрейфе.
 */
export function Deck({ entry, active, dividerPx, onEnded, onStarted }: DeckProps): JSX.Element {
  const portrait = entry.aspectRatio === '9:16'
  const count = portrait ? PORTRAIT_STRIPS : 1
  const videos = useRef<(HTMLVideoElement | null)[]>([])
  const src = entry.localUrl ?? ''

  // Перезагрузка источника при смене клипа в этом деке (происходит, пока дек скрыт).
  useEffect(() => {
    videos.current.forEach((v) => {
      if (!v) return
      v.src = src
      v.load()
      v.currentTime = 0
    })
  }, [src])

  // Активация/деактивация: играть с нуля или встать на паузу.
  useEffect(() => {
    const vids = videos.current.filter(Boolean) as HTMLVideoElement[]
    if (active) {
      vids.forEach((v, i) => {
        v.currentTime = 0
        v.muted = i !== 0 // звук только у первой полосы
        void v.play().catch(() => {})
      })
      onStarted()
    } else {
      vids.forEach((v) => v.pause())
    }
    // onStarted/onEnded стабильны на время жизни клипа — не в зависимостях.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, src])

  // Синхронизация зеркал по основному видео.
  const handleTimeUpdate = (): void => {
    const vids = videos.current
    const primary = vids[0]
    if (!primary || count === 1) return
    for (let i = 1; i < count; i++) {
      const m = vids[i]
      if (m && Math.abs(m.currentTime - primary.currentTime) > SYNC_DRIFT_SEC) {
        m.currentTime = primary.currentTime
      }
    }
  }

  return (
    <div
      className={`deck ${portrait ? 'deck--portrait' : 'deck--landscape'} ${active ? 'active' : ''}`}
      style={portrait ? { gap: `${dividerPx}px` } : undefined}
    >
      {Array.from({ length: count }, (_, i) => {
        const video = (
          <video
            key={i}
            ref={(el) => (videos.current[i] = el)}
            preload="auto"
            playsInline
            muted={i !== 0}
            onEnded={i === 0 ? onEnded : undefined}
            onTimeUpdate={i === 0 ? handleTimeUpdate : undefined}
          />
        )
        return portrait ? (
          <div className="strip" key={i}>
            {video}
          </div>
        ) : (
          video
        )
      })}
    </div>
  )
}
