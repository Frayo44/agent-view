/**
 * Auto-updater
 * Checks GitHub for newer releases and downloads tagged release binary to update
 */

import { spawnSync } from "child_process"
import fs from "fs"
import path from "path"
import os from "os"
import pkg from "../../package.json"

interface GitHubRelease {
  tag_name: string
}

function compareVersions(current: string, latest: string): boolean {
  const currentParts = current.split(".").map(Number)
  const latestParts = latest.split(".").map(Number)
  const len = Math.max(currentParts.length, latestParts.length)

  for (let i = 0; i < len; i++) {
    const c = currentParts[i] ?? 0
    const l = latestParts[i] ?? 0
    if (l > c) return true
    if (l < c) return false
  }

  return false
}

export async function checkForUpdate(): Promise<{ current: string; latest: string } | null> {
  try {
    const response = await fetch("https://api.github.com/repos/frayo44/agent-view/releases/latest", {
      headers: { "Accept": "application/vnd.github.v3+json" },
      signal: AbortSignal.timeout(5000)
    })

    if (!response.ok) return null

    const data = (await response.json()) as GitHubRelease
    const latest = data.tag_name.replace(/^v/, "")
    const current = pkg.version

    if (compareVersions(current, latest)) {
      return { current, latest }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Detect platform and architecture for binary download.
 */
function detectPlatform(): { os: string; arch: string } {
  const platform = process.platform === "darwin" ? "darwin" : "linux"
  const arch = process.arch === "arm64" ? "arm64" : "x64"
  return { os: platform, arch }
}

/**
 * Download and install the latest release binary directly.
 * Uses spawnSync with argument arrays (no shell) and downloads
 * from a tagged release URL instead of piping an unpinned script.
 */
export function performUpdateSync(): void {
  // Exit alternate screen buffer
  process.stdout.write("\x1b[?1049l")
  process.stdout.write("\x1b[2J\x1b[H")
  process.stdout.write("\x1b[?25h")

  const REPO = "frayo44/agent-view"
  const APP = "agent-view"
  const installDir = process.env.AGENT_VIEW_INSTALL_DIR || path.join(os.homedir(), ".agent-view", "bin")

  try {
    // 1. Fetch latest release tag from GitHub API
    console.log("Checking latest release...")
    const apiResult = spawnSync("curl", [
      "-fsSL",
      "-H", "Accept: application/vnd.github.v3+json",
      `https://api.github.com/repos/${REPO}/releases/latest`
    ], { stdio: ["pipe", "pipe", "pipe"], timeout: 15000 })

    if (apiResult.status !== 0) {
      throw new Error(`Failed to fetch release info: ${apiResult.stderr?.toString() || "unknown error"}`)
    }

    const releaseData = JSON.parse(apiResult.stdout.toString())
    const tagName = releaseData.tag_name
    if (!tagName || !/^v?\d+\.\d+\.\d+(-[\w.]+)?$/.test(tagName)) {
      throw new Error(`Invalid or missing tag_name in release data: ${tagName}`)
    }
    const version = tagName.replace(/^v/, "")

    // 2. Detect platform and build download URL
    const { os: plat, arch } = detectPlatform()
    const filename = `${APP}-${plat}-${arch}.tar.gz`
    const downloadUrl = `https://github.com/${REPO}/releases/download/${tagName}/${filename}`

    // 3. Create temp directory (mkdtemp generates unpredictable name, preventing symlink races)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `${APP}-update-`))

    // 4. Download tarball (no shell, argument array)
    console.log(`Downloading v${version} for ${plat}-${arch}...`)
    const downloadResult = spawnSync("curl", [
      "-fSL",
      "--progress-bar",
      "-o", path.join(tmpDir, filename),
      downloadUrl
    ], { stdio: ["pipe", "inherit", "inherit"], timeout: 120000 })

    if (downloadResult.status !== 0) {
      throw new Error("Download failed. The release may not have binaries for your platform.")
    }

    // 5. Extract tarball (no shell, argument array)
    const extractResult = spawnSync("tar", [
      "-xzf", path.join(tmpDir, filename),
      "-C", tmpDir
    ], { stdio: "pipe", timeout: 30000 })

    if (extractResult.status !== 0) {
      throw new Error(`Extraction failed: ${extractResult.stderr?.toString() || "unknown error"}`)
    }

    // 6. Find and install binary
    let binaryPath = path.join(tmpDir, APP)
    if (!fs.existsSync(binaryPath)) {
      binaryPath = path.join(tmpDir, `${APP}-${plat}-${arch}`, APP)
    }
    if (!fs.existsSync(binaryPath)) {
      throw new Error("Binary not found in archive")
    }

    fs.mkdirSync(installDir, { recursive: true })
    fs.copyFileSync(binaryPath, path.join(installDir, APP))
    fs.chmodSync(path.join(installDir, APP), 0o755)

    // Create short alias symlink
    try {
      fs.unlinkSync(path.join(installDir, "av"))
    } catch {
      // Symlink may not exist yet
    }
    fs.symlinkSync(path.join(installDir, APP), path.join(installDir, "av"))

    // 7. Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true })

    console.log(`\nUpdated to v${version}`)
    console.log(`Binary: ${path.join(installDir, APP)}`)
  } catch (err: any) {
    console.error(`\nUpdate failed: ${err.message}`)
    console.error("You can update manually from: https://github.com/frayo44/agent-view/releases")
  }

  // Clear screen and re-enter alternate buffer for TUI
  process.stdout.write("\x1b[2J\x1b[H")
  process.stdout.write("\x1b[?1049h")

  // Restore terminal title
  process.stdout.write("\x1b]0;Agent View\x07")
}
