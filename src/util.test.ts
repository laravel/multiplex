import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { childColumns, hexToRgb, sanitizeTitle, sidebarWidth } from "./util.js";

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

describe("childColumns", () => {
    const labels = ["server", "queue", "vite"];

    test("uses the tabbed width, the narrower mode for normal labels", () => {
        assert.equal(childColumns(labels, 120, false), 97);
        assert.equal(childColumns(labels, 200, false), 165);
        assert.equal(childColumns(labels, 80, false), 60);
    });

    test("leaves room for timestamps", () => {
        assert.equal(childColumns(labels, 120, true), 97 - 9);
    });

    // The sidebar stops widening at 40 while the stream label prefix does not,
    // so a long enough label makes stream the narrower mode.
    test("switches to the stream width once the label is long enough", () => {
        const long = ["x".repeat(45)];

        assert.equal(childColumns(long, 200, false), 149);
        assert.ok(
            childColumns(long, 200, false) < 155,
            "should not use tabbed",
        );
    });

    // Regression: the inlined formula returned 0 at 20 columns and -10 at 10.
    test("never goes below the floor on a tiny terminal", () => {
        assert.equal(childColumns(labels, 20, false), 20);
        assert.equal(childColumns(["a"], 10, false), 20);
        assert.equal(childColumns(labels, 1, true), 20);
    });

    test("is never wider than either layout can display", () => {
        for (const cols of [40, 80, 120, 200, 400]) {
            for (const ls of [["a"], labels, ["x".repeat(45)]]) {
                for (const ts of [false, true]) {
                    const width = childColumns(ls, cols, ts);
                    const maxLabelLen = Math.max(...ls.map((l) => l.length));
                    const tsWidth = ts ? 9 : 0;
                    const tabbed =
                        cols - sidebarWidth(ls, cols) - 2 - 1 - 2 - tsWidth;
                    const stream = cols - 1 - 2 - (maxLabelLen + 3) - tsWidth;
                    const label = `cols=${cols} labels=${ls.length} ts=${ts}`;

                    assert.ok(
                        width <= Math.max(20, tabbed),
                        `wider than tabbed: ${label}`,
                    );
                    assert.ok(
                        width <= Math.max(20, stream),
                        `wider than stream: ${label}`,
                    );
                }
            }
        }
    });
});

describe("sanitizeTitle", () => {
    test("leaves an ordinary title alone", () => {
        assert.equal(sanitizeTitle("Admin"), "Admin");
        assert.equal(sanitizeTitle("my app — dev"), "my app — dev");
    });

    // A BEL ends the OSC sequence, so anything after it would reach the terminal
    // as commands rather than as part of the title.
    test("drops the terminators that would end the OSC sequence", () => {
        assert.equal(sanitizeTitle("ok\x07\x1b[2J"), "ok[2J");
        assert.equal(sanitizeTitle("ok\x1b\\\x1b[2J"), "ok\\[2J");
    });

    test("drops every control character", () => {
        assert.equal(sanitizeTitle("a\x00b\nc\rd\te\x7ff"), "abcdef");

        for (let c = 0; c <= 0x9f; c++) {
            if (c <= 0x1f || c >= 0x7f) {
                assert.equal(
                    sanitizeTitle(String.fromCharCode(c)),
                    "",
                    `did not strip \\x${c.toString(16)}`,
                );
            }
        }
    });

    test("keeps printable and non-ASCII text", () => {
        assert.equal(sanitizeTitle("laravel 🚀 café"), "laravel 🚀 café");
    });

    test("collapses to empty when there is nothing printable left", () => {
        assert.equal(sanitizeTitle("\x1b\x07"), "");
    });
});

describe("sidebarWidth", () => {
    test("never goes below the minimum", () => {
        assert.equal(sidebarWidth(["a"], 80), 15);
        assert.equal(sidebarWidth(["server"], 80), 15);
        assert.equal(sidebarWidth(["a"], 1), 15);
    });

    test("never goes above the maximum", () => {
        assert.equal(sidebarWidth(["a"], 400), 40);
        assert.equal(sidebarWidth(["a"], 1000), 40);
        assert.equal(sidebarWidth(["x".repeat(50)], 80), 40);
    });

    test("targets 15% of the terminal when that clears the labels", () => {
        assert.equal(sidebarWidth(["server"], 200), 30);
        assert.equal(sidebarWidth(["server", "queue", "vite"], 120), 18);
    });

    test("widens past the target to fit a long label", () => {
        assert.equal(sidebarWidth(["averyveryverylonglabel"], 80), 29);
    });

    test("sizes to the longest label", () => {
        assert.equal(
            sidebarWidth(["a", "longest-label"], 200),
            sidebarWidth(["longest-label"], 200),
        );
    });
});
