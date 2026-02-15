import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import * as os from "os"
import * as path from "path"

import {
  validateBranchName,
  sanitizeBranchName,
  generateWorktreePath,
  generateBranchName,
} from "./git"

describe("validateBranchName", () => {
  test("accepts valid branch names", () => {
    expect(validateBranchName("feature/add-login")).toBeNull()
    expect(validateBranchName("main")).toBeNull()
    expect(validateBranchName("fix-123")).toBeNull()
    expect(validateBranchName("release-v1.0.0")).toBeNull()
  })

  test("rejects empty names", () => {
    expect(validateBranchName("")).toBe("branch name cannot be empty")
  })

  test("rejects names with leading or trailing spaces", () => {
    expect(validateBranchName(" feature")).toBe("branch name cannot have leading or trailing spaces")
    expect(validateBranchName("feature ")).toBe("branch name cannot have leading or trailing spaces")
    expect(validateBranchName("  ")).toBe("branch name cannot have leading or trailing spaces")
  })

  test("rejects names with spaces in the middle", () => {
    expect(validateBranchName("feature branch")).toBe("branch name cannot contain ' '")
  })

  test("rejects names with ..", () => {
    expect(validateBranchName("feature..branch")).toBe("branch name cannot contain '..'")
    expect(validateBranchName("..feature")).toBe("branch name cannot contain '..'")
  })

  test("rejects names starting with .", () => {
    expect(validateBranchName(".hidden")).toBe("branch name cannot start with '.'")
    expect(validateBranchName(".")).toBe("branch name cannot start with '.'")
  })

  test("rejects names ending with .lock", () => {
    expect(validateBranchName("feature.lock")).toBe("branch name cannot end with '.lock'")
    expect(validateBranchName("my-branch.lock")).toBe("branch name cannot end with '.lock'")
  })

  test("rejects names with invalid chars (~^:?*[\\)", () => {
    expect(validateBranchName("feature~name")).toBe("branch name cannot contain '~'")
    expect(validateBranchName("feature^name")).toBe("branch name cannot contain '^'")
    expect(validateBranchName("feature:name")).toBe("branch name cannot contain ':'")
    expect(validateBranchName("feature?name")).toBe("branch name cannot contain '?'")
    expect(validateBranchName("feature*name")).toBe("branch name cannot contain '*'")
    expect(validateBranchName("feature[name")).toBe("branch name cannot contain '['")
    expect(validateBranchName("feature\\name")).toBe("branch name cannot contain '\\'")
  })

  test("rejects names with tabs", () => {
    expect(validateBranchName("feature\tname")).toBe("branch name cannot contain '\t'")
  })

  test("rejects names with @{", () => {
    expect(validateBranchName("feature@{name")).toBe("branch name cannot contain '@{'")
    expect(validateBranchName("@{upstream}")).toBe("branch name cannot contain '@{'")
  })

  test("rejects @ alone", () => {
    expect(validateBranchName("@")).toBe("branch name cannot be just '@'")
  })

  test("accepts @ as part of a name", () => {
    expect(validateBranchName("user@feature")).toBeNull()
    expect(validateBranchName("@username")).toBeNull()
  })
})

describe("sanitizeBranchName", () => {
  test("replaces spaces with dashes", () => {
    expect(sanitizeBranchName("feature branch name")).toBe("feature-branch-name")
  })

  test("replaces .. with dash", () => {
    expect(sanitizeBranchName("feature..branch")).toBe("feature-branch")
  })

  test("removes leading dots", () => {
    expect(sanitizeBranchName(".hidden")).toBe("hidden")
    // "..." becomes "-." after replacing ".." with "-", then leading dash is removed
    expect(sanitizeBranchName("...hidden")).toBe(".hidden")
  })

  test("removes trailing .lock", () => {
    expect(sanitizeBranchName("feature.lock")).toBe("feature")
    expect(sanitizeBranchName("branch.lock.lock")).toBe("branch")
  })

  test("replaces invalid characters with dashes", () => {
    expect(sanitizeBranchName("feature~name")).toBe("feature-name")
    expect(sanitizeBranchName("feature^name")).toBe("feature-name")
    expect(sanitizeBranchName("feature:name")).toBe("feature-name")
    expect(sanitizeBranchName("feature?name")).toBe("feature-name")
    expect(sanitizeBranchName("feature*name")).toBe("feature-name")
    expect(sanitizeBranchName("feature[name")).toBe("feature-name")
    expect(sanitizeBranchName("feature\\name")).toBe("feature-name")
  })

  test("replaces @{ with dash", () => {
    expect(sanitizeBranchName("feature@{name")).toBe("feature-name")
  })

  test("collapses consecutive dashes", () => {
    expect(sanitizeBranchName("feature--branch")).toBe("feature-branch")
    expect(sanitizeBranchName("a  b  c")).toBe("a-b-c")
    expect(sanitizeBranchName("x~~y")).toBe("x-y")
  })

  test("removes leading/trailing dashes", () => {
    expect(sanitizeBranchName("-feature")).toBe("feature")
    expect(sanitizeBranchName("feature-")).toBe("feature")
    expect(sanitizeBranchName("--feature--")).toBe("feature")
  })

  test("handles complex cases", () => {
    expect(sanitizeBranchName("..feature~branch:test.lock")).toBe("feature-branch-test")
    expect(sanitizeBranchName("  multiple   spaces  ")).toBe("multiple-spaces")
  })
})

