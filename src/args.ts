import { InvalidArgumentError } from "commander";
import { DEFAULT_COLORS, normalizeColor } from "./color.js";
import type { CommandDef, CommandInput } from "./types.js";

const FORMAT = "Expected label,command or label:color,command";

const badColor = (value: string, label?: string) =>
    `"${value}" is not a valid color${label ? ` for "${label}"` : ""}. Expected a 6-digit hex value such as #93c5fd, or a name such as red or blueBright.`;

// The old label,#color,command form, rejected rather than still accepted: the
// current format reads that color as the first word of the command, so the run
// would otherwise look like it started fine.
const LEGACY_COLOR_SLOT = /^#[0-9a-fA-F]{6},/;

/**
 * One CLI positional onto a CommandInput. The color attaches to the label rather
 * than sitting in a slot of its own, so only the first comma is structural:
 * everything after it is the command, whether it holds commas, colons or a word
 * that happens to name a color.
 */
export function parseCommandDef(
    value: string,
    previous: CommandInput[],
): CommandInput[] {
    const split = value.indexOf(",");

    if (split < 1) {
        throw new InvalidArgumentError(FORMAT);
    }

    const head = value.slice(0, split);
    const command = value.slice(split + 1);

    if (!command) {
        throw new InvalidArgumentError(
            `"${head}" has no command after it. ${FORMAT}`,
        );
    }

    if (LEGACY_COLOR_SLOT.test(command)) {
        const end = command.indexOf(",");

        throw new InvalidArgumentError(
            `Colors now attach to the label: write ${head}:${command.slice(0, end)},${command.slice(end + 1)}`,
        );
    }

    const colon = head.indexOf(":");

    if (colon === -1) {
        return [...previous, { label: head, command }];
    }

    const label = head.slice(0, colon);
    const color = normalizeColor(head.slice(colon + 1));

    if (!label) {
        throw new InvalidArgumentError(`"${head}" has no label. ${FORMAT}`);
    }

    if (!color) {
        throw new InvalidArgumentError(
            `${badColor(head.slice(colon + 1))} Everything after the first colon is the color, so a label cannot contain one.`,
        );
    }

    return [...previous, { label, color, command }];
}

export function normalizeCommands(commands: CommandInput[]): CommandDef[] {
    if (commands.length === 0) {
        throw new Error("commands must contain at least one command.");
    }

    const used = new Set(
        commands
            .map((c) => (c.color ? normalizeColor(c.color) : undefined))
            .filter((c): c is string => Boolean(c)),
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

        if (cmd.color !== undefined) {
            const explicit = normalizeColor(cmd.color);

            if (!explicit) {
                throw new Error(badColor(cmd.color, cmd.label));
            }

            return { label: cmd.label, color: explicit, command: cmd.command };
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
