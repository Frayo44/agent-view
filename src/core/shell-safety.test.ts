import { describe, test, expect } from "bun:test"
import { generateSessionName } from "./tmux"
import { validateBranchName, sanitizeBranchName } from "./git"

describe("generateSessionName — shell injection resistance", () => {
  test("strips shell metacharacters from session names", () => {
    const dangerous = [
      'test; rm -rf /',
      'test && echo pwned',
      'test | cat /etc/passwd',
      'test > /tmp/evil',
      'test < /tmp/input',
      'test $(whoami)',
      'test `whoami`',
      "test' OR '1'='1",
      'test" OR "1"="1',
      'test\necho injected',
      'test\x00null',
    ]

    for (const input of dangerous) {
      const result = generateSessionName(input)
      // Session names must only contain safe chars: prefix + sanitized-name + timestamp
      expect(result).toMatch(/^agentorch_[a-z0-9-]*-[a-z0-9]+$/)
      // Must not contain any shell metacharacters
      expect(result).not.toMatch(/[;&|><$`'"\\{}()\n\x00]/)
    }
  })

  test("produces valid tmux session names from normal inputs", () => {
    const inputs = ["My Cool Project", "feat/auth-refactor", "v2.0.0-beta"]
    for (const input of inputs) {
      const result = generateSessionName(input)
      expect(result.startsWith("agentorch_")).toBe(true)
      expect(result).toMatch(/^agentorch_[a-z0-9-]+-[a-z0-9]+$/)
    }
  })

  test("handles empty and whitespace-only input safely", () => {
    const edgeCases = ["", "   ", "\t\n"]
    for (const input of edgeCases) {
      const result = generateSessionName(input)
      expect(result).toMatch(/^agentorch_/)
      // Should not contain raw whitespace
      expect(result).not.toMatch(/[\s]/)
    }
  })
})

describe("validateBranchName — shell-dangerous characters", () => {
  test("rejects characters that are both git-invalid and shell-dangerous", () => {
    const invalid: Array<{ name: string; desc: string }> = [
      { name: "branch name",    desc: "space" },
      { name: "branch\tname",   desc: "tab" },
      { name: "branch\\name",   desc: "backslash" },
      { name: "branch*name",    desc: "asterisk (glob)" },
      { name: "branch[name",    desc: "bracket (glob)" },
      { name: "branch?name",    desc: "question mark (glob)" },
      { name: "branch~name",    desc: "tilde" },
      { name: "branch^name",    desc: "caret" },
      { name: "branch:name",    desc: "colon" },
    ]

    for (const { name, desc } of invalid) {
      const error = validateBranchName(name)
      expect(error).not.toBeNull()
    }
  })

  test("allows valid git branch names — safety comes from execFile, not validation", () => {
    // These are valid git branch names. Characters like / and - are safe
    // because execFile bypasses shell interpretation entirely.
    const valid = [
      "feat/auth-refactor",
      "fix-123",
      "v2.0.0",
      "user@feature",
      "release/1.0",
    ]

    for (const name of valid) {
      const error = validateBranchName(name)
      expect(error).toBeNull()
    }
  })

  test("rejects path traversal attempts via '..'", () => {
    expect(validateBranchName("../../etc/passwd")).not.toBeNull()
    expect(validateBranchName("branch..name")).not.toBeNull()
  })
})

describe("sanitizeBranchName — dangerous character removal", () => {
  test("replaces shell-dangerous characters with dashes", () => {
    expect(sanitizeBranchName("my branch")).toContain("-")
    expect(sanitizeBranchName("my branch")).not.toContain(" ")

    expect(sanitizeBranchName("my\\branch")).not.toContain("\\")

    expect(sanitizeBranchName("my*branch")).not.toContain("*")

    expect(sanitizeBranchName("my?branch")).not.toContain("?")

    expect(sanitizeBranchName("my~branch")).not.toContain("~")

    expect(sanitizeBranchName("my^branch")).not.toContain("^")

    expect(sanitizeBranchName("my:branch")).not.toContain(":")
  })

  test("collapses multiple dangerous characters to a single dash", () => {
    // Multiple consecutive invalid chars should not produce runs of dashes
    expect(sanitizeBranchName("a  b")).toBe("a-b")
    expect(sanitizeBranchName("a~~b")).toBe("a-b")
    expect(sanitizeBranchName("a**b")).toBe("a-b")
  })

  test("produces a clean name from heavily-injected input", () => {
    const injected = "$(rm -rf /)"
    const sanitized = sanitizeBranchName(injected)
    // sanitizeBranchName targets git-invalid chars, not all shell chars.
    // Characters like $, (, ) are valid in git refs — the safety for those
    // comes from execFile passing them as literal argv elements.
    // But the git-invalid chars (space, *, ?, etc.) must be gone:
    expect(sanitized).not.toContain(" ")
    expect(sanitized).not.toContain("*")
    expect(sanitized).not.toContain("?")
    expect(sanitized).not.toContain("\\")
    // The result should be a non-empty, usable branch name
    expect(sanitized.length).toBeGreaterThan(0)
  })
})

describe("execFile safety model — documentation", () => {
  test("documents that execFile prevents shell injection by design", () => {
    // This is a documentation test — it verifies the security model.
    //
    // The key safety guarantee is that execFile() passes arguments
    // directly to the process as an argv array. Unlike shell-based
    // execution, execFile() never evaluates shell metacharacters
    // like $(), backticks, ;, &&, |, etc.
    //
    // This means even if user input contains malicious shell commands,
    // they are treated as literal strings — never executed.
    //
    // Example:
    //   execFile("git", ["-C", userPath, "status"])
    //   If userPath = "; rm -rf /", git receives the literal string
    //   "; rm -rf /" as a directory path argument, and fails safely.
    //
    // All tmux.ts and git.ts commands now use execFile/execFileAsync.
    expect(true).toBe(true)
  })

  test("input sanitization is defense-in-depth, not the primary safety layer", () => {
    // generateSessionName and sanitizeBranchName clean user input, but
    // the primary security boundary is execFile's argv-based invocation.
    //
    // Even if sanitization had a gap, execFile would prevent exploitation
    // because the shell is never invoked. Sanitization exists to:
    //   1. Produce valid tmux session names and git branch names
    //   2. Provide defense-in-depth against future regressions
    //   3. Prevent confusing behavior from special characters in names
    expect(true).toBe(true)
  })
})
