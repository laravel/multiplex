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

## Usage

```bash
multiplex [options] <commands...>
```

Each command is passed as a positional argument in the format:

```
label,command
label,#color,command
```

Colors are optional hex values. If omitted, colors are assigned automatically from a built-in palette.

### Examples

```bash
# Basic usage
multiplex 'server,php artisan serve' 'queue,php artisan queue:listen' 'vite,pnpm run dev'

# With custom colors
multiplex 'server,#93c5fd,php artisan serve' 'queue,#fb7185,php artisan queue:listen'

# Start in stream mode with timestamps
multiplex -s --timestamps 'server,php artisan serve' 'queue,php artisan queue:listen'

# Custom working directory
multiplex --cwd /path/to/project 'server,php artisan serve'
```

### Options

| Option | Description | Default |
| --- | --- | --- |
| `--cwd <path>` | Working directory for commands | Current directory |
| `-s, --stream` | Start in stream mode (interleaved output) | `false` |
| `--timestamps` | Show timestamps in stream mode | `false` |
| `--buffer-size <lines>` | Max lines kept per command buffer | `2000` |
| `--stream-buffer-size <lines>` | Max lines kept in stream buffer | `10000` |

## Keyboard Shortcuts

### Navigation

| Key | Action |
| --- | --- |
| `1`-`9` | Jump to tab by number |
| `Tab` | Toggle focus between sidebar and content |
| `Left` / `Right` | Move focus to sidebar / content |
| `Up` / `Down` | Navigate tabs (sidebar) or scroll (content) |
| `Page Up` / `Page Down` | Scroll one page |

### Actions

| Key | Action |
| --- | --- |
| `t` | Toggle between tabbed and stream mode |
| `r` | Restart the selected process |
| `c` | Clear output (current tab or stream) |
| `/` | Open search |
| `q` | Quit |

### Search

| Key | Action |
| --- | --- |
| `Enter` | Confirm search |
| `Esc` | Cancel search / clear results |
| `n` / `N` | Next / previous match |

## Features

- **Tabbed view** with a sidebar showing all running commands
- **Stream mode** for interleaved output with colored labels
- **Search** with ANSI-aware highlighting across output
- **Scrollbar** when content exceeds the viewport
- **Process management** - restart failed processes, clear output
- **Error indicators** in the sidebar when a process fails
- **New output indicator** when scrolled up and new data arrives
- **Buffer limits** to keep memory usage low during long sessions
- **Output flush** on exit so logs are preserved in terminal scrollback
- **Process group cleanup** ensures no zombie processes are left behind
