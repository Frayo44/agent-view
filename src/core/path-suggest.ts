/**
 * Filesystem-backed path suggestions for TUI inputs.
 */

import fs from "fs"
import path from "path"

export interface PathSuggestionOptions {
  cwd?: string
  home?: string
  limit?: number
}

type InputMode = "home" | "absolute" | "relative"

function detectMode(input: string): InputMode {
  if (input.startsWith("~")) return "home"
  if (path.isAbsolute(input)) return "absolute"
  return "relative"
}

function resolveInputPath(input: string, cwd: string, home: string): string {
  if (!input) return cwd

  if (input.startsWith("~")) {
    if (input === "~") return home
    if (input.startsWith("~/")) return path.join(home, input.slice(2))
    // Keep behavior consistent with existing path expansion in dialogs.
    return path.join(home, input.slice(1))
  }

  if (path.isAbsolute(input)) {
    return input
  }

  return path.resolve(cwd, input)
}

function formatSuggestion(absPath: string, mode: InputMode, cwd: string, home: string): string {
  let display: string

  if (mode === "home") {
    display = absPath.startsWith(home) ? `~${absPath.slice(home.length)}` : absPath
  } else if (mode === "absolute") {
    display = absPath
  } else {
    display = path.relative(cwd, absPath) || "."
  }

  return display.endsWith("/") ? display : `${display}/`
}

/**
 * Return directory suggestions based on the typed path prefix.
 * Suggestions are generated from the filesystem (not history).
 */
export function getDirectorySuggestions(input: string, options: PathSuggestionOptions = {}): string[] {
  const cwd = options.cwd || process.cwd()
  const home = options.home || process.env.HOME || cwd
  const limit = options.limit ?? 30
  const trimmed = input.trim()
  const mode = detectMode(trimmed)
  const resolved = resolveInputPath(trimmed, cwd, home)
  const hasTrailingSlash = trimmed.endsWith("/")

  let searchDir: string
  let prefix: string

  if (trimmed === "") {
    searchDir = cwd
    prefix = ""
  } else if (trimmed === "~") {
    searchDir = home
    prefix = ""
  } else if (trimmed === ".") {
    searchDir = cwd
    prefix = "."
  } else if (trimmed === "..") {
    searchDir = path.resolve(cwd, "..")
    prefix = ""
  } else if (hasTrailingSlash) {
    searchDir = resolved
    prefix = ""
  } else {
    searchDir = path.dirname(resolved)
    prefix = path.basename(resolved)
  }

  const prefixLower = prefix.toLowerCase()

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(searchDir, { withFileTypes: true })
  } catch {
    return []
  }

  const showDotDirs = prefix.startsWith(".")

  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      if (!showDotDirs && entry.name.startsWith(".")) return false
      return entry.name.toLowerCase().startsWith(prefixLower)
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((entry) => formatSuggestion(path.join(searchDir, entry.name), mode, cwd, home))
}

/**
 * Merge filesystem directory suggestions with existing history suggestions.
 * Filesystem suggestions are prioritized so users can explore valid paths first.
 */
export function mergePathSuggestions(input: string, historySuggestions: string[], options: PathSuggestionOptions = {}): string[] {
  const fsSuggestions = getDirectorySuggestions(input, options)
  const merged: string[] = []
  const seen = new Set<string>()

  for (const value of [...fsSuggestions, ...historySuggestions]) {
    if (seen.has(value)) continue
    seen.add(value)
    merged.push(value)
  }

  return merged
}
