import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { highlightLine, indexMatches, stripAnsi } from "./search.js";

const MATCH_BG = "\x1b[48;2;80;80;0m";
const CURRENT_MATCH_BG = "\x1b[48;2;160;120;0m";
const RESET_BG = "\x1b[49m";

const withoutHighlights = (s: string) =>
    s
        .replaceAll(MATCH_BG, "")
        .replaceAll(CURRENT_MATCH_BG, "")
        .replaceAll(RESET_BG, "");

describe("indexMatches", () => {
    test("returns an empty index when query is empty", () => {
        const index = indexMatches(["hello world"], "");
        assert.equal(index.count, 0);
        assert.deepEqual(index.lineOf, []);
        assert.equal(index.firstMatchOnLine.size, 0);
    });

    test("returns count 0 when no matches", () => {
        assert.equal(indexMatches(["hello world"], "xyz").count, 0);
    });

    test("counts every match on a line", () => {
        const index = indexMatches(["foo bar foo baz foo"], "foo");
        assert.equal(index.count, 3);
        assert.deepEqual(index.lineOf, [0, 0, 0]);
    });

    test("match is case-insensitive", () => {
        assert.equal(indexMatches(["Hello HELLO hello"], "hello").count, 3);
    });

    test("counts overlapping matches at each position", () => {
        assert.equal(indexMatches(["aaa"], "aa").count, 2);
    });

    test("ignores ANSI codes when matching", () => {
        assert.equal(indexMatches(["\x1b[31mhe\x1b[0mllo"], "hello").count, 1);
    });

    test("records the line of each match", () => {
        const index = indexMatches(
            ["line one", "line two", "line one again"],
            "one",
        );
        assert.equal(index.count, 2);
        assert.deepEqual(index.lineOf, [0, 2]);
    });

    test("records the first match index for each matching line", () => {
        const index = indexMatches(["a a", "none", "a", "a a a"], "a");
        assert.equal(index.count, 6);
        assert.deepEqual(
            [...index.firstMatchOnLine],
            [
                [0, 0],
                [2, 2],
                [3, 3],
            ],
        );
    });

    test("skips lines with no matches", () => {
        const index = indexMatches(["nope", "yes", "nope"], "yes");
        assert.deepEqual(index.lineOf, [1]);
        assert.equal(index.firstMatchOnLine.has(0), false);
    });
});

describe("highlightLine", () => {
    test("returns raw text when query is empty", () => {
        assert.equal(highlightLine("hello world", "", 0, 0), "hello world");
    });

    test("returns raw text when the line has no match", () => {
        assert.equal(highlightLine("hello world", "xyz", 0, -1), "hello world");
    });

    test("wraps matches with highlight escapes", () => {
        const result = highlightLine("abc", "abc", -1, 0);
        assert.ok(result.includes(MATCH_BG));
        assert.ok(result.includes(RESET_BG));
    });

    test("active match uses a different highlight", () => {
        const result = highlightLine("foo bar foo", "foo", 0, 0);
        assert.ok(result.startsWith(CURRENT_MATCH_BG));
        assert.ok(result.includes(MATCH_BG));
    });

    test("active match is offset by the line's first match index", () => {
        // This line holds buffer-wide matches 4 and 5, so 5 is the active one.
        const result = highlightLine("foo foo", "foo", 5, 4);
        assert.ok(result.startsWith(MATCH_BG));
        assert.ok(result.indexOf(CURRENT_MATCH_BG) > 0);
    });

    test("no match is active when activeMatchIdx is -1", () => {
        assert.equal(
            highlightLine("foo foo", "foo", -1, 0).includes(CURRENT_MATCH_BG),
            false,
        );
    });

    test("preserves ANSI escape codes in output", () => {
        const result = highlightLine(
            "\x1b[31mred text\x1b[0m normal",
            "red",
            -1,
            0,
        );
        assert.ok(result.includes("\x1b[31m"));
        assert.ok(result.includes(MATCH_BG));
    });

    test("highlights matches spanning ANSI boundaries", () => {
        const result = highlightLine("\x1b[31mhe\x1b[0mllo", "hello", 0, 0);
        assert.ok(result.includes(CURRENT_MATCH_BG));
        assert.equal(stripAnsi(withoutHighlights(result)), "hello");
    });

    test("highlights overlapping matches without dropping text", () => {
        const result = highlightLine("aaa", "aa", -1, 0);
        assert.equal(withoutHighlights(result), "aaa");
    });

    test("leaves unmatched text untouched", () => {
        const result = highlightLine("prefix match suffix", "match", -1, 0);
        assert.ok(result.startsWith("prefix "));
        assert.ok(result.endsWith(" suffix"));
    });
});

describe("stripAnsi", () => {
    test("removes CSI sequences, stray escapes and carriage returns", () => {
        assert.equal(stripAnsi("\x1b[31mred\x1b[0m"), "red");
        assert.equal(stripAnsi("a\rb"), "ab");
        assert.equal(stripAnsi("\x1b]0;title\x07abc"), "]0;title\x07abc");
    });

    test("agrees with the highlighter on where matches are", () => {
        const lines = [
            "plain text",
            "\x1b[31mcolored\x1b[0m text",
            "\x1b]0;osc title\x07text",
            "bare \x1b escape text",
            "carriage\rreturn text",
            "\x1b[1;38;2;147;197;253m[label]\x1b[0m text",
        ];

        for (const line of lines) {
            const label = JSON.stringify(line);
            const index = indexMatches([line], "text");
            const highlighted = highlightLine(line, "text", 0, 0);
            const inactive = highlighted.split(MATCH_BG).length - 1;
            const active = highlighted.split(CURRENT_MATCH_BG).length - 1;

            assert.equal(inactive + active, index.count, `count for ${label}`);
            assert.equal(active, 1, `active match for ${label}`);
        }
    });
});
