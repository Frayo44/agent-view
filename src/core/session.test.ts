/**
 * Tests for SessionManager status refresh — liveness snapshot, debounce,
 * hibernated self-correction, and kill verification.
 *
 * The ./tmux module is mocked; originals are restored in afterAll so test
 * files that run later see the real module.
 */

import { describe, test, expect, beforeEach, afterAll, mock } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

import * as realTmux from "./tmux"
import { Storage, setStorage } from "./storage"
import type { Session } from "./types"

// Capture originals before installing the mock (module body runs after imports)
const originalTmux = { ...realTmux }

// Mutable knobs the tests turn per-case
let cacheResult: Map<string, number> | null = new Map()
let killResult = true

mock.module("./tmux", () => ({
  ...originalTmux,
  refreshSessionCache: async () => cacheResult,
  capturePane: async () => "",
  parseToolStatus: () => ({ isWaiting: false, hasError: false, isBusy: false, isActive: false }),
  getSessionsMemoryKB: async () => new Map<string, number>(),
  killSession: async () => killResult
}))

afterAll(() => {
  mock.module("./tmux", () => originalTmux)
})

import { SessionManager } from "./session"

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id || "test-session-1",
    title: "test",
    projectPath: "/tmp",
    groupPath: "default",
    order: 0,
    command: "claude",
    wrapper: "",
    tool: "claude",
    status: "running",
    tmuxSession: "agentorch_test",
    createdAt: new Date(),
    lastAccessed: new Date(),
    worktreePath: "",
    worktreeRepo: "",
    worktreeBranch: "",
    toolData: {},
    acknowledged: false,
    ...overrides
  }
}

describe("SessionManager.refreshStatuses", () => {
  let storage: Storage
  let manager: SessionManager
  let dbDir: string

  beforeEach(() => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-view-session-test-"))
    storage = new Storage({ dbPath: path.join(dbDir, "state.db") })
    storage.migrate()
    setStorage(storage)
    manager = new SessionManager()
    cacheResult = new Map()
    killResult = true
  })

  test("transient tmux failure skips the tick — no status writes", async () => {
    storage.saveSession(makeSession({ status: "running" }))
    cacheResult = null

    await manager.refreshStatuses()

    expect(storage.getSession("test-session-1")?.status).toBe("running")
  })

  test("one missing tick preserves status (debounce)", async () => {
    storage.saveSession(makeSession({ status: "running" }))
    cacheResult = new Map() // server up, session gone

    await manager.refreshStatuses()

    expect(storage.getSession("test-session-1")?.status).toBe("running")
  })

  test("two consecutive missing ticks mark the session stopped", async () => {
    storage.saveSession(makeSession({ status: "running" }))
    cacheResult = new Map()

    await manager.refreshStatuses()
    await manager.refreshStatuses()

    expect(storage.getSession("test-session-1")?.status).toBe("stopped")
  })

  test("a reappearing session resets the miss counter", async () => {
    storage.saveSession(makeSession({ status: "running" }))

    cacheResult = new Map()
    await manager.refreshStatuses() // miss 1

    cacheResult = new Map([["agentorch_test", 0]])
    await manager.refreshStatuses() // present again

    cacheResult = new Map()
    await manager.refreshStatuses() // miss 1 again — not stopped

    expect(storage.getSession("test-session-1")?.status).not.toBe("stopped")
  })

  test("hibernated session that is actually alive heals to a live status", async () => {
    storage.saveSession(makeSession({ status: "hibernated" }))
    cacheResult = new Map([["agentorch_test", 0]])

    await manager.refreshStatuses()

    expect(storage.getSession("test-session-1")?.status).toBe("idle")
  })

  test("hibernated session with no tmux process stays hibernated", async () => {
    storage.saveSession(makeSession({ status: "hibernated" }))
    cacheResult = new Map()

    await manager.refreshStatuses()
    await manager.refreshStatuses()

    expect(storage.getSession("test-session-1")?.status).toBe("hibernated")
  })
})

describe("SessionManager.hibernate", () => {
  let storage: Storage
  let manager: SessionManager

  beforeEach(() => {
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-view-session-test-"))
    storage = new Storage({ dbPath: path.join(dbDir, "state.db") })
    storage.migrate()
    setStorage(storage)
    manager = new SessionManager()
    killResult = true
  })

  test("marks the session hibernated when the kill succeeds", async () => {
    storage.saveSession(makeSession({ status: "idle" }))

    await manager.hibernate("test-session-1")

    expect(storage.getSession("test-session-1")?.status).toBe("hibernated")
  })

  test("throws and keeps status when the kill fails", async () => {
    storage.saveSession(makeSession({ status: "idle" }))
    killResult = false

    await expect(manager.hibernate("test-session-1")).rejects.toThrow(/still alive/)
    expect(storage.getSession("test-session-1")?.status).toBe("idle")
  })
})
