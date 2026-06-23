// Менеджер кэша видео.
//
// Зачем: офлайн-устойчивость + плавные переходы. Качаем КАЖДЫЙ videoUrl на диск
// (имя файла = хэш URL), играем из file://. Перед стартом показа прогреваем
// ВЕСЬ плейлист (а не только следующий клип), чтобы не было лагов/ошибок.
//
// Скачивание атомарное: пишем в <hash>.part, по успеху переименовываем в <hash>.<ext>.
// Это защищает от «битых» полускачанных файлов при обрыве сети/питания.

import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { mkdir, readdir, rename, stat, unlink } from 'fs/promises'
import { join, extname } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { pathToFileURL } from 'url'
import { getConfig } from './config'
import { log } from './logger'

const DOWNLOAD_TIMEOUT_MS = 120_000

function hashUrl(url: string): string {
  return createHash('sha1').update(url).digest('hex')
}

function extFor(url: string): string {
  const ext = extname(new URL(url).pathname).toLowerCase()
  return /^\.(mp4|webm|mkv|mov|m4v)$/.test(ext) ? ext : '.mp4'
}

export class VideoCache {
  private dir: string
  /** Промисы текущих скачиваний — дедуп параллельных запросов на один URL. */
  private inflight = new Map<string, Promise<string>>()

  constructor(dir = getConfig().cacheDir) {
    this.dir = dir
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    log('info', `video cache dir: ${this.dir}`)
  }

  private finalPath(url: string): string {
    return join(this.dir, hashUrl(url) + extFor(url))
  }

  /** Уже прогрет ли URL (файл существует и непустой). */
  async isCached(url: string): Promise<boolean> {
    try {
      const s = await stat(this.finalPath(url))
      return s.isFile() && s.size > 0
    } catch {
      return false
    }
  }

  /** file:// URL прогретого файла или null, если ещё не в кэше. */
  async localUrl(url: string): Promise<string | null> {
    return (await this.isCached(url)) ? pathToFileURL(this.finalPath(url)).href : null
  }

  /**
   * Гарантирует, что URL скачан. Возвращает file:// путь.
   * Параллельные вызовы на один URL делят одно скачивание.
   */
  async ensure(url: string): Promise<string> {
    const dest = this.finalPath(url)
    if (await this.isCached(url)) return pathToFileURL(dest).href

    const existing = this.inflight.get(url)
    if (existing) return existing

    const task = this.download(url, dest).finally(() => this.inflight.delete(url))
    this.inflight.set(url, task)
    return task
  }

  private async download(url: string, dest: string): Promise<string> {
    const part = dest + '.part'
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS)
    log('info', `caching ${url}`)
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part))
      await rename(part, dest)
      log('info', `cached → ${dest}`)
      return pathToFileURL(dest).href
    } catch (err) {
      await unlink(part).catch(() => {})
      log('error', `cache failed ${url}: ${(err as Error).message}`)
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Прогревает весь список URL. Возвращает map url → file:// (или null при ошибке).
   * Качает с ограничением параллелизма, чтобы не насиловать сеть/диск.
   */
  async prefetchAll(urls: string[], concurrency = 3): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>()
    const unique = [...new Set(urls)]
    let i = 0
    const worker = async (): Promise<void> => {
      while (i < unique.length) {
        const url = unique[i++]
        try {
          result.set(url, await this.ensure(url))
        } catch {
          result.set(url, null)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker))
    return result
  }

  /** Удаляет из кэша файлы, которых нет в актуальном плейлисте. */
  async cleanup(keepUrls: string[]): Promise<void> {
    const keep = new Set(keepUrls.map((u) => hashUrl(u) + extFor(u)))
    let removed = 0
    try {
      for (const name of await readdir(this.dir)) {
        if (name.endsWith('.part')) continue
        if (!keep.has(name)) {
          await unlink(join(this.dir, name)).catch(() => {})
          removed++
        }
      }
      if (removed) log('info', `cache cleanup: removed ${removed} stale file(s)`)
    } catch (err) {
      log('warn', `cache cleanup failed: ${(err as Error).message}`)
    }
  }
}
