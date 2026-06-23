import type { CannectBridge } from '@shared/types'

declare global {
  interface Window {
    cannect: CannectBridge
  }
}

export {}
