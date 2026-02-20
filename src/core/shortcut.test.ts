import { describe, test, expect } from "bun:test"
import { getShortcutGroupPath } from "./shortcut"
import type { Shortcut } from "./types"

describe("shortcut", () => {
  describe("getShortcutGroupPath", () => {
    test("sanitizes group path with special characters", () => {
      const shortcut: Shortcut = {
        name: "Test",
        tool: "claude",
        projectPath: "/path",
        groupPath: "My Project!"
      }

      const result = getShortcutGroupPath(shortcut)
      expect(result).toBe("my-project")
    })

    test("removes leading and trailing dots and slashes", () => {
      const shortcut: Shortcut = {
        name: "Test",
        tool: "claude",
        projectPath: "/path",
        groupPath: "./work/"
      }

      const result = getShortcutGroupPath(shortcut)
      expect(result).toBe("work")
    })

    test("removes parent directory traversal", () => {
      const shortcut: Shortcut = {
        name: "Test",
        tool: "claude",
        projectPath: "/path",
        groupPath: "../../../etc"
      }

      const result = getShortcutGroupPath(shortcut)
      expect(result).toBe("etc")
    })

    test("collapses multiple dashes", () => {
      const shortcut: Shortcut = {
        name: "Test",
        tool: "claude",
        projectPath: "/path",
        groupPath: "my---project"
      }

      const result = getShortcutGroupPath(shortcut)
      expect(result).toBe("my-project")
    })

    test("converts to lowercase", () => {
      const shortcut: Shortcut = {
        name: "Test",
        tool: "claude",
        projectPath: "/path",
        groupPath: "MyProject"
      }

      const result = getShortcutGroupPath(shortcut)
      expect(result).toBe("myproject")
    })

    test("returns 'shortcuts' for empty path after sanitization", () => {
      const shortcut: Shortcut = {
        name: "Test",
        tool: "claude",
        projectPath: "/path",
        groupPath: "..."
      }

      const result = getShortcutGroupPath(shortcut)
      expect(result).toBe("shortcuts")
    })

    test("preserves valid simple paths", () => {
      const shortcut: Shortcut = {
        name: "Test",
        tool: "claude",
        projectPath: "/path",
        groupPath: "work"
      }

      const result = getShortcutGroupPath(shortcut)
      expect(result).toBe("work")
    })

    test("allows underscores and hyphens", () => {
      const shortcut: Shortcut = {
        name: "Test",
        tool: "claude",
        projectPath: "/path",
        groupPath: "my_project-name"
      }

      const result = getShortcutGroupPath(shortcut)
      expect(result).toBe("my_project-name")
    })
  })

  describe("Shortcut interface", () => {
    test("requires name, tool, projectPath, groupPath", () => {
      const shortcut: Shortcut = {
        name: "Test Shortcut",
        tool: "claude",
        projectPath: "/home/user/project",
        groupPath: "work"
      }

      expect(shortcut.name).toBe("Test Shortcut")
      expect(shortcut.tool).toBe("claude")
      expect(shortcut.projectPath).toBe("/home/user/project")
      expect(shortcut.groupPath).toBe("work")
    })

    test("optional fields are undefined when not set", () => {
      const shortcut: Shortcut = {
        name: "Test",
        tool: "claude",
        projectPath: "/path",
        groupPath: "work"
      }

      expect(shortcut.description).toBeUndefined()
      expect(shortcut.command).toBeUndefined()
      expect(shortcut.keybind).toBeUndefined()
    })

    test("supports all optional fields", () => {
      const shortcut: Shortcut = {
        name: "Full Shortcut",
        tool: "custom",
        projectPath: "/path",
        groupPath: "work",
        description: "A helpful description",
        command: "./my-tool",
        keybind: "<leader>1"
      }

      expect(shortcut.description).toBe("A helpful description")
      expect(shortcut.command).toBe("./my-tool")
      expect(shortcut.keybind).toBe("<leader>1")
    })
  })
})
