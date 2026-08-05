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

- `cli.tsx` — CLI entry point. Parses argv with Commander, then hands off to `multiplex()` and exits with its code. Validation errors from `multiplex()` are reported through `program.error`.
- `multiplex.tsx` — the package's programmatic entry point (`main`/`exports`), exporting `multiplex(options)`. Validates options, sets up alternate screen, renders `<App>`, and resolves with an exit code once everything is torn down. All teardown funnels through a single `shutdown()`, wired to normal exit, render failure, and SIGINT/SIGTERM/SIGHUP/SIGQUIT.
- `app.tsx` — Main React/Ink component. Sidebar + content panes, keyboard input handling, search overlay, stream/tab mode toggle.
- `use-processes.ts` — Hook that spawns/manages child processes. Handles stdout/stderr buffering, auto-restart with 5-attempt limit, desktop notifications on permanent failure.
- `use-scroll.ts` — Hook for scroll state (offset tracking, page up/down, new-output indicator).
- `search.ts` — ANSI-aware search in two phases: `indexMatches` counts and locates matches across the whole buffer, `highlightLine` highlights a single line. Strips escape codes for matching, preserves them in output, highlights across ANSI boundaries.
- `args.ts` — Command palette plus the two input paths onto `CommandDef[]`: `parseCommandDef` for CLI positionals (incremental, one value at a time) and `normalizeCommands` for programmatic input (validates and fills in colors for the whole list at once).
- `util.ts` — Shared constants and helpers (hex-to-RGB, timestamp formatting, dynamic sidebar width).
- `types.ts` — Shared type definitions.

## Design decisions

- **SIGKILL is intentional at all kill sites.** Exit and signal handlers are synchronous (can't wait for SIGTERM), manual restart spawns the replacement immediately (SIGTERM would race on port binding), and cleanup on unmount has no event loop to wait on. Do not change to SIGTERM.
- **Signal handlers are load-bearing, not belt-and-braces.** `process.on("exit")` does not run when the process is killed by a signal, and children are spawned into their own process groups so they never receive the terminal's SIGHUP. Without explicit SIGINT/SIGTERM/SIGHUP/SIGQUIT handlers, closing the terminal window leaves every dev server running and holding its port.
- **`shutdown()` ordering is fixed:** unmount Ink → kill children → leave the alternate screen → flush output. Ink's final frame and its raw-mode teardown have to happen while we still own the alternate screen; the flush has to happen after we've left it, or the logs never reach real scrollback. It guards on `shuttingDown`, so a second signal mid-flush force-exits rather than printing twice.
- **`multiplex()` never calls `process.exit` on its own.** It returns an exit code and removes the signal and exit listeners it installed, so a host process that calls it programmatically survives and keeps a usable terminal. Only the signal handlers exit, because a signal has to terminate the process.
- **Process groups:** Children are spawned with `detached: true` and killed via `process.kill(-pid)` to ensure the entire process tree is cleaned up.
- **Auto color selection** avoids duplicates by checking which palette colors are already assigned before falling back to cycling — matches the Laravel framework's `DevCommands.php` behavior.
- **Sidebar width** is computed dynamically from label lengths, clamped between 15 and 40 characters.
- **Buffer trimming** uses a 1.5x threshold to avoid trimming on every line of output.
- **Render batching** via `setTimeout(fn, 16)` to avoid excessive React re-renders from fast-arriving process output.
- **Never highlight the whole buffer.** Search indexes the full buffer linearly but only highlights the visible window. Highlighting everything was quadratic — searching a full 10k-line stream buffer for a common letter blocked the event loop for ~38 seconds, which also swallowed the keystrokes that would have cancelled it.
- **`stripAnsi`'s regex must mirror `parseSegments`.** `indexMatches` strips with a regex while `highlightLine` rebuilds plain text from parsed segments. If they disagree on what counts as plain text, match offsets drift and the wrong match gets flagged as active. A test in `search.test.ts` pins this against OSC sequences, stray escapes, and carriage returns.
- **The title is stripped, not escaped.** OSC strings have no escape mechanism, so a control character in `--title` can't be quoted — a BEL or ESC terminates the sequence and the rest of the title reaches the terminal as commands. `sanitizeTitle` drops control characters at the option boundary in `multiplex()`, so the OSC write, the Ink frame and the desktop notification all get the sanitized value.
- **`renderTick` is the buffer revision.** Output buffers live in refs, so React can't see them change. Anything memoized off buffer contents keys on `renderTick`, which `triggerRender` bumps after every mutation.

## Release

Run `./release.sh` on `main` with a clean working tree. It bumps the version in both `package.json` and `cli.tsx`, commits, tags, pushes, and creates a GitHub release. CI publishes to npm on release.
