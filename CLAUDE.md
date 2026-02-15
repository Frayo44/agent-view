# Agent View

OpenTUI-based terminal interface for managing and monitoring AI coding agent sessions.

## Tech Stack

- **Runtime:** Bun
- **Framework:** Solid.js
- **UI:** OpenTUI (terminal UI framework)
- **Storage:** SQLite (via bun:sqlite)
- **Session Management:** tmux

## Project Structure

```
src/
├── cli/           # CLI entry point
├── core/          # Core business logic
│   ├── git.ts     # Git/worktree utilities
│   ├── history.ts # History manager for autocomplete
│   ├── session.ts # Session lifecycle management
│   ├── storage.ts # SQLite storage layer
│   ├── tmux.ts    # tmux session control
│   └── types.ts   # TypeScript types
└── tui/           # Terminal UI
    ├── component/ # Reusable components (dialogs)
    ├── context/   # Solid.js contexts (theme, sync, routes)
    ├── routes/    # Page components (home, session)
    └── ui/        # Base UI components (dialog, toast, autocomplete)
```

## Key Features

- **Session Management:** Create, stop, restart, delete AI agent sessions
- **Multiple Tools:** Claude Code, OpenCode, Gemini, Codex, Custom commands
- **Git Worktrees:** Create sessions in isolated git worktrees
- **Auto-suggestions:** Fuzzy search for previously used paths and branch names
- **Status Monitoring:** Real-time session status (running, waiting, idle, error)

## Development

```bash
bun install      # Install dependencies
bun run dev      # Run in development mode
bun run build    # Build for production
bun test         # Run tests
```

## Important Files

- `src/tui/component/dialog-new.tsx` - New session dialog with tool selection
- `src/tui/routes/home.tsx` - Main home screen with session list
- `src/core/session.ts` - Session creation and lifecycle
- `src/core/git.ts` - Git worktree operations
