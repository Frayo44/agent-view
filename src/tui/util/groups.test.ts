import { describe, test, expect } from "bun:test"
import {
  flattenGroupTree,
  ensureDefaultGroup,
  getGroupSessionCount,
  getGroupStatusSummary,
  generateGroupPath,
  DEFAULT_GROUP_PATH,
  DEFAULT_GROUP_NAME
} from "./groups"
import type { Session, Group } from "@/core/types"

function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-id",
    title: "Test Session",
    projectPath: "/test/path",
    groupPath: DEFAULT_GROUP_PATH,
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

function createMockGroup(overrides: Partial<Group> = {}): Group {
  return {
    path: "test-group",
    name: "Test Group",
    expanded: true,
    order: 0,
    defaultPath: "",
    ...overrides,
  }
}

describe("ensureDefaultGroup", () => {
  test("adds default group when missing", () => {
    const groups: Group[] = []
    const result = ensureDefaultGroup(groups)

    expect(result).toHaveLength(1)
    expect(result[0]!.path).toBe(DEFAULT_GROUP_PATH)
    expect(result[0]!.name).toBe(DEFAULT_GROUP_NAME)
  })

  test("returns groups unchanged when default exists", () => {
    const groups = [createMockGroup({ path: DEFAULT_GROUP_PATH, name: DEFAULT_GROUP_NAME })]
    const result = ensureDefaultGroup(groups)

    expect(result).toHaveLength(1)
    expect(result[0]!.path).toBe(DEFAULT_GROUP_PATH)
  })

  test("preserves existing groups when adding default", () => {
    const groups = [createMockGroup({ path: "other", name: "Other", order: 0 })]
    const result = ensureDefaultGroup(groups)

    expect(result).toHaveLength(2)
    expect(result[0]!.path).toBe(DEFAULT_GROUP_PATH)
    expect(result[1]!.path).toBe("other")
  })
})

describe("flattenGroupTree", () => {
  test("returns empty array for empty inputs", () => {
    const result = flattenGroupTree([], [])
    expect(result).toEqual([])
  })

  test("creates group headers for each group", () => {
    const groups = [
      createMockGroup({ path: "group-1", order: 0 }),
      createMockGroup({ path: "group-2", order: 1 })
    ]
    const result = flattenGroupTree([], groups)

    expect(result).toHaveLength(2)
    expect(result[0]!.type).toBe("group")
    expect(result[1]!.type).toBe("group")
  })

  test("places sessions under their groups when expanded", () => {
    const groups = [createMockGroup({ path: "my-group", expanded: true })]
    const sessions = [
      createMockSession({ id: "s1", groupPath: "my-group" }),
      createMockSession({ id: "s2", groupPath: "my-group" })
    ]
    const result = flattenGroupTree(sessions, groups)

    expect(result).toHaveLength(3) // 1 group + 2 sessions
    expect(result[0]!.type).toBe("group")
    expect(result[1]!.type).toBe("session")
    expect(result[2]!.type).toBe("session")
  })

  test("hides sessions when group is collapsed", () => {
    const groups = [createMockGroup({ path: "my-group", expanded: false })]
    const sessions = [createMockSession({ id: "s1", groupPath: "my-group" })]
    const result = flattenGroupTree(sessions, groups)

    expect(result).toHaveLength(1) // Only group header
    expect(result[0]!.type).toBe("group")
  })

  test("assigns group indices 1-9 for hotkey jumps", () => {
    const groups = Array.from({ length: 10 }, (_, i) =>
      createMockGroup({ path: `group-${i}`, order: i })
    )
    const result = flattenGroupTree([], groups)

    expect(result[0]!.groupIndex).toBe(1)
    expect(result[8]!.groupIndex).toBe(9)
    expect(result[9]!.groupIndex).toBeUndefined()
  })
})

describe("getGroupSessionCount", () => {
  test("returns 0 for empty sessions", () => {
    expect(getGroupSessionCount([], "any-group")).toBe(0)
  })

  test("counts sessions in the specified group", () => {
    const sessions = [
      createMockSession({ id: "1", groupPath: "group-a" }),
      createMockSession({ id: "2", groupPath: "group-a" }),
      createMockSession({ id: "3", groupPath: "group-b" })
    ]
    expect(getGroupSessionCount(sessions, "group-a")).toBe(2)
    expect(getGroupSessionCount(sessions, "group-b")).toBe(1)
  })
})

describe("getGroupStatusSummary", () => {
  test("counts sessions by status", () => {
    const sessions = [
      createMockSession({ id: "1", groupPath: "g", status: "running" }),
      createMockSession({ id: "2", groupPath: "g", status: "running" }),
      createMockSession({ id: "3", groupPath: "g", status: "waiting" }),
      createMockSession({ id: "4", groupPath: "g", status: "error" })
    ]
    const summary = getGroupStatusSummary(sessions, "g")

    expect(summary.running).toBe(2)
    expect(summary.waiting).toBe(1)
    expect(summary.error).toBe(1)
  })
})

describe("generateGroupPath", () => {
  test("converts name to lowercase kebab-case", () => {
    expect(generateGroupPath("My Group", [])).toBe("my-group")
    expect(generateGroupPath("Backend Work", [])).toBe("backend-work")
  })

  test("removes special characters", () => {
    expect(generateGroupPath("Test @#$ Group!", [])).toBe("test-group")
  })

  test("appends number if path already exists", () => {
    const existing = ["my-group"]
    expect(generateGroupPath("My Group", existing)).toBe("my-group-1")
  })

  test("increments number until unique", () => {
    const existing = ["test", "test-1", "test-2"]
    expect(generateGroupPath("Test", existing)).toBe("test-3")
  })
})
