import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
    COLOR_NAMES,
    colorOpen,
    contrastText,
    DEFAULT_COLORS,
    hexToRgb,
    normalizeColor,
} from "./color.js";

describe("hexToRgb", () => {
    test("parses basic hex colors", () => {
        assert.deepEqual(hexToRgb("#000000"), [0, 0, 0]);
        assert.deepEqual(hexToRgb("#ffffff"), [255, 255, 255]);
        assert.deepEqual(hexToRgb("#ff0000"), [255, 0, 0]);
        assert.deepEqual(hexToRgb("#00ff00"), [0, 255, 0]);
        assert.deepEqual(hexToRgb("#0000ff"), [0, 0, 255]);
    });

    test("parses the default palette colors", () => {
        assert.deepEqual(hexToRgb("#93c5fd"), [147, 197, 253]);
        assert.deepEqual(hexToRgb("#fb7185"), [251, 113, 133]);
    });

    test("handles uppercase hex", () => {
        assert.deepEqual(hexToRgb("#FF00FF"), [255, 0, 255]);
    });
});

describe("normalizeColor", () => {
    test("lowercases hex", () => {
        assert.equal(normalizeColor("#93C5FD"), "#93c5fd");
        assert.equal(normalizeColor("#93c5fd"), "#93c5fd");
    });

    test("accepts every name", () => {
        for (const name of COLOR_NAMES) {
            assert.equal(normalizeColor(name), name, `rejected ${name}`);
        }
    });

    // The camelCase names are why normalizing cannot just be toLowerCase():
    // "redbright" is not a chalk name, so Ink would silently drop the color.
    test("canonicalizes the case of a name rather than lowercasing it", () => {
        assert.equal(normalizeColor("REDBRIGHT"), "redBright");
        assert.equal(normalizeColor("redbright"), "redBright");
        assert.equal(normalizeColor("BlueBright"), "blueBright");
        assert.equal(normalizeColor("Red"), "red");
    });

    test("rejects anything else", () => {
        for (const value of [
            "#fff",
            "#zzzzzz",
            "#93c5fdd",
            "#",
            "",
            "burgundy",
            "bgRed",
            "bold",
            "rgb(1,2,3)",
            "red ",
        ]) {
            assert.equal(
                normalizeColor(value),
                undefined,
                `accepted "${value}"`,
            );
        }
    });

    test("leaves the palette unchanged", () => {
        for (const color of DEFAULT_COLORS) {
            assert.match(color, /^#[0-9a-f]{6}$/);
            assert.equal(normalizeColor(color), color);
        }
    });
});

describe("COLOR_NAMES", () => {
    // Pinned because these are the names the README documents and the names Ink
    // can resolve; taking them from ansi-styles is what keeps the two in step.
    test("is the 16 ANSI foreground colors plus the two gray aliases", () => {
        assert.deepEqual([...COLOR_NAMES].sort(), [
            "black",
            "blackBright",
            "blue",
            "blueBright",
            "cyan",
            "cyanBright",
            "gray",
            "green",
            "greenBright",
            "grey",
            "magenta",
            "magentaBright",
            "red",
            "redBright",
            "white",
            "whiteBright",
            "yellow",
            "yellowBright",
        ]);
    });
});

describe("colorOpen", () => {
    test("uses truecolor for hex", () => {
        assert.equal(colorOpen("#93c5fd"), "\x1b[38;2;147;197;253m");
        assert.equal(colorOpen("#000000"), "\x1b[38;2;0;0;0m");
    });

    test("uses the SGR code for a name", () => {
        assert.equal(colorOpen("black"), "\x1b[30m");
        assert.equal(colorOpen("white"), "\x1b[37m");
        assert.equal(colorOpen("blackBright"), "\x1b[90m");
        assert.equal(colorOpen("whiteBright"), "\x1b[97m");
    });

    test("treats gray and grey as the same color", () => {
        assert.equal(colorOpen("gray"), colorOpen("grey"));
        assert.equal(colorOpen("gray"), colorOpen("blackBright"));
    });

    test("emits an opening sequence for every name", () => {
        for (const name of COLOR_NAMES) {
            assert.match(colorOpen(name), /^\x1b\[(3[0-7]|9[0-7])m$/);
        }
    });
});

describe("contrastText", () => {
    // Regression: the sidebar hard-coded black on the selected tab's fill, which
    // only ever worked because the palette was all light pastels.
    test("keeps black on every built-in palette color", () => {
        for (const color of DEFAULT_COLORS) {
            assert.equal(contrastText(color), "#000000", `wrong for ${color}`);
        }
    });

    test("picks white on dark backgrounds", () => {
        for (const color of ["#000000", "#1e1b4b", "black", "blue", "red"]) {
            assert.equal(contrastText(color), "#ffffff", `wrong for ${color}`);
        }
    });

    test("picks black on light backgrounds", () => {
        for (const color of [
            "#ffffff",
            "#fef08a",
            "white",
            "whiteBright",
            "yellowBright",
            "greenBright",
        ]) {
            assert.equal(contrastText(color), "#000000", `wrong for ${color}`);
        }
    });

    test("answers for every name", () => {
        for (const name of COLOR_NAMES) {
            assert.match(contrastText(name), /^#(0{6}|f{6})$/);
        }
    });
});
