#!/usr/bin/env node
import { render } from "ink";
import { jsx as _jsx } from "react/jsx-runtime";
import { App } from "./app.js";

const args = process.argv.slice(2);
let cwd = process.cwd();
let streamMode = false;
const commandDefs = [];
const DEFAULT_COLORS = [
    "#e06c75",
    "#98c379",
    "#e5c07b",
    "#61afef",
    "#c678dd",
    "#56b6c2",
    "#d19a66",
    "#be5046",
];
for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cwd" && args[i + 1]) {
        cwd = args[++i];
    } else if (args[i] === "--stream") {
        streamMode = true;
    } else {
        const parts = args[i].split(",");
        if (parts.length < 2) {
            console.error(
                `Invalid argument: "${args[i]}". Expected format: label,command`,
            );
            process.exit(1);
        }
        const label = parts[0];
        let color;
        let cmdStr;
        if (parts[1].startsWith("#")) {
            if (parts.length < 3) {
                console.error(
                    `Invalid argument: "${args[i]}". Color specified but no command found.`,
                );
                process.exit(1);
            }
            color = parts[1];
            cmdStr = parts.slice(2).join(",");
        } else {
            color = DEFAULT_COLORS[commandDefs.length % DEFAULT_COLORS.length];
            cmdStr = parts.slice(1).join(",");
        }
        commandDefs.push({ label, color, command: cmdStr.split(" ") });
    }
}
if (commandDefs.length === 0) {
    console.error(
        "Usage: artisan-dev-tui [--cwd path] [--stream] label,command [label,#color,command] ...",
    );
    console.error(
        '  e.g. artisan-dev-tui --cwd ./myapp "serve,php artisan serve" "queue,#e5c07b,php artisan queue:work"',
    );
    process.exit(1);
}
process.stdout.write("\x1b[?1049h\x1b[?25l");
process.on("exit", () => process.stdout.write("\x1b[?25h\x1b[?1049l"));
try {
    const { waitUntilExit } = render(
        _jsx(App, {
            commandDefs: commandDefs,
            cwd: cwd,
            initialStreamMode: streamMode,
        }),
        { exitOnCtrlC: true },
    );
    await waitUntilExit();
} catch {
    process.exit(1);
}
