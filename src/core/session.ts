/**
 * Session lifecycle management
 * Combines storage and tmux operations
 */

import { getStorage } from "./storage"
import type { Session, SessionCreateOptions, SessionStatus, Tool, Recent } from "./types"
import { getToolCommand } from "./types"
import * as tmux from "./tmux"
import { removeWorktree } from "./git"
import { randomUUID } from "crypto"
import path from "path"
import fs from "fs"
import os from "os"
import { buildClaudeCommand } from "./claude"
import { getConfig, saveConfig } from "./config"
import { addRecent } from "./recents"

const logFile = path.join(os.homedir(), ".agent-orchestrator", "debug.log")
function log(...args: unknown[]) {
  const msg = `[${new Date().toISOString()}] [SESSION] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}\n`
  try { fs.appendFileSync(logFile, msg) } catch {}
}

// Name generation patterns
const ADJECTIVES = [
  "swift", "bright", "calm", "deep", "eager", "fair", "gentle", "happy",
  "keen", "light", "mild", "noble", "proud", "quick", "rich", "safe",
  "true", "vivid", "warm", "wise", "bold", "cool", "dark", "fast"
]

const NOUNS = [
  "fox", "owl", "wolf", "bear", "hawk", "lion", "deer", "crow",
  "dove", "seal", "swan", "hare", "lynx", "moth", "newt", "orca",
  "pike", "rook", "toad", "vole", "wren", "yak", "bass", "crab"
]

