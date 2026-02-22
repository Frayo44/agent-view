import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import path from "path"
import os from "os"
import {
  buildClaudeCommand,
  buildForkCommand,
  convertToClaudeDirName,
  getSessionFilePath,
  sessionFileExists,
  copySessionToProject,
  type ForkCommandOptions
} from "./claude"
import type { ClaudeOptions } from "./types"

// =============================================================================
// buildClaudeCommand Tests
// =============================================================================

describe("buildClaudeCommand", () => {
  test("returns 'claude' when no options provided", () => {
    const result = buildClaudeCommand()
    expect(result).toBe("claude")
  })

  test("returns 'claude' when options is undefined", () => {
    const result = buildClaudeCommand(undefined)
    expect(result).toBe("claude")
  })

  test("returns 'claude' for new session mode", () => {
    const options: ClaudeOptions = { sessionMode: "new" }
    const result = buildClaudeCommand(options)
    expect(result).toBe("claude")
  })

  test("returns 'claude --resume' for resume session mode", () => {
    const options: ClaudeOptions = { sessionMode: "resume" }
    const result = buildClaudeCommand(options)
    expect(result).toBe("claude --resume")
  })

  test("returns 'claude --dangerously-skip-permissions' when skipPermissions is true", () => {
    const options: ClaudeOptions = { sessionMode: "new", skipPermissions: true }
    const result = buildClaudeCommand(options)
    expect(result).toBe("claude --dangerously-skip-permissions")
  })

  test("returns 'claude --resume --dangerously-skip-permissions' for resume with skipPermissions", () => {
    const options: ClaudeOptions = { sessionMode: "resume", skipPermissions: true }
    const result = buildClaudeCommand(options)
    expect(result).toBe("claude --resume --dangerously-skip-permissions")
  })

  test("returns 'claude' when skipPermissions is false", () => {
    const options: ClaudeOptions = { sessionMode: "new", skipPermissions: false }
    const result = buildClaudeCommand(options)
    expect(result).toBe("claude")
  })
})

// =============================================================================
// buildForkCommand Tests
// =============================================================================

