/**
 * SSH runner for executing commands on remote hosts
 * Manages agent-view sessions on remote machines via SSH
 */

import { spawn } from "child_process"
import { promisify } from "util"
import { exec, execFile } from "child_process"
import path from "path"
import os from "os"
import fs from "fs"
import type { Session, RemoteSession, SessionStatus, Tool } from "./types"

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

// SSH ControlMaster settings for connection reuse
const SSH_CONTROL_DIR = "/tmp/agent-view-ssh"
const SSH_CONTROL_PERSIST = 600 // seconds
const SSH_TIMEOUT = 10 // seconds

const logFile = path.join(os.homedir(), ".agent-orchestrator", "debug.log")
function log(...args: unknown[]) {
  const msg = `[${new Date().toISOString()}] [SSH] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}\n`
  try { fs.appendFileSync(logFile, msg) } catch {}
}

/**
 * Ensure the SSH control directory exists
 */
function ensureControlDir(): void {
  try {
    if (!fs.existsSync(SSH_CONTROL_DIR)) {
      fs.mkdirSync(SSH_CONTROL_DIR, { recursive: true, mode: 0o700 })
    }
  } catch {
    // Ignore errors - connection will work without ControlMaster
  }
}

/**
 * Build SSH options for connection reuse
 */
function sshOptions(host: string): string[] {
  ensureControlDir()
  return [
    "-o", "ControlMaster=auto",
    "-o", `ControlPath=${SSH_CONTROL_DIR}/%r@%h:%p`,
    "-o", `ControlPersist=${SSH_CONTROL_PERSIST}`,
    "-o", "BatchMode=yes",
    "-o", `ConnectTimeout=${SSH_TIMEOUT}`,
    "-o", "StrictHostKeyChecking=accept-new",
  ]
}

export class SSHRunner {
  constructor(
    private name: string,
    private host: string,
    private avPath: string = "av"
  ) {}

  /**
   * Execute an av command on the remote host
   */
  async run(args: string[]): Promise<string> {
    // Build the remote command as a single quoted string
    // This preserves arguments with spaces when passed through SSH
    const quotedArgs = args.map(arg => {
      // If arg contains spaces or special chars, quote it
      if (arg.includes(" ") || arg.includes("'") || arg.includes('"')) {
        // Escape single quotes and wrap in single quotes
        return `'${arg.replace(/'/g, "'\\''")}'`
      }
      return arg
    })
    const remoteCommand = `${this.avPath} ${quotedArgs.join(" ")}`

    const sshArgs = [
      ...sshOptions(this.host),
      this.host,
      remoteCommand
    ]

    log(`Running SSH command: ssh ${sshArgs.join(" ")}`)

    try {
      const { stdout, stderr } = await execFileAsync("ssh", sshArgs, {
        timeout: SSH_TIMEOUT * 1000,
        maxBuffer: 10 * 1024 * 1024 // 10MB
      })

      if (stderr) {
        log(`SSH stderr: ${stderr}`)
      }

      return stdout
    } catch (err: any) {
      log(`SSH error: ${err.message}`)
      throw new Error(`SSH to ${this.name}: ${err.message}`)
    }
  }

  /**
   * Fetch sessions from remote via `av --list --json`
   */
  async fetchSessions(): Promise<RemoteSession[]> {
    try {
      const output = await this.run(["--list", "--json"])

      if (!output.trim()) {
        return []
      }

      const sessions = JSON.parse(output) as Session[]

      return sessions.map(s => ({
        ...s,
        // Parse dates from JSON
        createdAt: new Date(s.createdAt),
        lastAccessed: new Date(s.lastAccessed),
        // Add remote metadata
        remoteName: this.name,
        remoteHost: this.host,
        // Prefix group path with remote name for display
        groupPath: `@${this.name}/${s.groupPath}`
      }))
    } catch (err: any) {
      log(`Failed to fetch sessions from ${this.name}: ${err.message}`)
      return []
    }
  }

  /**
   * Attach to a remote session interactively via SSH
   */
  attach(sessionId: string): void {
    log(`Attaching to remote session ${sessionId} on ${this.name}`)

    // Exit alternate screen buffer before attaching
    process.stdout.write("\x1b[?1049l")
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H")
    process.stdout.write("\x1b[?25h")

    const sshArgs = [
      "-t", // Force TTY allocation
      "-o", `ConnectTimeout=${SSH_TIMEOUT}`,
      "-o", "StrictHostKeyChecking=accept-new",
      this.host,
      this.avPath,
      "--attach",
      sessionId
    ]

    const child = spawn("ssh", sshArgs, {
      stdio: "inherit",
      env: process.env
    })

    child.on("exit", () => {
      // Clear screen and re-enter alternate buffer for TUI
      process.stdout.write("\x1b[2J\x1b[3J\x1b[H")
      process.stdout.write("\x1b[?1049h")
      process.stdout.write("\x1b]0;Agent View\x07")
    })
  }

