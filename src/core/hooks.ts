/**
 * Claude Code hooks management
 * Installs/uninstalls hooks that write session events to signal files
 */

import fs from "fs"
import path from "path"
import os from "os"

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json")
export const NOTIFICATIONS_DIR = path.join(os.homedir(), ".agent-view", "notifications")
const AGENT_VIEW_MARKER = "__installed_by_agent_view__"

// Hook commands that write signal files for agent-view
// Agent-view reads these and sends notifications (from outside tmux, so iTerm2 sees them)
// Using if/then/fi to always exit 0 even when env var isn't set
const STOP_HOOK_COMMAND = `bash -c 'NOTIF_DIR="$HOME/.agent-view/notifications"; mkdir -p "$NOTIF_DIR"; if [ -n "$AGENT_ORCHESTRATOR_SESSION" ]; then echo "{\\"event\\":\\"stop\\",\\"sessionId\\":\\"$AGENT_ORCHESTRATOR_SESSION\\",\\"timestamp\\":$(date +%s)}" > "$NOTIF_DIR/$AGENT_ORCHESTRATOR_SESSION.json"; fi; exit 0'`

const NOTIFICATION_HOOK_COMMAND = `bash -c 'NOTIF_DIR="$HOME/.agent-view/notifications"; mkdir -p "$NOTIF_DIR"; if [ -n "$AGENT_ORCHESTRATOR_SESSION" ]; then echo "{\\"event\\":\\"notification\\",\\"sessionId\\":\\"$AGENT_ORCHESTRATOR_SESSION\\",\\"timestamp\\":$(date +%s)}" > "$NOTIF_DIR/$AGENT_ORCHESTRATOR_SESSION.json"; fi; exit 0'`

interface ClaudeHook {
  type: "command"
  command: string
}

interface ClaudeHookMatcher {
  hooks: ClaudeHook[]
  [AGENT_VIEW_MARKER]?: boolean
}

interface ClaudeSettings {
  hooks?: {
    Stop?: ClaudeHookMatcher[]
    Notification?: ClaudeHookMatcher[]
    [key: string]: ClaudeHookMatcher[] | undefined
  }
  [key: string]: unknown
}

/**
 * Read Claude settings file
 */
function readSettings(): ClaudeSettings {
  try {
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      const content = fs.readFileSync(CLAUDE_SETTINGS_PATH, "utf-8")
      return JSON.parse(content)
    }
  } catch {
    // Ignore parse errors, return empty settings
  }
  return {}
}

/**
 * Write Claude settings file
 */
function writeSettings(settings: ClaudeSettings): void {
  const dir = path.dirname(CLAUDE_SETTINGS_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2))
}

/**
 * Check if agent-view hooks are installed
 */
export function areHooksInstalled(): boolean {
  const settings = readSettings()
  if (!settings.hooks) return false

  const stopHooks = settings.hooks.Stop || []
  const notificationHooks = settings.hooks.Notification || []

  const hasStopHook = stopHooks.some(matcher => matcher[AGENT_VIEW_MARKER] === true)
  const hasNotificationHook = notificationHooks.some(matcher => matcher[AGENT_VIEW_MARKER] === true)

  return hasStopHook && hasNotificationHook
}

/**
 * Install Claude Code hooks for agent-view notifications
 */
export function installClaudeHooks(): { success: boolean; message: string } {
  try {
    const settings = readSettings()

    if (!settings.hooks) {
      settings.hooks = {}
    }

    // Create agent-view hook matchers
    const stopMatcher: ClaudeHookMatcher = {
      hooks: [{ type: "command", command: STOP_HOOK_COMMAND }],
      [AGENT_VIEW_MARKER]: true
    }

    const notificationMatcher: ClaudeHookMatcher = {
      hooks: [{ type: "command", command: NOTIFICATION_HOOK_COMMAND }],
      [AGENT_VIEW_MARKER]: true
    }

    // Remove any existing agent-view hooks first
    if (settings.hooks.Stop) {
      settings.hooks.Stop = settings.hooks.Stop.filter(m => !m[AGENT_VIEW_MARKER])
    }
    if (settings.hooks.Notification) {
      settings.hooks.Notification = settings.hooks.Notification.filter(m => !m[AGENT_VIEW_MARKER])
    }

    // Add new hooks
    if (!settings.hooks.Stop) {
      settings.hooks.Stop = []
    }
    if (!settings.hooks.Notification) {
      settings.hooks.Notification = []
    }

    settings.hooks.Stop.push(stopMatcher)
    settings.hooks.Notification.push(notificationMatcher)

    writeSettings(settings)

    // Ensure notifications directory exists
    if (!fs.existsSync(NOTIFICATIONS_DIR)) {
      fs.mkdirSync(NOTIFICATIONS_DIR, { recursive: true, mode: 0o700 })
    }

    return { success: true, message: "Claude Code hooks installed successfully" }
  } catch (err) {
    return {
      success: false,
      message: `Failed to install hooks: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

/**
 * Uninstall Claude Code hooks for agent-view
 */
export function uninstallClaudeHooks(): { success: boolean; message: string } {
  try {
    const settings = readSettings()

    if (!settings.hooks) {
      return { success: true, message: "No hooks to uninstall" }
    }

    let removed = false

    // Remove agent-view hooks from Stop
    if (settings.hooks.Stop) {
      const before = settings.hooks.Stop.length
      settings.hooks.Stop = settings.hooks.Stop.filter(m => !m[AGENT_VIEW_MARKER])
      if (settings.hooks.Stop.length < before) removed = true
      if (settings.hooks.Stop.length === 0) delete settings.hooks.Stop
    }

    // Remove agent-view hooks from Notification
    if (settings.hooks.Notification) {
      const before = settings.hooks.Notification.length
      settings.hooks.Notification = settings.hooks.Notification.filter(m => !m[AGENT_VIEW_MARKER])
      if (settings.hooks.Notification.length < before) removed = true
      if (settings.hooks.Notification.length === 0) delete settings.hooks.Notification
    }

    // Clean up empty hooks object
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks
    }

    writeSettings(settings)

    return {
      success: true,
      message: removed ? "Claude Code hooks uninstalled successfully" : "No agent-view hooks found"
    }
  } catch (err) {
    return {
      success: false,
      message: `Failed to uninstall hooks: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

/**
 * Get hooks installation status
 */
export function getHooksStatus(): {
  installed: boolean
  settingsPath: string
  notificationsDir: string
  settingsExists: boolean
} {
  return {
    installed: areHooksInstalled(),
    settingsPath: CLAUDE_SETTINGS_PATH,
    notificationsDir: NOTIFICATIONS_DIR,
    settingsExists: fs.existsSync(CLAUDE_SETTINGS_PATH)
  }
}
