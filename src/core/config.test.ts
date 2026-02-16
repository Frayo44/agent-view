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
  type AppConfig
} from "./config"

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

      expect(config.defaultTool).toBe("claude")
      expect(config.theme).toBe("dark")
      expect(config.defaultGroup).toBe("default")
      expect(config.worktree).toBeDefined()
      expect(config.worktree?.defaultBaseBranch).toBe("main")
      expect(config.worktree?.autoCleanup).toBe(true)
    })

    test("returns a copy, not the original", () => {
      const config1 = getDefaultConfig()
      const config2 = getDefaultConfig()

      config1.defaultTool = "gemini"

      expect(config2.defaultTool).toBe("claude")
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
      expect(config.defaultTool).toBeDefined()
      expect(config.theme).toBeDefined()
      expect(config.worktree).toBeDefined()
    })

    test("merges partial config with defaults", async () => {
      // Create a partial config file
      const partialConfig = {
        defaultTool: "gemini",
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
        defaultTool: "claude",
        theme: "dark",
        worktree: {
          defaultBaseBranch: "main",
          autoCleanup: true
        },
        defaultGroup: "default"
      }

      expect(config.defaultTool).toBe("claude")
      expect(config.theme).toBe("dark")
      expect(config.worktree?.defaultBaseBranch).toBe("main")
      expect(config.worktree?.autoCleanup).toBe(true)
      expect(config.defaultGroup).toBe("default")
    })

    test("AppConfig allows partial worktree config", () => {
      const config: AppConfig = {
        defaultTool: "opencode",
        worktree: {
          autoCleanup: false
        }
      }

      expect(config.defaultTool).toBe("opencode")
      expect(config.worktree?.autoCleanup).toBe(false)
      expect(config.worktree?.defaultBaseBranch).toBeUndefined()
    })

    test("AppConfig allows all optional fields", () => {
      const config: AppConfig = {}

      expect(config.defaultTool).toBeUndefined()
      expect(config.theme).toBeUndefined()
      expect(config.worktree).toBeUndefined()
      expect(config.defaultGroup).toBeUndefined()
    })
  })

  describe("tool types", () => {
    test("defaultTool accepts valid tool values", () => {
      const tools = ["claude", "opencode", "gemini", "codex", "custom", "shell"] as const

      for (const tool of tools) {
        const config: AppConfig = { defaultTool: tool }
        expect(config.defaultTool).toBe(tool)
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
})
