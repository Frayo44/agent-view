import { readdirSync, statSync, existsSync } from "fs"
import path from "path"
import os from "os"

/**
 * List subdirectories of a given directory that match a prefix.
 * Returns absolute paths for matching directories.
 */
export function listSubdirectories(dirPath: string, prefix?: string): string[] {
  const expanded = dirPath.startsWith("~")
    ? path.join(os.homedir(), dirPath.slice(1))
    : dirPath

  if (!expanded || !existsSync(expanded)) return []

  try {
    const entries = readdirSync(expanded, { withFileTypes: true })
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith("."))
      .filter(e => !prefix || e.name.startsWith(prefix))
      .map(e => path.join(expanded, e.name))
  } catch {
    return []
  }
}

/**
 * Given a partial path, resolve the parent directory and prefix
 * to match against, then return matching subdirectory completions.
 */
export function resolvePathCompletion(partialPath: string): {
  parentDir: string
  prefix: string
  completions: string[]
} {
  let expanded = partialPath.startsWith("~")
    ? path.join(os.homedir(), partialPath.slice(1))
    : partialPath

  if (!expanded) expanded = process.cwd()

  let parentDir: string
  let prefix: string

  if (expanded.endsWith("/") || expanded.endsWith(path.sep)) {
    parentDir = expanded
    prefix = ""
  } else {
    parentDir = path.dirname(expanded)
    prefix = path.basename(expanded)
  }

  if (!existsSync(parentDir) && prefix) {
    const grandparent = path.dirname(parentDir)
    if (existsSync(grandparent)) {
      const parentPrefix = path.basename(parentDir)
      const completions = listSubdirectories(grandparent, parentPrefix)
      return { parentDir: grandparent, prefix: parentPrefix, completions }
    }
    return { parentDir, prefix, completions: [] }
  }

  const completions = listSubdirectories(parentDir, prefix)
  return { parentDir, prefix, completions }
}

/**
 * Check if a directory is a git repository (synchronous, for autocomplete).
 */
export function isDirGitRepoSync(dirPath: string): boolean {
  try {
    statSync(path.join(dirPath, ".git"))
    return true
  } catch {
    return false
  }
}