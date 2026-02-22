/**
 * Tmux session management
 * Based on agent-view's tmux package with session caching
 *
 * Uses an isolated tmux server (separate socket + custom config)
 * to avoid conflicts with the user's tmux configuration.
 */

import { spawn, exec } from "child_process"
import { promisify } from "util"
import path from "path"
import os from "os"
import fs from "fs"

// Lazy load node-pty to avoid import errors in test environments
let pty: typeof import("node-pty") | null = null
async function getPty() {
  if (!pty) {
    pty = await import("node-pty")
  }
  return pty
}

const execAsync = promisify(exec)

export const SESSION_PREFIX = "agentorch_"

// Signal file for command palette request
const COMMAND_PALETTE_SIGNAL = "/tmp/agent-view-cmd-palette"

// --- Isolated tmux server configuration ---
// All agent-view sessions run on a dedicated tmux socket with a custom config,
// so we never load or interfere with the user's ~/.tmux.conf.
// The config is defined in src/core/tmux.conf and inlined at build time.
import TMUX_CONF from "./tmux.conf" with { type: "text" }

const TMUX_SOCKET = "agent-view"
const CONFIG_DIR = path.join(os.homedir(), ".agent-view")
const CONFIG_PATH = path.join(CONFIG_DIR, "tmux.conf")

let configWritten = false

/**
 * Ensure the custom tmux config file exists and is up to date
 */
function ensureConfig(): void {
  if (configWritten) return
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
    }
    let needsWrite = true
    try {
      needsWrite = fs.readFileSync(CONFIG_PATH, "utf-8") !== TMUX_CONF
    } catch {
      // File doesn't exist
    }
    if (needsWrite) {
      fs.writeFileSync(CONFIG_PATH, TMUX_CONF, { mode: 0o600 })
    }
  } finally {
    configWritten = true
  }
}

/**
 * Build a tmux command string that targets our isolated server
 */
function tmuxCmd(subcmd: string): string {
  ensureConfig()
  return `tmux -L ${TMUX_SOCKET} -f "${CONFIG_PATH}" ${subcmd}`
}

/**
 * Build tmux spawn arguments that target our isolated server
 */
function tmuxSpawnArgs(...args: string[]): string[] {
  ensureConfig()
  return ["-L", TMUX_SOCKET, "-f", CONFIG_PATH, ...args]
}

// Session cache - reduces subprocess spawns
interface SessionCache {
  data: Map<string, number> // session_name -> activity_timestamp
  timestamp: number
}

let sessionCache: SessionCache = {
  data: new Map(),
  timestamp: 0
}

const CACHE_TTL = 2000 // 2 seconds

export async function isTmuxAvailable(): Promise<boolean> {
  try {
    await execAsync("tmux -V")
    return true
  } catch {
    return false
  }
}

/**
 * Refresh the session cache
 * Call this once per tick cycle
 */
export async function refreshSessionCache(): Promise<void> {
  try {
    const { stdout } = await execAsync(
      tmuxCmd('list-windows -a -F "#{session_name}\t#{window_activity}"')
    )

    const newCache = new Map<string, number>()
    for (const line of stdout.trim().split("\n")) {
      if (!line) continue
      const [name, activity] = line.split("\t")
      if (!name) continue
      const activityTs = parseInt(activity || "0", 10)
      // Keep maximum activity for sessions with multiple windows
      const existing = newCache.get(name) || 0
      if (activityTs > existing) {
        newCache.set(name, activityTs)
      }
    }

    sessionCache = {
      data: newCache,
      timestamp: Date.now()
    }
  } catch {
    // tmux not running or no sessions
    sessionCache = {
      data: new Map(),
      timestamp: Date.now()
    }
  }
}

/**
 * Check if session exists (from cache)
 */
export function sessionExists(name: string): boolean {
  if (Date.now() - sessionCache.timestamp > CACHE_TTL) {
    return false // Cache stale, caller should refresh
  }
  return sessionCache.data.has(name)
}

/**
 * Get session activity timestamp (from cache)
 */
export function getSessionActivity(name: string): number {
  if (Date.now() - sessionCache.timestamp > CACHE_TTL) {
    return 0
  }
  return sessionCache.data.get(name) || 0
}

/**
 * Register a new session in cache (prevents race condition)
 */
