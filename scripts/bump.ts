#!/usr/bin/env bun
/**
 * Bump version script for agent-view
 *
 * This script bumps the version, creates a tag, pushes it, and waits for
 * the GitHub Actions release workflow to complete and upload binaries.
 *
 * Usage:
 *   bun run scripts/bump.ts patch       # 0.0.21 -> 0.0.22
 *   bun run scripts/bump.ts minor       # 0.0.21 -> 0.1.0
 *   bun run scripts/bump.ts major       # 0.0.21 -> 1.0.0
 *   bun run scripts/bump.ts 1.2.3       # Set exact version
 */

import { $ } from "bun"
import path from "path"

const dir = path.resolve(import.meta.dir, "..")
process.chdir(dir)

type BumpType = "patch" | "minor" | "major"

function bumpVersion(current: string, type: BumpType): string {
  const parts = current.split(".").map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format: ${current}`)
  }

  const [major, minor, patch] = parts

  switch (type) {
    case "major":
      return `${major + 1}.0.0`
    case "minor":
      return `${major}.${minor + 1}.0`
    case "patch":
      return `${major}.${minor}.${patch + 1}`
  }
}

function isValidVersion(v: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(v)
}

async function waitForWorkflow(tag: string, maxWaitMs: number = 180000): Promise<boolean> {
  const startTime = Date.now()
  const pollInterval = 5000

  console.log("⏳ Waiting for release workflow to start...")

  // Wait for workflow to appear
  let runId: string | null = null
  while (Date.now() - startTime < maxWaitMs) {
    const result = await $`gh run list --workflow=release.yml --branch=${tag} --limit=1 --json databaseId,status,conclusion`.quiet()
    const runs = JSON.parse(result.text())

    if (runs.length > 0) {
      runId = runs[0].databaseId
      break
    }

    await Bun.sleep(pollInterval)
  }

  if (!runId) {
    console.error("❌ Release workflow did not start within timeout")
    return false
  }

  console.log(`🔄 Workflow started (run ID: ${runId}), waiting for completion...`)

  // Wait for workflow to complete
  while (Date.now() - startTime < maxWaitMs) {
    const result = await $`gh run view ${runId} --json status,conclusion`.quiet()
    const run = JSON.parse(result.text())

    if (run.status === "completed") {
      if (run.conclusion === "success") {
        return true
      } else {
        console.error(`❌ Workflow failed with conclusion: ${run.conclusion}`)
        console.log(`   View details: gh run view ${runId}`)
        return false
      }
    }

    process.stdout.write(".")
    await Bun.sleep(pollInterval)
  }

  console.error("\n❌ Workflow did not complete within timeout")
  return false
}

async function verifyReleaseBinaries(tag: string): Promise<boolean> {
  const result = await $`gh release view ${tag} --json assets`.quiet()
  const { assets } = JSON.parse(result.text())

  const required = ["agent-view-darwin-arm64.tar.gz", "agent-view-linux-x64.tar.gz"]
  const found = assets.map((a: { name: string }) => a.name)

  const missing = required.filter((r) => !found.includes(r))
  if (missing.length > 0) {
    console.error(`❌ Missing binaries: ${missing.join(", ")}`)
    return false
  }

  return true
}

async function main() {
  const args = process.argv.slice(2)
  const input = args[0]
  const skipWait = args.includes("--no-wait")

  if (!input) {
    console.error("Usage: bun run scripts/bump.ts <patch|minor|major|version>")
    console.error("")
    console.error("Examples:")
    console.error("  bun run scripts/bump.ts patch    # 0.0.21 -> 0.0.22")
    console.error("  bun run scripts/bump.ts minor    # 0.0.21 -> 0.1.0")
    console.error("  bun run scripts/bump.ts major    # 0.0.21 -> 1.0.0")
    console.error("  bun run scripts/bump.ts 1.2.3    # Set exact version")
    process.exit(1)
  }

  // Check for uncommitted changes
  const status = await $`git status --porcelain`.text()
  if (status.trim()) {
    console.error("❌ You have uncommitted changes. Please commit or stash them first.")
    process.exit(1)
  }

  // Read current version
  const pkg = await Bun.file("package.json").json()
  const currentVersion = pkg.version

  // Calculate new version
  let newVersion: string
  if (["patch", "minor", "major"].includes(input)) {
    newVersion = bumpVersion(currentVersion, input as BumpType)
  } else if (isValidVersion(input)) {
    newVersion = input
  } else {
    console.error(`❌ Invalid input: ${input}`)
    console.error("   Must be 'patch', 'minor', 'major', or a valid semver (e.g., 1.2.3)")
    process.exit(1)
  }

  const tag = `v${newVersion}`

  // Check if tag already exists
  try {
    await $`git rev-parse ${tag}`.quiet()
    console.error(`❌ Tag ${tag} already exists`)
    process.exit(1)
  } catch {
    // Tag doesn't exist, good
  }

  console.log("")
  console.log("╭───────────────────────────────────╮")
  console.log("│       Agent View Version Bump     │")
  console.log("╰───────────────────────────────────╯")
  console.log("")
  console.log(`  Current: ${currentVersion}`)
  console.log(`  New:     ${newVersion}`)
  console.log("")

  // Step 1: Update package.json
  console.log("📦 Updating package.json...")
  pkg.version = newVersion
  await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n")

  // Step 2: Commit
  console.log("📝 Committing version bump...")
  await $`git add package.json`
  await $`git commit -m "Bump version to ${newVersion}"`

  // Step 3: Create tag
  console.log(`🏷️  Creating tag ${tag}...`)
  await $`git tag ${tag}`

  // Step 4: Push
  console.log("📤 Pushing to remote...")
  await $`git push origin HEAD --tags`

  console.log("")
  console.log("✅ Version bumped and tag pushed!")

  if (skipWait) {
    console.log("")
    console.log("⚠️  Skipping workflow wait (--no-wait)")
    console.log("   Run 'gh run watch' to monitor the release workflow")
    console.log("")
    return
  }

  // Step 5: Wait for release workflow
  console.log("")
  const workflowSuccess = await waitForWorkflow(tag)

  if (!workflowSuccess) {
    console.log("")
    console.log("⚠️  Release workflow did not complete successfully")
    console.log("   The version bump is complete, but binaries may not be available")
    console.log("   Check: gh run list --workflow=release.yml")
    process.exit(1)
  }

  console.log("")
  console.log("✅ Release workflow completed!")

  // Step 6: Verify binaries
  console.log("🔍 Verifying release binaries...")
  const binariesOk = await verifyReleaseBinaries(tag)

  if (!binariesOk) {
    console.log("")
    console.log("⚠️  Some binaries are missing from the release")
    console.log(`   Check: https://github.com/frayo44/agent-view/releases/tag/${tag}`)
    process.exit(1)
  }

  console.log("✅ All binaries uploaded!")
  console.log("")
  console.log("🎉 Release complete!")
  console.log("")
  console.log(`   Version:  ${newVersion}`)
  console.log(`   Release:  https://github.com/frayo44/agent-view/releases/tag/${tag}`)
  console.log("")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
