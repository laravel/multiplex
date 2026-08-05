import { InvalidArgumentError } from "commander";
import type { CommandDef } from "./types.js";

export const DEFAULT_COLORS = [
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

export function parsePositiveInt(value: string): number {
    const n = parseInt(value, 10);

    if (Number.isNaN(n) || n <= 0) {
        throw new InvalidArgumentError(`"${value}" is not a positive integer.`);
    }

    return n;
}
