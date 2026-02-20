import { describe, test, expect } from "bun:test"
import { buildClaudeCommand } from "./claude"
import type { ClaudeOptions } from "./types"

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