export function registerSessionInCache(name: string): void {
  sessionCache.data.set(name, Math.floor(Date.now() / 1000))
}

export interface TmuxSession {
  name: string
  exists: boolean
  activity: number
}

/**
 * Check if a session has active output (activity within last N seconds)
 */
export function isSessionActive(name: string, thresholdSeconds = 2): boolean {
  const activity = getSessionActivity(name)
  if (!activity) return false
  const now = Math.floor(Date.now() / 1000)
  return now - activity < thresholdSeconds
}

export async function createSession(options: {
  name: string
  command?: string
  cwd?: string
  env?: Record<string, string>
  windowTitle?: string
}): Promise<void> {
  const cwd = options.cwd || process.env.HOME || "/tmp"

  await execAsync(tmuxCmd(`new-session -d -s "${options.name}" -c "${cwd}"`))
  registerSessionInCache(options.name)

  // Set window title if provided and prevent automatic renaming
  if (options.windowTitle) {
    await execAsync(tmuxCmd(`rename-window -t "${options.name}" "${options.windowTitle}"`))
    await execAsync(tmuxCmd(`set-option -t "${options.name}" automatic-rename off`))
    await execAsync(tmuxCmd(`set-option -t "${options.name}" allow-rename off`))
  }

  const envVars = options.env || {}
  for (const [key, value] of Object.entries(envVars)) {
    await execAsync(tmuxCmd(`set-environment -t "${options.name}" ${key} "${value}"`))
  }

  if (options.command) {
    let cmdToSend = options.command

    // IMPORTANT: Commands containing bash-specific syntax (like `session_id=$(...)`)
    // must be wrapped in `bash -c` for fish shell compatibility.
    // Fish uses different syntax: `set var (...)` instead of `var=$(...)`.
    if (options.command.includes("$(") || options.command.includes("session_id=")) {
      // Escape single quotes in the command for bash -c wrapper
      const escapedCmd = options.command.replace(/'/g, "'\"'\"'")
      cmdToSend = `bash -c '${escapedCmd}'`
    }

    await sendKeys(options.name, cmdToSend)
    await execAsync(tmuxCmd(`send-keys -t "${options.name}" Enter`))
  }
}

export async function killSession(name: string): Promise<void> {
  try {
    await execAsync(tmuxCmd(`kill-session -t "${name}"`))
    sessionCache.data.delete(name)
  } catch {
    // Session might not exist
  }
}

export async function sendKeys(name: string, keys: string): Promise<void> {
  // Escape special characters for tmux
  const escaped = keys
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")

  await execAsync(tmuxCmd(`send-keys -t "${name}" "${escaped}" Enter`))
}

/**
 * Send raw keys without Enter
 */
export async function sendRawKeys(name: string, keys: string): Promise<void> {
  await execAsync(tmuxCmd(`send-keys -t "${name}" "${keys}"`))
}

export async function capturePane(
  name: string,
  options: {
    startLine?: number
    endLine?: number
    escape?: boolean
    join?: boolean
  } = {}
): Promise<string> {
  const args = ["capture-pane", "-t", name, "-p"]

  if (options.startLine !== undefined) {
    args.push("-S", String(options.startLine))
  }
  if (options.endLine !== undefined) {
    args.push("-E", String(options.endLine))
  }
  if (options.escape) {
    args.push("-e") // Include escape sequences
  }
  if (options.join) {
    args.push("-J") // Join wrapped lines
  }

  try {
    const { stdout } = await execAsync(tmuxCmd(args.join(" ")), {
      timeout: 5000
    })
    return stdout
  } catch (err: any) {
    if (err.killed) {
      throw new Error("capture-pane timed out")
    }
    throw err
  }
}

export async function getPaneDimensions(name: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execAsync(
    tmuxCmd(`display-message -t "${name}" -p "#{pane_width}\t#{pane_height}"`)
  )
  const [width, height] = stdout.trim().split("\t").map(Number)
  return { width: width || 80, height: height || 24 }
}

export async function resizePane(name: string, width: number, height: number): Promise<void> {
  await execAsync(tmuxCmd(`resize-pane -t "${name}" -x ${width} -y ${height}`))
}

/**
 * Attach to a tmux session (replaces current terminal)
 */
