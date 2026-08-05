import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hexToRgb, sidebarWidth } from "./util.js";

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
