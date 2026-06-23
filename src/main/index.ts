// Точка входа main-процесса Electron.
//
// Ключевое: autoplay-policy=no-user-gesture-required — ГЛАВНАЯ причина перехода
// на Electron (см. CLAUDE.md). Снимает требование жеста юзера → видео играет со
// звуком сразу, без костылей браузера.

import { app, BrowserWindow, globalShortcut, ipcMain, session } from 'electron'
import { join } from 'path'
import { getConfig, getRendererConfig } from './config'
import { Orchestrator } from './orchestrator'
import { setupAutoUpdate } from './updater'
import { log } from './logger'
import type { PlaybackEvent } from '@shared/types'

// --- Флаги до готовности app ---------------------------------------------
// Автоплей со звуком без жеста пользователя.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// На банке один экземпляр.
if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null
let orchestrator: Orchestrator | null = null

function createWindow(): BrowserWindow {
  // PLAYER_WINDOWED=1 — оконный режим для разработки/смоук-теста (не захватывает экран).
  const windowed = process.env['PLAYER_WINDOWED'] === '1'
  const w = new BrowserWindow({
    fullscreen: !windowed,
    kiosk: !windowed,
    frame: windowed,
    width: windowed ? 960 : undefined,
    height: windowed ? 540 : undefined,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      // Нужен доступ к file:// из кэша для <video src>.
      webSecurity: false
    }
  })

  w.once('ready-to-show', () => w.show())
  w.webContents.on('render-process-gone', (_e, details) =>
    log('error', `renderer gone: ${details.reason}`)
  )

  if (process.env['ELECTRON_RENDERER_URL']) {
    void w.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void w.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return w
}

function registerIpc(): void {
  ipcMain.handle('config:get', () => getRendererConfig())

  ipcMain.on('playback:event', (_e, ev: PlaybackEvent) => {
    orchestrator?.handlePlaybackEvent(ev)
  })

  ipcMain.on('renderer:log', (_e, level: 'info' | 'warn' | 'error', message: string) => {
    log(level, `[renderer] ${message}`)
  })
}

app.whenReady().then(async () => {
  const cfg = getConfig()
  log('info', `cannect-player starting · station=${cfg.stationId}`)
  if (!cfg.stationToken) {
    log('warn', 'STATION_TOKEN пуст — вызовы камеры /current-ad будут без авторизации')
  }

  // Опциональный выбор аудио-устройства вывода.
  if (cfg.audioDevice) {
    session.defaultSession.setPermissionCheckHandler(() => true)
  }

  // Аварийный выход из kiosk: Ctrl+Q всегда, Esc — только вне упакованного билда.
  globalShortcut.register('CommandOrControl+Q', () => app.quit())
  if (!app.isPackaged) globalShortcut.register('Escape', () => app.quit())

  registerIpc()
  win = createWindow()
  orchestrator = new Orchestrator(win)
  await orchestrator.start()

  setupAutoUpdate()
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('window-all-closed', () => {
  orchestrator?.stop()
  app.quit()
})
