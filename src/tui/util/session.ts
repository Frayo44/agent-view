/**
 * Session utilities
 */

import type { Session } from "@/core/types"

/**
 * Sort sessions by creation time (newest first).
 * This provides a stable sort order that doesn't change when session
 * status changes or when sessions are accessed.
 */
export function sortSessionsByCreatedAt(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
}
