import { describe, test, expect } from "bun:test"
import {
  buildClaudeCommand,
  convertToClaudeDirName,
  getSessionFilePath,
  sessionFileExists,
  sessionHasConversationData,
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
// Session File Existence Tests
// =============================================================================

describe("sessionFileExists", () => {
  test("returns false for non-existent session", () => {
    const result = sessionFileExists("/nonexistent/path", "fake-session-id")
    expect(result).toBe(false)
  })
})

// =============================================================================
// Session Conversation Data Tests
// =============================================================================

describe("sessionHasConversationData", () => {
  test("returns false for non-existent session", () => {
    const result = sessionHasConversationData("/nonexistent/path", "fake-session-id")
    expect(result).toBe(false)
  })
})

