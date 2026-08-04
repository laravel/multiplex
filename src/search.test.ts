import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { highlightSearch } from "./search.js";

describe("highlightSearch", () => {
    test("returns raw text when query is empty", () => {
        const result = highlightSearch("hello world", "", 0);
        assert.equal(result.result, "hello world");
        assert.equal(result.count, 0);
        assert.deepEqual(result.linePositions, []);
    });

    test("returns count 0 when no matches", () => {
        const result = highlightSearch("hello world", "xyz", 0);
        assert.equal(result.count, 0);
        assert.equal(result.result, "hello world");
    });

    test("finds matches and returns correct count", () => {
        const result = highlightSearch("foo bar foo baz foo", "foo", -1);
        assert.equal(result.count, 3);
    });

    test("match is case-insensitive", () => {
        const result = highlightSearch("Hello HELLO hello", "hello", -1);
        assert.equal(result.count, 3);
    });

    test("wraps matches with highlight escapes", () => {
        const result = highlightSearch("abc", "abc", -1);
        assert.equal(result.count, 1);
        assert.ok(result.result.includes("\x1b[48;2;80;80;0m"));
        assert.ok(result.result.includes("\x1b[49m"));
    });

    test("active match uses different highlight", () => {
        const result = highlightSearch("foo bar foo", "foo", 0);
        assert.ok(result.result.includes("\x1b[48;2;160;120;0m"));
    });

    test("preserves ANSI escape codes in output", () => {
        const input = "\x1b[31mred text\x1b[0m normal";
        const result = highlightSearch(input, "red", -1);
        assert.equal(result.count, 1);
        assert.ok(result.result.includes("\x1b[31m"));
    });

    test("matches span across ANSI boundaries", () => {
        const input = "\x1b[31mhe\x1b[0mllo";
        const result = highlightSearch(input, "hello", -1);
        assert.equal(result.count, 1);
    });

    test("returns correct line positions", () => {
        const input = "line one\nline two\nline one again";
        const result = highlightSearch(input, "one", -1);
        assert.equal(result.count, 2);
        assert.deepEqual(result.linePositions, [0, 2]);
    });

    test("overlapping matches found at each position", () => {
        const result = highlightSearch("aaa", "aa", -1);
        assert.equal(result.count, 2);
    });
});
