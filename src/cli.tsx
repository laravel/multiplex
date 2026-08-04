#!/usr/bin/env node
import { Command } from "commander";
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
        throw new Error(
            `Invalid format: "${value}". Expected: label,command or label,#color,command`,
        );
    }

    const label = parts[0];

    let color: string;
    let cmdStr: string;

    if (parts[1].startsWith("#")) {
        if (parts.length < 3) {
            throw new Error(
                `Invalid format: "${value}". Color specified but no command found.`,
            );
        }

        const validHex = /^#[0-9a-fA-F]{6}$/.test(parts[1]);
        color = validHex ? parts[1] : getNextColor(previous);
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
        throw new Error(`"${value}" is not a positive integer.`);
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

if (opts.title) {
    process.stdout.write(`\x1b]0;${opts.title}\x07`);
}

process.stdout.write("\x1b[?1049h\x1b[?25l");
process.on("exit", () => {
    killAll();
    process.stdout.write("\x1b[?25h\x1b[?1049l");
});

const outputRef: OutputRef = { current: [] };
const procsRef: ProcsRef = { current: [] };

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

try {
    const { waitUntilExit } = render(
        <App
            commandDefs={commandDefs}
            cwd={opts.cwd}
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

    await waitUntilExit();
} catch {
    process.exit(1);
}

killAll();

process.stdout.write("\x1b[?25h\x1b[?1049l");

if (outputRef.current.length > 0) {
    const maxLabelLen = Math.max(...commandDefs.map((c) => c.label.length));

    for (const sl of outputRef.current) {
        const cmd = commandDefs[sl.cmdIndex];
        const [r, g, b] = hexToRgb(cmd.color);
        const padding = " ".repeat(maxLabelLen - cmd.label.length);
        const ts = opts.timestamps ? formatTimestamp(sl.time) : "";

        process.stdout.write(
            `${ts}\x1b[1;38;2;${r};${g};${b}m[${cmd.label}]${padding} \x1b[0m${sl.text}\n`,
        );
    }
}

process.exit(0);
