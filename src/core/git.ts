/**
 * Git utilities for worktree management
 * Based on agent-view's internal/git package
 */

import { execFile } from "child_process"
import { promisify } from "util"
import * as path from "path"
import * as os from "os"

const execFileAsync = promisify(execFile)

/**
 * Execute a git command using execFile (no shell interpolation).
 * Uses cwd option instead of git -C to avoid path injection.
 */
async function execGit(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd })
}

export interface Worktree {
  path: string
  branch: string
  commit: string
  bare: boolean
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execGit(["rev-parse", "--git-dir"], dir)
    return true
  } catch {
    return false
  }
}

export async function getRepoRoot(dir: string): Promise<string> {
  try {
    const { stdout } = await execGit(["rev-parse", "--show-toplevel"], dir)
    return stdout.trim()
  } catch (err) {
    throw new Error(`not a git repository: ${err}`)
  }
}

export async function getCurrentBranch(dir: string): Promise<string> {
  try {
    const { stdout } = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], dir)
    return stdout.trim()
  } catch (err) {
    throw new Error(`failed to get current branch: ${err}`)
  }
}

export async function branchExists(repoDir: string, branchName: string): Promise<boolean> {
  try {
    await execGit(["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], repoDir)
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
  const validationError = validateBranchName(branchName)
  if (validationError) {
    throw new Error(`invalid branch name: ${validationError}`)
  }

  if (!(await isGitRepo(repoDir))) {
    throw new Error("not a git repository")
  }

  const wtPath = worktreePath || generateWorktreePath(repoDir, branchName)

  try {
    if (await branchExists(repoDir, branchName)) {
      // Use existing branch
      await execGit(["worktree", "add", wtPath, branchName], repoDir)
    } else {
      // Create new branch with -b flag
      // If baseBranch is provided, create from that branch instead of HEAD
      const base = baseBranch || "HEAD"
      await execGit(["worktree", "add", "-b", branchName, wtPath, base], repoDir)
    }
    return wtPath
  } catch (err: any) {
    const output = err.stderr || err.stdout || err.message
    throw new Error(`failed to create worktree: ${output}`)
  }
}

export async function listWorktrees(repoDir: string): Promise<Worktree[]> {
  if (!(await isGitRepo(repoDir))) {
    throw new Error("not a git repository")
  }

  try {
    const { stdout } = await execGit(["worktree", "list", "--porcelain"], repoDir)
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
  args.push(worktreePath)

  try {
    await execGit(args, repoDir)
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
      execGit(["rev-parse", "--git-common-dir"], dir),
      execGit(["rev-parse", "--git-dir"], dir)
    ])

    const common = commonDir.stdout.trim()
    const git = gitDir.stdout.trim()

    // If common-dir and git-dir differ, it's a worktree
    return common !== git && common !== "."
  } catch {
    return false
  }
}

export async function hasUncommittedChanges(dir: string): Promise<boolean> {
  try {
    const { stdout } = await execGit(["status", "--porcelain"], dir)
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
    const { stdout } = await execGit(["symbolic-ref", "refs/remotes/origin/HEAD"], repoDir)
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

export function generateBranchName(title?: string): string {
  const base = title ? sanitizeBranchName(title.toLowerCase()) : "session"
  const timestamp = Date.now().toString(36)
  return `${base}-${timestamp}`
}

export async function pruneWorktrees(repoDir: string): Promise<void> {
  try {
    await execGit(["worktree", "prune"], repoDir)
  } catch (err: any) {
    const output = err.stderr || err.stdout || err.message
    throw new Error(`failed to prune worktrees: ${output}`)
  }
}