  /**
   * Attach synchronously (blocks until detach)
   * Returns true if Ctrl+L (session list) was requested
   */
  attachSync(sessionId: string): boolean {
    log(`Attaching sync to remote session ${sessionId} on ${this.name}`)
    const { spawnSync } = require("child_process")

    // Exit alternate screen buffer
    process.stdout.write("\x1b[?1049l")
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H")
    process.stdout.write("\x1b[?25h")

    const sshArgs = [
      "-t",
      "-o", `ConnectTimeout=${SSH_TIMEOUT}`,
      "-o", "StrictHostKeyChecking=accept-new",
      this.host,
      this.avPath,
      "--attach",
      sessionId
    ]

    spawnSync("ssh", sshArgs, {
      stdio: "inherit",
      env: process.env
    })

    // Check if Ctrl+L was pressed on remote by checking signal file
    let sessionListRequested = false
    try {
      const checkResult = spawnSync("ssh", [
        ...sshOptions(this.host),
        this.host,
        "test -f /tmp/agent-view-session-list && rm /tmp/agent-view-session-list && echo yes"
      ], { encoding: "utf-8", timeout: 5000 })
      sessionListRequested = checkResult.stdout?.trim() === "yes"
    } catch {
      // Ignore errors
    }

    // Clear screen and re-enter alternate buffer for TUI
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H")
    process.stdout.write("\x1b[?1049h")
    process.stdout.write("\x1b]0;Agent View\x07")

    return sessionListRequested
  }

  /**
   * Stop a remote session
   */
  async stop(sessionId: string): Promise<void> {
    await this.run(["--stop", sessionId])
  }

  /**
   * Restart a remote session
   */
  async restart(sessionId: string): Promise<void> {
    await this.run(["--restart", sessionId])
  }

  /**
   * Delete a remote session (with --force to skip confirmation)
   */
  async delete(sessionId: string): Promise<void> {
    await this.run(["--delete", sessionId, "--force"])
  }

  /**
   * Hibernate a remote session (Claude only)
   */
  async hibernate(sessionId: string): Promise<void> {
    await this.run(["--hibernate", sessionId])
  }

  /**
   * Resume a remote session (Claude only) - uses 'wake' CLI command
   */
  async resume(sessionId: string): Promise<void> {
    await this.run(["--wake", sessionId])
  }

  /**
   * Test SSH connectivity to the remote host
   */
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const sshArgs = [
        ...sshOptions(this.host),
        this.host,
        "echo", "ok"
      ]

      await execFileAsync("ssh", sshArgs, {
        timeout: SSH_TIMEOUT * 1000
      })

      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  }

  /**
   * Check if av is available on the remote host
   * Checks configured path first, then default install location
   */
  async checkAvailable(): Promise<{ ok: boolean; version?: string; path?: string; error?: string }> {
    // First try the configured avPath
    try {
      const output = await this.run(["-v"])
      const version = output.trim()
      return { ok: true, version, path: this.avPath }
    } catch {
      // Configured path failed, try default install location
    }

    // Try default install path
    const defaultPath = "~/.agent-view/bin/av"
    if (this.avPath !== defaultPath) {
      try {
        const sshArgs = [
          ...sshOptions(this.host),
          this.host,
          `${defaultPath} -v`
        ]
        const { stdout } = await execFileAsync("ssh", sshArgs, {
          timeout: SSH_TIMEOUT * 1000
        })
        const version = stdout.trim()
        return { ok: true, version, path: defaultPath }
      } catch {
        // Default path also failed
      }
    }

    return { ok: false, error: "av not found on remote" }
  }

  /**
   * Install av on the remote host using the install script
   */
  async installAv(): Promise<{ success: boolean; error?: string }> {
    try {
      // Don't use BatchMode for install - it needs to run curl | bash
      const sshArgs = [
        "-o", `ConnectTimeout=${SSH_TIMEOUT}`,
        "-o", "StrictHostKeyChecking=accept-new",
        this.host,
        "curl -fsSL https://raw.githubusercontent.com/frayo44/agent-view/main/install.sh | bash"
      ]

      log(`Installing av on remote: ssh ${sshArgs.join(" ")}`)

      const { stdout, stderr } = await execFileAsync("ssh", sshArgs, {
        timeout: 180000, // 3 minutes for install
        maxBuffer: 10 * 1024 * 1024
      })

      log(`Install stdout: ${stdout}`)
      if (stderr) {
        log(`Install stderr: ${stderr}`)
      }

      return { success: true }
    } catch (err: any) {
      log(`Install error: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  /**
   * Create a new session on the remote host
   */
  async create(options: {
    title?: string
    projectPath: string
    tool: string
    group?: string
    command?: string
  }): Promise<{ success: boolean; error?: string }> {
    const args = ["--new", "--path", options.projectPath, "--tool", options.tool]

    if (options.title) {
      args.push("--title", options.title)
    }
    if (options.group) {
      args.push("--group", options.group)
    }
    if (options.command && options.tool === "custom") {
      args.push("--command", options.command)
    }

    try {
      await this.run(args)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }
}