export function attachSession(name: string): void {
  const child = spawn("tmux", tmuxSpawnArgs("attach-session", "-t", name), {
    stdio: "inherit",
    env: process.env
  })

  child.on("exit", (code) => {
    process.exit(code || 0)
  })
}

/**
 * List all sessions with our prefix
 */
export async function listSessions(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(tmuxCmd("list-sessions -F #{session_name}"))
    return stdout
      .trim()
      .split("\n")
      .filter((name) => name.startsWith(SESSION_PREFIX))
  } catch {
    return []
  }
}

export function insideTmux(): boolean {
  return !!process.env.TMUX
}

export async function getCurrentSession(): Promise<string | null> {
  if (!insideTmux()) return null

  try {
    const { stdout } = await execAsync("tmux display-message -p #{session_name}")
    return stdout.trim()
  } catch {
    return null
  }
}

export function generateSessionName(title: string): string {
  const safe = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20)

  const timestamp = Date.now().toString(36)
  return `${SESSION_PREFIX}${safe}-${timestamp}`
}

/**
 * Parse output to detect tool status
 */
export interface ToolStatus {
  isActive: boolean
  isWaiting: boolean
  isBusy: boolean
  hasError: boolean
}

export function stripAnsi(text: string): string {
  // Remove ANSI escape sequences (colors, cursor movement, etc.)
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "") // OSC sequences
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, "") // DCS, SOS, PM, APC sequences
}

// Claude Code busy indicators - agent is actively working (NOT waiting for input)
// These indicate Claude is in the middle of processing
const CLAUDE_BUSY_PATTERNS = [
  /ctrl\+c to interrupt/i,
  /….*tokens/i,  // Processing indicator with tokens count
]

// Spinner characters used by Claude Code when processing
const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏", "✳", "✽", "✶", "✢"]

// Claude Code waiting indicators - needs user input (permission prompts, questions)
// These indicate Claude is BLOCKED waiting for a specific user response
const CLAUDE_WAITING_PATTERNS = [
  // Permission prompts with numbered options (blocked on user decision)
  /Do you want to proceed\?/i,
  /\d\.\s*Yes\b/i,  // "1. Yes" pattern in selection UI
  /Esc to cancel.*Tab to amend/i,  // Permission prompt footer
  // Selection UI (blocked on user selection)
  /Enter to select.*to navigate/i,
  // Confirmation prompts
  /\(Y\/n\)/i,
  /Continue\?/i,
  /Approve this plan\?/i,
  /\[Y\/n\]/i,
  /\[y\/N\]/i,
  // Other blocking prompts
  /Yes,? allow once/i,
  /Allow always/i,
  /No,? and tell Claude/i,
]

// Patterns indicating Claude has exited (shell returned)
const CLAUDE_EXITED_PATTERNS = [
  /Resume this session with:/i,
  /claude --resume/i,
  /Press Ctrl-C again to exit/i,
]

// Generic waiting patterns (for other tools)
const WAITING_PATTERNS = [
  /\? \(y\/n\)/i,
  /\[Y\/n\]/i,
  /Press enter to continue/i,
  /waiting for.*input/i,
  /do you want to/i
]

const ERROR_PATTERNS = [
  /error:/i,
  /failed:/i,
  /exception:/i,
  /traceback/i,
  /panic:/i
]

/**
 * Check if output contains spinner characters (Claude is processing)
 */
function hasSpinner(text: string): boolean {
  return SPINNER_CHARS.some(char => text.includes(char))
}

/**
 * Parse output to detect tool status
 * @param output - Raw terminal output
 * @param tool - Optional tool type for tool-specific detection
 */
