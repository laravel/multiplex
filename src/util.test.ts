import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hexToRgb } from "./util.js";

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
