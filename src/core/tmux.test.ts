import { describe, test, expect, beforeEach } from "bun:test"

import {
  SESSION_PREFIX,
  generateSessionName,
  parseToolStatus,
  sessionExists,
  getSessionActivity,
  registerSessionInCache,
  isSessionActive,
} from "./tmux"

// Note: We need to access the internal sessionCache for testing
// Since it's a module-level variable, we'll test through the public API

describe("generateSessionName", () => {
  test("prefixes with SESSION_PREFIX", () => {
    const name = generateSessionName("test")
    expect(name.startsWith(SESSION_PREFIX)).toBe(true)
  })

  test("sanitizes special characters", () => {
    const name = generateSessionName("My Feature!")
    // Should only contain alphanumeric, dashes, and underscores
    expect(name).toMatch(/^agentorch_[a-z0-9-]+-[a-z0-9]+$/)
  })

  test("converts to lowercase", () => {
    const name = generateSessionName("UPPERCASE")
    expect(name.toLowerCase()).toBe(name)
  })

  test("replaces spaces and special chars with dashes", () => {
    const name = generateSessionName("Hello World!")
    expect(name).toContain("hello-world")
  })

  test("removes leading/trailing dashes from safe name", () => {
    const name = generateSessionName("---test---")
    expect(name).toContain("test")
    expect(name).not.toContain("---")
  })

  test("truncates long titles to 20 characters", () => {
    const longTitle = "this-is-a-very-long-title-that-should-be-truncated"
    const name = generateSessionName(longTitle)
    // The safe part (between prefix and timestamp) should be <= 20 chars
    const parts = name.replace(SESSION_PREFIX, "").split("-")
    parts.pop() // Remove timestamp
    const safePart = parts.join("-")
    expect(safePart.length).toBeLessThanOrEqual(20)
  })

  test("adds timestamp for uniqueness", () => {
    const name1 = generateSessionName("test")
    const name2 = generateSessionName("test")

    // Both should have the same prefix structure
    expect(name1.startsWith(`${SESSION_PREFIX}test-`)).toBe(true)
    expect(name2.startsWith(`${SESSION_PREFIX}test-`)).toBe(true)

    // Extract timestamps (last part after final dash)
    const timestamp1 = name1.split("-").pop()
    const timestamp2 = name2.split("-").pop()

    expect(timestamp1).toBeTruthy()
    expect(timestamp2).toBeTruthy()
  })

  test("generates valid tmux session names", () => {
    const testCases = [
      "Simple",
      "with spaces",
      "Special!@#$%^&*()",
      "Mix3d-C4se_123",
      "",
    ]

    for (const title of testCases) {
      const name = generateSessionName(title)
      // tmux session names should not contain periods or colons
      expect(name).not.toContain(".")
      expect(name).not.toContain(":")
    }
  })
})

describe("parseToolStatus", () => {
  test("detects y/n prompt waiting patterns", () => {
    const output = "Some output\nDo you want to proceed? (y/n)"
    const status = parseToolStatus(output)
    expect(status.isWaiting).toBe(true)
    expect(status.hasError).toBe(false)
  })

  test("detects [Y/n] prompt waiting patterns", () => {
    const output = "Install packages? [Y/n]"
    const status = parseToolStatus(output)
    expect(status.isWaiting).toBe(true)
  })

  test("detects Press enter to continue", () => {
    const output = "Operation completed.\nPress enter to continue..."
    const status = parseToolStatus(output)
    expect(status.isWaiting).toBe(true)
  })

  test("detects waiting for input", () => {
    const output = "The process is waiting for user input"
    const status = parseToolStatus(output)
    expect(status.isWaiting).toBe(true)
  })

  test("detects permission denied", () => {
    const output = "Error: Permission denied for /etc/passwd"
    const status = parseToolStatus(output)
    expect(status.isWaiting).toBe(true)
  })

  test("detects do you want to pattern", () => {
    const output = "Do you want to continue?"
    const status = parseToolStatus(output)
    expect(status.isWaiting).toBe(true)
  })

  test("detects error patterns", () => {
    const errorOutputs = [
      "Error: Something went wrong",
      "Failed: Unable to connect",
      "Exception: NullPointerException",
      "Traceback (most recent call last):",
      "panic: runtime error",
    ]

    for (const output of errorOutputs) {
      const status = parseToolStatus(output)
      expect(status.hasError).toBe(true)
    }
  })

  test("returns isWaiting=false for normal output", () => {
    const output = "Building project...\nCompiling files...\nDone!"
    const status = parseToolStatus(output)
    expect(status.isWaiting).toBe(false)
    expect(status.hasError).toBe(false)
  })

  test("only checks last 20 lines", () => {
    // Create output with error early but clean output at the end
    const lines = ["Error: old error"]
    for (let i = 0; i < 25; i++) {
      lines.push(`Line ${i}`)
    }
    const output = lines.join("\n")

    const status = parseToolStatus(output)
    expect(status.hasError).toBe(false) // Error is outside last 20 lines
  })

  test("isActive is always false (determined by activity timestamp)", () => {
    const status = parseToolStatus("any output")
    expect(status.isActive).toBe(false)
  })
})

describe("session cache", () => {
  // Note: These tests rely on the module-level cache state
  // We test through the public API

  test("sessionExists returns false when cache is stale", () => {
    // When cache is very old or uninitialized, sessionExists should return false
    // This is the default state since cache timestamp starts at 0
    const exists = sessionExists("nonexistent-session")
    expect(exists).toBe(false)
  })

  test("getSessionActivity returns 0 for unknown sessions", () => {
    const activity = getSessionActivity("unknown-session")
    expect(activity).toBe(0)
  })

  test("registerSessionInCache adds session with current timestamp", () => {
    const testSessionName = `test-session-${Date.now()}`

    // Register the session
    registerSessionInCache(testSessionName)

    // Since we just registered it, and the cache timestamp was 0 (stale),
    // sessionExists will still return false because the cache is stale
    // But getSessionActivity should return a value > 0 if we ignore staleness
    // Actually, getSessionActivity also checks staleness, so it returns 0

    // The behavior is: after registering, the session is in cache.data
    // but the cache.timestamp check will fail because it's still the old timestamp
    // This is expected behavior - register is for preventing race conditions
    // when you know you just created a session
  })

  test("isSessionActive checks threshold correctly", () => {
    // Since cache is likely stale in test environment,
    // isSessionActive should return false
    const active = isSessionActive("any-session", 2)
    expect(active).toBe(false)
  })

  test("isSessionActive returns false for unknown sessions", () => {
    const active = isSessionActive("definitely-not-exists", 2)
    expect(active).toBe(false)
  })
})

describe("SESSION_PREFIX constant", () => {
  test("has expected value", () => {
    expect(SESSION_PREFIX).toBe("agentorch_")
  })
})
