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

export function parseCommandDef(
    value: string,
    previous: CommandInput[],
): CommandInput[] {
    const parts = value.split(",");

    if (parts.length < 2) {
        throw new InvalidArgumentError(
            "Expected label,command or label,#color,command",
        );
    }

    const label = parts[0];

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

        return [
            ...previous,
            { label, color: parts[1], command: parts.slice(2).join(",") },
        ];
    }

    return [...previous, { label, command: parts.slice(1).join(",") }];
}

export function normalizeCommands(commands: CommandInput[]): CommandDef[] {
    if (commands.length === 0) {
        throw new Error("commands must contain at least one command.");
    }

    const used = new Set(
        commands.map((c) => c.color).filter((c): c is string => Boolean(c)),
    );

    let reused = 0;

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

        const available = DEFAULT_COLORS.filter((c) => !used.has(c));
        const color =
            available.length > 0
                ? available[0]
                : DEFAULT_COLORS[reused++ % DEFAULT_COLORS.length];

        used.add(color);

        return { label: cmd.label, color, command: cmd.command };
    });
}

// Number(), not parseInt(): parseInt stops at the first character it cannot use,
// so "10abc" became 10 and "1e6" became 1 — a plausible way to ask for a big
// buffer that silently produced a buffer of one line.
export function parsePositiveInt(value: string): number {
    const n = Number(value);

    if (!Number.isSafeInteger(n) || n <= 0) {
        throw new InvalidArgumentError(`"${value}" is not a positive integer.`);
    }

    return n;
}
