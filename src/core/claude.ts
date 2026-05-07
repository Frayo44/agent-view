/**
 * Claude-specific functionality
 *
 * This module handles:
 * - Session ID detection and tracking
 * - Command building
 */

import { homedir } from "os"
import path from "path"
import { readdirSync, statSync, readFileSync, existsSync } from "fs"
import type { ClaudeOptions } from "./types"

// =============================================================================
// Constants
// =============================================================================

/** UUID v4 regex pattern for validating session IDs */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Time window for considering a session "active" (5 minutes) */
const ACTIVE_SESSION_WINDOW_MS = 5 * 60 * 1000

// =============================================================================
// Path Utilities
// =============================================================================

/**
 * Get the Claude configuration directory (~/.claude)
 */
export function getClaudeConfigDir(): string {
  return path.join(homedir(), ".claude")
}

/**
 * Convert a project path to Claude's directory format.
 * Non-alphanumeric characters are replaced with hyphens.
 *
 * @example
 * convertToClaudeDirName("/Users/foo/project") // "-Users-foo-project"
 */
export function convertToClaudeDirName(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-")
}

/**
 * Get the full path to a Claude session file
 */
export function getSessionFilePath(projectPath: string, sessionId: string): string {
  const configDir = getClaudeConfigDir()
  const projectDirName = convertToClaudeDirName(projectPath)
  return path.join(configDir, "projects", projectDirName, `${sessionId}.jsonl`)
}

/**
 * Check if a session file exists
 */
export function sessionFileExists(projectPath: string, sessionId: string): boolean {
  return existsSync(getSessionFilePath(projectPath, sessionId))
}

// =============================================================================
// Session Detection
// =============================================================================

/**
 * Check if a filename is a valid UUID-formatted session file
 */
function isUuidSessionFile(filename: string): boolean {
  if (!filename.endsWith(".jsonl")) return false
  if (filename.startsWith("agent-")) return false

  const baseName = filename.replace(".jsonl", "")
  return UUID_PATTERN.test(baseName)
}

/**
 * Find the most recently modified session file in a directory.
 * Only returns sessions modified within the active window (5 minutes).
 *
 * WARNING: This returns the most recent session, not necessarily the one
 * you want. Prefer using stored session IDs from toolData when available.
 */
function findActiveSessionID(configDir: string): string | null {
  return findSessionID(configDir, { activeOnly: true })
}

/**
 * Find session files in a directory.
 *
 * @param configDir - The Claude project config directory
 * @param options.activeOnly - If true, only return sessions modified within 5 minutes
 * @returns The most recent session ID or null
 */
function findSessionID(
  configDir: string,
  options: { activeOnly?: boolean } = {}
): string | null {
  if (!existsSync(configDir)) {
    return null
  }

  try {
    const files = readdirSync(configDir)
    const cutoffTime = options.activeOnly
      ? Date.now() - ACTIVE_SESSION_WINDOW_MS
      : 0

    let mostRecent: { sessionId: string; mtime: number } | null = null

    for (const file of files) {
      if (!isUuidSessionFile(file)) continue

      const filePath = path.join(configDir, file)
      try {
        const stats = statSync(filePath)
        const mtime = stats.mtimeMs

        // Skip if activeOnly and file is too old
        if (options.activeOnly && mtime < cutoffTime) continue

        if (!mostRecent || mtime > mostRecent.mtime) {
          mostRecent = {
            sessionId: file.replace(".jsonl", ""),
            mtime
          }
        }
      } catch {
        continue
      }
    }

    return mostRecent?.sessionId ?? null
  } catch {
    return null
  }
}

/**
 * Check if a session file contains actual conversation data.
 * This helps distinguish real sessions from "zombie" sessions
 * (e.g., Claude crashed on startup before creating conversation).
 *
 * Based on agent-deck's sessionHasConversationData() approach.
 */
export function sessionHasConversationData(
  projectPath: string,
  sessionId: string
): boolean {
  const sessionFile = getSessionFilePath(projectPath, sessionId)

  if (!existsSync(sessionFile)) {
    return false
  }

  try {
    const content = readFileSync(sessionFile, "utf-8")
    // Check if file has actual conversation - look for "sessionId" field
    // which indicates Claude wrote conversation data
    return content.includes('"sessionId"')
  } catch {
    return false
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

    if (config.projects?.[projectPath]?.lastSessionId) {
      return config.projects[projectPath].lastSessionId
    }

    if (config.lastSessionId) {
      return config.lastSessionId
    }

    return null
  } catch {
    return null
  }
}

/**
 * Find the most recently active Claude session ID for a project.
 *
 * WARNING: This uses file system detection and returns the most recent session,
 * which may not be the session you want when multiple sessions exist for the
 * same project.
 *
 * @returns Session ID or null if no active session found
 */
export function getClaudeSessionID(projectPath: string): string | null {
  const configDir = getClaudeConfigDir()
  const projectDirName = convertToClaudeDirName(projectPath)
  const projectConfigDir = path.join(configDir, "projects", projectDirName)

  const sessionId = findActiveSessionID(projectConfigDir)
  if (sessionId) {
    return sessionId
  }

  return getLastSessionIdFromConfig(projectPath)
}

// =============================================================================
// Command Building
// =============================================================================

/**
 * Build the Claude command based on options.
 *
 * @param options - Claude session options
 * @returns Command string (e.g., "claude", "claude --resume", etc.)
 */
export function buildClaudeCommand(options?: ClaudeOptions): string {
  const parts: string[] = ["claude"]

  if (options?.sessionMode === "resume") {
    parts.push("--resume")
  }

  if (options?.skipPermissions) {
    parts.push("--dangerously-skip-permissions")
  }

  return parts.join(" ")
}

// =============================================================================
// Session Info
// =============================================================================

/**
 * Session information for display purposes
 */
export interface ClaudeSessionInfo {
  sessionId: string
  projectPath: string
  lastModified: Date
}

/**
 * Get session info for display purposes
 */
export function getClaudeSessionInfo(projectPath: string): ClaudeSessionInfo | null {
  const sessionId = getClaudeSessionID(projectPath)
  if (!sessionId) return null

  const sessionFile = getSessionFilePath(projectPath, sessionId)

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
