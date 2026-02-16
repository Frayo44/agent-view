/**
 * Git utilities for worktree management
 * Based on agent-view's internal/git package
 */

import { exec } from "child_process"
import { promisify } from "util"
import * as path from "path"
import * as os from "os"

const execAsync = promisify(exec)

export interface Worktree {
  path: string
  branch: string
  commit: string
  bare: boolean
}

/**
 * Check if the given directory is inside a git repository
 */
export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execAsync(`git -C "${dir}" rev-parse --git-dir`)
    return true
  } catch {
    return false
  }
}

/**
 * Get the root directory of the git repository containing dir
 */
export async function getRepoRoot(dir: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`git -C "${dir}" rev-parse --show-toplevel`)
    return stdout.trim()
  } catch (err) {
    throw new Error(`not a git repository: ${err}`)
  }
}

/**
 * Get the current branch name for the repository at dir
 */
export async function getCurrentBranch(dir: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`git -C "${dir}" rev-parse --abbrev-ref HEAD`)
    return stdout.trim()
  } catch (err) {
    throw new Error(`failed to get current branch: ${err}`)
  }
}

/**
 * Check if a branch exists in the repository
 */
export async function branchExists(repoDir: string, branchName: string): Promise<boolean> {
  try {
    await execAsync(`git -C "${repoDir}" show-ref --verify --quiet refs/heads/${branchName}`)
    return true
  } catch {
    return false
  }
}

/**
 * Validate that a branch name follows git's naming rules
 */
export function validateBranchName(name: string): string | null {
  if (!name) {
    return "branch name cannot be empty"
  }

  if (name.trim() !== name) {
    return "branch name cannot have leading or trailing spaces"
  }

  if (name.includes("..")) {
    return "branch name cannot contain '..'"
  }

  if (name.startsWith(".")) {
    return "branch name cannot start with '.'"
  }

  if (name.endsWith(".lock")) {
    return "branch name cannot end with '.lock'"
  }

  const invalidChars = [" ", "\t", "~", "^", ":", "?", "*", "[", "\\"]
  for (const char of invalidChars) {
    if (name.includes(char)) {
      return `branch name cannot contain '${char}'`
    }
  }

  if (name.includes("@{")) {
    return "branch name cannot contain '@{'"
  }

  if (name === "@") {
    return "branch name cannot be just '@'"
  }

  return null
}

/**
 * Sanitize a string to be a valid branch name
 */
