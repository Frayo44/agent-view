/**
 * Simple CLI argument parser
 * No external dependencies - parses process.argv into structured commands
 */

export type CLICommand =
  | { type: "tui"; mode: "light" | "dark" }
  | { type: "help" }
  | { type: "version" }
  | { type: "new"; options: NewOptions }
  | { type: "list"; options: ListOptions }
  | { type: "delete"; id: string; worktree: boolean; force: boolean }
  | { type: "stop"; id: string }
  | { type: "restart"; id: string }
  | { type: "attach"; id: string }
  | { type: "status"; id: string }
  | { type: "info"; id: string; json: boolean }

export interface NewOptions {
  path: string
  tool: string
  title?: string
  command?: string
  group?: string
  worktree: boolean
  branch?: string
  baseDevelop: boolean
  resume: boolean
  skipPermissions: boolean
}

export interface ListOptions {
  group?: string
  status?: string
  json: boolean
}

function getFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1 || idx + 1 >= args.length) return undefined
  return args[idx + 1]
}

export function parseArgs(argv: string[]): CLICommand {
  const args = argv.slice(2)

  if (args.length === 0) {
    return { type: "tui", mode: "dark" }
  }

  if (getFlag(args, "--help") || getFlag(args, "-h")) {
    return { type: "help" }
  }

  if (getFlag(args, "--version") || getFlag(args, "-v")) {
    return { type: "version" }
  }

  if (getFlag(args, "--new") || getFlag(args, "-n")) {
    return {
      type: "new",
      options: {
        path: getFlagValue(args, "--path") ?? process.cwd(),
        tool: getFlagValue(args, "--tool") ?? "claude",
        title: getFlagValue(args, "--title"),
        command: getFlagValue(args, "--command"),
        group: getFlagValue(args, "--group"),
        worktree: getFlag(args, "--worktree"),
        branch: getFlagValue(args, "--branch"),
        baseDevelop: getFlag(args, "--base-develop"),
        resume: getFlag(args, "--resume"),
        skipPermissions: getFlag(args, "--skip-permissions"),
      },
    }
  }

  if (getFlag(args, "--list") || getFlag(args, "-l")) {
    return {
      type: "list",
      options: {
        group: getFlagValue(args, "--group"),
        status: getFlagValue(args, "--status"),
        json: getFlag(args, "--json"),
      },
    }
  }

  if (getFlag(args, "--delete")) {
    const id = getFlagValue(args, "--delete")
    if (!id) {
      process.stderr.write("Error: --delete requires a session ID or title\n")
      process.exit(2)
    }
    return {
      type: "delete",
      id,
      worktree: getFlag(args, "--worktree"),
      force: getFlag(args, "--force") || getFlag(args, "-f"),
    }
  }

  if (getFlag(args, "--stop")) {
    const id = getFlagValue(args, "--stop")
    if (!id) {
      process.stderr.write("Error: --stop requires a session ID or title\n")
      process.exit(2)
    }
    return { type: "stop", id }
  }

  if (getFlag(args, "--restart")) {
    const id = getFlagValue(args, "--restart")
    if (!id) {
      process.stderr.write("Error: --restart requires a session ID or title\n")
      process.exit(2)
    }
    return { type: "restart", id }
  }

  if (getFlag(args, "--attach") || getFlag(args, "-a")) {
    const id = getFlagValue(args, "--attach") ?? getFlagValue(args, "-a")
    if (!id) {
      process.stderr.write("Error: --attach requires a session ID or title\n")
      process.exit(2)
    }
    return { type: "attach", id }
  }

  if (getFlag(args, "--status")) {
    const id = getFlagValue(args, "--status")
    if (!id) {
      process.stderr.write("Error: --status requires a session ID or title\n")
      process.exit(2)
    }
    return { type: "status", id }
  }

  if (getFlag(args, "--info")) {
    const id = getFlagValue(args, "--info")
    if (!id) {
      process.stderr.write("Error: --info requires a session ID or title\n")
      process.exit(2)
    }
    return { type: "info", id, json: getFlag(args, "--json") }
  }

  // Fallback: TUI mode with optional --light
  const mode = getFlag(args, "--light") ? "light" : "dark"
  return { type: "tui", mode }
}

export function printHelp(): void {
  console.log(`
Agent View - Terminal Agent Management

Usage:
  av [options]                    Launch TUI (default)
  av --new [flags]                Create a new session
  av --list [flags]               List sessions
  av --delete <id> [flags]        Delete a session
  av --stop <id>                  Stop a session
  av --restart <id>               Restart a session
  av --attach <id>                Attach to a session
  av --status <id>                Get session status
  av --info <id> [--json]         Get session details

TUI Options:
  --light                         Use light mode theme

New Session (--new, -n):
  --path <dir>                    Project path (default: cwd)
  --tool <name>                   Tool: claude|opencode|gemini|codex|custom|shell (default: claude)
  --title <name>                  Session title (default: auto-generated)
  --command <cmd>                 Custom command (requires --tool custom)
  --group <path>                  Group path (default: my-sessions)
  --worktree                      Create in git worktree
  --branch <name>                 Worktree branch name (requires --worktree)
  --base-develop                  Base worktree on develop branch
  --resume                        Resume existing Claude session
  --skip-permissions              Skip Claude permission prompts

List Sessions (--list, -l):
  --group <path>                  Filter by group
  --status <status>               Filter: running|waiting|idle|stopped|error
  --json                          Output as JSON

Delete Session (--delete):
  --worktree                      Also delete the git worktree
  --force, -f                     Skip confirmation prompt

General:
  --help, -h                      Show this help message
  --version, -v                   Show version
`)
}