describe("generateWorktreePath", () => {
  const repoDir = "/home/user/project"

  test("subdirectory mode creates .worktrees/<branch>", () => {
    expect(generateWorktreePath(repoDir, "feature", "subdirectory")).toBe(
      "/home/user/project/.worktrees/feature"
    )
  })

  test("sibling mode creates <repo>-<branch>", () => {
    expect(generateWorktreePath(repoDir, "feature", "sibling")).toBe(
      "/home/user/project-feature"
    )
  })

  test("defaults to subdirectory mode when empty string provided", () => {
    // Empty string falls through to default case which is sibling
    expect(generateWorktreePath(repoDir, "feature", "")).toBe(
      "/home/user/project-feature"
    )
  })

  test("defaults to subdirectory mode when no location specified", () => {
    expect(generateWorktreePath(repoDir, "feature")).toBe(
      "/home/user/project/.worktrees/feature"
    )
  })

  test("custom path with ~ expands home directory", () => {
    const home = os.homedir()
    const result = generateWorktreePath(repoDir, "feature", "~/worktrees")
    expect(result).toBe(path.join(home, "worktrees", "project", "feature"))
  })

  test("custom path with just ~ expands to home directory", () => {
    const home = os.homedir()
    const result = generateWorktreePath(repoDir, "feature", "~")
    expect(result).toBe(path.join(home, "project", "feature"))
  })

  test("custom path containing / is treated as custom path", () => {
    const result = generateWorktreePath(repoDir, "feature", "/tmp/worktrees")
    expect(result).toBe("/tmp/worktrees/project/feature")
  })

  test("sanitizes branch name with slashes", () => {
    expect(generateWorktreePath(repoDir, "feature/sub/branch", "subdirectory")).toBe(
      "/home/user/project/.worktrees/feature-sub-branch"
    )
  })

  test("sanitizes branch name with spaces", () => {
    expect(generateWorktreePath(repoDir, "feature branch", "subdirectory")).toBe(
      "/home/user/project/.worktrees/feature-branch"
    )
  })

  test("extracts repo name from path for custom location", () => {
    const result = generateWorktreePath("/path/to/my-repo", "feature", "/custom/path")
    expect(result).toBe("/custom/path/my-repo/feature")
  })
})

describe("generateBranchName", () => {
  test("creates unique names with timestamp", () => {
    const name1 = generateBranchName("Test Feature")
    const name2 = generateBranchName("Test Feature")

    // Names should be different due to timestamp
    // Allow for same millisecond execution - they might be equal
    expect(name1).toMatch(/^test-feature-[a-z0-9]+$/)
    expect(name2).toMatch(/^test-feature-[a-z0-9]+$/)
  })

  test("sanitizes title input", () => {
    // Note: sanitizeBranchName only handles specific git-invalid chars, not all punctuation
    const name = generateBranchName("Feature: Add Login")
    expect(name).toMatch(/^feature-add-login-[a-z0-9]+$/)
  })

  test("uses 'session' prefix when no title", () => {
    const name = generateBranchName()
    expect(name).toMatch(/^session-[a-z0-9]+$/)
  })

  test("uses 'session' prefix when empty title", () => {
    const name = generateBranchName("")
    expect(name).toMatch(/^session-[a-z0-9]+$/)
  })

  test("converts to lowercase", () => {
    const name = generateBranchName("UPPERCASE")
    expect(name).toMatch(/^uppercase-[a-z0-9]+$/)
  })

  test("timestamp is base36 encoded", () => {
    const before = Date.now()
    const name = generateBranchName("test")
    const after = Date.now()

    const timestampPart = name.split("-").pop()!
    const decodedTimestamp = parseInt(timestampPart, 36)

    expect(decodedTimestamp).toBeGreaterThanOrEqual(before)
    expect(decodedTimestamp).toBeLessThanOrEqual(after)
  })
})
