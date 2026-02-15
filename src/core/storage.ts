/**
 * SQLite storage for session/group persistence
 * Based on agent-view's statedb pattern
 * Uses Bun's built-in SQLite
 */

import { Database } from "bun:sqlite"
import path from "path"
import os from "os"
import fs from "fs"
import type { Session, Group, StatusUpdate, Tool, SessionStatus } from "./types"

const SCHEMA_VERSION = 1

export interface StorageOptions {
  dbPath?: string
}

export class Storage {
  private db: Database
  private pid: number
  private closed = false

  constructor(options: StorageOptions = {}) {
    const dbPath = options.dbPath ?? this.getDefaultPath()

    // Ensure directory exists
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    }

    this.db = new Database(dbPath)
    this.pid = process.pid

    // Configure SQLite for concurrent access
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA busy_timeout = 5000")
    this.db.exec("PRAGMA foreign_keys = ON")
  }

  private getDefaultPath(): string {
    const home = os.homedir()
    return path.join(home, ".agent-orchestrator", "state.db")
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        project_path TEXT NOT NULL,
        group_path TEXT NOT NULL DEFAULT 'my-sessions',
        sort_order INTEGER NOT NULL DEFAULT 0,
        command TEXT NOT NULL DEFAULT '',
        wrapper TEXT NOT NULL DEFAULT '',
        tool TEXT NOT NULL DEFAULT 'shell',
        status TEXT NOT NULL DEFAULT 'idle',
        tmux_session TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL DEFAULT 0,
        parent_session_id TEXT NOT NULL DEFAULT '',
        worktree_path TEXT NOT NULL DEFAULT '',
        worktree_repo TEXT NOT NULL DEFAULT '',
        worktree_branch TEXT NOT NULL DEFAULT '',
        tool_data TEXT NOT NULL DEFAULT '{}',
        acknowledged INTEGER NOT NULL DEFAULT 0
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        path TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        expanded INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        default_path TEXT NOT NULL DEFAULT ''
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS heartbeats (
        pid INTEGER PRIMARY KEY,
        started INTEGER NOT NULL,
        heartbeat INTEGER NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0
      )
    `)

    // Set schema version
    const setVersion = this.db.prepare(
      "INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', ?)"
    )
    setVersion.run(String(SCHEMA_VERSION))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
      this.db.close()
    } catch {
      // Ignore close errors
    }
  }

  isClosed(): boolean {
    return this.closed
  }

  // Session CRUD

  saveSession(session: Session): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (
        id, title, project_path, group_path, sort_order,
        command, wrapper, tool, status, tmux_session,
        created_at, last_accessed,
        parent_session_id, worktree_path, worktree_repo, worktree_branch,
        tool_data, acknowledged
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      session.id,
      session.title,
      session.projectPath,
      session.groupPath,
      session.order,
      session.command,
      session.wrapper,
      session.tool,
      session.status,
      session.tmuxSession,
      session.createdAt.getTime(),
      session.lastAccessed.getTime(),
      session.parentSessionId,
      session.worktreePath,
      session.worktreeRepo,
      session.worktreeBranch,
      JSON.stringify(session.toolData),
      session.acknowledged ? 1 : 0
    )
  }

  saveSessions(sessions: Session[]): void {
    const deleteStmt = this.db.prepare("DELETE FROM sessions WHERE id NOT IN (" +
      sessions.map(() => "?").join(",") + ")")
    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (
        id, title, project_path, group_path, sort_order,
        command, wrapper, tool, status, tmux_session,
        created_at, last_accessed,
        parent_session_id, worktree_path, worktree_repo, worktree_branch,
        tool_data, acknowledged
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const transaction = this.db.transaction(() => {
      if (sessions.length === 0) {
        this.db.exec("DELETE FROM sessions")
      } else {
        deleteStmt.run(...sessions.map(s => s.id))
      }

      for (const session of sessions) {
        insertStmt.run(
          session.id,
          session.title,
          session.projectPath,
          session.groupPath,
          session.order,
          session.command,
          session.wrapper,
          session.tool,
          session.status,
          session.tmuxSession,
          session.createdAt.getTime(),
          session.lastAccessed.getTime(),
          session.parentSessionId,
          session.worktreePath,
          session.worktreeRepo,
          session.worktreeBranch,
          JSON.stringify(session.toolData),
          session.acknowledged ? 1 : 0
        )
      }
    })

    transaction()
  }

  loadSessions(): Session[] {
    if (this.closed) return []
    const stmt = this.db.prepare(`
      SELECT id, title, project_path, group_path, sort_order,
        command, wrapper, tool, status, tmux_session,
        created_at, last_accessed,
        parent_session_id, worktree_path, worktree_repo, worktree_branch,
        tool_data, acknowledged
      FROM sessions ORDER BY sort_order
    `)

    const rows = stmt.all() as any[]
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      projectPath: row.project_path,
      groupPath: row.group_path,
      order: row.sort_order,
      command: row.command,
      wrapper: row.wrapper,
      tool: row.tool as Tool,
      status: row.status as SessionStatus,
      tmuxSession: row.tmux_session,
      createdAt: new Date(row.created_at),
      lastAccessed: new Date(row.last_accessed),
      parentSessionId: row.parent_session_id,
      worktreePath: row.worktree_path,
      worktreeRepo: row.worktree_repo,
      worktreeBranch: row.worktree_branch,
      toolData: JSON.parse(row.tool_data),
      acknowledged: row.acknowledged === 1
    }))
  }

  getSession(id: string): Session | null {
    const stmt = this.db.prepare(`
      SELECT id, title, project_path, group_path, sort_order,
        command, wrapper, tool, status, tmux_session,
        created_at, last_accessed,
        parent_session_id, worktree_path, worktree_repo, worktree_branch,
        tool_data, acknowledged
      FROM sessions WHERE id = ?
    `)

    const row = stmt.get(id) as any
    if (!row) return null

    return {
      id: row.id,
      title: row.title,
      projectPath: row.project_path,
      groupPath: row.group_path,
      order: row.sort_order,
      command: row.command,
      wrapper: row.wrapper,
      tool: row.tool as Tool,
      status: row.status as SessionStatus,
      tmuxSession: row.tmux_session,
      createdAt: new Date(row.created_at),
      lastAccessed: new Date(row.last_accessed),
      parentSessionId: row.parent_session_id,
      worktreePath: row.worktree_path,
      worktreeRepo: row.worktree_repo,
      worktreeBranch: row.worktree_branch,
      toolData: JSON.parse(row.tool_data),
      acknowledged: row.acknowledged === 1
    }
  }

  deleteSession(id: string): void {
    const stmt = this.db.prepare("DELETE FROM sessions WHERE id = ?")
    stmt.run(id)
  }

  updateSessionField(id: string, field: string, value: unknown): void {
    // Map TypeScript field names to SQL column names
    const columnMap: Record<string, string> = {
      projectPath: "project_path",
      groupPath: "group_path",
      sortOrder: "sort_order",
      tmuxSession: "tmux_session",
      createdAt: "created_at",
      lastAccessed: "last_accessed",
      parentSessionId: "parent_session_id",
      worktreePath: "worktree_path",
      worktreeRepo: "worktree_repo",
      worktreeBranch: "worktree_branch",
      toolData: "tool_data"
    }
    const column = columnMap[field] ?? field
    const stmt = this.db.prepare(`UPDATE sessions SET ${column} = ? WHERE id = ?`)
    stmt.run(value as string | number | null, id)
  }

  // Status updates

  writeStatus(id: string, status: SessionStatus, tool: Tool): void {
    if (this.closed) return
    const stmt = this.db.prepare("UPDATE sessions SET status = ?, tool = ? WHERE id = ?")
    stmt.run(status, tool, id)
  }

  readAllStatuses(): Map<string, StatusUpdate> {
    const stmt = this.db.prepare("SELECT id, status, tool, acknowledged FROM sessions")
    const rows = stmt.all() as any[]

    const result = new Map<string, StatusUpdate>()
    for (const row of rows) {
      result.set(row.id, {
        sessionId: row.id,
        status: row.status as SessionStatus,
        tool: row.tool as Tool,
        acknowledged: row.acknowledged === 1
      })
    }
    return result
  }

  setAcknowledged(id: string, ack: boolean): void {
    const stmt = this.db.prepare("UPDATE sessions SET acknowledged = ? WHERE id = ?")
    stmt.run(ack ? 1 : 0, id)
  }

  // Group CRUD

  saveGroups(groups: Group[]): void {
    const transaction = this.db.transaction(() => {
      this.db.exec("DELETE FROM groups")

      const stmt = this.db.prepare(`
        INSERT INTO groups (path, name, expanded, sort_order, default_path)
        VALUES (?, ?, ?, ?, ?)
      `)

      for (const group of groups) {
        stmt.run(
          group.path,
          group.name,
          group.expanded ? 1 : 0,
          group.order,
          group.defaultPath
        )
      }
    })

    transaction()
  }

  loadGroups(): Group[] {
    if (this.closed) return []
    const stmt = this.db.prepare(`
      SELECT path, name, expanded, sort_order, default_path
      FROM groups ORDER BY sort_order
    `)

    const rows = stmt.all() as any[]
    return rows.map(row => ({
      path: row.path,
      name: row.name,
      expanded: row.expanded === 1,
      order: row.sort_order,
      defaultPath: row.default_path
    }))
  }

  deleteGroup(path: string): void {
    const stmt = this.db.prepare("DELETE FROM groups WHERE path = ?")
    stmt.run(path)
  }

  // Heartbeat management

  registerInstance(isPrimary: boolean): void {
    const now = Math.floor(Date.now() / 1000)
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO heartbeats (pid, started, heartbeat, is_primary)
      VALUES (?, ?, ?, ?)
    `)
    stmt.run(this.pid, now, now, isPrimary ? 1 : 0)
  }

  heartbeat(): void {
    const now = Math.floor(Date.now() / 1000)
    const stmt = this.db.prepare("UPDATE heartbeats SET heartbeat = ? WHERE pid = ?")
    stmt.run(now, this.pid)
  }

  unregisterInstance(): void {
    const stmt = this.db.prepare("DELETE FROM heartbeats WHERE pid = ?")
    stmt.run(this.pid)
  }

  cleanDeadInstances(timeoutSeconds: number): void {
    const cutoff = Math.floor(Date.now() / 1000) - timeoutSeconds
    const stmt = this.db.prepare("DELETE FROM heartbeats WHERE heartbeat < ?")
    stmt.run(cutoff)
  }

  aliveInstanceCount(): number {
    const cutoff = Math.floor(Date.now() / 1000) - 30
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM heartbeats WHERE heartbeat >= ?")
    const row = stmt.get(cutoff) as { count: number }
    return row.count
  }

  electPrimary(timeoutSeconds: number): boolean {
    const cutoff = Math.floor(Date.now() / 1000) - timeoutSeconds

    const transaction = this.db.transaction(() => {
      // Clear stale primaries
      this.db.prepare(
        "UPDATE heartbeats SET is_primary = 0 WHERE heartbeat < ? AND is_primary = 1"
      ).run(cutoff)

      // Check for existing primary
      const existing = this.db.prepare(
        "SELECT pid FROM heartbeats WHERE is_primary = 1 AND heartbeat >= ? LIMIT 1"
      ).get(cutoff) as { pid: number } | undefined

      if (existing) {
        return existing.pid === this.pid
      }

      // Claim primary
      this.db.prepare("UPDATE heartbeats SET is_primary = 1 WHERE pid = ?").run(this.pid)
      return true
    })

    return transaction()
  }

  resignPrimary(): void {
    const stmt = this.db.prepare("UPDATE heartbeats SET is_primary = 0 WHERE pid = ?")
    stmt.run(this.pid)
  }

  // Metadata

  setMeta(key: string, value: string): void {
    if (this.closed) return
    const stmt = this.db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
    stmt.run(key, value)
  }

  getMeta(key: string): string | null {
    if (this.closed) return null
    const stmt = this.db.prepare("SELECT value FROM metadata WHERE key = ?")
    const row = stmt.get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  // Change detection

  touch(): void {
    this.setMeta("last_modified", String(Date.now()))
  }

  lastModified(): number {
    const value = this.getMeta("last_modified")
    return value ? parseInt(value, 10) : 0
  }

  isEmpty(): boolean {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM sessions")
    const row = stmt.get() as { count: number }
    return row.count === 0
  }
}

// Global instance
let globalStorage: Storage | null = null

export function getStorage(): Storage {
  if (!globalStorage) {
    globalStorage = new Storage()
    globalStorage.migrate()
  }
  return globalStorage
}

export function setStorage(storage: Storage): void {
  globalStorage = storage
}
