/**
 * Configuration loader for agent-view
 * Reads from ~/.agent-view/config.json
 */

import * as path from "path"
import * as os from "os"
import * as fs from "fs/promises"
import type { Tool, Shortcut } from "./types"

export interface WorktreeConfig {
  defaultBaseBranch?: string
  autoCleanup?: boolean
}

export interface AppConfig {
  defaultTool?: Tool
  theme?: string
  worktree?: WorktreeConfig
  defaultGroup?: string
  shortcuts?: Shortcut[]
}

const CONFIG_DIR = path.join(os.homedir(), ".agent-view")
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json")

const DEFAULT_CONFIG: AppConfig = {
  defaultTool: "claude",
  theme: "dark",
  worktree: {
    defaultBaseBranch: "main",
    autoCleanup: true
  },
  defaultGroup: "default",
  shortcuts: []
}

// Cached config for sync access
let cachedConfig: AppConfig = { ...DEFAULT_CONFIG }

/**
 * Ensure the config directory exists
 */
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
    const parsed = JSON.parse(content) as Partial<AppConfig>

    // Deep merge with defaults
    cachedConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      worktree: {
        ...DEFAULT_CONFIG.worktree,
        ...parsed.worktree
      },
      // Shortcuts array is taken from config directly (no merge with defaults)
      shortcuts: parsed.shortcuts || []
    }

    return cachedConfig
  } catch (err: any) {
    if (err.code === "ENOENT") {
      // Config file doesn't exist, use defaults
      cachedConfig = { ...DEFAULT_CONFIG }
      return cachedConfig
    }

    // Invalid JSON or other error - log warning and use defaults
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
 * Get the cached config synchronously
 * Call loadConfig() first to ensure config is loaded
 */
export function getConfig(): AppConfig {
  return cachedConfig
}

/**
 * Save configuration to disk
 */
export async function saveConfig(config: AppConfig): Promise<void> {
  await ensureConfigDir()
  const content = JSON.stringify(config, null, 2)
  await fs.writeFile(CONFIG_PATH, content, "utf-8")
  cachedConfig = config
}

/**
 * Get the config directory path
 */
export function getConfigDir(): string {
  return CONFIG_DIR
}

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  return CONFIG_PATH
}

/**
 * Get default config (for reference)
 */
export function getDefaultConfig(): AppConfig {
  return { ...DEFAULT_CONFIG }
}
