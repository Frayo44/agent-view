Use the `av` CLI to manage agent-view sessions without the TUI.

## Create a session

```bash
av --new --path $PROJECT_PATH --tool claude
```

Flags:
- `--path <dir>` — Project directory (default: cwd)
- `--tool <name>` — claude | opencode | gemini | codex | custom | shell (default: claude)
- `--title <name>` — Session title (default: auto-generated)
- `--command <cmd>` — Custom command (requires `--tool custom`)
- `--group <path>` — Group path (default: my-sessions)
- `--worktree` — Create in a git worktree
- `--branch <name>` — Worktree branch name (requires `--worktree`)
- `--base-develop` — Base worktree on develop branch
- `--resume` — Resume existing Claude session
- `--skip-permissions` — Skip Claude permission prompts

## List sessions

```bash
av --list
av --list --status running
av --list --json
```

## Session actions

```bash
av --stop <id-or-title>
av --restart <id-or-title>
av --attach <id-or-title>
av --delete <id-or-title> --force
av --delete <id-or-title> --worktree --force
```

## Session info

```bash
av --status <id-or-title>
av --info <id-or-title>
av --info <id-or-title> --json
```

Sessions can be referenced by full ID, title, or ID prefix. Changes made via CLI appear in any running TUI instance automatically.
