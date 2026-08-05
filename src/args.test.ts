import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
    DEFAULT_COLORS,
    normalizeCommands,
    parseCommandDef,
    parsePositiveInt,
} from "./args.js";
import type { CommandDef } from "./types.js";

const parse = (...values: string[]) =>
    values.reduce<CommandDef[]>((acc, v) => parseCommandDef(v, acc), []);

const invalid = (value: string) =>
    assert.throws(() => parseCommandDef(value, []), {
        code: "commander.invalidArgument",
    });

describe("parseCommandDef", () => {
    test("parses label,command", () => {
        assert.deepEqual(parse("server,php artisan serve"), [
            {
                label: "server",
                color: DEFAULT_COLORS[0],
                command: "php artisan serve",
            },
        ]);
    });

    test("parses label,#color,command", () => {
        assert.deepEqual(parse("server,#fb7185,php artisan serve"), [
            {
                label: "server",
                color: "#fb7185",
                command: "php artisan serve",
            },
        ]);
    });

    test("accepts uppercase hex", () => {
        assert.equal(parse("a,#93C5FD,echo hi")[0].color, "#93C5FD");
    });

    // The command is everything after the label (and optional color), so commas
    // inside it have to survive.
    test("keeps commas in the command", () => {
        assert.equal(parse("a,echo A,B,C")[0].command, "echo A,B,C");
        assert.equal(parse("a,#86efac,echo A,B,C")[0].command, "echo A,B,C");
    });

    test("only treats a leading # as a color", () => {
        assert.equal(
            parse("a,curl http://x/#frag")[0].command,
            "curl http://x/#frag",
        );
    });

    test("accumulates across calls", () => {
        const defs = parse("one,echo 1", "two,echo 2", "three,echo 3");
        assert.deepEqual(
            defs.map((d) => d.label),
            ["one", "two", "three"],
        );
    });

    test("auto-assigned colors do not repeat", () => {
        const colors = parse(
            ...DEFAULT_COLORS.map((_, i) => `cmd${i},echo ${i}`),
        ).map((d) => d.color);

        assert.deepEqual(colors, DEFAULT_COLORS);
        assert.equal(new Set(colors).size, DEFAULT_COLORS.length);
    });

    test("auto-assignment skips colors already taken explicitly", () => {
        const defs = parse(`a,${DEFAULT_COLORS[0]},echo a`, "b,echo b");

        assert.equal(defs[1].color, DEFAULT_COLORS[1]);
    });

    test("keeps assigning palette colors past the end of the palette", () => {
        const defs = parse(
            ...Array.from(
                { length: DEFAULT_COLORS.length + 3 },
                (_, i) => `cmd${i},echo ${i}`,
            ),
        );

        for (const def of defs) {
            assert.ok(
                DEFAULT_COLORS.includes(def.color),
                `${def.color} is not a palette color`,
            );
        }
    });

    test("every palette color is a 6-digit hex", () => {
        for (const color of DEFAULT_COLORS) {
            assert.match(color, /^#[0-9a-f]{6}$/);
        }
    });

    test("rejects a value with no command", () => {
        invalid("onlyonepart");
        invalid("");
    });

    test("rejects a color with no command after it", () => {
        invalid("a,#93c5fd");
    });

    // Regression: these used to silently drop the #token and run the rest of
    // the value as the command.
    test("rejects a malformed color instead of dropping it", () => {
        invalid("a,#fff,echo hi");
        invalid("a,#zzzzzz,echo hi");
        invalid("a,#3 tasks,echo hi");
        invalid("a,#93c5fdd,echo hi");
        invalid("a,#,echo hi");
    });
});

describe("normalizeCommands", () => {
    test("assigns colors to commands that omit them", () => {
        assert.deepEqual(
            normalizeCommands([
                { label: "server", command: "php artisan serve" },
                { label: "queue", command: "php artisan queue:listen" },
            ]),
            [
                {
                    label: "server",
                    color: DEFAULT_COLORS[0],
                    command: "php artisan serve",
                },
                {
                    label: "queue",
                    color: DEFAULT_COLORS[1],
                    command: "php artisan queue:listen",
                },
            ],
        );
    });

    test("keeps explicit colors", () => {
        const defs = normalizeCommands([
            { label: "a", command: "echo a", color: "#fb7185" },
            { label: "b", command: "echo b", color: "#86EFAC" },
        ]);

        assert.deepEqual(
            defs.map((d) => d.color),
            ["#fb7185", "#86EFAC"],
        );
    });

    // Unlike the CLI, which parses left to right, we can see every explicit
    // color up front, so auto-assignment avoids the ones taken later too.
    test("auto-assignment avoids explicit colors anywhere in the list", () => {
        const defs = normalizeCommands([
            { label: "a", command: "echo a" },
            { label: "b", command: "echo b", color: DEFAULT_COLORS[1] },
            { label: "c", command: "echo c" },
        ]);

        assert.deepEqual(
            defs.map((d) => d.color),
            [DEFAULT_COLORS[0], DEFAULT_COLORS[1], DEFAULT_COLORS[2]],
        );
    });

    test("does not repeat auto-assigned colors", () => {
        const defs = normalizeCommands(
            DEFAULT_COLORS.map((_, i) => ({
                label: `cmd${i}`,
                command: `echo ${i}`,
            })),
        );

        assert.equal(new Set(defs.map((d) => d.color)).size, defs.length);
    });

    test("keeps assigning palette colors past the end of the palette", () => {
        const defs = normalizeCommands(
            Array.from({ length: DEFAULT_COLORS.length + 3 }, (_, i) => ({
                label: `cmd${i}`,
                command: `echo ${i}`,
            })),
        );

        for (const def of defs) {
            assert.ok(
                DEFAULT_COLORS.includes(def.color),
                `${def.color} is not a palette color`,
            );
        }
    });

    test("rejects an empty list", () => {
        assert.throws(() => normalizeCommands([]), /at least one command/);
    });

    test("rejects a missing label or command", () => {
        assert.throws(
            () => normalizeCommands([{ label: "", command: "echo hi" }]),
            /missing a label/,
        );

        assert.throws(
            () => normalizeCommands([{ label: "a", command: "" }]),
            /missing a command/,
        );
    });

    test("rejects a malformed color", () => {
        for (const color of ["#fff", "#zzzzzz", "#93c5fdd", "#", "red"]) {
            assert.throws(
                () => normalizeCommands([{ label: "a", command: "x", color }]),
                /is not a valid color/,
            );
        }
    });
});

describe("parsePositiveInt", () => {
    test("accepts positive integers", () => {
        assert.equal(parsePositiveInt("1"), 1);
        assert.equal(parsePositiveInt("2000"), 2000);
    });

    test("accepts exponent notation", () => {
        assert.equal(parsePositiveInt("1e6"), 1_000_000);
    });

    test("rejects zero, negatives and non-numbers", () => {
        for (const value of ["0", "-1", "abc", "", " "]) {
            assert.throws(() => parsePositiveInt(value), {
                code: "commander.invalidArgument",
            });
        }
    });

    // Regression: parseInt() truncated all of these to a number instead of
    // rejecting them, so "1e6" quietly became a buffer of one line.
    test("rejects partial numbers rather than truncating them", () => {
        for (const value of ["10abc", "5.7", "0.5", "1,000", "1_000", "1 2"]) {
            assert.throws(
                () => parsePositiveInt(value),
                { code: "commander.invalidArgument" },
                `accepted ${value}`,
            );
        }
    });

    test("rejects values too large to be an exact integer", () => {
        for (const value of ["1e21", "Infinity", "9007199254740993"]) {
            assert.throws(
                () => parsePositiveInt(value),
                { code: "commander.invalidArgument" },
                `accepted ${value}`,
            );
        }
    });
});
