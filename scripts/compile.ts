#!/usr/bin/env bun
/**
 * Compile agent-view to standalone binaries for distribution
 *
 * Usage:
 *   bun run scripts/compile.ts           # Compile for current platform
 *   bun run scripts/compile.ts --all     # Compile for all platforms
 *
 * Output: Creates a tarball for each platform containing:
 *   - agent-view binary
 *   - prebuilds/ directory with native modules
 *   - install script
 */

import path from "path"
import { mkdir, rm, copyFile, chmod, cp } from "fs/promises"
import { existsSync } from "fs"
import solidPlugin from "@opentui/solid/bun-plugin"
import { $ } from "bun"

const dir = path.resolve(import.meta.dir, "..")
process.chdir(dir)

const DIST_DIR = path.join(dir, "dist")
const BIN_DIR = path.join(dir, "bin")
const NODE_PTY_PREBUILDS = path.join(dir, "node_modules/node-pty/prebuilds")

// Supported platforms
type Platform = "darwin-arm64" | "darwin-x64" | "linux-arm64" | "linux-x64"

const PLATFORMS: Platform[] = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
]

// Get current platform
function getCurrentPlatform(): Platform {
  const os = process.platform === "darwin" ? "darwin" : "linux"
  const arch = process.arch === "arm64" ? "arm64" : "x64"
  return `${os}-${arch}` as Platform
}

// Map platform to Bun target
function getBunTarget(platform: Platform): string {
  const map: Record<Platform, string> = {
    "darwin-arm64": "bun-darwin-arm64",
    "darwin-x64": "bun-darwin-x64",
    "linux-arm64": "bun-linux-arm64",
    "linux-x64": "bun-linux-x64",
  }
  return map[platform]
}

// Build the TypeScript/Solid code first
async function buildSource(): Promise<boolean> {
  console.log("📦 Building source...")

  const result = await Bun.build({
    entrypoints: ["./src/index.ts"],
    outdir: DIST_DIR,
    target: "bun",
    format: "esm",
    splitting: false,
    sourcemap: "none",
    minify: true,
    plugins: [solidPlugin],
    external: ["bun:sqlite", "node-pty"],
  })

  if (!result.success) {
    console.error("Build failed:")
    for (const log of result.logs) {
      console.error(log)
    }
    return false
  }

  return true
}

// Compile to standalone binary and create distribution package
async function compileForPlatform(platform: Platform): Promise<boolean> {
  const target = getBunTarget(platform)
  const packageDir = path.join(BIN_DIR, `agent-view-${platform}`)
  const binaryPath = path.join(packageDir, "agent-view")
  const prebuildsDir = path.join(packageDir, "prebuilds", platform)

  console.log(`🔨 Compiling for ${platform}...`)

  try {
    // Create package directory
    await rm(packageDir, { recursive: true, force: true })
    await mkdir(packageDir, { recursive: true })
    await mkdir(prebuildsDir, { recursive: true })

    // Compile binary from pre-built dist (which includes Solid transforms)
    const proc = Bun.spawn({
      cmd: [
        "bun",
        "build",
        "--compile",
        "--target",
        target,
        "--outfile",
        binaryPath,
        "./dist/index.js",
      ],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    })

    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()

    if (exitCode !== 0) {
      console.error(`Failed to compile for ${platform}:`, stderr)
      return false
    }

    await chmod(binaryPath, 0o755)

    // Copy native prebuilds
    const sourcePrebuild = path.join(NODE_PTY_PREBUILDS, platform)
    if (existsSync(sourcePrebuild)) {
      await cp(sourcePrebuild, prebuildsDir, { recursive: true })
      console.log(`   📁 Copied prebuilds for ${platform}`)
    } else {
      console.log(`   ⚠️  No prebuilds found for ${platform}`)
    }

    // Create launcher script
    const launcherPath = path.join(packageDir, "run.sh")
    const launcher = `#!/usr/bin/env bash
# Agent View launcher - sets up native module paths
# Resolve symlinks to find the real script location
SOURCE="\${BASH_SOURCE[0]}"
while [ -L "\$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "\$SOURCE")" && pwd)"
  SOURCE="$(readlink "\$SOURCE")"
  [[ \$SOURCE != /* ]] && SOURCE="\$DIR/\$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "\$SOURCE")" && pwd)"
export NODE_PTY_PREBUILDS="\$SCRIPT_DIR/prebuilds"
exec "\$SCRIPT_DIR/agent-view" "\$@"
`
    await Bun.write(launcherPath, launcher)
    await chmod(launcherPath, 0o755)

    // Create install script
    const installPath = path.join(packageDir, "install.sh")
    const installScript = `#!/usr/bin/env bash
# Agent View local installer
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="\${HOME}/.local/share/agent-view"
BIN_DIR="\${HOME}/.local/bin"

echo "Installing Agent View..."

# Create directories
mkdir -p "\$INSTALL_DIR" "\$BIN_DIR"

# Copy files
cp -r "\$SCRIPT_DIR"/* "\$INSTALL_DIR/"

# Create symlink
ln -sf "\$INSTALL_DIR/run.sh" "\$BIN_DIR/agent-view"
ln -sf "\$INSTALL_DIR/run.sh" "\$BIN_DIR/av"

echo "✅ Installed to \$INSTALL_DIR"
echo "   Commands: agent-view, av"
echo ""
echo "Make sure \$BIN_DIR is in your PATH"
`
    await Bun.write(installPath, installScript)
    await chmod(installPath, 0o755)

    // Create tarball
    const tarballName = `agent-view-${platform}.tar.gz`
    const tarballPath = path.join(BIN_DIR, tarballName)

    await $`tar -czf ${tarballPath} -C ${BIN_DIR} agent-view-${platform}`.quiet()

    const stats = await Bun.file(tarballPath).stat()
    const sizeMB = (stats?.size ?? 0) / (1024 * 1024)
    console.log(`   ✅ ${tarballName} (${sizeMB.toFixed(1)} MB)`)

    return true
  } catch (err) {
    console.error(`Failed to compile for ${platform}:`, err)
    return false
  }
}

// Main
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const compileAll = args.includes("--all")

  console.log("")
  console.log("╭───────────────────────────────────╮")
  console.log("│     Agent View Compiler           │")
  console.log("╰───────────────────────────────────╯")
  console.log("")

  // Clean bin directory
  await rm(BIN_DIR, { recursive: true, force: true })
  await mkdir(BIN_DIR, { recursive: true })

  // Build source first
  if (!(await buildSource())) {
    process.exit(1)
  }

  // Compile binaries
  const platforms = compileAll ? PLATFORMS : [getCurrentPlatform()]

  console.log("")
  console.log(`Compiling for: ${platforms.join(", ")}`)
  console.log("")

  let success = true
  for (const platform of platforms) {
    if (!(await compileForPlatform(platform))) {
      success = false
    }
  }

  console.log("")
  if (success) {
    console.log("✅ Compilation complete!")
    console.log("")
    console.log(`Output directory: ${BIN_DIR}`)
    console.log("")

    // List created tarballs
    const files = await Array.fromAsync(
      new Bun.Glob("*.tar.gz").scan({ cwd: BIN_DIR })
    )
    for (const file of files.sort()) {
      console.log(`   - ${file}`)
    }

    console.log("")
    console.log("To install locally, extract and run:")
    console.log("   tar -xzf agent-view-<platform>.tar.gz")
    console.log("   cd agent-view-<platform>")
    console.log("   ./install.sh")
  } else {
    console.log("❌ Some compilations failed")
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
