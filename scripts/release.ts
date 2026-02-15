#!/usr/bin/env bun
/**
 * Release script for agent-view
 *
 * Usage:
 *   bun run scripts/release.ts 1.0.0           # Release version 1.0.0
 *   bun run scripts/release.ts 1.0.0 --draft   # Create draft release
 */

import { $ } from "bun"
import path from "path"

const dir = path.resolve(import.meta.dir, "..")
process.chdir(dir)

const BIN_DIR = path.join(dir, "bin")

async function main() {
  const args = process.argv.slice(2)
  const version = args.find(a => !a.startsWith("--"))
  const isDraft = args.includes("--draft")

  if (!version) {
    console.error("Usage: bun run scripts/release.ts <version> [--draft]")
    console.error("Example: bun run scripts/release.ts 1.0.0")
    process.exit(1)
  }

  const tag = version.startsWith("v") ? version : `v${version}`

  console.log("")
  console.log("╭───────────────────────────────────╮")
  console.log("│       Agent View Release          │")
  console.log("╰───────────────────────────────────╯")
  console.log("")
  console.log(`Version: ${tag}`)
  console.log(`Draft: ${isDraft}`)
  console.log("")

  // Step 1: Update version in package.json
  console.log("📦 Updating package.json version...")
  const pkg = await Bun.file("package.json").json()
  pkg.version = version.replace(/^v/, "")
  await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n")

  // Step 2: Compile all binaries
  console.log("🔨 Compiling binaries for all platforms...")
  const compileResult = await $`bun run compile:all`.quiet()
  if (compileResult.exitCode !== 0) {
    console.error("Compilation failed")
    process.exit(1)
  }
  console.log("   ✅ Binaries compiled")

  // Step 3: Check for uncommitted changes
  const status = await $`git status --porcelain`.text()
  if (status.trim()) {
    console.log("📝 Committing version bump...")
    await $`git add package.json`
    await $`git commit -m "chore: bump version to ${tag}"`
  }

  // Step 4: Create and push tag
  console.log(`🏷️  Creating tag ${tag}...`)
  try {
    await $`git tag ${tag}`
    console.log("   ✅ Tag created")
  } catch {
    console.log("   ⚠️  Tag already exists, using existing tag")
  }

  console.log("📤 Pushing to remote...")
  await $`git push origin HEAD --tags`.quiet()

  // Step 5: Create GitHub release
  console.log("🚀 Creating GitHub release...")

  const releaseNotes = `## Agent View ${tag}

### Installation

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/frayo44/agent-view/main/install.sh | bash
\`\`\`

### Direct Download

Download the binary for your platform below, make it executable, and run it.

### Changes

- See commit history for changes
`

  const draftFlag = isDraft ? "--draft" : ""
  const binaries = await Array.fromAsync(
    new Bun.Glob("agent-view-*").scan({ cwd: BIN_DIR })
  )

  const binaryPaths = binaries.map(b => path.join(BIN_DIR, b)).join(" ")

  try {
    await $`gh release create ${tag} ${binaryPaths.split(" ")} --title ${tag} --notes ${releaseNotes} ${draftFlag}`.quiet()
    console.log("   ✅ Release created")
  } catch (err) {
    console.error("   ❌ Failed to create release. Make sure 'gh' CLI is installed and authenticated.")
    console.error("   Run: gh auth login")
    process.exit(1)
  }

  console.log("")
  console.log("✅ Release complete!")
  console.log("")
  console.log(`   View release: https://github.com/frayo44/agent-view/releases/tag/${tag}`)
  console.log("")
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
