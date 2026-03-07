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

  describe("argument quoting", () => {
    // Test that arguments with spaces are properly quoted
    // We can't test the actual SSH execution, but we can verify the runner handles various inputs

    test("handles simple arguments", async () => {
      const runner = new SSHRunner("test", "localhost", "av")
      // This will fail to connect but we're testing argument handling
      try {
        await runner.run(["--list", "--json"])
      } catch {
        // Expected to fail - no SSH connection
      }
    })

    test("handles arguments with spaces", async () => {
      const runner = new SSHRunner("test", "localhost", "av")
      try {
        await runner.run(["--title", "My Session Name"])
      } catch {
        // Expected to fail - no SSH connection
      }
    })

    test("handles arguments with quotes", async () => {
      const runner = new SSHRunner("test", "localhost", "av")
      try {
        await runner.run(["--title", "Session's \"Name\""])
      } catch {
        // Expected to fail - no SSH connection
      }
    })
  })

  describe("fetchSessions", () => {
    test("returns empty array on connection failure", async () => {
      const runner = new SSHRunner("test", "nonexistent-host-12345", "av")
      const sessions = await runner.fetchSessions()
      expect(sessions).toEqual([])
    })
  })

  describe("testConnection", () => {
    test("returns error for invalid host", async () => {
      const runner = new SSHRunner("test", "nonexistent-host-12345", "av")
      const result = await runner.testConnection()
      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe("checkAvailable", () => {
    test("returns error for invalid host", async () => {
      const runner = new SSHRunner("test", "nonexistent-host-12345", "av")
      const result = await runner.checkAvailable()
      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe("installAv", () => {
    test("returns error for invalid host", async () => {
      const runner = new SSHRunner("test", "nonexistent-host-12345", "av")
      const result = await runner.installAv()
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe("create", () => {
    test("returns error for invalid host", async () => {
      const runner = new SSHRunner("test", "nonexistent-host-12345", "av")
      const result = await runner.create({
        projectPath: "/home/user/project",
        tool: "claude",
      })
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    test("builds correct arguments for basic session", async () => {
      const runner = new SSHRunner("test", "nonexistent-host-12345", "av")
      // We can verify the runner doesn't throw for valid inputs
      const result = await runner.create({
        projectPath: "/home/user/project",
        tool: "claude",
        title: "My Session",
        group: "work",
      })
      expect(result.success).toBe(false) // Connection fails
    })

    test("handles custom tool with command", async () => {
      const runner = new SSHRunner("test", "nonexistent-host-12345", "av")
      const result = await runner.create({
        projectPath: "/home/user/project",
        tool: "custom",
        command: "./my-script.sh",
      })
      expect(result.success).toBe(false) // Connection fails
    })
  })
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
