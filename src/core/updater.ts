/**
 * Auto-updater
 * Checks GitHub for newer releases and runs install script to update
 */

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

export function performUpdateSync(): void {
  const { spawnSync } = require("child_process")

  // Exit alternate screen buffer
  process.stdout.write("\x1b[?1049l")
  process.stdout.write("\x1b[2J\x1b[H")
  process.stdout.write("\x1b[?25h")

  spawnSync("bash", ["-c", "curl -fsSL https://raw.githubusercontent.com/frayo44/agent-view/main/install.sh | bash"], {
    stdio: "inherit",
    env: process.env
  })

  // Clear screen and re-enter alternate buffer for TUI
  process.stdout.write("\x1b[2J\x1b[H")
  process.stdout.write("\x1b[?1049h")

  // Restore terminal title
  process.stdout.write("\x1b]0;Agent View\x07")
}
