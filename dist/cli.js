#!/usr/bin/env node
import { jsx as _jsx } from "react/jsx-runtime";
import { Command } from "commander";
import { render } from "ink";
import { App, hexToRgb } from "./app.js";
const DEFAULT_COLORS = [
    "#93c5fd",
    "#c4b5fd",
    "#fb7185",
    "#fdba74",
    "#86efac",
    "#fcd34d",
];
function parseCommandDef(value, previous) {
    const parts = value.split(",");
    if (parts.length < 2) {
        throw new Error(`Invalid format: "${value}". Expected: label,command or label,#color,command`);
    }
    const label = parts[0];
    let color;
    let cmdStr;
    if (parts[1].startsWith("#")) {
        if (parts.length < 3) {
            throw new Error(`Invalid format: "${value}". Color specified but no command found.`);
        }
        color = parts[1];
        cmdStr = parts.slice(2).join(",");
    }
    else {
        color = DEFAULT_COLORS[previous.length % DEFAULT_COLORS.length];
        cmdStr = parts.slice(1).join(",");
    }
    return [...previous, { label, color, command: cmdStr.split(" ") }];
}
const program = new Command()
    .name("multiplex")
    .description("Run multiple commands in a tabbed TUI with searchable output")
    .version("1.0.0")
    .option("--cwd <path>", "working directory for commands", process.cwd())
    .option("-s, --stream", "start in stream mode", false)
    .option("--buffer-size <lines>", "max lines per command buffer", "2000")
    .option("--stream-buffer-size <lines>", "max lines in stream buffer", "10000")
    .option("--timestamps", "show timestamps in stream mode", false)
    .argument("<commands...>", "commands as label,command or label,#color,command", parseCommandDef, [])
    .parse();
const opts = program.opts();
const commandDefs = program.processedArgs[0];
process.stdout.write("\x1b[?1049h\x1b[?25l");
process.on("exit", () => {
    killAll();
    process.stdout.write("\x1b[?25h\x1b[?1049l");
});
const outputRef = { current: [] };
const procsRef = { current: [] };
function killAll() {
    for (const proc of procsRef.current) {
        try {
            if (proc.pid) {
                process.kill(-proc.pid, "SIGKILL");
            }
        }
        catch { }
    }
}
try {
    const { waitUntilExit } = render(_jsx(App, { commandDefs: commandDefs, cwd: opts.cwd, initialStreamMode: opts.stream, bufferSize: parseInt(opts.bufferSize, 10), streamBufferSize: parseInt(opts.streamBufferSize, 10), timestamps: opts.timestamps, outputRef: outputRef, procsRef: procsRef }), { exitOnCtrlC: true });
    await waitUntilExit();
}
catch {
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
        const ts = opts.timestamps
            ? `\x1b[90m${sl.time.toLocaleTimeString("en-GB")} \x1b[0m`
            : "";
        process.stdout.write(`${ts}\x1b[1;38;2;${r};${g};${b}m[${cmd.label}]${padding} \x1b[0m${sl.text}\n`);
    }
}
process.exit(0);
