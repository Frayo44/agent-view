/**
 * Terminal-agnostic notification system
 * Uses Claude Code hooks to write signal files
 * Agent-view reads signal files and sends macOS native notifications
 */

import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import os from "os"

export const NOTIFICATIONS_DIR = path.join(os.homedir(), ".agent-view", "notifications")

export interface SessionNotification {
  event: "stop" | "notification"
  sessionId: string
  timestamp: number
}

export interface PendingAttach {
  sessionId: string
  sessionTitle: string
  reason: "waiting" | "idle" | "error" | "stopped"
  timestamp: number
}

// Time window (ms) to show banner after notification
const AUTO_ATTACH_WINDOW_MS = 10000

// Track pending attach
let pendingAttach: PendingAttach | null = null

// Track shown notifications to avoid showing again
const shownNotifications = new Set<string>()

/**
 * Send iTerm2 notification via escape sequence
 * This works when agent-view is running directly in iTerm2 (not inside tmux)
 * Writes to /dev/tty to bypass any output buffering/capturing by TUI frameworks
 */
export function sendItermNotification(sessionTitle: string, event: "stop" | "notification"): void {
  const message = event === "stop"
    ? `Session '${sessionTitle}' finished`
    : `Session '${sessionTitle}' needs input`

  // iTerm2 escape sequence: ESC ] 9 ; message BEL
  const notification = `\x1b]9;${message}\x07`

  // Write to /dev/tty to bypass TUI output capturing
  try {
    const fd = fs.openSync("/dev/tty", "w")
    fs.writeSync(fd, notification)
    fs.closeSync(fd)
  } catch {
    // Fallback to stdout if /dev/tty isn't available
    process.stdout.write(notification)
  }
}

/**
 * Play a sound using afplay (macOS)
 */
export function playSound(sound: "done" | "attention" | "error"): void {
  const sounds = {
    done: "/System/Library/Sounds/Glass.aiff",
    attention: "/System/Library/Sounds/Tink.aiff",
    error: "/System/Library/Sounds/Basso.aiff"
  }

  const soundPath = sounds[sound]
  spawn("afplay", [soundPath], { detached: true, stdio: "ignore" }).unref()
}

/**
 * Check if there's a pending attach and it's still within the time window
 */
export function getPendingAttach(): PendingAttach | null {
  if (!pendingAttach) return null

  const elapsed = Date.now() - pendingAttach.timestamp
  if (elapsed > AUTO_ATTACH_WINDOW_MS) {
    pendingAttach = null
    return null
  }

  return pendingAttach
}

/**
 * Consume the pending attach (after attaching)
 */
export function clearPendingAttach(): void {
  pendingAttach = null
}

/**
 * Send macOS native notification
 * Uses terminal-notifier if available, falls back to osascript
 */
export function sendMacOSNotification(sessionTitle: string, event: "stop" | "notification"): void {
  const title = event === "stop" ? "Session Finished" : "Input Needed"
  const message = `${sessionTitle} - Click to open agent-view`

  // Try terminal-notifier first (more reliable for terminal apps)
  const terminalNotifier = "/opt/homebrew/bin/terminal-notifier"
  if (fs.existsSync(terminalNotifier)) {
    spawn(terminalNotifier, [
      "-title", "Agent View",
      "-subtitle", title,
      "-message", message,
      "-sound", "default",
      "-group", "agent-view"
    ], { detached: true, stdio: "ignore" }).unref()
  } else {
    // Fallback to osascript
    const script = `display notification "${message}" with title "Agent View" subtitle "${title}" sound name "default"`
    spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref()
  }
}

/**
 * Check for new notification signal files from Claude Code hooks
 * Called from session refresh loop
 * @returns The notification signal if found, null otherwise
 */
export function checkNotificationSignals(
  sessions: { id: string; title: string }[]
): SessionNotification | null {
  if (!fs.existsSync(NOTIFICATIONS_DIR)) return null

  let files: string[]
  try {
    files = fs.readdirSync(NOTIFICATIONS_DIR)
  } catch {
    return null
  }

  for (const file of files) {
    if (!file.endsWith(".json")) continue

    const filePath = path.join(NOTIFICATIONS_DIR, file)
    try {
      const content = fs.readFileSync(filePath, "utf-8")
      const signal = JSON.parse(content) as SessionNotification

      // Delete file after reading
      fs.unlinkSync(filePath)

      // Find session title
      const session = sessions.find(s => s.id === signal.sessionId)
      if (session) {
        // Create unique key for this notification
        const notifKey = `${signal.sessionId}-${signal.timestamp}`

        // Skip if already shown
        if (shownNotifications.has(notifKey)) {
          continue
        }

        // Mark as shown
        shownNotifications.add(notifKey)

        // Clean up old entries (keep last 100)
        if (shownNotifications.size > 100) {
          const first = shownNotifications.values().next().value
          if (first) shownNotifications.delete(first)
        }

        // Send iTerm2 notification from agent-view (outside tmux)
        sendItermNotification(session.title, signal.event)
        playSound(signal.event === "stop" ? "done" : "attention")

        // Set pending attach
        pendingAttach = {
          sessionId: signal.sessionId,
          sessionTitle: session.title,
          reason: signal.event === "stop" ? "idle" : "waiting",
          timestamp: Date.now()
        }

        return signal
      }
    } catch {
      // Invalid file, delete it
      try { fs.unlinkSync(filePath) } catch {}
    }
  }

  return null
}

/**
 * Ensure notifications directory exists
 */
export function ensureNotificationsDir(): void {
  if (!fs.existsSync(NOTIFICATIONS_DIR)) {
    fs.mkdirSync(NOTIFICATIONS_DIR, { recursive: true, mode: 0o700 })
  }
}
