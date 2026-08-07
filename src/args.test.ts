import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
    normalizeCommands,
    parseCommandDef,
    parsePositiveInt,
} from "./args.js";
import { DEFAULT_COLORS } from "./color.js";
import type { CommandInput } from "./types.js";

const parse = (...values: string[]) =>
    values.reduce<CommandInput[]>((acc, v) => parseCommandDef(v, acc), []);

const invalid = (value: string) =>
    assert.throws(() => parseCommandDef(value, []), {
        code: "commander.invalidArgument",
    });

describe("parseCommandDef", () => {
    test("parses label,command", () => {
        assert.deepEqual(parse("server,php artisan serve"), [
            {
                label: "server",
                command: "php artisan serve",
            },
        ]);
    });

    test("parses label:#hex,command", () => {
        assert.deepEqual(parse("server:#fb7185,php artisan serve"), [
            {
                label: "server",
                color: "#fb7185",
                command: "php artisan serve",
            },
        ]);
    });

    test("parses label:name,command", () => {
        assert.deepEqual(parse("server:red,php artisan serve"), [
            {
                label: "server",
                color: "red",
                command: "php artisan serve",
            },
        ]);
    });

    test("normalizes the color it stores", () => {
        assert.equal(parse("a:#93C5FD,echo hi")[0].color, "#93c5fd");
        assert.equal(parse("a:REDBRIGHT,echo hi")[0].color, "redBright");
    });

    // Only the first comma is structural, so everything else belongs to the
    // command however it is punctuated. This is the whole point of hanging the
    // color off the label instead of giving it a positional slot.
    test("keeps commas in the command", () => {
        assert.equal(parse("a,echo A,B,C")[0].command, "echo A,B,C");
        assert.equal(parse("a:#86efac,echo A,B,C")[0].command, "echo A,B,C");
    });

    test("never reads the command as a color", () => {
        assert.equal(parse("a,red")[0].command, "red");
        assert.equal(parse("a,red,--watch")[0].command, "red,--watch");
        assert.equal(parse("a:blue,red")[0].color, "blue");
        assert.equal(parse("a:blue,red")[0].command, "red");
    });

    test("leaves colons and hashes in the command alone", () => {
        assert.equal(
            parse("a,curl http://x/#frag")[0].command,
            "curl http://x/#frag",
        );
        assert.equal(
            parse("q,php artisan queue:listen")[0].command,
            "php artisan queue:listen",
        );
        assert.equal(
            parse("q:cyan,php artisan queue:listen")[0].command,
            "php artisan queue:listen",
        );
    });

    test("accumulates across calls", () => {
        const defs = parse("one,echo 1", "two,echo 2", "three,echo 3");
        assert.deepEqual(
            defs.map((d) => d.label),
            ["one", "two", "three"],
        );
    });

    test("leaves the color unset unless it was given explicitly", () => {
        const defs = parse("a,echo a", `b:${DEFAULT_COLORS[2]},echo b`);

        assert.equal(defs[0].color, undefined);
        assert.equal(defs[1].color, DEFAULT_COLORS[2]);
    });

    test("rejects a value with no command", () => {
        invalid("onlyonepart");
        invalid("");
        invalid("a,");
        invalid("a:red,");
    });

    test("rejects a value with no label", () => {
        invalid(",echo hi");
        invalid(":red,echo hi");
    });

    // Regression: these used to silently drop the #token and run the rest of
    // the value as the command.
    test("rejects a malformed color instead of dropping it", () => {
        invalid("a:#fff,echo hi");
        invalid("a:#zzzzzz,echo hi");
        invalid("a:#3 tasks,echo hi");
        invalid("a:#93c5fdd,echo hi");
        invalid("a:#,echo hi");
        invalid("a:burgundy,echo hi");
        invalid("a:bgRed,echo hi");
    });

    // A colon in the label is indistinguishable from a color that we don't
    // recognize, so it has to be an error rather than a silent misparse.
    test("rejects a colon in the label", () => {
        invalid("api:v2,echo hi");
    });

    // The old positional color slot would otherwise be read as the first word of
    // the command, and the run would look like it started fine.
    test("points the old label,#color,command form at the new one", () => {
        assert.throws(() => parseCommandDef("a,#93c5fd,echo hi", []), {
            code: "commander.invalidArgument",
            message: /a:#93c5fd,echo hi/,
        });
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

    test("keeps explicit colors, normalized", () => {
        const defs = normalizeCommands([
            { label: "a", command: "echo a", color: "#fb7185" },
            { label: "b", command: "echo b", color: "#86EFAC" },
            { label: "c", command: "echo c", color: "cyan" },
            { label: "d", command: "echo d", color: "MAGENTABRIGHT" },
        ]);

        assert.deepEqual(
            defs.map((d) => d.color),
            ["#fb7185", "#86efac", "cyan", "magentaBright"],
        );
    });

    // Names are not in the palette, so they take nothing out of it.
    test("auto-assignment ignores explicit names", () => {
        const defs = normalizeCommands([
            { label: "a", command: "echo a", color: "red" },
            { label: "b", command: "echo b" },
            { label: "c", command: "echo c" },
        ]);

        assert.deepEqual(
            defs.map((d) => d.color),
            ["red", DEFAULT_COLORS[0], DEFAULT_COLORS[1]],
        );
    });

    // Unlike the CLI, which parses left to right, we can see every explicit
    // color up front, so auto-assignment avoids the ones taken later too.
    test("auto-assignment avoids explicit colors anywhere in the list", () => {
        const defs = normalizeCommands([
            { label: "a", command: "echo a" },
            {
                label: "b",
                command: "echo b",
                color: DEFAULT_COLORS[1].toUpperCase(),
            },
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

        assert.deepEqual(
            defs.map((d) => d.color),
            DEFAULT_COLORS,
        );
        assert.equal(new Set(defs.map((d) => d.color)).size, defs.length);
    });

    test("cycles the palette deterministically past its end", () => {
        const defs = Array.from({ length: 3 }, () =>
            normalizeCommands(
                Array.from({ length: DEFAULT_COLORS.length + 3 }, (_, i) => ({
                    label: `cmd${i}`,
                    command: `echo ${i}`,
                })),
            ).map((d) => d.color),
        );

        for (const colors of defs) {
            assert.deepEqual(colors, [
                ...DEFAULT_COLORS,
                ...DEFAULT_COLORS.slice(0, 3),
            ]);
        }
    });

    test("counts reuse from where the palette runs out", () => {
        const defs = normalizeCommands([
            { label: "e", color: "#010203", command: "x" },
            ...Array.from({ length: 9 }, (_, i) => ({
                label: `a${i}`,
                command: "x",
            })),
        ]);

        assert.deepEqual(
            defs.map((d) => d.color),
            ["#010203", ...DEFAULT_COLORS, ...DEFAULT_COLORS.slice(0, 3)],
        );
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
        for (const color of [
            "#fff",
            "#zzzzzz",
            "#93c5fdd",
            "#",
            "burgundy",
            "bgRed",
        ]) {
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
