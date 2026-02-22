/**
 * Claude-specific functionality
 *
 * This module handles:
 * - Session ID detection and tracking
 * - Fork command building
 * - Session file management for worktree forks
 */

import { homedir } from "os"
import path from "path"
import { readdirSync, statSync, readFileSync, existsSync, mkdirSync, copyFileSync } from "fs"
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
  if (!existsSync(configDir)) {
    return null
  }

  try {
    const files = readdirSync(configDir)
    const cutoffTime = Date.now() - ACTIVE_SESSION_WINDOW_MS

    let mostRecent: { sessionId: string; mtime: number } | null = null

    for (const file of files) {
      if (!isUuidSessionFile(file)) continue

      const filePath = path.join(configDir, file)
      try {
        const stats = statSync(filePath)
        const mtime = stats.mtimeMs
        if (mtime < cutoffTime) continue

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
 * same project. Prefer using stored session IDs from session.toolData when
 * forking a specific session.
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
// Fork Operations
// =============================================================================

/**
 * Check if a session can be forked (has an active Claude session).
 * This is a basic check - prefer checking session.toolData.claudeSessionId directly.
 */
export async function canFork(projectPath: string): Promise<boolean> {
  const sessionId = getClaudeSessionID(projectPath)
  return sessionId !== null
}

/**
 * Options for building a fork command
 */
export interface ForkCommandOptions {
  /** Working directory for the forked session */
  projectPath: string
  /** Claude session ID to fork from (the parent conversation) */
  parentSessionId: string
  /** New session ID for the forked session (must be pre-generated) */
  newSessionId: string
}

/**
 * Build the shell command to fork a Claude session.
 *
 * The command:
 * 1. Changes to the project directory
 * 2. Sets CLAUDE_SESSION_ID in tmux environment for tracking
 * 3. Runs claude with --session-id, --resume, and --fork-session flags
 *
 * IMPORTANT: The newSessionId must be the same UUID that is stored in
 * the session's toolData. If a different UUID is used, the fork will
 * fail with "No conversation found" because Claude won't find a session
 * matching the stored ID.
 */
export function buildForkCommand(options: ForkCommandOptions): string {
  // Escape single quotes for shell safety
  const escapedPath = options.projectPath.replace(/'/g, "'\\''")

  // Build the command:
  // - cd to project directory
  // - set tmux env var for session tracking
  // - run claude with fork flags using the PRE-GENERATED session ID
  return (
    `cd '${escapedPath}' && ` +
    `tmux set-environment CLAUDE_SESSION_ID "${options.newSessionId}"; ` +
    `claude --session-id "${options.newSessionId}" --resume ${options.parentSessionId} --fork-session`
  )
}

/**
 * Copy a Claude session file from one project to another.
 *
 * This is required when forking to a git worktree because Claude stores
 * sessions per-project-path. When the worktree has a different path,
 * Claude won't find the parent session unless we copy it.
 *
 * @param sessionId - The Claude session ID to copy
 * @param sourceProjectPath - Original project path where session exists
 * @param targetProjectPath - Worktree path where session should be copied
 * @returns true if copy succeeded, false otherwise
 */
export function copySessionToProject(
  sessionId: string,
  sourceProjectPath: string,
  targetProjectPath: string
): boolean {
  const configDir = getClaudeConfigDir()
  const sourceDirName = convertToClaudeDirName(sourceProjectPath)
  const targetDirName = convertToClaudeDirName(targetProjectPath)

  const sourceFile = path.join(configDir, "projects", sourceDirName, `${sessionId}.jsonl`)
  const targetDir = path.join(configDir, "projects", targetDirName)
  const targetFile = path.join(targetDir, `${sessionId}.jsonl`)

  if (!existsSync(sourceFile)) {
    return false
  }

  try {
    // Create target directory if it doesn't exist
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true })
    }

    // Copy the session file
    copyFileSync(sourceFile, targetFile)
    return true
  } catch {
    return false
  }
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
