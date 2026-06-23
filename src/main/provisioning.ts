// Провижининг банки из мастера первого запуска (main-сторона).
//
// Вариант A: плеер ПИШЕТ .env камеры и ПЕРЕЗАПУСКАЕТ её через systemd.
// Саму камеру (git clone + venv + systemd-юнит + NOPASSWD sudoers) ставит
// разовый install.sh — здесь только конфиг + рестарт.

import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { getConfig } from './config'
import { log } from './logger'

const pExecFile = promisify(execFile)

/**
 * Индексы /dev/video* — подсказка о подключённых камерах. На новых ядрах одна
 * USB-камера может давать 2 ноды (capture + metadata), поэтому это ОЦЕНКА:
 * мастер показывает её, а итоговое число камер подтверждает пользователь.
 */
export function detectCameras(): number[] {
  try {
    return readdirSync('/dev')
      .filter((n) => /^video\d+$/.test(n))
      .map((n) => Number(n.slice('video'.length)))
      .sort((a, b) => a - b)
  } catch {
    return []
  }
}

function cameraEnvPath(): string {
  return join(getConfig().cameraDir, '.env')
}

/** Обновить/вставить ключи в .env, сохраняя прочие строки и комментарии. */
function upsertEnv(content: string, updates: Record<string, string>): string {
  let out = content
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`
    const re = new RegExp(`^${key}=.*$`, 'm')
    if (re.test(out)) {
      out = out.replace(re, line)
    } else {
      out = out === '' || out.endsWith('\n') ? `${out}${line}\n` : `${out}\n${line}\n`
    }
  }
  return out
}

export interface CameraEnvOpts {
  stationId: string
  stationToken: string
  /** Число камер для записи; <0 = «Пропустить» (не трогаем число камер, только ID/токен). */
  cameraCount: number
}

export interface ProvisionResult {
  ok: boolean
  path: string
  reason?: string
}

/** Записать идентичность (+опц. камеры) в .env модуля cannect-camera (если установлен). */
export function writeCameraEnv(opts: CameraEnvOpts): ProvisionResult {
  const dir = getConfig().cameraDir
  const path = cameraEnvPath()
  if (!existsSync(dir)) {
    return { ok: false, path, reason: `каталог камеры не найден: ${dir}` }
  }

  const updates: Record<string, string> = {
    STATION_ID: opts.stationId,
    STATION_TOKEN: opts.stationToken
  }
  // Камеры пишем только если пользователь не нажал «Пропустить».
  if (opts.cameraCount >= 0) {
    updates['CAMERA_COUNT'] = String(opts.cameraCount)
    // Последовательные USB-индексы 0..N-1 (конвенция .env камеры).
    for (let i = 1; i <= opts.cameraCount; i++) updates[`CAMERA_${i}_URL`] = String(i - 1)
  }

  try {
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
    writeFileSync(path, upsertEnv(existing, updates), { mode: 0o600 })
    log('info', `camera .env обновлён (${path}), cameras=${opts.cameraCount}`)
    return { ok: true, path }
  } catch (e) {
    return { ok: false, path, reason: (e as Error).message }
  }
}

/** Перезапустить службу камеры через systemd (NOPASSWD-правило ставит install.sh). */
export async function restartCamera(): Promise<{ ok: boolean; reason?: string }> {
  const svc = getConfig().cameraService
  try {
    await pExecFile('sudo', ['-n', 'systemctl', 'restart', svc])
    log('info', `служба камеры перезапущена: ${svc}`)
    return { ok: true }
  } catch (e) {
    log('warn', `рестарт камеры не удался: ${(e as Error).message}`)
    return { ok: false, reason: (e as Error).message }
  }
}

/** Установлен ли модуль камеры на этой банке. */
export function cameraInstalled(): boolean {
  return existsSync(getConfig().cameraDir)
}
