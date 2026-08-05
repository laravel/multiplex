# @laravel/multiplex

A tabbed TUI for running multiple commands simultaneously with searchable, scrollable output. Built with [Ink](https://github.com/vadimdemedes/ink).

When you exit, all output is flushed to your terminal scrollback so you don't lose your logs.

## Install

```bash
npm install -g @laravel/multiplex
```

Or run directly:

```bash
npx @laravel/multiplex 'server,php artisan serve' 'queue,php artisan queue:listen'
```

## Requirements

- **Node 22.12 or later.**
- **An interactive terminal.** Both stdin and stdout must be a TTY. Piping or redirecting either one (`multiplex ... | tee log`) exits with an error instead of starting your commands, as does running it from CI.
- **Non-interactive commands.** Child processes are spawned without stdin, so anything that prompts for input — `php artisan tinker`, a migration confirmation — won't work.

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
| `--timestamps` | Display timestamps on each output line | `false` |
| `--no-restart` | Disable auto-restart on crash | |
| `--buffer-size <lines>` | Max lines kept per command buffer | `2000` |
| `--stream-buffer-size <lines>` | Max lines kept in stream buffer | `10000` |

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

`multiplex()` takes over the terminal for the duration of the call: it enters the alternate screen, installs its own `SIGINT`/`SIGTERM`/`SIGHUP`/`SIGQUIT` handlers, and renders the TUI. It resolves with the same exit code the CLI would have used — `0` normally, `1` if rendering failed. By then the terminal is restored, every child process is dead, the buffered output has been flushed to scrollback, and the signal handlers it installed have been removed, so the calling process is free to carry on. The same requirements apply as for the CLI: both stdin and stdout must be a TTY.

Options are validated before anything is written to the terminal, so an invalid option throws with the screen untouched.

| Option | Type | Description | Default |
| --- | --- | --- | --- |
| `commands` | `{ label, command, color? }[]` | Required, at least one. `color` is an optional 6-digit hex value | |
| `title` | `string` | Set the terminal tab title | |
| `cwd` | `string` | Set the working directory (must exist) | `process.cwd()` |
| `stream` | `boolean` | Start in stream mode (interleaved output) | `false` |
| `timestamps` | `boolean` | Display timestamps on each output line | `false` |
| `restart` | `boolean` | Auto-restart on crash | `true` |
| `bufferSize` | `number` | Max lines kept per command buffer | `2000` |
| `streamBufferSize` | `number` | Max lines kept in stream buffer | `10000` |

Commands that omit a color are assigned one from the built-in palette (also exported as `DEFAULT_COLORS`), avoiding colors used elsewhere in the list.

## Auto-Restart

Processes that crash (exit with a non-zero code) are automatically restarted after a 1-second delay. If a process fails 5 times in a row, it stops restarting and is marked as failed in the sidebar. A manual restart with `r` resets the counter.

A desktop notification is sent when a process permanently fails (macOS via `osascript`, Linux via `notify-send` if available).

Use `--no-restart` to disable auto-restart for one-shot commands like builds or migrations.

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
| `t` | Toggle between tabbed and stream mode |
| `r` | Restart the selected process |
| `c` | Clear output (current tab or stream) |
| `f` | Filter which commands appear in the stream |
| `/` | Open search |
| `q` | Quit |

`r`, `Tab` and `Left`/`Right` apply to tabbed mode; `f` applies to stream mode. In filter mode, `1`-`9` toggle each command on and off and `f` or `Esc` closes it — you can always leave at least one command visible.

### Search

| Key | Action |
| --- | --- |
| `Enter` | Confirm search |
| `Esc` | Cancel search / clear results |
| `n` / `N` | Next / previous match |

## Features

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