function generateTitle(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adj}-${noun}`
}

export class SessionManager {
  private refreshInterval: NodeJS.Timeout | null = null
  private memoryMap = new Map<string, number>() // sessionId → KB
  private _recentAutoHibernated: { id: string; title: string; idleMinutes: number }[] = []

  getMemoryKB(sessionId: string): number | undefined {
    return this.memoryMap.get(sessionId)
  }

  drainAutoHibernated(): { id: string; title: string; idleMinutes: number }[] {
    const items = this._recentAutoHibernated
    this._recentAutoHibernated = []
    return items
  }

  startRefreshLoop(intervalMs = 500): void {
    if (this.refreshInterval) return

    this.refreshInterval = setInterval(async () => {
      await this.refreshStatuses()
    }, intervalMs)
  }

  stopRefreshLoop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = null
    }
  }

  async refreshStatuses(): Promise<void> {
    await tmux.refreshSessionCache()

    const storage = getStorage()
    const sessions = storage.loadSessions()

    const config = getConfig()
    const autoHibernateMs = (config.autoHibernateMinutes || 0) * 60 * 1000

    for (const session of sessions) {
      if (!session.tmuxSession) continue

      // Skip hibernated sessions — they have no tmux process
      if (session.status === "hibernated") continue

      const exists = tmux.sessionExists(session.tmuxSession)
      if (!exists) {
        // Session was killed externally
        storage.writeStatus(session.id, "stopped", session.tool)
        continue
      }

      const isActive = tmux.isSessionActive(session.tmuxSession, 2)

      // Always capture output and check patterns - not just when active
      // This fixes the bug where waiting sessions were incorrectly marked as idle
      try {
        // Don't use endLine - Claude Code TUI may have blank lines at bottom
        // which causes -E -1 to capture mostly empty content
        const output = await tmux.capturePane(session.tmuxSession, {
          startLine: -100
        })
        const status = tmux.parseToolStatus(output, session.tool)

        if (status.isWaiting) {
          // Agent is waiting for user input (permission prompt, question, etc.)
          storage.writeStatus(session.id, "waiting", session.tool)
        } else if (status.hasError) {
          // Agent encountered an error
          storage.writeStatus(session.id, "error", session.tool)
        } else if (status.isBusy || isActive) {
          // Agent is actively working (spinner visible, recent output, etc.)
          storage.writeStatus(session.id, "running", session.tool)
        } else {
          // No recent activity and no waiting prompt - idle
          storage.writeStatus(session.id, "idle", session.tool)

          // Auto-hibernate: if idle too long, hibernate Claude sessions
          if (autoHibernateMs > 0 && session.tool === "claude") {
            const lastActivity = tmux.getSessionActivity(session.tmuxSession)
            if (lastActivity > 0) {
              const idleMs = Date.now() - lastActivity * 1000
              if (idleMs >= autoHibernateMs) {
                try {
                  await this.hibernate(session.id)
                  this._recentAutoHibernated.push({
                    id: session.id,
                    title: session.title,
                    idleMinutes: Math.round(idleMs / 60000)
                  })
                } catch {
                  // Ignore hibernate failures during auto-hibernate
                }
              }
            }
          }
        }
      } catch {
        // Fallback: use activity-based detection if capture fails
        storage.writeStatus(session.id, isActive ? "running" : "idle", session.tool)
      }
    }

    storage.touch()

    // Collect memory usage for all running sessions
    const tmuxNames = sessions
      .filter((s): s is Session & { tmuxSession: string } => !!s.tmuxSession && tmux.sessionExists(s.tmuxSession))
      .map(s => s.tmuxSession)
    const memMap = await tmux.getSessionsMemoryKB(tmuxNames)
    for (const session of sessions) {
      if (session.tmuxSession && memMap.has(session.tmuxSession)) {
        this.memoryMap.set(session.id, memMap.get(session.tmuxSession)!)
      } else {
        this.memoryMap.delete(session.id)
      }
    }
  }

  async create(options: SessionCreateOptions): Promise<Session> {
    log("create() called with options:", options)
    const storage = getStorage()
    const now = new Date()

    const title = options.title || generateTitle()
    const id = randomUUID()
    const tmuxName = tmux.generateSessionName(title)

    // Determine command
    let command: string
    if (options.command) {
      command = options.command
    } else if (options.tool === "claude" && options.claudeOptions) {
      command = buildClaudeCommand(options.claudeOptions)
    } else {
      command = getToolCommand(options.tool)
    }

    log("Creating tmux session:", tmuxName, "command:", command)

    const env: Record<string, string> = {
      AGENT_ORCHESTRATOR_SESSION: id
    }

    try {
      await tmux.createSession({
        name: tmuxName,
        command,
        cwd: options.projectPath,
        env,
        windowTitle: title
      })
      log("tmux session created successfully")
    } catch (err) {
      log("tmux.createSession error:", err)
      throw err
    }

    const toolData: Record<string, unknown> = {}
    if (options.tool === "claude" && options.claudeOptions) {
      toolData.claudeSessionMode = options.claudeOptions.sessionMode
    }

    const session: Session = {
      id,
      title,
      projectPath: options.projectPath,
      groupPath: options.groupPath || "my-sessions",
      order: storage.loadSessions().length,
      command,
      wrapper: options.wrapper || "",
      tool: options.tool,
      status: "running",
      tmuxSession: tmuxName,
      createdAt: now,
      lastAccessed: now,
      worktreePath: options.worktreePath || "",
      worktreeRepo: options.worktreeRepo || "",
      worktreeBranch: options.worktreeBranch || "",
      toolData,
      acknowledged: false
    }

    storage.saveSession(session)
    storage.touch()

    // Auto-save as recent for future quick access
    await this.saveRecent(options)

    return session
  }

  private async saveRecent(options: SessionCreateOptions): Promise<void> {
    const config = getConfig()

    const newRecent: Recent = {
      name: options.title || "untitled",
      projectPath: options.projectPath,
      tool: options.tool,
      groupPath: options.groupPath
    }

    const recents = addRecent(config.recents || [], newRecent)
    await saveConfig({ ...config, recents })
  }

  async delete(sessionId: string, options?: { deleteWorktree?: boolean }): Promise<void> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (session?.tmuxSession) {
      await tmux.killSession(session.tmuxSession)
    }

    if (options?.deleteWorktree && session?.worktreePath && session?.worktreeRepo) {
      try {
        await removeWorktree(session.worktreeRepo, session.worktreePath, true)
      } catch {
        // Worktree may already be removed
      }
    }

    storage.deleteSession(sessionId)
    storage.touch()
  }

  async resume(sessionId: string): Promise<Session> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (session.tmuxSession) {
      await tmux.killSession(session.tmuxSession)
    }

    const command = session.tool === "claude"
      ? "claude --resume"
      : session.command

    const env: Record<string, string> = { AGENT_ORCHESTRATOR_SESSION: session.id }

    const newTmuxName = tmux.generateSessionName(session.title)
    await tmux.createSession({
      name: newTmuxName,
      command,
      cwd: session.projectPath,
      env
    })

    session.tmuxSession = newTmuxName
    session.command = command
    session.status = "running"
    session.lastAccessed = new Date()

    storage.saveSession(session)
    storage.touch()

    return session
  }

  async restart(sessionId: string): Promise<Session> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (session.tmuxSession) {
      await tmux.killSession(session.tmuxSession)
    }

    const command = session.tool === "claude"
      ? "claude"
      : session.command

    const env: Record<string, string> = { AGENT_ORCHESTRATOR_SESSION: session.id }

    const newTmuxName = tmux.generateSessionName(session.title)
    await tmux.createSession({
      name: newTmuxName,
      command,
      cwd: session.projectPath,
      env
    })

    session.tmuxSession = newTmuxName
    session.command = command
    session.status = "running"
    session.lastAccessed = new Date()

    storage.saveSession(session)
    storage.touch()

    return session
  }

  /**
   * Stop a session (kill tmux but keep record)
   */
  async stop(sessionId: string): Promise<void> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session) return

    if (session.tmuxSession) {
      await tmux.killSession(session.tmuxSession)
    }

    storage.writeStatus(sessionId, "stopped", session.tool)
    storage.touch()
  }

  /**
   * Hibernate a session (kill tmux to free memory, keep record for resume)
   * Only works for Claude sessions.
   */
  async hibernate(sessionId: string): Promise<void> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session) return

    if (session.tool !== "claude") {
      throw new Error("Only Claude sessions can be hibernated")
    }

    if (session.tmuxSession) {
      await tmux.killSession(session.tmuxSession)
    }

    storage.writeStatus(sessionId, "hibernated", session.tool)
    storage.touch()
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session?.tmuxSession) {
      throw new Error(`Session not found or not running: ${sessionId}`)
    }

    await tmux.sendKeys(session.tmuxSession, message)
    storage.updateSessionField(sessionId, "last_accessed", Date.now())
  }

  async getOutput(sessionId: string, lines = 100): Promise<string> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session?.tmuxSession) {
      return ""
    }

    try {
      return await tmux.capturePane(session.tmuxSession, {
        startLine: -lines,
        endLine: -1,
        escape: true,
        join: true
      })
    } catch {
      return ""
    }
  }

  /**
   * Attach to a session (takes over terminal)
   */
  attach(sessionId: string): void {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session?.tmuxSession) {
      throw new Error(`Session not found or not running: ${sessionId}`)
    }

    tmux.attachSession(session.tmuxSession)
  }

  list(): Session[] {
    return getStorage().loadSessions()
  }

  get(sessionId: string): Session | null {
    return getStorage().getSession(sessionId)
  }

  async updateTitle(sessionId: string, title: string): Promise<void> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    // Update title in storage
    storage.updateSessionField(sessionId, "title", title)

    // Also rename tmux window to show the new title (keep session name for internal tracking)
    if (session?.tmuxSession) {
      await tmux.renameWindow(session.tmuxSession, title)
    }

    storage.touch()
  }

  moveToGroup(sessionId: string, groupPath: string): void {
    const storage = getStorage()
    storage.updateSessionField(sessionId, "group_path", groupPath)
    storage.touch()
  }

  acknowledge(sessionId: string): void {
    const storage = getStorage()
    storage.setAcknowledged(sessionId, true)
    storage.touch()
  }

  groupByStatus(): {
    running: Session[]
    waiting: Session[]
    idle: Session[]
    stopped: Session[]
    error: Session[]
    hibernated: Session[]
  } {
    const sessions = this.list()
    return {
      running: sessions.filter((s) => s.status === "running"),
      waiting: sessions.filter((s) => s.status === "waiting"),
      idle: sessions.filter((s) => s.status === "idle"),
      stopped: sessions.filter((s) => s.status === "stopped"),
      error: sessions.filter((s) => s.status === "error"),
      hibernated: sessions.filter((s) => s.status === "hibernated")
    }
  }

  groupByPath(): Map<string, Session[]> {
    const sessions = this.list()
    const groups = new Map<string, Session[]>()

    for (const session of sessions) {
      const existing = groups.get(session.groupPath) || []
      existing.push(session)
      groups.set(session.groupPath, existing)
    }

    return groups
  }
}

// Singleton instance
let sessionManager: SessionManager | null = null

export function getSessionManager(): SessionManager {
  if (!sessionManager) {
    sessionManager = new SessionManager()
  }
  return sessionManager
}
