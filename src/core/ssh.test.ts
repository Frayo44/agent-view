import { describe, test, expect } from "bun:test"

import { SSHRunner } from "./ssh"

describe("SSHRunner", () => {
  describe("constructor", () => {
    test("creates runner with required parameters", () => {
      const runner = new SSHRunner("myremote", "user@host")
      expect(runner).toBeDefined()
    })

    test("creates runner with custom av path", () => {
      const runner = new SSHRunner("myremote", "user@host", "/custom/path/av")
      expect(runner).toBeDefined()
    })
  })

  // Note: SSH connection tests removed - they're slow, flaky, and potentially unsafe
  // (could connect to real hosts if the fake hostname happens to exist)
})

describe("isRemoteSession type guard", () => {
  // Import the type guard
  const { isRemoteSession } = require("./types")

  test("returns true for remote session", () => {
    const remoteSession = {
      id: "123",
      title: "Test",
      projectPath: "/path",
      tool: "claude",
      status: "running",
      groupPath: "@remote/group",
      createdAt: new Date(),
      lastAccessed: new Date(),
      acknowledged: true,
      remoteName: "myremote",
      remoteHost: "user@host",
    }
    expect(isRemoteSession(remoteSession)).toBe(true)
  })

  test("returns false for local session", () => {
    const localSession = {
      id: "123",
      title: "Test",
      projectPath: "/path",
      tool: "claude",
      status: "running",
      groupPath: "default",
      createdAt: new Date(),
      lastAccessed: new Date(),
      acknowledged: true,
    }
    expect(isRemoteSession(localSession)).toBe(false)
  })
})
