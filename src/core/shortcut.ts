/**
 * Shortcut execution module
 * Handles creating sessions from shortcut configurations
 */

import type { Shortcut, Session, SessionCreateOptions, Group } from "./types"
import { getSessionManager } from "./session"
import { getStorage } from "./storage"

/**
 * Sanitize a group path - remove invalid characters and normalize
 */
function sanitizeGroupPath(groupPath: string): string {
  return groupPath
    .replace(/^[./]+|[./]+$/g, "") // Remove leading/trailing dots and slashes
    .replace(/\.\./g, "")          // Remove parent directory traversal
    .replace(/[^a-zA-Z0-9-_/]/g, "-") // Replace invalid chars with dash
    .replace(/-+/g, "-")           // Collapse multiple dashes
    .replace(/^-|-$/g, "")         // Remove leading/trailing dashes
    .toLowerCase() || "shortcuts"  // Fallback if empty
}

/**
 * Ensure a group exists, creating it if necessary
 */
function ensureGroup(groupPath: string): void {
  const storage = getStorage()
  const groups = storage.loadGroups()

  const sanitizedPath = sanitizeGroupPath(groupPath)
  const exists = groups.some(g => g.path === sanitizedPath)

  if (!exists) {
    const newGroup: Group = {
      path: sanitizedPath,
      name: groupPath, // Use original name for display
      expanded: true,
      order: groups.length,
      defaultPath: ""
    }
    storage.saveGroups([...groups, newGroup])
  }
}

export interface ExecuteShortcutOptions {
  shortcut: Shortcut
}

/**
 * Execute a shortcut by creating a session with its configuration
 */
export async function executeShortcut(options: ExecuteShortcutOptions): Promise<Session> {
  const { shortcut } = options
  const manager = getSessionManager()

  const groupPath = sanitizeGroupPath(shortcut.groupPath)
  ensureGroup(shortcut.groupPath)

  const createOptions: SessionCreateOptions = {
    title: shortcut.name,
    projectPath: shortcut.projectPath,
    groupPath,
    tool: shortcut.tool,
    command: shortcut.command
  }

  const session = await manager.create(createOptions)

  return session
}

/**
 * Get the sanitized group path for a shortcut
 */
export function getShortcutGroupPath(shortcut: Shortcut): string {
  return sanitizeGroupPath(shortcut.groupPath)
}
