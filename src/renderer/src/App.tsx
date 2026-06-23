import { useEffect, useState } from 'react'
import type { PlaylistUpdate, RendererConfig } from '@shared/types'
import { Player } from './Player'

export function App(): JSX.Element {
  const [config, setConfig] = useState<RendererConfig | null>(null)
  const [playlist, setPlaylist] = useState<PlaylistUpdate | null>(null)

  useEffect(() => {
    void window.cannect.getConfig().then(setConfig)
    const off = window.cannect.onPlaylist(setPlaylist)
    return off
  }, [])

  if (!config) return <div className="status">инициализация…</div>

  const playable = playlist?.entries.filter((e) => e.localUrl) ?? []
  if (playable.length === 0) {
    return (
      <div className="status">
        {playlist ? 'нет прогретого контента — ожидание…' : 'загрузка плейлиста…'}
      </div>
    )
  }

  return <Player config={config} playlist={playlist!} />
}