export function sanitizeBranchName(name: string): string {
  let sanitized = name
    .replace(/ /g, "-")
    .replace(/\.\./g, "-")
    .replace(/~/g, "-")
    .replace(/\^/g, "-")
    .replace(/:/g, "-")
    .replace(/\?/g, "-")
    .replace(/\*/g, "-")
    .replace(/\[/g, "-")
    .replace(/\\/g, "-")
    .replace(/@\{/g, "-")

  while (sanitized.startsWith(".")) {
    sanitized = sanitized.slice(1)
  }

  while (sanitized.endsWith(".lock")) {
    sanitized = sanitized.slice(0, -5)
  }

  sanitized = sanitized.replace(/-+/g, "-")
  sanitized = sanitized.replace(/^-+|-+$/g, "")

  return sanitized
}

/**
 * Generate a worktree directory path based on the repository directory and branch name.
 * Always places worktrees under <repo>/.worktrees/<branch>.
 */
export function generateWorktreePath(repoDir: string, branchName: string): string {
  // Sanitize branch name for filesystem
  const sanitized = branchName
    .replace(/\//g, "-")
    .replace(/ /g, "-")

  return path.join(repoDir, ".worktrees", sanitized)
}

/**
 * Create a new git worktree at worktreePath for the given branch.
 * If the branch doesn't exist, it will be created.
 * If baseBranch is provided, the new branch will be created from that branch instead of HEAD.
 * Returns the worktree path on success.
 */
export async function createWorktree(
  repoDir: string,
  branchName: string,
  worktreePath?: string,
  baseBranch?: string
): Promise<string> {
  // Validate branch name first
  const validationError = validateBranchName(branchName)
  if (validationError) {
    throw new Error(`invalid branch name: ${validationError}`)
  }

  // Check if it's a git repo
  if (!(await isGitRepo(repoDir))) {
    throw new Error("not a git repository")
  }

  // Generate worktree path if not provided
  const wtPath = worktreePath || generateWorktreePath(repoDir, branchName)

  let cmd: string
  if (await branchExists(repoDir, branchName)) {
    // Use existing branch
    cmd = `cd "${repoDir}" && git worktree add "${wtPath}" "${branchName}"`
  } else {
    // Create new branch with -b flag
    // If baseBranch is provided, create from that branch instead of HEAD
    const base = baseBranch || "HEAD"
    cmd = `cd "${repoDir}" && git worktree add -b "${branchName}" "${wtPath}" ${base}`
  }

  try {
    await execAsync(cmd)
    return wtPath
  } catch (err: any) {
    const output = err.stderr || err.stdout || err.message
    throw new Error(`failed to create worktree: ${output}`)
  }
}

/**
 * List all worktrees for the repository at repoDir
 */
export async function listWorktrees(repoDir: string): Promise<Worktree[]> {
  if (!(await isGitRepo(repoDir))) {
    throw new Error("not a git repository")
  }

  try {
    const { stdout } = await execAsync(`git -C "${repoDir}" worktree list --porcelain`)
    return parseWorktreeList(stdout)
  } catch (err) {
    throw new Error(`failed to list worktrees: ${err}`)
  }
}

/**
 * Parse the output of `git worktree list --porcelain`
 */
function parseWorktreeList(output: string): Worktree[] {
  const worktrees: Worktree[] = []
  let current: Partial<Worktree> = {}

  for (const line of output.split("\n")) {
    if (line === "") {
      // Empty line marks end of worktree entry
      if (current.path) {
        worktrees.push({
          path: current.path,
          branch: current.branch || "",
          commit: current.commit || "",
          bare: current.bare || false
        })
      }
      current = {}
      continue
    }

    if (line.startsWith("worktree ")) {
      current.path = line.slice(9)
    } else if (line.startsWith("HEAD ")) {
      current.commit = line.slice(5)
    } else if (line.startsWith("branch ")) {
      // Branch is in format "refs/heads/branch-name"
      let branch = line.slice(7)
      if (branch.startsWith("refs/heads/")) {
        branch = branch.slice(11)
      }
      current.branch = branch
    } else if (line === "bare") {
      current.bare = true
    } else if (line === "detached") {
      // Detached HEAD, branch will be empty
      current.branch = ""
    }
  }

  // Don't forget the last entry if output doesn't end with empty line
  if (current.path) {
    worktrees.push({
      path: current.path,
      branch: current.branch || "",
      commit: current.commit || "",
      bare: current.bare || false
    })
  }

  return worktrees
}

/**
 * Remove a worktree from the repository.
 * If force is true, it will remove even if there are uncommitted changes.
 */
export async function removeWorktree(repoDir: string, worktreePath: string, force: boolean = false): Promise<void> {
  if (!(await isGitRepo(repoDir))) {
    throw new Error("not a git repository")
  }

  const args = ["worktree", "remove"]
  if (force) {
    args.push("--force")
  }
  args.push(`"${worktreePath}"`)

  try {
    await execAsync(`git -C "${repoDir}" ${args.join(" ")}`)
  } catch (err: any) {
    const output = err.stderr || err.stdout || err.message
    throw new Error(`failed to remove worktree: ${output}`)
  }
}

/**
 * Check if the given directory is a git worktree (not the main repo)
 */
export async function isWorktree(dir: string): Promise<boolean> {
  try {
    const [commonDir, gitDir] = await Promise.all([
      execAsync(`git -C "${dir}" rev-parse --git-common-dir`),
      execAsync(`git -C "${dir}" rev-parse --git-dir`)
    ])

    const common = commonDir.stdout.trim()
    const git = gitDir.stdout.trim()

    // If common-dir and git-dir differ, it's a worktree
    return common !== git && common !== "."
  } catch {
    return false
  }
}

/**
 * Check if the repository at dir has uncommitted changes
 */
export async function hasUncommittedChanges(dir: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`git -C "${dir}" status --porcelain`)
    return stdout.trim() !== ""
  } catch (err: any) {
    const output = err.stderr || err.stdout || err.message
    throw new Error(`failed to check git status: ${output}`)
  }
}

/**
 * Get the default branch name (e.g. "main" or "master") for the repo
 */
export async function getDefaultBranch(repoDir: string): Promise<string> {
  // Try symbolic-ref first (works when remote HEAD is set)
  try {
    const { stdout } = await execAsync(`git -C "${repoDir}" symbolic-ref refs/remotes/origin/HEAD`)
    const ref = stdout.trim()
    const branch = ref.replace("refs/remotes/origin/", "")
    if (branch && branch !== ref) {
      return branch
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: check for common default branch names
  if (await branchExists(repoDir, "main")) {
    return "main"
  }
  if (await branchExists(repoDir, "master")) {
    return "master"
  }

  throw new Error("could not determine default branch (no origin/HEAD, no main or master branch)")
}

/**
 * Generate a unique branch name based on a title
 */
export function generateBranchName(title?: string): string {
  const base = title ? sanitizeBranchName(title.toLowerCase()) : "session"
  const timestamp = Date.now().toString(36)
  return `${base}-${timestamp}`
}

/**
 * Prune stale worktree references
 */
export async function pruneWorktrees(repoDir: string): Promise<void> {
  try {
    await execAsync(`git -C "${repoDir}" worktree prune`)
  } catch (err: any) {
    const output = err.stderr || err.stdout || err.message
    throw new Error(`failed to prune worktrees: ${output}`)
  }
}
