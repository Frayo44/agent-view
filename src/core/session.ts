/**
 * Session lifecycle management
 * Combines storage and tmux operations
 */

import { getStorage } from "./storage"
import type { Session, SessionCreateOptions, SessionForkOptions, SessionStatus, Tool } from "./types"
import { getToolCommand } from "./types"
import * as tmux from "./tmux"
import { removeWorktree } from "./git"
import { randomUUID } from "crypto"
import path from "path"
import fs from "fs"
import os from "os"
import { getClaudeSessionID, buildForkCommand, canFork, buildClaudeCommand, copySessionToProject } from "./claude"

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

    for (const session of sessions) {
      if (!session.tmuxSession) continue

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
        }
      } catch {
        // Fallback: use activity-based detection if capture fails
        storage.writeStatus(session.id, isActive ? "running" : "idle", session.tool)
      }
    }

    storage.touch()
  }

  async create(options: SessionCreateOptions): Promise<Session> {
    log("create() called with options:", options)
    const storage = getStorage()
    const now = new Date()

    const title = options.title || generateTitle()
    const id = randomUUID()
    const tmuxName = tmux.generateSessionName(title)

    // Generate Claude session ID for new Claude sessions (not forks/resumes)
    // This allows us to track the session ID for forking later
    let claudeSessionId: string | null = null
    const isNewClaudeSession = options.tool === "claude" &&
      !options.command && // No custom command (fork uses custom command)
      (!options.claudeOptions || options.claudeOptions.sessionMode === "new")

    if (isNewClaudeSession) {
      claudeSessionId = randomUUID()
      log("Generated Claude session ID:", claudeSessionId)
    }

    // Determine command - handle Claude options for resume
    let command: string
    if (options.command) {
      command = options.command
    } else if (options.tool === "claude" && claudeSessionId) {
      // New Claude session with our generated session ID
      const baseCommand = buildClaudeCommand(options.claudeOptions)
      command = `${baseCommand} --session-id "${claudeSessionId}"`
    } else if (options.tool === "claude" && options.claudeOptions) {
      command = buildClaudeCommand(options.claudeOptions)
    } else {
      command = getToolCommand(options.tool)
    }

    log("Creating tmux session:", tmuxName, "command:", command)

    // Build environment variables
    const env: Record<string, string> = {
      AGENT_ORCHESTRATOR_SESSION: id
    }
    if (claudeSessionId) {
      env.CLAUDE_SESSION_ID = claudeSessionId
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
    if (claudeSessionId) {
      toolData.claudeSessionId = claudeSessionId
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
   * Resolve the Claude session ID for a session.
   *
   * Resolution order (most reliable first):
   * 1. From session's toolData.claudeSessionId (pre-assigned on creation)
   * 2. From tmux environment CLAUDE_SESSION_ID
   * 3. From file system detection (WARNING: returns most recent, may be wrong session)
   *
   * @returns The Claude session ID or null if not found
   */
  private async resolveClaudeSessionId(session: Session): Promise<string | null> {
    // 1. Check toolData (most reliable - we assigned this ID)
    if (session.toolData?.claudeSessionId && typeof session.toolData.claudeSessionId === "string") {
      log("Resolved Claude session ID from toolData:", session.toolData.claudeSessionId)
      return session.toolData.claudeSessionId
    }

    // 2. Check tmux environment (reliable if session set it)
    const tmuxEnvId = await tmux.getSessionEnvironment(session.tmuxSession, "CLAUDE_SESSION_ID")
    if (tmuxEnvId) {
      log("Resolved Claude session ID from tmux environment:", tmuxEnvId)
      return tmuxEnvId
    }

    // 3. Fall back to file system detection (least reliable)
    // WARNING: This returns the most recently modified session, which may not
    // be the session you want when multiple sessions exist for the same project.
    const fileSystemId = getClaudeSessionID(session.projectPath)
    if (fileSystemId) {
      log("Resolved Claude session ID from file system (fallback):", fileSystemId)
    }
    return fileSystemId
  }

  /**
   * Fork an existing session.
   *
   * For Claude sessions, this:
   * 1. Resolves the parent Claude session ID from the source session
   * 2. Generates a new session ID for the fork
   * 3. Copies session file to worktree if needed (different project path)
   * 4. Creates a new session with --resume and --fork-session flags
   *
   * IMPORTANT: The fork command uses a pre-generated session ID that is
   * stored in toolData. This ensures the ID Claude uses matches what we track.
   */
  async fork(options: SessionForkOptions): Promise<Session> {
    log("fork() called with options:", options)
    const storage = getStorage()
    const source = storage.getSession(options.sourceSessionId)

    if (!source) {
      log("Source session not found:", options.sourceSessionId)
      throw new Error(`Source session not found: ${options.sourceSessionId}`)
    }

    log("Source session:", { id: source.id, tool: source.tool, projectPath: source.projectPath })

    const projectPath = options.worktreePath || source.projectPath

    // Handle Claude session forking
    if (source.tool === "claude") {
      return this.forkClaudeSession(source, options, projectPath, storage)
    }

    // For non-Claude sessions, create a fresh session with same config
    return this.create({
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
  }

  /**
   * Fork a Claude session with conversation history.
   */
  private async forkClaudeSession(
    source: Session,
    options: SessionForkOptions,
    projectPath: string,
    storage: ReturnType<typeof getStorage>
  ): Promise<Session> {
    log("Forking Claude session")

    // Step 1: Resolve the parent Claude session ID
    const parentClaudeSessionId = await this.resolveClaudeSessionId(source)
    if (!parentClaudeSessionId) {
      log("No Claude session ID found")
      throw new Error(
        "Cannot fork: no active Claude session detected. " +
        "Session must be running with an active conversation."
      )
    }

    // Step 2: Handle worktree - copy session file if needed
    // Claude stores sessions per-project-path, so when forking to a worktree
    // with a different path, we must copy the session file there.
    if (options.worktreePath && options.worktreePath !== source.projectPath) {
      log("Copying session file to worktree project directory")
      const copied = copySessionToProject(
        parentClaudeSessionId,
        source.projectPath,
        options.worktreePath
      )
      log(copied ? "Session file copied successfully" : "Warning: Failed to copy session file")
    }

    // Step 3: Generate new session ID for the fork
    // CRITICAL: This ID must be passed to buildForkCommand AND stored in toolData.
    // Previously, buildForkCommand generated its own ID, causing a mismatch.
    const newClaudeSessionId = randomUUID()
    log("Generated new Claude session ID:", newClaudeSessionId)

    // Step 4: Build the fork command
    const forkCommand = buildForkCommand({
      projectPath,
      parentSessionId: parentClaudeSessionId,
      newSessionId: newClaudeSessionId
    })
    log("Fork command:", forkCommand)

    // Step 5: Create the new session
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

    // Step 6: Store the Claude session ID in toolData for future forks
    storage.updateSessionField(newSession.id, "tool_data", JSON.stringify({
      claudeSessionId: newClaudeSessionId,
      parentClaudeSessionId: parentClaudeSessionId,
      claudeDetectedAt: Date.now()
    }))

    log("Fork complete")
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

  async restart(sessionId: string): Promise<Session> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (session.tmuxSession) {
      await tmux.killSession(session.tmuxSession)
    }

    const newTmuxName = tmux.generateSessionName(session.title)
    await tmux.createSession({
      name: newTmuxName,
      command: session.command,
      cwd: session.projectPath
    })

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

  updateTitle(sessionId: string, title: string): void {
    const storage = getStorage()
    storage.updateSessionField(sessionId, "title", title)
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
