# @laravel/multiplex

Tabbed TUI for running multiple CLI commands simultaneously. Built with Ink (React for terminals), TypeScript, Commander.

## Scope

This is for the commands you run **while you are actively developing** — a dev server, a queue listener, a watcher, a build in watch mode — for the length of a working session, with you sitting in front of it.

It is not a CI runner and not a process supervisor. It works fine in CI (inline mode exits with a real code, `--json` is parseable) and nothing should gratuitously break there, but CI is not what the defaults are tuned for. Neither is unattended operation: there is no daemonising, no log rotation, no restart policy worth the name, and buffers are capped for memory rather than kept for later.

Weigh proposals against the working session. "What if this runs for three days" and "what if nobody is watching" are usually the wrong questions here; "what happens when I save a file and something crashes" is the right one.

## Commands

- `pnpm run build` — TypeScript compile to `dist/`
- `pnpm test` — run tests via `tsx --test`
- `pnpm run dev` — run from source via tsx
- `pnpm run check` — biome lint + format (auto-fix)
- `pnpm run lint` — biome lint only

Always run build + test after changes.

## Architecture

- `cli.tsx` — CLI entry point. Parses argv with Commander, then hands off to `multiplex()` and exits with its code. Validation errors from `multiplex()` are reported through `program.error`.
- `multiplex.tsx` — the package's programmatic entry point (`main`/`exports`), exporting `multiplex(options)`. Validates options, then runs either `runTui()` or `runInlineMode()`. Each has its own `shutdown()`, wired to normal exit, failure, and SIGINT/SIGTERM/SIGHUP/SIGQUIT via the shared `installTeardown`.
- `app.tsx` — Main React/Ink component. Sidebar + content panes, keyboard input handling, search overlay, stream/tab mode toggle.
- `supervisor.ts` — The process layer, with no React and no rendering in it: spawn, line splitting, restart accounting, auto-restart with a 5-attempt limit, and settle detection. Emits events; both front ends drive it.
- `use-processes.ts` — Thin React wrapper over the supervisor. Turns its events into the TUI's per-command buffers, stream lines, `failedProcs` state and desktop notifications.
- `inline.ts` — The non-TUI front end. Same supervisor, but each line is written to stdout/stderr as it arrives, or serialised as NDJSON when `json` is set. Resolves with an exit code when everything has settled.
- `use-scroll.ts` — Hook for scroll state (offset tracking, page up/down, new-output indicator).
- `search.ts` — ANSI-aware search in two phases: `indexMatches` counts and locates matches across the whole buffer, `highlightLine` highlights a single line. Strips escape codes for matching, preserves them in output, highlights across ANSI boundaries.
- `args.ts` — Command palette plus the two input paths onto `CommandDef[]`: `parseCommandDef` for CLI positionals (incremental, one value at a time) and `normalizeCommands` for programmatic input (validates and fills in colors for the whole list at once).
- `util.ts` — Shared constants and helpers (hex-to-RGB, timestamp formatting, dynamic sidebar width).
- `types.ts` — Shared type definitions.

## Design decisions

