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
})
