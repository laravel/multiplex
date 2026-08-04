# @laravel/multiplex

Tabbed TUI for running multiple CLI commands simultaneously. Built with Ink (React for terminals), TypeScript, Commander.

## Commands

- `pnpm run build` — TypeScript compile to `dist/`
- `pnpm test` — run tests via `tsx --test`
- `pnpm run dev` — run from source via tsx
- `pnpm run check` — biome lint + format (auto-fix)
- `pnpm run lint` — biome lint only

Always run build + test after changes.

## Architecture

- `cli.tsx` — CLI entry point. Parses args, sets up alternate screen, renders `<App>`, flushes output on exit.
- `app.tsx` — Main React/Ink component. Sidebar + content panes, keyboard input handling, search overlay, stream/tab mode toggle.
- `use-processes.ts` — Hook that spawns/manages child processes. Handles stdout/stderr buffering, auto-restart with 5-attempt limit, desktop notifications on permanent failure.
- `use-scroll.ts` — Hook for scroll state (offset tracking, page up/down, new-output indicator).
- `search.ts` — ANSI-aware search highlighting. Strips escape codes for matching, preserves them in output, highlights across ANSI boundaries.
- `util.ts` — Shared constants and helpers (hex-to-RGB, timestamp formatting, dynamic sidebar width).
- `types.ts` — Shared type definitions.

## Design decisions

- **SIGKILL is intentional at all kill sites.** Exit handlers are synchronous (can't wait for SIGTERM), manual restart spawns the replacement immediately (SIGTERM would race on port binding), and cleanup on unmount has no event loop to wait on. Do not change to SIGTERM.
- **Process groups:** Children are spawned with `detached: true` and killed via `process.kill(-pid)` to ensure the entire process tree is cleaned up.
- **Auto color selection** avoids duplicates by checking which palette colors are already assigned before falling back to cycling — matches the Laravel framework's `DevCommands.php` behavior.
- **Sidebar width** is computed dynamically from label lengths, clamped between 15 and 40 characters.
- **Buffer trimming** uses a 1.5x threshold to avoid trimming on every line of output.
- **Render batching** via `setTimeout(fn, 16)` to avoid excessive React re-renders from fast-arriving process output.

## Release

Run `./release.sh` on `main` with a clean working tree. It bumps the version in both `package.json` and `cli.tsx`, commits, tags, pushes, and creates a GitHub release. CI publishes to npm on release.
