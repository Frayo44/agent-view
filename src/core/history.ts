/**
 * History manager for storing and filtering recently used values
 * Uses LRU (Least Recently Used) strategy with deduplication
 */

import fuzzysort from "fuzzysort"
import type { Storage } from "./storage"

export class HistoryManager {
  constructor(
    private storageKey: string,
    private maxItems: number = 30
  ) {}

  /**
   * Get the full history list from storage
   */
  getHistory(storage: Storage): string[] {
    const raw = storage.getMeta(this.storageKey)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string")
      }
    } catch {
      // Ignore parse errors
    }
    return []
  }

  /**
   * Add an entry to the history (LRU with deduplication)
   * The new entry is prepended to the list
   */
  addEntry(storage: Storage, value: string): void {
    if (!value || !value.trim()) return

    const history = this.getHistory(storage)

    // Remove duplicates (case-sensitive)
    const filtered = history.filter((item) => item !== value)

    // Prepend the new entry
    filtered.unshift(value)

    // Trim to max items
    const trimmed = filtered.slice(0, this.maxItems)

    // Save back to storage
    storage.setMeta(this.storageKey, JSON.stringify(trimmed))
  }

  /**
   * Get filtered history entries using fuzzy search
   */
  getFiltered(storage: Storage, query: string): string[] {
    const history = this.getHistory(storage)

    if (!query || !query.trim()) {
      return history
    }

    const results = fuzzysort.go(query, history, {
      threshold: -10000, // Allow loose matches
      limit: this.maxItems
    })

    return results.map((r) => r.target)
  }

  /**
   * Clear all history entries
   */
  clear(storage: Storage): void {
    storage.setMeta(this.storageKey, JSON.stringify([]))
  }

  /**
   * Remove a specific entry from history
   */
  removeEntry(storage: Storage, value: string): void {
    const history = this.getHistory(storage)
    const filtered = history.filter((item) => item !== value)
    storage.setMeta(this.storageKey, JSON.stringify(filtered))
  }
}
