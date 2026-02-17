/**
 * Claude-specific functionality
 * Session ID detection and fork command building
 */

import { homedir } from "os"
import path from "path"
import { readdirSync, statSync, readFileSync, existsSync } from "fs"

// UUID regex pattern (v4 format)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Get the Claude config directory
 */
export function getClaudeConfigDir(): string {
  return path.join(homedir(), ".claude")
}

/**
 * Convert a project path to Claude's directory format
 * Non-alphanumeric characters are replaced with hyphens
 * Example: /Users/foo/project -> -Users-foo-project
 */
export function convertToClaudeDirName(projectPath: string): string {
  // Replace all non-alphanumeric with hyphens (including leading /)
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-")
}

/**
 * Check if a filename is a UUID-formatted session file
 */
function isUuidSessionFile(filename: string): boolean {
  if (!filename.endsWith(".jsonl")) return false

  // Exclude agent-*.jsonl files
  if (filename.startsWith("agent-")) return false

  const baseName = filename.replace(".jsonl", "")
  return UUID_PATTERN.test(baseName)
}

/**
 * Find the most recently active Claude session ID for a project
 * Returns null if no active session found
 */
export function getClaudeSessionID(projectPath: string): string | null {
  const configDir = getClaudeConfigDir()
  const projectDirName = convertToClaudeDirName(projectPath)
  const projectConfigDir = path.join(configDir, "projects", projectDirName)

  // Try to find active session from project directory
  const sessionId = findActiveSessionID(projectConfigDir)
  if (sessionId) {
    return sessionId
  }

  // Fall back to lastSessionId from .claude.json
  return getLastSessionIdFromConfig(projectPath)
}

/**
 * Find the most recently modified session file in a directory
 * Only returns sessions modified within the last 5 minutes
 */
function findActiveSessionID(configDir: string): string | null {
  if (!existsSync(configDir)) {
    return null
  }

  try {
    const files = readdirSync(configDir)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000)

    let mostRecent: { sessionId: string; mtime: number } | null = null

    for (const file of files) {
      if (!isUuidSessionFile(file)) continue

      const filePath = path.join(configDir, file)
      try {
        const stats = statSync(filePath)
        const mtime = stats.mtimeMs

        // Only consider files modified within 5 minutes
        if (mtime < fiveMinutesAgo) continue

        if (!mostRecent || mtime > mostRecent.mtime) {
          mostRecent = {
            sessionId: file.replace(".jsonl", ""),
            mtime
          }
        }
      } catch {
        // Skip files we can't stat
        continue
      }
    }

    return mostRecent?.sessionId ?? null
  } catch {
    return null
  }
}

/**
 * Get the lastSessionId from .claude.json for a specific project
 */
function getLastSessionIdFromConfig(projectPath: string): string | null {
  const configDir = getClaudeConfigDir()
  const configFile = path.join(configDir, ".claude.json")

  if (!existsSync(configFile)) {
    return null
  }

  try {
    const content = readFileSync(configFile, "utf-8")
    const config = JSON.parse(content)

    // The config may have project-specific sessions
    // Check if there's a lastSessionId for this project
    if (config.projects?.[projectPath]?.lastSessionId) {
      return config.projects[projectPath].lastSessionId
    }

    // Fall back to global lastSessionId
    if (config.lastSessionId) {
      return config.lastSessionId
    }

    return null
  } catch {
    return null
  }
}

/**
 * Check if a session can be forked (has an active Claude session)
 */
export async function canFork(projectPath: string): Promise<boolean> {
  const sessionId = getClaudeSessionID(projectPath)
  return sessionId !== null
}

/**
 * Build the fork command for Claude with --resume and --fork-session flags
 */
export function buildForkCommand(options: {
  projectPath: string
  parentSessionId: string
  newSessionId: string
}): string {
  // Build the command with proper escaping
  const escapedPath = options.projectPath.replace(/'/g, "'\\''")

  return `cd '${escapedPath}' && ` +
    `session_id=$(uuidgen | tr '[:upper:]' '[:lower:]'); ` +
    `tmux set-environment CLAUDE_SESSION_ID "$session_id"; ` +
    `claude --session-id "$session_id" --resume ${options.parentSessionId} --fork-session`
}

/**
 * Get session info for display purposes
 */
export interface ClaudeSessionInfo {
  sessionId: string
  projectPath: string
  lastModified: Date
}

import type { ClaudeOptions } from "./types"

/**
 * Build the Claude command based on options
 * - "new" mode: returns plain "claude"
 * - "resume" mode: returns "claude --resume" (Claude will prompt for session selection)
 */
export function buildClaudeCommand(options?: ClaudeOptions): string {
  if (!options || options.sessionMode === "new") {
    return "claude"
  }

  if (options.sessionMode === "resume") {
    return "claude --resume"
  }

  return "claude"
}

/**
 * Get information about the current Claude session for a project
 */
export function getClaudeSessionInfo(projectPath: string): ClaudeSessionInfo | null {
  const sessionId = getClaudeSessionID(projectPath)
  if (!sessionId) return null

  const configDir = getClaudeConfigDir()
  const projectDirName = convertToClaudeDirName(projectPath)
  const sessionFile = path.join(configDir, "projects", projectDirName, `${sessionId}.jsonl`)

  try {
    if (existsSync(sessionFile)) {
      const stats = statSync(sessionFile)
      return {
        sessionId,
        projectPath,
        lastModified: stats.mtime
      }
    }
  } catch {
    // Ignore errors
  }

  return {
    sessionId,
    projectPath,
    lastModified: new Date()
  }
}
