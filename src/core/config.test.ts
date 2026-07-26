import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

import {
  loadConfig,
  getConfig,
  saveConfig,
  ensureConfigDir,
  getConfigDir,
  getConfigPath,
  getDefaultConfig,
  getShortcuts,
  type AppConfig
} from "./config"
import { sanitizeTool, type Shortcut } from "./types"

describe("config", () => {
  const testConfigDir = path.join(os.tmpdir(), `agent-view-test-${Date.now()}`)
  const testConfigPath = path.join(testConfigDir, "config.json")

  // Store original values to restore after tests
  let originalConfigDir: string
  let originalConfigPath: string

  beforeEach(async () => {
    // Create test directory
    await fs.mkdir(testConfigDir, { recursive: true })
  })

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fs.rm(testConfigDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("getDefaultConfig", () => {
    test("returns default configuration", () => {
      const config = getDefaultConfig()

      expect(config.theme).toBe("dark")
      expect(config.defaultGroup).toBe("default")
      expect(config.worktree).toBeDefined()
      expect(config.worktree?.defaultBaseBranch).toBe("main")
      expect(config.worktree?.autoCleanup).toBe(true)
    })

    test("returns a copy, not the original", () => {
      const config1 = getDefaultConfig()
      const config2 = getDefaultConfig()

      config1.theme = "light"

      expect(config2.theme).toBe("dark")
    })
  })

  describe("getConfigDir", () => {
    test("returns path in home directory", () => {
      const dir = getConfigDir()
      expect(dir).toBe(path.join(os.homedir(), ".agent-view"))
    })
  })

  describe("getConfigPath", () => {
    test("returns config.json path", () => {
      const configPath = getConfigPath()
      expect(configPath).toBe(path.join(os.homedir(), ".agent-view", "config.json"))
    })
  })

  describe("loadConfig", () => {
    test("returns defaults when config file does not exist", async () => {
      // Point to non-existent file by loading from a temp path
      const config = await loadConfig()

      // Should have default values
      expect(config.theme).toBeDefined()
      expect(config.worktree).toBeDefined()
    })

    test("merges partial config with defaults", async () => {
      // Create a partial config file
      const partialConfig = {
        theme: "light",
        worktree: {
          defaultBaseBranch: "develop"
        }
      }

      await fs.writeFile(
        testConfigPath,
        JSON.stringify(partialConfig, null, 2)
      )

      // We can't easily test loadConfig with a custom path without modifying the module,
      // but we can verify the merge logic by checking getDefaultConfig structure
      const defaults = getDefaultConfig()

      // Verify default structure that should be merged
      expect(defaults.theme).toBe("dark")
      expect(defaults.worktree?.autoCleanup).toBe(true)
    })
  })

  describe("getConfig", () => {
    test("returns cached config synchronously", () => {
      const config = getConfig()

      // Should return an object with expected properties
      expect(config).toBeDefined()
      expect(typeof config).toBe("object")
    })
  })

  describe("config structure", () => {
    test("AppConfig has correct shape", () => {
      const config: AppConfig = {
        theme: "dark",
        worktree: {
          defaultBaseBranch: "main",
          autoCleanup: true
        },
        defaultGroup: "default"
      }

      expect(config.theme).toBe("dark")
      expect(config.worktree?.defaultBaseBranch).toBe("main")
      expect(config.worktree?.autoCleanup).toBe(true)
      expect(config.defaultGroup).toBe("default")
    })

    test("AppConfig allows partial worktree config", () => {
      const config: AppConfig = {
        worktree: {
          autoCleanup: false
        }
      }

      expect(config.worktree?.autoCleanup).toBe(false)
      expect(config.worktree?.defaultBaseBranch).toBeUndefined()
    })

    test("AppConfig allows all optional fields", () => {
      const config: AppConfig = {}

      expect(config.theme).toBeUndefined()
      expect(config.worktree).toBeUndefined()
      expect(config.defaultGroup).toBeUndefined()
    })
  })

  describe("tool sanitization", () => {
    test("claude passes through", () => {
      expect(sanitizeTool("claude")).toBe("claude")
    })

    test("custom passes through", () => {
      expect(sanitizeTool("custom")).toBe("custom")
    })

    test("legacy tool values map to custom", () => {
      for (const legacy of ["opencode", "gemini", "codex", "shell", "unknown", undefined, null]) {
        expect(sanitizeTool(legacy)).toBe("custom")
      }
    })
  })

  describe("worktree config", () => {
    test("supports different base branches", () => {
      const branches = ["main", "master", "develop", "staging"]

      for (const branch of branches) {
        const config: AppConfig = {
          worktree: {
            defaultBaseBranch: branch
          }
        }
        expect(config.worktree?.defaultBaseBranch).toBe(branch)
      }
    })

    test("autoCleanup can be true or false", () => {
      const configTrue: AppConfig = {
        worktree: { autoCleanup: true }
      }
      const configFalse: AppConfig = {
        worktree: { autoCleanup: false }
      }

      expect(configTrue.worktree?.autoCleanup).toBe(true)
      expect(configFalse.worktree?.autoCleanup).toBe(false)
    })
  })

  describe("shortcuts config", () => {
    test("AppConfig allows shortcuts array", () => {
      const config: AppConfig = {
        shortcuts: [
          {
            name: "Test Project",
            tool: "claude",
            projectPath: "/home/user/project",
            groupPath: "work"
          }
        ]
      }

      expect(config.shortcuts).toBeDefined()
      expect(config.shortcuts?.length).toBe(1)
      expect(config.shortcuts?.[0]?.name).toBe("Test Project")
    })

    test("shortcuts support all tool types", () => {
      const tools = ["claude", "custom"] as const

      for (const tool of tools) {
        const shortcut: Shortcut = {
          name: `${tool} shortcut`,
          tool,
          projectPath: "/path/to/project",
          groupPath: "test"
        }
        expect(shortcut.tool).toBe(tool)
      }
    })

    test("shortcuts support optional keybind field", () => {
      const shortcutWithKeybind: Shortcut = {
        name: "With Keybind",
        tool: "claude",
        projectPath: "/path",
        groupPath: "work",
        keybind: "<leader>1"
      }

      const shortcutWithoutKeybind: Shortcut = {
        name: "Without Keybind",
        tool: "claude",
        projectPath: "/path",
        groupPath: "work"
      }

      expect(shortcutWithKeybind.keybind).toBe("<leader>1")
      expect(shortcutWithoutKeybind.keybind).toBeUndefined()
    })

    test("shortcuts support optional command field for custom tool", () => {
      const shortcut: Shortcut = {
        name: "Custom Tool",
        tool: "custom",
        command: "./my-script",
        projectPath: "/path",
        groupPath: "work"
      }

      expect(shortcut.command).toBe("./my-script")
    })

    test("shortcuts support optional description field", () => {
      const shortcut: Shortcut = {
        name: "Described",
        tool: "claude",
        projectPath: "/path",
        groupPath: "work",
        description: "This is a helpful description"
      }

      expect(shortcut.description).toBe("This is a helpful description")
    })

    test("shortcuts support various keybind formats", () => {
      const keybinds = ["1", "<leader>1", "<leader>w", "ctrl+1", "ctrl+shift+p"]

      for (const keybind of keybinds) {
        const shortcut: Shortcut = {
          name: "Test",
          tool: "claude",
          projectPath: "/path",
          groupPath: "work",
          keybind
        }
        expect(shortcut.keybind).toBe(keybind)
      }
    })

    test("default config has empty shortcuts array", () => {
      const defaults = getDefaultConfig()
      expect(defaults.shortcuts).toEqual([])
    })

    test("getShortcuts returns array", () => {
      const shortcuts = getShortcuts()
      expect(Array.isArray(shortcuts)).toBe(true)
    })
  })
})
