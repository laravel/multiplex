#!/usr/bin/env node
import { Command } from "commander";
import { render } from "ink";
import { App, type CommandDef } from "./app.js";

const DEFAULT_COLORS = [
    "#93c5fd",
    "#c4b5fd",
    "#fb7185",
    "#fdba74",
    "#86efac",
    "#fcd34d",
];

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

        color = parts[1];
        cmdStr = parts.slice(2).join(",");
    } else {
        color = DEFAULT_COLORS[previous.length % DEFAULT_COLORS.length];
        cmdStr = parts.slice(1).join(",");
    }

    return [...previous, { label, color, command: cmdStr.split(" ") }];
}

const program = new Command()
    .name("artisan-dev-tui")
    .description("Run multiple commands in a tabbed TUI with searchable output")
    .version("1.0.0")
    .option("--cwd <path>", "working directory for commands", process.cwd())
    .option("-s, --stream", "start in stream mode", false)
    .argument(
        "<commands...>",
        "commands as label,command or label,#color,command",
        parseCommandDef,
        [] as CommandDef[],
    )
    .parse();

const opts = program.opts<{ cwd: string; stream: boolean }>();
const commandDefs = program.processedArgs[0] as CommandDef[];

process.stdout.write("\x1b[?1049h\x1b[?25l");
process.on("exit", () => process.stdout.write("\x1b[?25h\x1b[?1049l"));

try {
    const { waitUntilExit } = render(
        <App
            commandDefs={commandDefs}
            cwd={opts.cwd}
            initialStreamMode={opts.stream}
        />,
        { exitOnCtrlC: true },
    );
    await waitUntilExit();
} catch {
    process.exit(1);
}
