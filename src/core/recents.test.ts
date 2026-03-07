import { describe, test, expect } from "bun:test"
import { addRecent, getMaxRecents } from "./recents"
import type { Recent } from "./types"

describe("recents", () => {
  describe("addRecent", () => {
    test("adds new entry to empty list", () => {
      const recent: Recent = {
        name: "my-session",
        projectPath: "/home/user/project",
        tool: "claude"
      }

      const result = addRecent([], recent)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(recent)
    })

    test("prepends new entry (most recent first)", () => {
      const existing: Recent[] = [
        { name: "old", projectPath: "/old", tool: "claude" }
      ]
      const newRecent: Recent = {
        name: "new",
        projectPath: "/new",
        tool: "claude"
      }

      const result = addRecent(existing, newRecent)

      expect(result).toHaveLength(2)
      expect(result[0]?.name).toBe("new")
      expect(result[1]?.name).toBe("old")
    })

    test("moves existing entry to top when re-used", () => {
      const existing: Recent[] = [
        { name: "first", projectPath: "/first", tool: "claude" },
        { name: "second", projectPath: "/second", tool: "claude" },
        { name: "third", projectPath: "/third", tool: "claude" }
      ]
      // Re-use "third"
      const reused: Recent = { name: "third", projectPath: "/third", tool: "claude" }

      const result = addRecent(existing, reused)

      expect(result).toHaveLength(3)
      expect(result[0]?.name).toBe("third")
      expect(result[1]?.name).toBe("first")
      expect(result[2]?.name).toBe("second")
    })

    describe("uniqueness by name", () => {
      test("same folder with different names creates separate entries", () => {
        const existing: Recent[] = [
          { name: "session-a", projectPath: "/project", tool: "claude" }
        ]
        const newRecent: Recent = {
          name: "session-b",
          projectPath: "/project",
          tool: "claude"
        }

        const result = addRecent(existing, newRecent)

        expect(result).toHaveLength(2)
        expect(result[0]?.name).toBe("session-b")
        expect(result[1]?.name).toBe("session-a")
      })

      test("same folder and name deduplicates", () => {
        const existing: Recent[] = [
          { name: "session-a", projectPath: "/project", tool: "claude" }
        ]
        const duplicate: Recent = {
          name: "session-a",
          projectPath: "/project",
          tool: "claude"
        }

        const result = addRecent(existing, duplicate)

        expect(result).toHaveLength(1)
        expect(result[0]?.name).toBe("session-a")
      })

      test("same folder different tool creates separate entries", () => {
        const existing: Recent[] = [
          { name: "session", projectPath: "/project", tool: "claude" }
        ]
        const newRecent: Recent = {
          name: "session",
          projectPath: "/project",
          tool: "gemini"
        }

        const result = addRecent(existing, newRecent)

        expect(result).toHaveLength(2)
        expect(result[0]?.tool).toBe("gemini")
        expect(result[1]?.tool).toBe("claude")
      })
    })

    describe("sorting by last used time", () => {
      test("new entries appear at top", () => {
        let recents: Recent[] = []

        recents = addRecent(recents, { name: "a", projectPath: "/a", tool: "claude" })
        recents = addRecent(recents, { name: "b", projectPath: "/b", tool: "claude" })
        recents = addRecent(recents, { name: "c", projectPath: "/c", tool: "claude" })

        expect(recents[0]?.name).toBe("c")
        expect(recents[1]?.name).toBe("b")
        expect(recents[2]?.name).toBe("a")
      })

      test("re-using old entry moves it to top", () => {
        let recents: Recent[] = []

        recents = addRecent(recents, { name: "a", projectPath: "/a", tool: "claude" })
        recents = addRecent(recents, { name: "b", projectPath: "/b", tool: "claude" })
        recents = addRecent(recents, { name: "c", projectPath: "/c", tool: "claude" })
        // Re-use "a"
        recents = addRecent(recents, { name: "a", projectPath: "/a", tool: "claude" })

        expect(recents[0]?.name).toBe("a")
        expect(recents[1]?.name).toBe("c")
        expect(recents[2]?.name).toBe("b")
      })
    })

    describe("limit enforcement", () => {
      test("limits to 15 entries", () => {
        let recents: Recent[] = []

        // Add 20 entries
        for (let i = 0; i < 20; i++) {
          recents = addRecent(recents, {
            name: `session-${i}`,
            projectPath: `/project-${i}`,
            tool: "claude"
          })
        }

        expect(recents).toHaveLength(15)
      })

      test("oldest entries are dropped when limit exceeded", () => {
        let recents: Recent[] = []

        // Add 20 entries
        for (let i = 0; i < 20; i++) {
          recents = addRecent(recents, {
            name: `session-${i}`,
            projectPath: `/project-${i}`,
            tool: "claude"
          })
        }

        // Most recent (19) should be first
        expect(recents[0]?.name).toBe("session-19")
        // Oldest remaining (5) should be last
        expect(recents[14]?.name).toBe("session-5")
        // Entries 0-4 should be dropped
        expect(recents.find(r => r.name === "session-0")).toBeUndefined()
        expect(recents.find(r => r.name === "session-4")).toBeUndefined()
      })

      test("re-using entry does not exceed limit", () => {
        let recents: Recent[] = []

        // Fill to limit
        for (let i = 0; i < 15; i++) {
          recents = addRecent(recents, {
            name: `session-${i}`,
            projectPath: `/project-${i}`,
            tool: "claude"
          })
        }

        // Re-use an existing entry
        recents = addRecent(recents, {
          name: "session-0",
          projectPath: "/project-0",
          tool: "claude"
        })

        expect(recents).toHaveLength(15)
        expect(recents[0]?.name).toBe("session-0")
      })
    })

    test("does not mutate input array", () => {
      const original: Recent[] = [
        { name: "a", projectPath: "/a", tool: "claude" }
      ]
      const originalCopy = [...original]

      addRecent(original, { name: "b", projectPath: "/b", tool: "claude" })

      expect(original).toEqual(originalCopy)
    })

    test("handles groupPath in deduplication", () => {
      const existing: Recent[] = [
        { name: "session", projectPath: "/project", tool: "claude", groupPath: "work" }
      ]
      // Same name/path/tool but different group - still considered same entry
      const newRecent: Recent = {
        name: "session",
        projectPath: "/project",
        tool: "claude",
        groupPath: "personal"
      }

      const result = addRecent(existing, newRecent)

      // Should dedupe (group is not part of unique key)
      expect(result).toHaveLength(1)
      expect(result[0]?.groupPath).toBe("personal")
    })
  })

  describe("getMaxRecents", () => {
    test("returns 15", () => {
      expect(getMaxRecents()).toBe(15)
    })
  })
})
