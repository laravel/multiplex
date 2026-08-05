#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { constants } from "node:os";
import { resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { render } from "ink";
import { App } from "./app.js";
import type { CommandDef, OutputRef, ProcsRef } from "./types.js";
import { formatTimestamp, hexToRgb } from "./util.js";

const DEFAULT_COLORS = [
    "#93c5fd",
    "#c4b5fd",
    "#fb7185",
    "#fdba74",
    "#86efac",
    "#fcd34d",
];

let colorCount = 0;

function getNextColor(existing: CommandDef[]): string {
    const usedColors = new Set(existing.map((c) => c.color));
    const available = DEFAULT_COLORS.filter((c) => !usedColors.has(c));

    if (available.length > 0) {
        return available[0];
    }

    return DEFAULT_COLORS[colorCount++ % DEFAULT_COLORS.length];
}

function parseCommandDef(value: string, previous: CommandDef[]): CommandDef[] {
    const parts = value.split(",");

    if (parts.length < 2) {
        throw new InvalidArgumentError(
            "Expected label,command or label,#color,command",
        );
    }

    const label = parts[0];

    let color: string;
    let cmdStr: string;

    if (parts[1].startsWith("#")) {
        if (parts.length < 3) {
            throw new InvalidArgumentError(
                `The color ${parts[1]} is set but no command follows it.`,
            );
        }

        if (!/^#[0-9a-fA-F]{6}$/.test(parts[1])) {
            throw new InvalidArgumentError(
                `"${parts[1]}" is not a valid color. Expected a 6-digit hex color such as #93c5fd.`,
            );
        }

        color = parts[1];
        cmdStr = parts.slice(2).join(",");
    } else {
        color = getNextColor(previous);
        cmdStr = parts.slice(1).join(",");
    }

    return [...previous, { label, color, command: cmdStr }];
}

function parsePositiveInt(value: string): number {
    const n = parseInt(value, 10);

    if (Number.isNaN(n) || n <= 0) {
        throw new InvalidArgumentError(`"${value}" is not a positive integer.`);
    }

    return n;
}

const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

const program = new Command()
    .name("multiplex")
    .description("Run multiple commands in a tabbed TUI")
    .version("0.1.0", "-V, --version", "Display the version number")
    .option("--cwd <path>", "Set the working directory", process.cwd())
    .option("-s, --stream", "Start in stream mode", false)
    .option(
        "--buffer-size <lines>",
        "Set the max lines per command buffer",
        parsePositiveInt,
        2000,
    )
    .option(
        "--stream-buffer-size <lines>",
        "Set the max lines in the stream buffer",
        parsePositiveInt,
        10000,
    )
    .option("--timestamps", "Display timestamps on each output line", false)
    .option("--no-restart", "Disable auto-restart on crash")
    .option("--title <name>", "Set the terminal tab title")
    .helpOption("-h, --help", "Display help for the command")
    .argument(
        "<commands...>",
        "commands as label,command or label,#color,command",
        parseCommandDef,
        [] as CommandDef[],
    )
    .configureHelp({
        formatHelp(cmd, helper) {
            const lines: string[] = [];

            lines.push(yellow("Description:"));
            lines.push(`  ${cmd.description()}`);
            lines.push("");

            lines.push(yellow("Usage:"));
            lines.push(`  ${cmd.name()} [options] <commands...>`);
            lines.push("");

            lines.push(yellow("Arguments:"));
            lines.push(
                `  ${green("commands")}  The commands to run as ${green("label,command")} or ${green("label,#color,command")}`,
            );
            lines.push("");

            lines.push(yellow("Options:"));

            const opts = helper.visibleOptions(cmd);
            const padWidth = Math.max(
                ...opts.map((o) => helper.optionTerm(o).length),
            );

            for (const opt of opts) {
                const term = helper.optionTerm(opt);
                const pad = " ".repeat(padWidth - term.length);
                let desc = opt.description;
                const def = opt.defaultValue;

                if (
                    def !== undefined &&
                    def !== false &&
                    def !== true &&
                    def !== process.cwd()
                ) {
                    desc += ` [default: ${JSON.stringify(def)}]`;
                }

                lines.push(`  ${green(term)}${pad}  ${desc}`);
            }

            lines.push("");

            return lines.join("\n");
        },
    })
    .parse();

const opts = program.opts<{
    cwd: string;
    stream: boolean;
    bufferSize: number;
    streamBufferSize: number;
    timestamps: boolean;
    restart: boolean;
    title?: string;
}>();
const commandDefs = program.processedArgs[0] as CommandDef[];

if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const stream = process.stdin.isTTY ? "stdout" : "stdin";

    program.error(
        `error: multiplex needs an interactive terminal, but ${stream} is not a TTY. Run it directly rather than through a pipe or redirect.`,
    );
}