export function parseToolStatus(output: string, tool?: string): ToolStatus {
  const cleaned = stripAnsi(output)
  // Filter out trailing empty lines before slicing - Claude Code TUI often has blank padding
  const allLines = cleaned.split("\n")
  let lastNonEmptyIdx = allLines.length - 1
  while (lastNonEmptyIdx >= 0 && allLines[lastNonEmptyIdx]?.trim() === "") {
    lastNonEmptyIdx--
  }
  const trimmedLines = allLines.slice(0, lastNonEmptyIdx + 1)
  const lastLines = trimmedLines.slice(-30).join("\n")
  const lastFewLines = trimmedLines.slice(-10).join("\n")

  let isWaiting = false
  let isBusy = false
  let hasError = false
  let hasExited = false

  if (tool === "claude") {
    // Claude Code specific detection

    // Check if Claude has exited (shell returned)
    hasExited = CLAUDE_EXITED_PATTERNS.some(p => p.test(lastLines))

    if (!hasExited) {
      // Check for busy indicators (actively working)
      isBusy = CLAUDE_BUSY_PATTERNS.some(p => p.test(lastLines)) || hasSpinner(lastFewLines)

      // Check for waiting indicators (needs user input)
      isWaiting = CLAUDE_WAITING_PATTERNS.some(p => p.test(lastLines))
    }
    // If Claude has exited, both isBusy and isWaiting stay false -> will become idle
  } else {
    // Generic tool detection
    isWaiting = WAITING_PATTERNS.some(p => p.test(lastLines))
  }

  hasError = ERROR_PATTERNS.some(p => p.test(lastLines))

  return {
    isActive: false, // Determined by activity timestamp
    isWaiting,
    isBusy,
    hasError
  }
}

/**
 * Attach to a tmux session with PTY support
 * Intercepts Ctrl+Q (ASCII 17) to detach and return control to the TUI
 * Based on agent-view's pty.go implementation
 */
export async function attachWithPty(sessionName: string): Promise<void> {
  const ptyModule = await getPty()
  return new Promise((resolve) => {
    const ptyProcess = ptyModule.spawn("tmux", tmuxSpawnArgs("attach-session", "-t", sessionName), {
      name: "xterm-256color",
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      cwd: process.cwd(),
      env: process.env as { [key: string]: string }
    })

    let isDetaching = false

    ptyProcess.onData((data: string) => {
      if (!isDetaching) {
        process.stdout.write(data)
      }
    })

    ptyProcess.onExit(() => {
      cleanup()
      resolve()
    })

    const handleResize = () => {
      ptyProcess.resize(
        process.stdout.columns || 80,
        process.stdout.rows || 24
      )
    }
    process.stdout.on("resize", handleResize)

    const wasRaw = process.stdin.isRaw
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }
    process.stdin.resume()

    const handleStdin = (data: Buffer) => {
      if (data.length === 1 && data[0] === 17) {
        isDetaching = true
        cleanup()
        resolve()
        return
      }
      ptyProcess.write(data.toString())
    }
    process.stdin.on("data", handleStdin)

    function cleanup() {
      process.stdin.removeListener("data", handleStdin)
      process.stdout.removeListener("resize", handleResize)

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(wasRaw ?? false)
      }

      try {
        ptyProcess.kill()
      } catch {
        // PTY may already be closed
      }

      // Clear screen before returning to TUI
      process.stdout.write("\x1b[2J\x1b[H")
    }
  })
}

/**
 * Check if command palette was requested during attached session
 */
export function wasCommandPaletteRequested(): boolean {
  try {
    if (fs.existsSync(COMMAND_PALETTE_SIGNAL)) {
      fs.unlinkSync(COMMAND_PALETTE_SIGNAL)
      return true
    }
  } catch {
    // Ignore errors
  }
  return false
}

/**
 * Attach to a tmux session with Ctrl+Q to detach
 * Keybindings and status bar are configured via the custom tmux.conf,
 * so we just need to attach/detach and manage the screen buffer.
 */
export function attachSessionSync(sessionName: string): void {
  const { spawnSync } = require("child_process")

  try {
    fs.unlinkSync(COMMAND_PALETTE_SIGNAL)
  } catch {
    // Ignore if doesn't exist
  }

  // Exit alternate screen buffer (TUI uses this)
  process.stdout.write("\x1b[?1049l")
  process.stdout.write("\x1b[2J\x1b[H")
  process.stdout.write("\x1b[?25h")

  // Attach to tmux - this blocks until user detaches (Ctrl+Q or Ctrl+B d)
  spawnSync("tmux", tmuxSpawnArgs("attach-session", "-t", sessionName), {
    stdio: "inherit",
    env: process.env
  })

  // Clear screen and re-enter alternate buffer for TUI
  process.stdout.write("\x1b[2J\x1b[H")
  process.stdout.write("\x1b[?1049h")

  // Restore terminal title to "Agent View"
  process.stdout.write("\x1b]0;Agent View\x07")
}
