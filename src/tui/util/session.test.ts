import { describe, test, expect } from "bun:test"
import { sortSessionsByCreatedAt } from "./session"
import type { Session } from "@/core/types"

function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-id",
    title: "Test Session",
    projectPath: "/test/path",
    groupPath: "",
    order: 0,
    command: "claude",
    wrapper: "",
    tool: "claude",
    status: "idle",
    tmuxSession: "test-tmux",
    createdAt: new Date("2024-01-01T10:00:00Z"),
    lastAccessed: new Date("2024-01-01T10:00:00Z"),
    parentSessionId: "",
    worktreePath: "",
    worktreeRepo: "",
    worktreeBranch: "",
    toolData: {},
    acknowledged: false,
    ...overrides,
  }
}

describe("sortSessionsByCreatedAt", () => {
  test("returns empty array for empty input", () => {
    expect(sortSessionsByCreatedAt([])).toEqual([])
  })

  test("returns single session unchanged", () => {
    const session = createMockSession({ id: "1" })
    const result = sortSessionsByCreatedAt([session])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("1")
  })

  test("sorts sessions by creation time, newest first", () => {
    const oldest = createMockSession({
      id: "oldest",
      createdAt: new Date("2024-01-01T10:00:00Z"),
    })
    const middle = createMockSession({
      id: "middle",
      createdAt: new Date("2024-01-02T10:00:00Z"),
    })
    const newest = createMockSession({
      id: "newest",
      createdAt: new Date("2024-01-03T10:00:00Z"),
    })

    const result = sortSessionsByCreatedAt([oldest, middle, newest])

    expect(result[0].id).toBe("newest")
    expect(result[1].id).toBe("middle")
    expect(result[2].id).toBe("oldest")
  })

  test("order is stable regardless of status", () => {
    const running = createMockSession({
      id: "running",
      status: "running",
      createdAt: new Date("2024-01-01T10:00:00Z"),
    })
    const waiting = createMockSession({
      id: "waiting",
      status: "waiting",
      createdAt: new Date("2024-01-02T10:00:00Z"),
    })
    const idle = createMockSession({
      id: "idle",
      status: "idle",
      createdAt: new Date("2024-01-03T10:00:00Z"),
    })

    const result = sortSessionsByCreatedAt([running, waiting, idle])

    // Order should be by creation time, not status
    expect(result[0].id).toBe("idle")
    expect(result[1].id).toBe("waiting")
    expect(result[2].id).toBe("running")
  })

  test("order is stable regardless of lastAccessed", () => {
    const recentlyAccessed = createMockSession({
      id: "recently-accessed",
      createdAt: new Date("2024-01-01T10:00:00Z"),
      lastAccessed: new Date("2024-01-10T10:00:00Z"),
    })
    const notRecentlyAccessed = createMockSession({
      id: "not-recently-accessed",
      createdAt: new Date("2024-01-02T10:00:00Z"),
      lastAccessed: new Date("2024-01-02T10:00:00Z"),
    })

    const result = sortSessionsByCreatedAt([recentlyAccessed, notRecentlyAccessed])

    // Order should be by creation time, not lastAccessed
    expect(result[0].id).toBe("not-recently-accessed")
    expect(result[1].id).toBe("recently-accessed")
  })

  test("does not mutate original array", () => {
    const sessions = [
      createMockSession({ id: "1", createdAt: new Date("2024-01-01") }),
      createMockSession({ id: "2", createdAt: new Date("2024-01-02") }),
    ]
    const original = [...sessions]

    sortSessionsByCreatedAt(sessions)

    expect(sessions[0].id).toBe(original[0].id)
    expect(sessions[1].id).toBe(original[1].id)
  })

  test("handles sessions with same creation time", () => {
    const sameTime = new Date("2024-01-01T10:00:00Z")
    const session1 = createMockSession({ id: "1", createdAt: sameTime })
    const session2 = createMockSession({ id: "2", createdAt: sameTime })

    const result = sortSessionsByCreatedAt([session1, session2])

    // Both should be present, order is implementation-defined for equal keys
    expect(result).toHaveLength(2)
    expect(result.map(s => s.id).sort()).toEqual(["1", "2"])
  })
})
