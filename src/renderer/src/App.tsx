import { useEffect, useState } from 'react'
import type { PlaylistUpdate, ProvisioningStatus, RendererConfig } from '@shared/types'
import { Player } from './Player'
import { Wizard } from './Wizard'

export function App(): JSX.Element {
  const [status, setStatus] = useState<ProvisioningStatus | null>(null)
  const [provisioned, setProvisioned] = useState(false)
  const [config, setConfig] = useState<RendererConfig | null>(null)
  const [playlist, setPlaylist] = useState<PlaylistUpdate | null>(null)

  useEffect(() => {
    void window.cannect.getProvisioningStatus().then((s) => {
      setStatus(s)
      setProvisioned(s.provisioned)
    })
    const off = window.cannect.onPlaylist(setPlaylist)
    return off
  }, [])

  // Конфиг (со stationId) грузим только когда станция настроена.
  useEffect(() => {
    if (provisioned) void window.cannect.getConfig().then(setConfig)
  }, [provisioned])

  if (!status) return <div className="status">инициализация…</div>

  // Станция не настроена → мастер первого запуска.
  if (!provisioned) return <Wizard status={status} onDone={() => setProvisioned(true)} />

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
