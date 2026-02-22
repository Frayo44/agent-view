/**
 * Agent Orchestrator
 * OpenTUI-based Agent Management
 */

import { parseArgs, printHelp } from "./cli/args"
import type { CLICommand } from "./cli/args"

async function executeHeadlessCommand(command: CLICommand): Promise<void> {
  // Lazy import to avoid loading TUI dependencies for headless commands
  const { cmdNew, cmdList, cmdDelete, cmdStop, cmdRestart, cmdAttach, cmdStatus, cmdInfo } = await import("./cli/commands")

  switch (command.type) {
    case "new":
      await cmdNew(command.options)
      break
    case "list":
      await cmdList(command.options)
      break
    case "delete":
      await cmdDelete(command.id, command.worktree, command.force)
      break
    case "stop":
      await cmdStop(command.id)
      break
    case "restart":
      await cmdRestart(command.id)
      break
    case "attach":
      await cmdAttach(command.id)
      break
    case "status":
      await cmdStatus(command.id)
      break
    case "info":
      await cmdInfo(command.id, command.json)
      break
  }
}

async function launchTUI(mode: "light" | "dark"): Promise<void> {
  const { tui } = await import("./tui/app")
  await tui({
    mode,
    onExit: async () => {
      console.log("Goodbye!")
    }
  })
}

async function main() {
  const command = parseArgs(process.argv)

  if (command.type === "help") {
    printHelp()
    process.exit(0)
  }

  if (command.type === "version") {
    const pkg = await import("../package.json")
    console.log(`agent-view v${pkg.version}`)
    process.exit(0)
  }

  if (command.type === "tui") {
    try {
      await launchTUI(command.mode)
    } catch (error) {
      console.error("Fatal error:", error)
      process.exit(1)
    }
    return
  }

  // Headless command
  try {
    await executeHeadlessCommand(command)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Error: ${message}\n`)
    process.exit(1)
  }
}

main()
