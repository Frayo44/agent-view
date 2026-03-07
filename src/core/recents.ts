/**
 * Recents management - pure functions for managing recent sessions list
 */

import type { Recent } from "./types"

const MAX_RECENTS = 15

/**
 * Add a recent entry to the list with LRU behavior
 * - Deduplicates by projectPath + tool + name
 * - Most recently used entries appear first
 * - Limits to MAX_RECENTS entries
 */
export function addRecent(recents: Recent[], newRecent: Recent): Recent[] {
  const list = [...recents]

  // Dedupe by projectPath + tool + name + remoteHost (allows same folder with different names)
  const existingIdx = list.findIndex(r =>
    r.projectPath === newRecent.projectPath &&
    r.tool === newRecent.tool &&
    r.name === newRecent.name &&
    r.remoteHost === newRecent.remoteHost
  )

  // Remove existing if found, then prepend (most recent first)
  if (existingIdx >= 0) {
    list.splice(existingIdx, 1)
  }
  list.unshift(newRecent)

  // Limit to MAX_RECENTS entries
  return list.slice(0, MAX_RECENTS)
}

/**
 * Get the max recents limit
 */
export function getMaxRecents(): number {
  return MAX_RECENTS
}