describe("buildForkCommand", () => {
  const defaultOptions: ForkCommandOptions = {
    projectPath: "/path/to/project",
    parentSessionId: "parent-uuid-1234-5678-9abc-def012345678",
    newSessionId: "new-uuid-abcd-efgh-ijkl-mnop12345678"
  }

  describe("session ID handling", () => {
    test("uses the provided newSessionId - never generates a new one", () => {
      const result = buildForkCommand(defaultOptions)

      // Must NOT contain uuidgen or any UUID generation
      expect(result).not.toContain("uuidgen")
      expect(result).not.toContain("$(")

      // Must contain the exact provided session ID
      expect(result).toContain(defaultOptions.newSessionId)
    })

    test("uses the provided parentSessionId for --resume flag", () => {
      const result = buildForkCommand(defaultOptions)
      expect(result).toContain(`--resume ${defaultOptions.parentSessionId}`)
    })

    test("passes newSessionId to --session-id flag", () => {
      const result = buildForkCommand(defaultOptions)
      expect(result).toContain(`--session-id "${defaultOptions.newSessionId}"`)
    })

    test("sets tmux environment with the exact newSessionId", () => {
      const result = buildForkCommand(defaultOptions)
      expect(result).toContain(`tmux set-environment CLAUDE_SESSION_ID "${defaultOptions.newSessionId}"`)
    })
  })

  describe("command structure", () => {
    test("includes --fork-session flag", () => {
      const result = buildForkCommand(defaultOptions)
      expect(result).toContain("--fork-session")
    })

    test("changes directory to the project path first", () => {
      const result = buildForkCommand(defaultOptions)
      expect(result).toContain(`cd '${defaultOptions.projectPath}'`)
      // cd should come before the claude command
      expect(result.indexOf("cd")).toBeLessThan(result.indexOf("claude"))
    })

    test("command order is: cd, tmux set-environment, claude", () => {
      const result = buildForkCommand(defaultOptions)
      const cdIndex = result.indexOf("cd")
      const tmuxIndex = result.indexOf("tmux set-environment")
      const claudeIndex = result.indexOf("claude --session-id")

      expect(cdIndex).toBeLessThan(tmuxIndex)
      expect(tmuxIndex).toBeLessThan(claudeIndex)
    })
  })

  describe("path escaping", () => {
    test("handles paths with single quotes by escaping them", () => {
      const options: ForkCommandOptions = {
        ...defaultOptions,
        projectPath: "/path/to/project's folder"
      }
      const result = buildForkCommand(options)

      // Single quote should be escaped as '\'' for shell safety
      expect(result).toContain("cd '/path/to/project'\\''s folder'")
    })

    test("handles paths with spaces", () => {
      const options: ForkCommandOptions = {
        ...defaultOptions,
        projectPath: "/path/to/my project"
      }
      const result = buildForkCommand(options)
      expect(result).toContain("cd '/path/to/my project'")
    })

    test("handles paths with special characters", () => {
      const options: ForkCommandOptions = {
        ...defaultOptions,
        projectPath: "/path/to/project-name_v2.0"
      }
      const result = buildForkCommand(options)
      expect(result).toContain("cd '/path/to/project-name_v2.0'")
    })
  })

  describe("regression tests for fork bug", () => {
    test("CRITICAL: newSessionId in command matches the one that will be stored in toolData", () => {
      // This test documents the critical fix:
      // The session ID passed to buildForkCommand MUST be the same one stored
      // in the session's toolData. Previously, buildForkCommand generated a
      // NEW UUID with uuidgen, causing a mismatch.

      const storedSessionId = "stored-uuid-1111-2222-3333-444455556666"
      const options: ForkCommandOptions = {
        projectPath: "/some/path",
        parentSessionId: "parent-uuid",
        newSessionId: storedSessionId
      }

      const result = buildForkCommand(options)

      // The command must use the EXACT session ID that was passed in
      // (which is the same one stored in toolData)
      expect(result).toContain(`--session-id "${storedSessionId}"`)
      expect(result).toContain(`CLAUDE_SESSION_ID "${storedSessionId}"`)

      // Must NOT generate a different ID
      expect(result).not.toContain("uuidgen")
    })
  })
})

// =============================================================================
// Path Utility Tests
// =============================================================================

describe("convertToClaudeDirName", () => {
  test("converts path separators to hyphens", () => {
    expect(convertToClaudeDirName("/Users/foo/project")).toBe("-Users-foo-project")
  })

  test("converts spaces to hyphens", () => {
    expect(convertToClaudeDirName("/Users/foo/my project")).toBe("-Users-foo-my-project")
  })

  test("preserves alphanumeric characters", () => {
    expect(convertToClaudeDirName("/path/to/Project123")).toBe("-path-to-Project123")
  })

  test("converts special characters to hyphens", () => {
    expect(convertToClaudeDirName("/path/to/project@v1.0")).toBe("-path-to-project-v1-0")
  })
})

describe("getSessionFilePath", () => {
  test("returns correct path for session file", () => {
    const result = getSessionFilePath("/Users/test/project", "abc-123")
    expect(result).toContain(".claude/projects/-Users-test-project/abc-123.jsonl")
  })
})

// =============================================================================
// copySessionToProject Tests
// =============================================================================

describe("copySessionToProject", () => {
  const testDir = path.join(os.tmpdir(), "claude-test-" + Date.now())
  const fakeClaudeDir = path.join(testDir, ".claude", "projects")

  beforeEach(() => {
    // Create test directory structure
    mkdirSync(fakeClaudeDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  test("returns false when source file does not exist", () => {
    const result = copySessionToProject(
      "nonexistent-session",
      "/source/path",
      "/target/path"
    )
    expect(result).toBe(false)
  })

  // Note: Full integration tests for copySessionToProject would require
  // mocking the home directory, which is complex. The function is tested
  // through integration tests and manual testing.
})

// =============================================================================
// Session File Existence Tests
// =============================================================================

describe("sessionFileExists", () => {
  test("returns false for non-existent session", () => {
    const result = sessionFileExists("/nonexistent/path", "fake-session-id")
    expect(result).toBe(false)
  })
})
