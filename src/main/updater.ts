// Автообновление через electron-updater.
//
// Релизы лежат на GitHub Releases ПУБЛИЧНОГО репо k-batyrbek/cannect-player,
// поэтому на банке НЕ нужен токен — устройство просто качает обновления.
// Публикация (заливка релизов) идёт с Mac/CI: `npm run build:linux` + electron-builder.
//
// Работает только в упакованном билде (AppImage). В dev — no-op.

import { app } from 'electron'
// electron-updater — CommonJS-модуль: именованный импорт не работает в ESM-сборке,
// берём autoUpdater из default-экспорта.
import electronUpdater from 'electron-updater'
import { log } from './logger'

const { autoUpdater } = electronUpdater

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // каждые 6 часов

export function setupAutoUpdate(): void {
  if (!app.isPackaged) {
    log('info', 'auto-update отключён (dev / не упаковано)')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => log('info', 'updater: проверяю обновления…'))
  autoUpdater.on('update-available', (i) => log('info', `updater: доступно ${i.version}, качаю`))
  autoUpdater.on('update-not-available', () => log('info', 'updater: актуальная версия'))
  autoUpdater.on('download-progress', (p) =>
    log('info', `updater: загрузка ${Math.round(p.percent)}%`)
  )
  autoUpdater.on('error', (e) => log('error', `updater: ${e.message}`))
  autoUpdater.on('update-downloaded', (i) => {
    // Банка крутится 24/7 и почти не перезапускается, поэтому ставим сразу:
    // перезапуск занимает секунды, плейбэк возобновляется из кэша.
    // TODO: при желании откладывать до нерабочих часов (data.operating=false).
    log('info', `updater: ${i.version} загружено → перезапуск для установки`)
    autoUpdater.quitAndInstall()
  })

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((e) => log('warn', `updater: проверка не удалась: ${e.message}`))
  }
  check()
  setInterval(check, CHECK_INTERVAL_MS)
}
