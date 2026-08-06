# @laravel/multiplex

A tabbed TUI for running multiple commands simultaneously with searchable, scrollable output. Built with [Ink](https://github.com/vadimdemedes/ink).

When you exit, the interleaved output is flushed to your terminal scrollback so you don't lose your logs, up to the `--stream-buffer-size` limit.

Without an interactive terminal — piped, redirected, or in CI — it runs [inline](#inline-mode) instead: same labelled, interleaved output, printed as it arrives, with no TUI.

## Install

```bash
npm install -g @laravel/multiplex
```

Or run directly:

```bash
npx @laravel/multiplex 'server,php artisan serve' 'queue,php artisan queue:listen'
```

## Requirements

- **Node 22.13 or later.**
- **An interactive terminal, for the TUI.** Both stdin and stdout must be a TTY. Without one, multiplex runs in [inline mode](#inline-mode) instead of failing.
- **Non-interactive commands.** Child processes are spawned without stdin, so anything that prompts for input — `php artisan tinker`, a migration confirmation — won't work.
- **A stable terminal width.** Children are told how wide they are via `COLUMNS` when they start, and that can't be updated afterwards. Resizing the terminal leaves already-running commands sizing their output to the old width; press `r` to restart one against the new width.

## Usage

```bash
multiplex [options] <commands...>
```

Each command is passed as a positional argument in the format:

```
label,command
label,#color,command
```

Colors are optional 6-digit hex values such as `#93c5fd`. If omitted, they're assigned automatically from a built-in palette, avoiding duplicates. A malformed color is an error rather than being ignored, and shorthand like `#fff` is not accepted.

### Examples

```bash
# Basic usage
multiplex 'server,php artisan serve' 'queue,php artisan queue:listen' 'vite,pnpm run dev'

# With custom colors
multiplex 'server,#93c5fd,php artisan serve' 'queue,#fb7185,php artisan queue:listen'

# Set the terminal tab title
multiplex --title "Admin" 'server,php artisan serve' 'queue,php artisan queue:listen'

# Start in stream mode with timestamps
multiplex -s --timestamps 'server,php artisan serve' 'queue,php artisan queue:listen'

# Custom working directory
multiplex --cwd /path/to/project 'server,php artisan serve'

# Disable auto-restart
multiplex --no-restart 'build,pnpm run build'
```

### Options

| Option | Description | Default |
| --- | --- | --- |
| `--title <name>` | Set the terminal tab title | |
| `--cwd <path>` | Set the working directory (must exist) | Current directory |
| `-s, --stream` | Start in stream mode (interleaved output) | `false` |
| `-i, --inline` | Print output inline instead of rendering the TUI | On when not a TTY |
| `--json` | Emit newline-delimited JSON events. Implies `--inline` | `false` |
| `--timestamps` | Display timestamps on each output line | `false` |
| `--no-restart` | Disable auto-restart on crash | |
| `--buffer-size <lines>` | Max lines kept per command buffer | `2000` |
| `--stream-buffer-size <lines>` | Max lines kept in stream buffer | `10000` |

## Inline Mode

Inline mode is multiplex without the TUI: no alternate screen, no keyboard handling, no tabs or search. Every line is written straight to your terminal as it arrives, prefixed with the command's colored label — the same interleaved format the TUI flushes to scrollback when you quit. Your existing scrollback is left alone, output scrolls normally, and `Ctrl-C` still tears down the whole process tree.

It's used automatically whenever stdin or stdout isn't a TTY, so `multiplex ... | tee log`, `make dev` and CI jobs all work. Use `-i` to ask for it in a real terminal.

A few things behave differently from the TUI, because the TUI's defaults are wrong for a pipeline:

- **The run ends when the last command does.** The TUI stays open showing dead tabs; inline mode exits.
- **The exit code reflects your commands.** The first command to fail permanently sets the exit code; if none do, it's `0`. The TUI always exits `0`.
- **stderr stays on stderr.** Command output goes to the stream it came from, and multiplex's own notices ("Process exited with code 1") always go to stderr, so a redirected stdout holds nothing but your commands' output.
- **Color follows the usual rules** — on when stdout is a TTY, forced by `FORCE_COLOR`, disabled by `NO_COLOR`.

```bash
multiplex -i 'build,pnpm run build' 'test,pnpm test'
multiplex 'lint,pnpm lint' 'types,tsc --noEmit' | tee ci.log
```

### JSON Output

`--json` writes newline-delimited JSON to stdout, one object per event, instead of formatted lines. It implies `--inline`. Nothing else is written to stdout, so the stream is safe to pipe into `jq`.

```bash
multiplex --json 'build,pnpm run build' 'test,pnpm test' | jq -c 'select(.type == "failed")'
```

```json
{"v":1,"time":"2026-01-01T12:00:00.000Z","type":"start","label":"build","command":"pnpm run build","pid":4123}
{"v":1,"time":"2026-01-01T12:00:00.412Z","type":"output","label":"build","stream":"stdout","text":"compiled in 320ms"}
{"v":1,"time":"2026-01-01T12:00:01.900Z","type":"exit","label":"test","code":1,"signal":null}
{"v":1,"time":"2026-01-01T12:00:01.901Z","type":"restarting","label":"test","attempt":1,"max":5}
{"v":1,"time":"2026-01-01T12:00:06.100Z","type":"failed","label":"test","code":1}
{"v":1,"time":"2026-01-01T12:00:06.101Z","type":"done","code":1}
```

`reason` on a `failed` event is one of `spawn-error`, `crashed-immediately`, `attempts-exhausted` or `restart-disabled`. Every event carries `v` (the schema version, currently `1`) and an ISO-8601 `time`. `text` has ANSI escape codes stripped. A `start` event is emitted for each restart as well as the first spawn, and `done` is always the last line.

| `type` | Fields | Meaning |
| --- | --- | --- |
| `start` | `label`, `command`, `pid` | A command was spawned |
| `output` | `label`, `stream`, `text` | One line of output, from `stdout` or `stderr` |
| `exit` | `label`, `code`, `signal` | A command exited |
| `restarting` | `label`, `attempt`, `max` | An auto-restart was scheduled |
| `error` | `label`, `message` | The command could not be spawned |
| `failed` | `label`, `code`, `reason` | A command failed for good; no more restarts |
| `done` | `code` | Every command has stopped; the process exit code |

## Programmatic API

The package also exports `multiplex()`, so you can start the TUI from your own script instead of going through the CLI:

```ts
import { multiplex } from "@laravel/multiplex";

const code = await multiplex({
    commands: [
        { label: "server", command: "php artisan serve" },
        { label: "queue", color: "#fb7185", command: "php artisan queue:listen" },
    ],
    stream: true,
});

process.exit(code);
```

Every `command` is run through `sh -c`, so it is a shell string, not an argv array — pipes, redirects and `&&` all work. That also means **you must never build a `command` out of untrusted input.** Anything that reaches the string is executed with the privileges of the calling process, so a value taken from a config file, a request payload or a workspace manifest is a remote code execution vector. If the commands are not written by you, quote every interpolated value yourself before passing it in.

`multiplex()` takes over the terminal for the duration of the call: it enters the alternate screen, installs its own `SIGINT`/`SIGTERM`/`SIGHUP`/`SIGQUIT` handlers, and renders the TUI. It resolves with the same exit code the CLI would have used — `0` normally, `1` if rendering failed. By then the terminal is restored, every child process is dead, the buffered output has been flushed to scrollback, and the signal handlers it installed have been removed, so the calling process is free to carry on.

If stdin or stdout isn't a TTY it runs [inline](#inline-mode) instead, resolving with the first failing command's exit code. Set `inline: true` to ask for that in a real terminal.

Options are validated before anything is written to the terminal, so an invalid option throws with the screen untouched.

| Option | Type | Description | Default |
| --- | --- | --- | --- |
| `commands` | `{ label, command, color? }[]` | Required, at least one. `color` is an optional 6-digit hex value | |
| `title` | `string` | Set the terminal tab title | |
| `cwd` | `string` | Set the working directory (must exist) | `process.cwd()` |
| `inline` | `boolean` | Print output inline instead of rendering the TUI | On when not a TTY |
| `json` | `boolean` | Emit newline-delimited JSON events on stdout. Implies inline | `false` |
| `stream` | `boolean` | Start in stream mode (interleaved output) | `false` |
| `timestamps` | `boolean` | Display timestamps on each output line | `false` |
| `restart` | `boolean` | Auto-restart on crash | `true` |
| `bufferSize` | `number` | Max lines kept per command buffer | `2000` |
| `streamBufferSize` | `number` | Max lines kept in stream buffer | `10000` |

Commands that omit a color are assigned one from the built-in palette (also exported as `DEFAULT_COLORS`), avoiding colors used elsewhere in the list.

## Auto-Restart

Processes that crash (exit with a non-zero code) are automatically restarted after a 1-second delay, up to 5 times; on the 6th consecutive failure they stop restarting and are marked as failed. A manual restart with `r` resets the counter. This is the same in the TUI and inline.

**A command that dies within a second of starting is not retried at all.** Something that fails that fast never got off the ground — a typo, a port already bound, a missing binary — and retrying only scrolls the real error out of view while you fix it. A command that was up for longer was working until it wasn't, which is the case auto-restart exists for.

A desktop notification is sent when a process permanently fails (macOS via `osascript`, Linux via `notify-send` if available).

Use `--no-restart` to turn it off entirely, for one-shot commands like builds or migrations.

## Keyboard Shortcuts

### Navigation

| Key | Action |
| --- | --- |
| `1`-`9` | Jump to tab by number |
| `Tab` | Toggle focus between sidebar and content |
| `Left` / `Right` | Move focus to sidebar / content |
| `Up` / `Down` / `j` / `k` | Navigate tabs (sidebar) or scroll (content) |
| `Page Up` / `Page Down` | Scroll one page |
| `g` / `G` | Scroll to top / bottom |

### Actions

| Key | Action |
| --- | --- |
| `s` | Switch to stream mode |
| `t` | Switch to tabbed mode |
| `r` | Restart the selected process |
| `c` | Clear output (current tab or stream) |
| `f` | Filter which commands appear in the stream |
| `/` | Open search |
| `q` | Quit |

`s`, `r`, `Tab` and `Left`/`Right` apply to tabbed mode; `t` and `f` apply to stream mode. Pressing the key for the mode you are already in does nothing. In filter mode, `1`-`9` toggle each command on and off and `f` or `Esc` closes it — you can always leave at least one command visible.

### Search

| Key | Action |
| --- | --- |
| `Enter` | Confirm search |
| `Esc` | Cancel search / clear results |
| `n` / `N` | Next / previous match |

## Features

- **Inline mode** when there's no TTY, so pipes and CI get labelled output and a real exit code instead of an error
- **JSON output** as newline-delimited events, for anything that needs to parse a run
- **Tabbed view** with a sidebar showing all running commands
- **Stream mode** for interleaved output with colored labels, with per-command filtering
- **Search** with ANSI-aware highlighting across output
- **Timestamps** on output lines in both tabbed and stream modes
- **Auto-restart** crashed processes with a 5-attempt limit
- **Desktop notifications** when a process permanently fails
- **Scrollbar** when content exceeds the viewport
- **Process management** - restart failed processes, clear output
- **Error indicators** in the sidebar when a process fails
- **New output indicator** when scrolled up and new data arrives
- **Buffer limits** to keep memory usage low during long sessions
- **Output flush** on exit so logs are preserved in terminal scrollback
- **Process group cleanup** on quit and on `SIGINT`/`SIGTERM`/`SIGHUP`/`SIGQUIT`, so closing the terminal window doesn't leave dev servers running and holding their ports
