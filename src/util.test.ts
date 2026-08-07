import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { stripAnsi } from "./search.js";
import {
    childColumns,
    formatStreamContinuation,
    formatStreamLabel,
    sanitizeTitle,
    sidebarWidth,
    wrapLine,
} from "./util.js";

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

describe("wrapLine", () => {
    test("leaves a line that already fits as a single row", () => {
        assert.deepEqual(wrapLine("short", 20), ["short"]);
        assert.deepEqual(wrapLine("", 20), [""]);
        assert.deepEqual(wrapLine("x".repeat(20), 20), ["x".repeat(20)]);
    });

    // The line that started this: laravel-vite-plugin emits it on boot and it
    // does not fit the tabbed pane on any terminal anyone actually has.
    test("splits the fontaine warning rather than losing its second half", () => {
        const warning =
            '[laravel:fonts] Optimized font fallbacks require the optional "fontaine" package. Install it, or set "optimizedFallbacks: false" on your fonts to disable the feature.';

        const rows = wrapLine(warning, 97);

        assert.equal(rows.length, 2);
        assert.ok(rows.every((r) => r.length <= 97));
        assert.equal(rows.join("").replace(/ {2,}/g, " "), warning);
        assert.ok(rows[1].includes("optimizedFallbacks"));
    });

    test("never emits a row wider than the pane", () => {
        const samples = [
            "a".repeat(500),
            `https://example.com/${"segment/".repeat(40)}`,
            "  ➜  Local:   http://localhost:5173/",
            "\x1b[36mcolored\x1b[39m ".repeat(30),
        ];

        for (const width of [20, 40, 97]) {
            for (const sample of samples) {
                for (const row of wrapLine(sample, width)) {
                    assert.ok(
                        stripAnsi(row).length <= width,
                        `row wider than ${width}: ${JSON.stringify(row)}`,
                    );
                }
            }
        }
    });

    test("measures display width, not escape codes", () => {
        const colored = `\x1b[31m${"x".repeat(20)}\x1b[39m`;

        assert.deepEqual(wrapLine(colored, 20), [colored]);
    });

    test("carries the active color onto continuation rows", () => {
        const rows = wrapLine(`\x1b[31m${"x".repeat(40)}\x1b[39m`, 20);

        assert.equal(rows.length, 2);
        assert.ok(rows[1].startsWith("\x1b[31m"));
    });

    test("keeps leading indentation, so stack traces stay readable", () => {
        const rows = wrapLine(`    at fn (${"a/".repeat(30)}f.js:1:2)`, 30);

        assert.ok(rows.length > 1);
        assert.ok(rows[0].startsWith("    at fn"));
    });

    // A pane can be reported as zero width mid-resize; wrapping to it would spin.
    test("gives up rather than wrapping to a useless width", () => {
        assert.deepEqual(wrapLine("anything", 0), ["anything"]);
        assert.deepEqual(wrapLine("anything", -5), ["anything"]);
    });
});

describe("formatStreamLabel", () => {
    test("writes a hex color as a truecolor sequence", () => {
        assert.match(
            formatStreamLabel("a", "#93c5fd", 1, true),
            /\x1b\[38;2;147;197;253m/,
        );
    });

    // A name has to reach the terminal as its SGR code so it picks up the theme's
    // idea of the color, not ours.
    test("writes a named color as its SGR code", () => {
        assert.match(formatStreamLabel("a", "red", 1, true), /\x1b\[31m/);
        assert.match(
            formatStreamLabel("a", "blueBright", 1, true),
            /\x1b\[94m/,
        );
    });

    test("emits no color at all when asked not to", () => {
        assert.equal(formatStreamLabel("a", "red", 3, false), "  a │ ");
    });

    test("is the same width whatever form the color took", () => {
        for (const color of ["#93c5fd", "red", "blueBright"]) {
            assert.equal(
                stripAnsi(formatStreamLabel("api", color, 6, true)),
                "   api │ ",
            );
        }
    });
});

describe("formatStreamContinuation", () => {
    test("is exactly as wide as the label prefix it stands in for", () => {
        for (const maxLabelLen of [1, 4, 12, 40]) {
            assert.equal(
                stripAnsi(formatStreamContinuation(maxLabelLen, true)).length,
                stripAnsi(formatStreamLabel("a", "#ffffff", maxLabelLen, true))
                    .length,
            );
        }
    });

    test("keeps the rule but drops the label", () => {
        assert.equal(formatStreamContinuation(4, false), "     │ ");
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
