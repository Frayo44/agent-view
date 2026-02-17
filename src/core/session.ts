/**
 * Session lifecycle management
 * Combines storage and tmux operations
 */

import { getStorage } from "./storage"
import type { Session, SessionCreateOptions, SessionForkOptions, SessionStatus, Tool } from "./types"
import { getToolCommand } from "./types"
import * as tmux from "./tmux"
import { randomUUID } from "crypto"
import path from "path"
import fs from "fs"
import os from "os"
import { getClaudeSessionID, buildForkCommand, canFork, buildClaudeCommand } from "./claude"

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
    log("create() called with options:", options)
    const storage = getStorage()
    const now = new Date()

    const title = options.title || generateTitle()
    const id = randomUUID()
    const tmuxName = tmux.generateSessionName(title)

    // Determine command - handle Claude options for resume
    let command: string
    if (options.command) {
      command = options.command
    } else if (options.tool === "claude" && options.claudeOptions) {
      command = buildClaudeCommand(options.claudeOptions)
    } else {
      command = getToolCommand(options.tool)
    }

    log("Creating tmux session:", tmuxName, "command:", command)

    // Create tmux session
    try {
      await tmux.createSession({
        name: tmuxName,
        command,
        cwd: options.projectPath,
        env: {
          AGENT_ORCHESTRATOR_SESSION: id
        }
      })
      log("tmux session created successfully")
    } catch (err) {
      log("tmux.createSession error:", err)
      throw err
    }

    // Build toolData - store Claude session mode
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
      parentSessionId: options.parentSessionId || "",
      worktreePath: options.worktreePath || "",
      worktreeRepo: options.worktreeRepo || "",
      worktreeBranch: options.worktreeBranch || "",
      toolData,
      acknowledged: false
    }

    storage.saveSession(session)
    storage.touch()

    return session
  }

  /**
   * Fork an existing session
   * For Claude sessions, this uses --resume and --fork-session to continue the conversation
   */
  async fork(options: SessionForkOptions): Promise<Session> {
    log("fork() called with options:", options)
    const storage = getStorage()
    const source = storage.getSession(options.sourceSessionId)

    if (!source) {
      log("Source session not found:", options.sourceSessionId)
      throw new Error(`Source session not found: ${options.sourceSessionId}`)
    }

    log("Source session found:", source.id, source.tool, source.projectPath)

    // Determine the project path (use worktree path if provided)
    const projectPath = options.worktreePath || source.projectPath

    // For Claude sessions, use real fork with --resume and --fork-session
    if (source.tool === "claude") {
      log("Forking Claude session")
      // Get the Claude session ID from the running session
      const claudeSessionId = getClaudeSessionID(source.projectPath)
      log("Claude session ID:", claudeSessionId)

      if (!claudeSessionId) {
        log("No Claude session ID found")
        throw new Error("Cannot fork: no active Claude session detected. Session must be running with an active conversation.")
      }

      // Generate new session ID for the fork
      const newClaudeSessionId = randomUUID()
      log("New Claude session ID:", newClaudeSessionId)

      // Build fork command with Claude flags
      const forkCommand = buildForkCommand({
        projectPath,
        parentSessionId: claudeSessionId,
        newSessionId: newClaudeSessionId
      })
      log("Fork command:", forkCommand)

      // Create session with the fork command
      log("Calling this.create()")
      const newSession = await this.create({
        title: options.title || `${source.title}-fork`,
        projectPath,
        groupPath: source.groupPath,
        tool: "claude",
        command: forkCommand,
        wrapper: source.wrapper,
        parentSessionId: source.id,
        worktreePath: options.worktreePath,
        worktreeRepo: options.worktreeRepo,
        worktreeBranch: options.worktreeBranch
      })
      log("Session created:", newSession.id)

      // Store the Claude session IDs in toolData
      storage.updateSessionField(newSession.id, "tool_data", JSON.stringify({
        claudeSessionId: newClaudeSessionId,
        parentClaudeSessionId: claudeSessionId,
        claudeDetectedAt: Date.now()
      }))

      log("Fork complete, returning new session")
      return newSession
    }

    // For non-Claude sessions, create a fresh session with the same config
    const newSession = await this.create({
      title: options.title || `${source.title}-fork`,
      projectPath,
      groupPath: source.groupPath,
      tool: source.tool,
      command: source.command,
      wrapper: source.wrapper,
      parentSessionId: source.id,
      worktreePath: options.worktreePath,
      worktreeRepo: options.worktreeRepo,
      worktreeBranch: options.worktreeBranch
    })

    return newSession
  }

  /**
   * Check if a session can be forked (has an active Claude session)
   */
  async canFork(sessionId: string): Promise<boolean> {
    const session = getStorage().getSession(sessionId)
    if (!session) return false
    if (session.tool !== "claude") return false

    return await canFork(session.projectPath)
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