const cwd = resolve(opts.cwd);

if (!existsSync(cwd)) {
    program.error(`error: --cwd path does not exist: ${cwd}`);
}

if (!statSync(cwd).isDirectory()) {
    program.error(`error: --cwd path is not a directory: ${cwd}`);
}

if (opts.title) {
    process.stdout.write(`\x1b]0;${opts.title}\x07`);
}

const outputRef: OutputRef = { current: [] };
const procsRef: ProcsRef = { current: [] };

let instance: ReturnType<typeof render> | undefined;
let shuttingDown = false;

function killAll() {
    for (const proc of procsRef.current) {
        try {
            if (proc.pid) {
                process.kill(-proc.pid, "SIGKILL");
            }
        } catch {
            //
        }
    }
}

function restoreTerminal() {
    try {
        process.stdout.write("\x1b[?25h\x1b[?1049l");
    } catch {
        //
    }
}

function flushOutput() {
    if (outputRef.current.length === 0) {
        return;
    }

    const maxLabelLen = Math.max(...commandDefs.map((c) => c.label.length));

    try {
        for (const sl of outputRef.current) {
            const cmd = commandDefs[sl.cmdIndex];
            const [r, g, b] = hexToRgb(cmd.color);
            const padding = " ".repeat(maxLabelLen - cmd.label.length);
            const ts = opts.timestamps ? formatTimestamp(sl.time) : "";

            process.stdout.write(
                `${ts}\x1b[1;38;2;${r};${g};${b}m[${cmd.label}]${padding} \x1b[0m${sl.text}\n`,
            );
        }
    } catch {
        // The terminal can already be gone when we got here via SIGHUP.
    }
}

/**
 * Unmount first, so Ink's final frame and its raw-mode teardown happen while
 * we still own the alternate screen, then leave the screen before flushing so
 * the logs land in the real scrollback.
 */
function shutdown(code: number): never {
    if (!shuttingDown) {
        shuttingDown = true;

        try {
            instance?.unmount();
        } catch {
            //
        }

        killAll();
        restoreTerminal();
        flushOutput();
    }

    process.exit(code);
}

process.stdout.write("\x1b[?1049h\x1b[?25l");

// Signals terminate the process without running exit handlers, and the children
// sit in their own process groups so they never see the terminal's own SIGHUP.
// Without these, closing the terminal window leaves every dev server running
// and holding its port.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const) {
    process.on(signal, () => {
        shutdown(128 + constants.signals[signal]);
    });
}

// Last resort for exits we did not route through shutdown().
process.on("exit", () => {
    killAll();
    restoreTerminal();
});

try {
    instance = render(
        <App
            commandDefs={commandDefs}
            cwd={cwd}
            initialStreamMode={opts.stream}
            bufferSize={opts.bufferSize}
            streamBufferSize={opts.streamBufferSize}
            timestamps={opts.timestamps}
            autoRestart={opts.restart}
            title={opts.title}
            outputRef={outputRef}
            procsRef={procsRef}
        />,
        { exitOnCtrlC: true },
    );

    await instance.waitUntilExit();
} catch {
    shutdown(1);
}

shutdown(0);
