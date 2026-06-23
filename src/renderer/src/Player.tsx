import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlaylistEntry, PlaylistUpdate, RendererConfig } from '@shared/types'
import { Deck } from './Deck'

interface PlayerProps {
  config: RendererConfig
  playlist: PlaylistUpdate
}

/**
 * Движок плеера с двойной буферизацией.
 *
 * Два дека (slot 0/1) наложены друг на друга. Активный играет и виден, неактивный
 * держит СЛЕДУЮЩИЙ клип прогретым (загружен, на паузе). По окончании активного —
 * мгновенный свап: прогретый дек становится активным, освободившийся подгружает
 * клип через один. Так переход без чёрного кадра/лагов.
 *
 * Инвариант: неактивный дек всегда показывает (playingIndex + 1) % len.
 */
export function Player({ config, playlist }: PlayerProps): JSX.Element {
  // Только прогретые в кэш клипы играбельны.
  const playable = playlist.entries.filter((e): e is PlaylistEntry & { localUrl: string } =>
    Boolean(e.localUrl)
  )
  const len = playable.length

  // Какой индех playable показан в каждом деке.
  const [slotIndex, setSlotIndex] = useState<[number, number]>([0, len > 1 ? 1 : 0])
  const [active, setActive] = useState<0 | 1>(0)
  const activeRef = useRef<0 | 1>(0)
  const playingIndexRef = useRef(0)
  const isFirstRef = useRef(true)
  const startedAtRef = useRef<string>('')

  const emitStart = useCallback(
    (entry: PlaylistEntry, isFirst: boolean) => {
      const startedAt = new Date().toISOString()
      startedAtRef.current = startedAt
      window.cannect.sendPlaybackEvent({
        type: 'start',
        isFirst,
        videoId: entry.videoId,
        videoTitle: entry.videoTitle,
        campaignId: entry.campaignId,
        bookingId: entry.bookingId,
        expectedDuration: entry.duration,
        isDefault: playlist.isDefault,
        startedAt
      })
    },
    [playlist.isDefault]
  )

  const emitEnd = useCallback(
    (entry: PlaylistEntry, completed: boolean) => {
      window.cannect.sendPlaybackEvent({
        type: 'end',
        videoId: entry.videoId,
        videoTitle: entry.videoTitle,
        campaignId: entry.campaignId,
        bookingId: entry.bookingId,
        expectedDuration: entry.duration,
        isDefault: playlist.isDefault,
        startedAt: startedAtRef.current,
        completed
      })
    },
    [playlist.isDefault]
  )

  // Сброс движка при новом плейлисте — стартуем с индекса 0.
  useEffect(() => {
    playingIndexRef.current = 0
    isFirstRef.current = true
    activeRef.current = 0
    setSlotIndex([0, len > 1 ? 1 : 0])
    setActive(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist])

  // Конец активного клипа → отчёт + свап на прогретый дек + подгрузка следующего.
  const handleEnded = useCallback(() => {
    if (len === 0) return
    emitEnd(playable[playingIndexRef.current], true)

    const nextIndex = (playingIndexRef.current + 1) % len
    const followingIndex = (nextIndex + 1) % len
    const freed = activeRef.current // освободившийся дек — подгружает клип «через один»
    const newActive: 0 | 1 = freed === 0 ? 1 : 0

    setSlotIndex((slots) => {
      const updated = [...slots] as [number, number]
      updated[freed] = followingIndex
      return updated
    })
    activeRef.current = newActive
    setActive(newActive)
    playingIndexRef.current = nextIndex
    isFirstRef.current = false
  }, [emitEnd, len, playable])

  // Старт клипа эмитим из деки в момент фактического play().
  const handleStarted = useCallback(() => {
    const entry = playable[playingIndexRef.current]
    if (entry) emitStart(entry, isFirstRef.current)
  }, [emitStart, playable])

  if (len === 0) return <div className="status">нет прогретого контента — ожидание…</div>

  return (
    <div className="stage">
      {[0, 1].map((slot) => {
        const entry = playable[slotIndex[slot as 0 | 1]]
        if (!entry) return null
        return (
          <Deck
            key={slot}
            entry={entry}
            active={active === slot}
            dividerPx={config.stripDividerPx}
            onEnded={handleEnded}
            onStarted={handleStarted}
          />
        )
      })}
    </div>
  )
}
