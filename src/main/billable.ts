// Учёт оплачиваемости показов (billable).
//
// CLAUDE.md: billable=false для бонус-петель — повторов сверх забронированных
// showsPerHour. Сервер САМ занулит billable вне рабочих часов, так что про часы
// мы не думаем — только про квоту повторов в текущем часе.
//
// Ключ квоты — bookingId (точная бронь), иначе campaignId, иначе videoId.

import type { QueueItem } from '@shared/types'

function key(item: Pick<QueueItem, 'videoId' | 'campaignId' | 'bookingId'>): string {
  return item.bookingId ?? item.campaignId ?? item.videoId
}

export class BillableTracker {
  private counts = new Map<string, number>()
  private hourStamp = ''

  private rollHourIfNeeded(nowIso: string): void {
    const hour = nowIso.slice(0, 13) // YYYY-MM-DDTHH
    if (hour !== this.hourStamp) {
      this.hourStamp = hour
      this.counts.clear()
    }
  }

  /**
   * Регистрирует показ и возвращает, оплачиваемый ли он.
   * Первые showsPerHour показов в часе — billable; сверх — бонус (false).
   * Если showsPerHour не задан, считаем показ оплачиваемым (квоты нет).
   */
  register(item: QueueItem, nowIso: string): boolean {
    this.rollHourIfNeeded(nowIso)
    const k = key(item)
    const seen = this.counts.get(k) ?? 0
    this.counts.set(k, seen + 1)
    if (item.showsPerHour === undefined) return true
    return seen < item.showsPerHour
  }
}
