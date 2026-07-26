/**
 * TUI-side notification support.
 *
 * Claude sessions notify from the Claude Code hook itself (see hooks.ts);
 * the signal files it drops are consumed here to flag sessions as needing
 * attention. Custom tools have no hooks, so status-transition edges in the
 * refresh loop call sendOSNotification directly.
 */

import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import { NOTIFICATIONS_DIR } from "./hooks"

// Signals older than this are dropped: they aged out while the TUI was
// frozen during a long attach (the user saw the session state directly)
// or are leftovers from a previous run.
const SIGNAL_MAX_AGE_MS = 30_000

export interface NotificationSignal {
  event: string
  sessionId: string
  timestamp: number
}

/**
 * Read and delete all pending signal files, returning the fresh ones.
 * Deleting is the claim: if another agent-view instance got there first,
 * the unlink fails and the signal is skipped.
 */
export function consumeSignals(dir: string = NOTIFICATIONS_DIR): NotificationSignal[] {
  let files: string[]
  try {
    files = fs.readdirSync(dir)
  } catch {
    return []
  }

  const signals: NotificationSignal[] = []
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    const filePath = path.join(dir, file)

    let content: string
    try {
      content = fs.readFileSync(filePath, "utf-8")
      fs.unlinkSync(filePath) // claim
    } catch {
      continue // claimed by another instance, or vanished
    }

    try {
      const parsed = JSON.parse(content) as NotificationSignal
      if (!parsed.sessionId) continue
      const ageMs = Date.now() - (parsed.timestamp || 0) * 1000
      if (ageMs > SIGNAL_MAX_AGE_MS) continue // stale
      signals.push(parsed)
    } catch {
      // Malformed — already deleted, nothing to do
    }
  }
  return signals
}

/**
 * Remove any pending signal for a session (called when the user attaches —
 * they're about to see the session state themselves).
 */
export function clearSignalsFor(sessionId: string, dir: string = NOTIFICATIONS_DIR): void {
  try {
    fs.unlinkSync(path.join(dir, `${sessionId}.json`))
  } catch {
    // No signal pending
  }
}

/**
 * Fire a native OS notification. Used for custom-tool sessions only —
 * claude sessions notify from the hook script, which also works while the
 * TUI is frozen or closed.
 */
export function sendOSNotification(title: string, message: string): void {
  try {
    if (process.platform === "darwin") {
      const tn = ["/opt/homebrew/bin/terminal-notifier", "/usr/local/bin/terminal-notifier"]
        .find(p => fs.existsSync(p))
      if (tn) {
        spawn(tn, ["-title", title, "-message", message], { detached: true, stdio: "ignore" }).unref()
      } else {
        const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
        spawn("osascript", ["-e", `display notification "${esc(message)}" with title "${esc(title)}"`], {
          detached: true,
          stdio: "ignore"
        }).unref()
      }
    } else if (process.platform === "linux") {
      spawn("notify-send", [title, message], { detached: true, stdio: "ignore" }).unref()
    }
  } catch {
    // Notification delivery is best-effort
  }
}
