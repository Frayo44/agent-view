/**
 * Key-Value store context for persistent settings
 * Based on OpenCode's kv context
 */

import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [store, setStore] = createStore<Record<string, unknown>>({})

    return {
      get<T>(key: string, defaultValue: T): T {
        const value = store[key]
        return value !== undefined ? (value as T) : defaultValue
      },
      set<T>(key: string, value: T): void {
        setStore(key, value)
      },
      has(key: string): boolean {
        return store[key] !== undefined
      },
      delete(key: string): void {
        setStore(key, undefined)
      }
    }
  }
})
