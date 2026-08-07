#!/usr/bin/env node
import { Command } from "commander";
import { parseCommandDef, parsePositiveInt } from "./args.js";
import { multiplex } from "./multiplex.js";
import type { CommandInput } from "./types.js";

const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

const program = new Command()
    .name("multiplex")
    .description("Run multiple commands in a tabbed TUI")
    .version("0.2.2")
    .option("--cwd <path>", "Set the working directory", process.cwd())
    .option("-s, --stream", "Start in stream mode", false)
    .option(
        "-i, --inline",
        "Print output inline instead of rendering the TUI (the default when not a TTY)",
        false,
    )
    .option(
        "--json",
        "Emit newline-delimited JSON events. Implies --inline",
        false,
    )
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
        [] as CommandInput[],
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
    inline: boolean;
    json: boolean;
    bufferSize: number;
    streamBufferSize: number;
    timestamps: boolean;
    restart: boolean;
    title?: string;
}>();
const commands = program.processedArgs[0] as CommandInput[];

try {
    const code = await multiplex({
        commands,
        cwd: opts.cwd,
        inline: opts.inline,
        json: opts.json,
        stream: opts.stream,
        bufferSize: opts.bufferSize,
        streamBufferSize: opts.streamBufferSize,
        timestamps: opts.timestamps,
        restart: opts.restart,
        title: opts.title,
    });

    process.exit(code);
} catch (e) {
    program.error(`error: ${e instanceof Error ? e.message : String(e)}`);
}
