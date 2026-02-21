/**
 * Agent Orchestrator
 * OpenTUI-based Agent Management
 */

import { tui } from "./tui/app"
import { installClaudeHooks, uninstallClaudeHooks, getHooksStatus } from "./core/hooks"

function handleHooksCommand(subcommand: string): void {
  switch (subcommand) {
    case "install": {
      const result = installClaudeHooks()
      console.log(result.message)
      process.exit(result.success ? 0 : 1)
      break
    }
    case "uninstall": {
      const result = uninstallClaudeHooks()
      console.log(result.message)
      process.exit(result.success ? 0 : 1)
      break
    }
    case "status": {
      const status = getHooksStatus()
      console.log(`Hooks installed: ${status.installed ? "yes" : "no"}`)
      console.log(`Settings file: ${status.settingsPath}`)
      console.log(`Settings exists: ${status.settingsExists ? "yes" : "no"}`)
      console.log(`Notifications dir: ${status.notificationsDir}`)
      process.exit(0)
      break
    }
    default:
      console.log(`Unknown hooks subcommand: ${subcommand}`)
      console.log("Usage: agent-view hooks [install|uninstall|status]")
      process.exit(1)
  }
}

async function main() {
  const args = process.argv.slice(2)

  // Handle hooks subcommand
  if (args[0] === "hooks") {
    const subcommand = args[1] || "status"
    handleHooksCommand(subcommand)
    return
  }

  // Simple CLI argument handling
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Agent Orchestrator - Terminal Agent Management

Usage:
  agent-orchestrator [options]
  agent-orchestrator hooks [install|uninstall|status]

Options:
  --help, -h     Show this help message
  --version, -v  Show version
  --light        Use light mode theme

Commands:
  hooks install    Install Claude Code hooks for notifications
  hooks uninstall  Remove Claude Code hooks
  hooks status     Check hooks installation status

Keyboard Shortcuts (in TUI):
  Ctrl+K         Command palette
  Ctrl+L         Session list
  N              New session
  Q              Quit / Detach
  ?              Help
`)
    process.exit(0)
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log("agent-orchestrator v1.0.0")
    process.exit(0)
  }

  const mode = args.includes("--light") ? "light" : "dark"

  try {
    await tui({
      mode,
      onExit: async () => {
        console.log("Goodbye!")
      }
    })
  } catch (error) {
    console.error("Fatal error:", error)
    process.exit(1)
  }
}

main()
