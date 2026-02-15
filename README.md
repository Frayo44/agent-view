# Agent View

OpenTUI-based interface for managing and monitoring AI agents.

## Tech Stack

- **Runtime:** Bun
- **Framework:** Solid.js
- **UI:** OpenTUI

## Getting Started

```bash
# Install dependencies
bun install

# Build
bun run build

# Run
bun run start

# Development
bun run dev
```

## Scripts

| Script | Description |
|--------|-------------|
| `bun run build` | Build the project |
| `bun run dev` | Build and run in development mode |
| `bun run start` | Run the built application |
| `bun run test` | Run unit tests |
| `bun run test:watch` | Run tests in watch mode |
| `bun run typecheck` | Run TypeScript type checking |

## Project Structure

```
src/
├── cli/          # CLI entry point
├── components/   # UI components
├── core/         # Core utilities (git, tmux, storage, session)
├── hooks/        # Solid.js hooks
├── screens/      # Screen components
└── types/        # TypeScript type definitions
```

## License

MIT
