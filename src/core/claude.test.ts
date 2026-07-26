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
  // Every command carries --settings pointing at agent-view's hook settings
  // (Stop/Notification hooks for OS notifications)
  const SETTINGS_SUFFIX = /--settings ".*claude-settings\.json"$/

  test("plain claude when no options provided", () => {
    const result = buildClaudeCommand()
    expect(result.startsWith("claude ")).toBe(true)
    expect(result).not.toContain("--resume")
    expect(result).not.toContain("--dangerously-skip-permissions")
    expect(result).toMatch(SETTINGS_SUFFIX)
  })

  test("plain claude for new session mode", () => {
    const options: ClaudeOptions = { sessionMode: "new" }
    const result = buildClaudeCommand(options)
    expect(result).not.toContain("--resume")
    expect(result).toMatch(SETTINGS_SUFFIX)
  })

  test("adds --resume for resume session mode", () => {
    const options: ClaudeOptions = { sessionMode: "resume" }
    const result = buildClaudeCommand(options)
    expect(result.startsWith("claude --resume")).toBe(true)
    expect(result).toMatch(SETTINGS_SUFFIX)
  })

  test("adds --dangerously-skip-permissions when skipPermissions is true", () => {
    const options: ClaudeOptions = { sessionMode: "new", skipPermissions: true }
    const result = buildClaudeCommand(options)
    expect(result).toContain("--dangerously-skip-permissions")
    expect(result).toMatch(SETTINGS_SUFFIX)
  })

  test("combines --resume and --dangerously-skip-permissions", () => {
    const options: ClaudeOptions = { sessionMode: "resume", skipPermissions: true }
    const result = buildClaudeCommand(options)
    expect(result.startsWith("claude --resume --dangerously-skip-permissions")).toBe(true)
  })

  test("omits --dangerously-skip-permissions when skipPermissions is false", () => {
    const options: ClaudeOptions = { sessionMode: "new", skipPermissions: false }
    const result = buildClaudeCommand(options)
    expect(result).not.toContain("--dangerously-skip-permissions")
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

