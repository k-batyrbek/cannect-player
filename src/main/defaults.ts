// Дефолтные ролики — крутятся, когда нет рекламы:
//   • очередь /queue пуста, ИЛИ
//   • бэкенд недоступен И нет сохранённого плейлиста.
// Всегда держатся в кэше и НИКОГДА не вычищаются (см. orchestrator cleanup).
//
// Пока список хардкодом; позже — редактирование из админки cannect-web.
// aspectRatio выставлен 16:9 (полный экран); поправь, если дефолты вертикальные.

import type { QueueItem } from '@shared/types'

const DEFAULT_URLS = [
  'https://cannect-upload-video.s3.eu-central-1.amazonaws.com/videos/1782456899569-default5.mp4',
  'https://cannect-upload-video.s3.eu-central-1.amazonaws.com/videos/1782456886066-default4.mp4',
  'https://cannect-upload-video.s3.eu-central-1.amazonaws.com/videos/1782456861481-default3.mp4',
  'https://cannect-upload-video.s3.eu-central-1.amazonaws.com/videos/1782456844556-default2.mp4',
  'https://cannect-upload-video.s3.eu-central-1.amazonaws.com/videos/1782456828760-default.mp4'
]

export const DEFAULT_VIDEOS: QueueItem[] = DEFAULT_URLS.map((url, i) => ({
  videoId: `default-${i + 1}`,
  videoTitle: `default-${i + 1}`,
  videoUrl: url,
  duration: 15,
  aspectRatio: '16:9',
  source: 'smb'
}))