- **A missing TTY is a fallback, not an error.** Piping, redirecting or running from CI drops to inline mode instead of refusing to start, because those are the cases where people most want a process runner. There is deliberately no flag to restore the old hard failure: it would only ever fire where nobody wanted a TUI anyway.
- **The supervisor emits events, not formatted text.** It would have been shorter to keep building the `Process exited with code 1` strings where the exit is handled, but then JSON output would be a scrape of the human output and every renderer would inherit the TUI's wording. Each front end decides how an event reads.
- **`onData` exists alongside `onLine` for one reason.** The tabbed view shows raw chunks so a partial line — a progress bar, a prompt — is visible before its newline lands. Everything line-oriented (the stream buffer, inline mode, JSON) uses `onLine` and waits for the newline. Dropping `onData` and rebuilding the tab buffer from lines would make unterminated output invisible until the process exits.
- **Inline mode's defaults are not the TUI's**, in two places only: it exits when the last command does, and it exits with the first permanent failure's code. Everything else, auto-restart included, is identical — a mode-dependent default means the same command line behaves differently depending on whether someone piped it, which is worse than either choice.
- **Restart is guarded by uptime, not by mode.** A crash inside `MIN_UPTIME_FOR_RESTART_MS` is never retried, because a command that died that fast never started; anything longer-lived gets the full 5 attempts. This is what replaced an earlier mode-dependent default, and it is why there is one `--no-restart` flag rather than a `--restart`/`--no-restart` pair plus a `getOptionValueSource` dance in `cli.tsx` to tell "not passed" from "passed false". `onFailed` carries a `FailureReason` so the distinction is visible rather than looking like a silently skipped restart.
- **Only permanent failures set the exit code.** `onFailed`, not `onExit` — a command that crashed, auto-restarted and then ran clean did not fail the run.
- **Multiplex's own notices go to stderr inline.** Command output goes to whichever stream it came from, so `multiplex ... > out.log` gets the commands' stdout and nothing else. This is why the supervisor tags every line with its stream, which the old merged `handleData` threw away.
- **JSON events carry a `v`.** Anything parsing the stream needs to know when the shape changes; bumping `JSON_SCHEMA_VERSION` is the contract. `text` is ANSI-stripped, because a consumer parsing JSON does not want escape codes inside a string field.
- **SIGKILL is intentional at all kill sites.** Exit and signal handlers are synchronous (can't wait for SIGTERM), manual restart spawns the replacement immediately (SIGTERM would race on port binding), and cleanup on unmount has no event loop to wait on. Do not change to SIGTERM.
- **`intentionalKills` (in `supervisor.ts`) counts outstanding intentional kills; only bump it when the kill lands.** It exists to stop our own SIGKILL being reported as a crash, and every entry must be paid for by a real exit event. Bumping it for a process that has already exited (or never spawned, so has no pid) leaves it set with no exit coming, which swallows the replacement's crash and leaves a dead process looking healthy in the sidebar — reachable by pressing `r` on a failed tab, the documented recovery path. Hence the `exitCode === null && signalCode === null` guard, and the bump sitting after `process.kill` inside the `try`. It is a count rather than a flag so two rapid restarts don't report the second kill as a crash.
- **Signal handlers are load-bearing, not belt-and-braces.** `process.on("exit")` does not run when the process is killed by a signal, and children are spawned into their own process groups so they never receive the terminal's SIGHUP. Without explicit SIGINT/SIGTERM/SIGHUP/SIGQUIT handlers, closing the terminal window leaves every dev server running and holding its port.
- **`shutdown()` ordering is fixed:** unmount Ink → kill children → leave the alternate screen → flush output. Ink's final frame and its raw-mode teardown have to happen while we still own the alternate screen; the flush has to happen after we've left it, or the logs never reach real scrollback. It guards on `shuttingDown`, so a second signal mid-flush force-exits rather than printing twice.
- **`multiplex()` never calls `process.exit` on its own.** It returns an exit code and removes the signal and exit listeners it installed, so a host process that calls it programmatically survives and keeps a usable terminal. Only the signal handlers exit, because a signal has to terminate the process.
- **Process groups:** Children are spawned with `detached: true` and killed via `process.kill(-pid)` to ensure the entire process tree is cleaned up.
- **Auto color selection** avoids duplicates by checking which palette colors are already assigned before falling back to cycling — matches the Laravel framework's `DevCommands.php` behavior.
- **Sidebar width** is computed dynamically from label lengths, clamped between 15 and 40 characters.
- **`COLUMNS` is the narrower of the two layouts.** Children get it once at spawn and it can't be updated, so one value has to serve both modes — toggling with `t` must not invalidate it, and respawning to resize would kill dev servers on a keystroke. `childColumns` errs narrow deliberately, because output wider than the pane costs a re-wrap and a ragged right edge while narrower output only wraps early. Resizing the terminal leaves it stale; restarting a process with `r` re-reads the current width.
- **`COLUMNS` is a request, not a guarantee, so the renderer wraps anyway.** Node never maps the env var onto `process.stdout.columns`, and plenty of tools read neither — Vite emits a 166-column warning on boot in a stock Laravel app and does the same under a real pty at 60 columns, because its logger never consults width at all. Truncating that line drops the half that says how to fix it, so `wrapLine` splits every line into the rows it occupies. A pty would not have helped; only wrapping does.
- **Wrapping happens on arrival, not at render.** `use-processes.ts` stores rows already wrapped to the pane, so one buffer entry is one screen row and the scroll offsets, the scrollbar thumb and the search index all keep working on plain array indices. Wrapping in the renderer instead would mean re-wrapping the whole buffer on every tick, which is the same quadratic trap that the highlight rule below exists to avoid. Two consequences to keep in mind: `bufferSize` now counts rows, so one enormous line can evict real history, and a resize leaves already-stored rows wrapped at the old width.
- **The tabbed buffer is rows plus a raw tail.** `outputRowsRef` holds complete wrapped rows; `outputPendingRef` holds whatever has arrived since the last newline, still unwrapped because more of it is coming. Only the tail is wrapped at render time. Together they reproduce the old single-string buffer's `split("\n")` exactly, which is why `commitPending` pushes even when the tail is empty — that is the blank row a trailing newline used to leave.
- **Continuation rows drop the label but keep the rule.** `formatStreamContinuation` is padded to the same width as `formatStreamLabel`, so a wrapped line in stream mode stays in its column instead of reading as two separate lines from the same command. The exit flush uses it too, so scrollback matches what was on screen.
- **Buffer trimming** uses a 1.5x threshold to avoid trimming on every line of output.
- **Render batching** via `setTimeout(fn, 16)` to avoid excessive React re-renders from fast-arriving process output.
- **Never highlight the whole buffer.** Search indexes the full buffer linearly but only highlights the visible window. Highlighting everything was quadratic — searching a full 10k-line stream buffer for a common letter blocked the event loop for ~38 seconds, which also swallowed the keystrokes that would have cancelled it.
- **`stripAnsi`'s regex must mirror `parseSegments`.** `indexMatches` strips with a regex while `highlightLine` rebuilds plain text from parsed segments. If they disagree on what counts as plain text, match offsets drift and the wrong match gets flagged as active. A test in `search.test.ts` pins this against OSC sequences, stray escapes, and carriage returns.
- **The title is stripped, not escaped.** OSC strings have no escape mechanism, so a control character in `--title` can't be quoted — a BEL or ESC terminates the sequence and the rest of the title reaches the terminal as commands. `sanitizeTitle` drops control characters at the option boundary in `multiplex()`, so the OSC write, the Ink frame and the desktop notification all get the sanitized value.
- **`renderTick` is the buffer revision.** Output buffers live in refs, so React can't see them change. Anything memoized off buffer contents keys on `renderTick`, which `triggerRender` bumps after every mutation.

## Release

Run `./release.sh` on `main` with a clean working tree. It bumps the version in both `package.json` and `cli.tsx`, commits, tags, pushes, and creates a GitHub release. CI publishes to npm on release.
