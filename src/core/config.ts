/**
 * Configuration loader for agent-view
 * Reads from ~/.agent-view/config.json
 */

import * as path from "path"
import * as os from "os"
import * as fs from "fs/promises"
import { sanitizeTool, type Shortcut, type Recent } from "./types"

export interface WorktreeConfig {
  defaultBaseBranch?: string
  autoCleanup?: boolean
}

export interface LastRemoteSession {
  host: string
  avPath: string
  tool: string
  projectPath: string
}

export interface AppConfig {
  theme?: string
  worktree?: WorktreeConfig
  defaultGroup?: string
  shortcuts?: Shortcut[]
  recents?: Recent[]
  autoHibernateMinutes?: number   // 0 = disabled, default 0
  autoHibernatePrompted?: boolean // true = user has seen the prompt
  notifications?: boolean         // OS notifications when agents finish/need input, default true
  lastRemoteSession?: LastRemoteSession   // Last used remote session values
}

const CONFIG_DIR = path.join(os.homedir(), ".agent-view")
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json")

const DEFAULT_CONFIG: AppConfig = {
  theme: "dark",
  worktree: {
    defaultBaseBranch: "main",
    autoCleanup: true
  },
  defaultGroup: "default",
  shortcuts: [],
  recents: [],
  notifications: true
}

// Cached config for sync access
let cachedConfig: AppConfig = { ...DEFAULT_CONFIG }

export async function ensureConfigDir(): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true })
  } catch (err) {
    // Directory might already exist
  }
}

/**
 * Load configuration from disk, merging with defaults
 */
export async function loadConfig(): Promise<AppConfig> {
  try {
    const content = await fs.readFile(CONFIG_PATH, "utf-8")
    const parsed = JSON.parse(content) as Partial<AppConfig> & { defaultTool?: unknown }
    // Legacy key from the multi-tool era; ignore it
    delete parsed.defaultTool

    cachedConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      worktree: {
        ...DEFAULT_CONFIG.worktree,
        ...parsed.worktree
      },
      // Shortcuts array is replaced entirely, not merged with defaults.
      // Tool values are sanitized so entries from the multi-tool era still work.
      shortcuts: (parsed.shortcuts || []).map(s => ({ ...s, tool: sanitizeTool(s.tool) })),
      recents: (parsed.recents || []).map(r => ({ ...r, tool: sanitizeTool(r.tool) })),
      lastRemoteSession: parsed.lastRemoteSession
        ? { ...parsed.lastRemoteSession, tool: sanitizeTool(parsed.lastRemoteSession.tool) }
        : undefined
    }

    return cachedConfig
  } catch (err: any) {
    if (err.code === "ENOENT") {
      cachedConfig = { ...DEFAULT_CONFIG }
      return cachedConfig
    }

    console.warn(`Warning: Failed to load config from ${CONFIG_PATH}: ${err.message}`)
    cachedConfig = { ...DEFAULT_CONFIG }
    return cachedConfig
  }
}

/**
 * Get shortcuts from the cached config
 */
export function getShortcuts(): Shortcut[] {
  return cachedConfig.shortcuts || []
}

/**
 * Get recents from the cached config
 */
export function getRecents(): Recent[] {
  return cachedConfig.recents || []
}

/**
 * Get last remote session values
 */
export function getLastRemoteSession(): LastRemoteSession | undefined {
  return cachedConfig.lastRemoteSession
}

/**
 * Save last remote session values
 */
export async function saveLastRemoteSession(session: LastRemoteSession): Promise<void> {
  const config = await loadConfig()
  await saveConfig({ ...config, lastRemoteSession: session })
}

/**
 * Get the cached config synchronously
 * Call loadConfig() first to ensure config is loaded
 */
export function getConfig(): AppConfig {
  return cachedConfig
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await ensureConfigDir()
  const content = JSON.stringify(config, null, 2)
  await fs.writeFile(CONFIG_PATH, content, "utf-8")
  cachedConfig = config
}

export function getConfigDir(): string {
  return CONFIG_DIR
}

export function getConfigPath(): string {
  return CONFIG_PATH
}

/**
 * Get default config (for reference)
 */
export function getDefaultConfig(): AppConfig {
  return { ...DEFAULT_CONFIG }
}
