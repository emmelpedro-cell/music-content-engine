/// <reference types="vite/client" />
import type { MceApi } from '../../shared/api'

declare global {
  interface Window {
    mce: MceApi
  }
}

export {}
