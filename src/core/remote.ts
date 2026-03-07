/**
 * Remote session manager
 * Coordinates fetching and managing sessions across multiple remote hosts
 */

import { getLastRemoteSession } from "./config"
import { SSHRunner } from "./ssh"
import type { RemoteSession } from "./types"
import path from "path"
import os from "os"
import fs from "fs"

const logFile = path.join(os.homedir(), ".agent-orchestrator", "debug.log")
function log(...args: unknown[]) {
  const msg = `[${new Date().toISOString()}] [REMOTE] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}\n`
  try { fs.appendFileSync(logFile, msg) } catch {}
}

export class RemoteManager {
  private runners: Map<string, SSHRunner> = new Map()
  private cachedSessions: RemoteSession[] = []
  private lastFetchTime: number = 0
  private fetchPromise: Promise<RemoteSession[]> | null = null

  /**
   * Get SSH runners for known remote hosts
   */
  getRunners(): SSHRunner[] {
    const runners: SSHRunner[] = []

    // Only use last session host if available
    const lastSession = getLastRemoteSession()
    if (lastSession) {
      const runner = new SSHRunner(lastSession.host, lastSession.host, lastSession.avPath)
      this.runners.set(lastSession.host, runner)
      runners.push(runner)
    }

    return runners
  }

  /**
   * Get runner for a specific host
   */
  getRunner(host: string): SSHRunner | null {
    // Check last remote session for avPath
    const lastSession = getLastRemoteSession()
    const avPath = (lastSession && lastSession.host === host) ? lastSession.avPath : "av"

    const runner = new SSHRunner(host, host, avPath)
    this.runners.set(host, runner)
    return runner
  }

  /**
   * Fetch sessions from known remote hosts
   * Uses caching to avoid excessive SSH connections
   */
  async fetchAllSessions(forceRefresh = false): Promise<RemoteSession[]> {
    const runners = this.getRunners()

    // No known remote hosts
    if (runners.length === 0) {
      this.cachedSessions = []
      return []
    }

    // Return cached if recent and not forced
    const now = Date.now()
    const cacheAge = now - this.lastFetchTime
    if (!forceRefresh && cacheAge < 5000 && this.cachedSessions.length > 0) {
      return this.cachedSessions
    }

    // Deduplicate concurrent fetches
    if (this.fetchPromise) {
      return this.fetchPromise
    }

    this.fetchPromise = this.doFetchAll()

    try {
      const sessions = await this.fetchPromise
      this.cachedSessions = sessions
      this.lastFetchTime = Date.now()
      return sessions
    } finally {
      this.fetchPromise = null
    }
  }

  private async doFetchAll(): Promise<RemoteSession[]> {
    const runners = this.getRunners()

    if (runners.length === 0) {
      return []
    }

    log(`Fetching sessions from ${runners.length} remotes`)

    // Fetch from all remotes in parallel with timeout
    const results = await Promise.allSettled(
      runners.map(async (runner) => {
        try {
          return await runner.fetchSessions()
        } catch (err: any) {
          log(`Failed to fetch from remote: ${err.message}`)
          return [] as RemoteSession[]
        }
      })
    )

    // Collect all successful results
    const allSessions: RemoteSession[] = []
    for (const result of results) {
      if (result.status === "fulfilled") {
        allSessions.push(...result.value)
      }
    }

    log(`Fetched ${allSessions.length} remote sessions`)
    return allSessions
  }

  /**
   * Get cached sessions without triggering a fetch
   */
  getCachedSessions(): RemoteSession[] {
    return this.cachedSessions
  }

  /**
   * Clear the session cache
   */
  clearCache(): void {
    this.cachedSessions = []
    this.lastFetchTime = 0
  }

  /**
   * Stop a remote session
   */
  async stopSession(session: RemoteSession): Promise<void> {
    const runner = this.getRunner(session.remoteName)
    if (!runner) {
      throw new Error(`Remote "${session.remoteName}" not found`)
    }
    await runner.stop(session.id)
    this.clearCache()
  }

  /**
   * Restart a remote session
   */
  async restartSession(session: RemoteSession): Promise<void> {
    const runner = this.getRunner(session.remoteName)
    if (!runner) {
      throw new Error(`Remote "${session.remoteName}" not found`)
    }
    await runner.restart(session.id)
    this.clearCache()
  }

  /**
   * Delete a remote session
   */
  async deleteSession(session: RemoteSession): Promise<void> {
    const runner = this.getRunner(session.remoteName)
    if (!runner) {
      throw new Error(`Remote "${session.remoteName}" not found`)
    }
    await runner.delete(session.id)
    this.clearCache()
  }

  /**
   * Hibernate a remote session
   */
  async hibernateSession(session: RemoteSession): Promise<void> {
    const runner = this.getRunner(session.remoteName)
    if (!runner) {
      throw new Error(`Remote "${session.remoteName}" not found`)
    }
    await runner.hibernate(session.id)
    this.clearCache()
  }

  /**
   * Resume a remote session
   */
  async resumeSession(session: RemoteSession): Promise<void> {
    const runner = this.getRunner(session.remoteName)
    if (!runner) {
      throw new Error(`Remote "${session.remoteName}" not found`)
    }
    await runner.resume(session.id)
    this.clearCache()
  }

  /**
   * Attach to a remote session
   * Returns true if Ctrl+L (session list) was requested
   */
  attachSession(session: RemoteSession): boolean {
    const runner = this.getRunner(session.remoteName)
    if (!runner) {
      throw new Error(`Remote "${session.remoteName}" not found`)
    }
    return runner.attachSync(session.id)
  }

  /**
   * Create a new session on a remote host
   */
  async createSession(remoteName: string, options: {
    title?: string
    projectPath: string
    tool: string
    group?: string
    command?: string
  }): Promise<{ success: boolean; error?: string }> {
    const runner = this.getRunner(remoteName)
    if (!runner) {
      return { success: false, error: `Remote "${remoteName}" not found` }
    }

    const result = await runner.create(options)
    if (result.success) {
      this.clearCache()
    }
    return result
  }

  /**
   * Test connectivity to all remotes
   */
  async testAllConnections(): Promise<Map<string, { ok: boolean; error?: string }>> {
    const runners = this.getRunners()
    const results = new Map<string, { ok: boolean; error?: string }>()

    await Promise.allSettled(
      runners.map(async (runner) => {
        const name = runner["name"]
        const result = await runner.testConnection()
        results.set(name, result)
      })
    )

    return results
  }
}

// Singleton instance
let remoteManager: RemoteManager | null = null

export function getRemoteManager(): RemoteManager {
  if (!remoteManager) {
    remoteManager = new RemoteManager()
  }
  return remoteManager
}
