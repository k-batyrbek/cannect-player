// Preload: безопасный мост между renderer и main (window.cannect).
// Никаких node-API наружу — только узкий типизированный контракт.

import { contextBridge, ipcRenderer } from 'electron'
import type { CannectBridge, PlaybackEvent, PlaylistUpdate, RendererConfig } from '@shared/types'

const bridge: CannectBridge = {
  getConfig: (): Promise<RendererConfig> => ipcRenderer.invoke('config:get'),

  onPlaylist: (cb: (playlist: PlaylistUpdate) => void): (() => void) => {
    const listener = (_e: unknown, playlist: PlaylistUpdate): void => cb(playlist)
    ipcRenderer.on('playlist:update', listener)
    return () => ipcRenderer.removeListener('playlist:update', listener)
  },

  sendPlaybackEvent: (ev: PlaybackEvent): void => ipcRenderer.send('playback:event', ev),

  log: (level, message): void => ipcRenderer.send('renderer:log', level, message)
}

contextBridge.exposeInMainWorld('cannect', bridge)
