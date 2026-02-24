/**
 * Status utilities
 */

import type { SessionStatus } from "@/core/types"

export const STATUS_ICONS: Record<SessionStatus, string> = {
  running: "●",
  waiting: "◐",
  idle: "○",
  stopped: "◻",
  error: "✗",
  hibernated: "◉"
}
