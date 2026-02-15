/**
 * Session lifecycle management
 * Combines storage and tmux operations
 */

import { getStorage } from "./storage"
import type { Session, SessionCreateOptions, SessionForkOptions, SessionStatus, Tool } from "./types"
import * as tmux from "./tmux"
import { randomUUID } from "crypto"
import path from "path"

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

function getToolCommand(tool: Tool): string {
  switch (tool) {
    case "claude":
      return "claude"
    case "opencode":
      return "opencode"
    case "gemini":
      return "gemini"
    case "shell":
    default:
      return process.env.SHELL || "/bin/bash"
  }
}

export class SessionManager {
  private refreshInterval: NodeJS.Timeout | null = null

  /**
   * Start the session status refresh loop
   */
  startRefreshLoop(intervalMs = 500): void {
    if (this.refreshInterval) return

    this.refreshInterval = setInterval(async () => {
      await this.refreshStatuses()
    }, intervalMs)
  }

  /**
   * Stop the refresh loop
   */
  stopRefreshLoop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = null
    }
  }

  /**
   * Refresh session statuses from tmux
   */
  async refreshStatuses(): Promise<void> {
    await tmux.refreshSessionCache()

    const storage = getStorage()
    const sessions = storage.loadSessions()

    for (const session of sessions) {
      if (!session.tmuxSession) continue

      const exists = tmux.sessionExists(session.tmuxSession)
      if (!exists) {
        // Session was killed externally
        storage.writeStatus(session.id, "stopped", session.tool)
        continue
      }

      const isActive = tmux.isSessionActive(session.tmuxSession, 2)

      if (isActive) {
        // Check for waiting state by capturing output
        try {
          const output = await tmux.capturePane(session.tmuxSession, {
            startLine: -50,
            endLine: -1
          })
          const status = tmux.parseToolStatus(output)

          if (status.isWaiting) {
            storage.writeStatus(session.id, "waiting", session.tool)
          } else if (status.hasError) {
            storage.writeStatus(session.id, "error", session.tool)
          } else {
            storage.writeStatus(session.id, "running", session.tool)
          }
        } catch {
          storage.writeStatus(session.id, "running", session.tool)
        }
      } else {
        storage.writeStatus(session.id, "idle", session.tool)
      }
    }

    storage.touch()
  }

  /**
   * Create a new session
   */
  async create(options: SessionCreateOptions): Promise<Session> {
    const storage = getStorage()
    const now = new Date()

    const title = options.title || generateTitle()
    const id = randomUUID()
    const tmuxName = tmux.generateSessionName(title)
    const command = options.command || getToolCommand(options.tool)

    // Create tmux session
    await tmux.createSession({
      name: tmuxName,
      command,
      cwd: options.projectPath,
      env: {
        AGENT_ORCHESTRATOR_SESSION: id
      }
    })

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
      parentSessionId: options.parentSessionId || "",
      worktreePath: options.worktreePath || "",
      worktreeRepo: options.worktreeRepo || "",
      worktreeBranch: options.worktreeBranch || "",
      toolData: {},
      acknowledged: false
    }

    storage.saveSession(session)
    storage.touch()

    return session
  }

  /**
   * Fork an existing session
   */
  async fork(options: SessionForkOptions): Promise<Session> {
    const storage = getStorage()
    const source = storage.getSession(options.sourceSessionId)

    if (!source) {
      throw new Error(`Source session not found: ${options.sourceSessionId}`)
    }

    // For Claude sessions, we can use the session fork feature
    const newSession = await this.create({
      title: options.title || `${source.title}-fork`,
      projectPath: source.projectPath,
      groupPath: source.groupPath,
      tool: source.tool,
      command: source.command,
      wrapper: source.wrapper,
      parentSessionId: source.id,
      worktreePath: source.worktreePath,
      worktreeRepo: source.worktreeRepo,
      worktreeBranch: source.worktreeBranch
    })

    // If preserving history and using Claude, we could copy session files
    // This is tool-specific and would need implementation

    return newSession
  }

  /**
   * Delete a session
   */
  async delete(sessionId: string): Promise<void> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (session?.tmuxSession) {
      await tmux.killSession(session.tmuxSession)
    }

    storage.deleteSession(sessionId)
    storage.touch()
  }

  /**
   * Restart a session
   */
  async restart(sessionId: string): Promise<Session> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // Kill existing tmux session if it exists
    if (session.tmuxSession) {
      await tmux.killSession(session.tmuxSession)
    }

    // Create new tmux session
    const newTmuxName = tmux.generateSessionName(session.title)
    await tmux.createSession({
      name: newTmuxName,
      command: session.command,
      cwd: session.projectPath
    })

    // Update session
    session.tmuxSession = newTmuxName
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
   * Send a message to a session
   */
  async sendMessage(sessionId: string, message: string): Promise<void> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session?.tmuxSession) {
      throw new Error(`Session not found or not running: ${sessionId}`)
    }

    await tmux.sendKeys(session.tmuxSession, message)
    storage.updateSessionField(sessionId, "last_accessed", Date.now())
  }

  /**
   * Get session output
   */
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

  /**
   * Get all sessions
   */
  list(): Session[] {
    return getStorage().loadSessions()
  }

  /**
   * Get session by ID
   */
  get(sessionId: string): Session | null {
    return getStorage().getSession(sessionId)
  }

  /**
   * Update session title
   */
  updateTitle(sessionId: string, title: string): void {
    const storage = getStorage()
    storage.updateSessionField(sessionId, "title", title)
    storage.touch()
  }

  /**
   * Move session to a different group
   */
  moveToGroup(sessionId: string, groupPath: string): void {
    const storage = getStorage()
    storage.updateSessionField(sessionId, "group_path", groupPath)
    storage.touch()
  }

  /**
   * Acknowledge a session status change
   */
  acknowledge(sessionId: string): void {
    const storage = getStorage()
    storage.setAcknowledged(sessionId, true)
    storage.touch()
  }

  /**
   * Get sessions grouped by status
   */
  groupByStatus(): {
    running: Session[]
    waiting: Session[]
    idle: Session[]
    stopped: Session[]
    error: Session[]
  } {
    const sessions = this.list()
    return {
      running: sessions.filter((s) => s.status === "running"),
      waiting: sessions.filter((s) => s.status === "waiting"),
      idle: sessions.filter((s) => s.status === "idle"),
      stopped: sessions.filter((s) => s.status === "stopped"),
      error: sessions.filter((s) => s.status === "error")
    }
  }

  /**
   * Get sessions grouped by group path
   */
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
