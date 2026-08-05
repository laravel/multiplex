import { InvalidArgumentError } from "commander";
import type { CommandDef, CommandInput } from "./types.js";

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_COLORS = [
    "#93c5fd",
    "#c4b5fd",
    "#fb7185",
    "#fdba74",
    "#86efac",
    "#fcd34d",
];

let colorCount = 0;

function nextColor(used: Set<string>): string {
    const available = DEFAULT_COLORS.filter((c) => !used.has(c));

    if (available.length > 0) {
        return available[0];
    }

    return DEFAULT_COLORS[colorCount++ % DEFAULT_COLORS.length];
}

export function parseCommandDef(
    value: string,
    previous: CommandDef[],
): CommandDef[] {
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

        if (!HEX_COLOR.test(parts[1])) {
            throw new InvalidArgumentError(
                `"${parts[1]}" is not a valid color. Expected a 6-digit hex color such as #93c5fd.`,
            );
        }

        color = parts[1];
        cmdStr = parts.slice(2).join(",");
    } else {
        color = nextColor(new Set(previous.map((c) => c.color)));
        cmdStr = parts.slice(1).join(",");
    }

    return [...previous, { label, color, command: cmdStr }];
}

export function normalizeCommands(commands: CommandInput[]): CommandDef[] {
    if (commands.length === 0) {
        throw new Error("commands must contain at least one command.");
    }

    const used = new Set(
        commands.map((c) => c.color).filter((c): c is string => Boolean(c)),
    );

    return commands.map((cmd, i) => {
        if (!cmd.label) {
            throw new Error(`commands[${i}] is missing a label.`);
        }

        if (!cmd.command) {
            throw new Error(
                `commands[${i}] ("${cmd.label}") is missing a command.`,
            );
        }

        if (cmd.color !== undefined && !HEX_COLOR.test(cmd.color)) {
            throw new Error(
                `"${cmd.color}" is not a valid color for "${cmd.label}". Expected a 6-digit hex color such as #93c5fd.`,
            );
        }

        if (cmd.color) {
            return { label: cmd.label, color: cmd.color, command: cmd.command };
        }

        const color = nextColor(used);
        used.add(color);

        return { label: cmd.label, color, command: cmd.command };
    });
}

export function parsePositiveInt(value: string): number {
    const n = parseInt(value, 10);

    if (Number.isNaN(n) || n <= 0) {
        throw new InvalidArgumentError(`"${value}" is not a positive integer.`);
    }

    return n;
}
