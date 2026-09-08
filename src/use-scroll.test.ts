import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WHEEL_SCROLL_LINES } from "./mouse.js";
import {
    nextPageDown,
    nextPageUp,
    nextScrollDown,
    nextScrollUp,
} from "./use-scroll.js";

// A buffer of 100 lines in a 20-row pane: offsets run 0..80, null is pinned
// to the live tail.
const TOTAL = 100;
const HEIGHT = 20;

describe("nextScrollDown", () => {
    test("stays pinned when already at the live tail", () => {
        assert.equal(nextScrollDown(null, TOTAL, HEIGHT), null);
    });

    test("moves one line toward the tail", () => {
        assert.equal(nextScrollDown(70, TOTAL, HEIGHT), 71);
    });

    test("snaps back to the tail at the last offset", () => {
        assert.equal(nextScrollDown(79, TOTAL, HEIGHT), null);
        assert.equal(nextScrollDown(80, TOTAL, HEIGHT), null);
    });
});

describe("nextScrollUp", () => {
    test("lifts one line off the live tail", () => {
        assert.equal(nextScrollUp(null, TOTAL, HEIGHT), 79);
    });

    test("moves one line toward the top", () => {
        assert.equal(nextScrollUp(70, TOTAL, HEIGHT), 69);
    });

    test("clamps at the top", () => {
        assert.equal(nextScrollUp(1, TOTAL, HEIGHT), 0);
        assert.equal(nextScrollUp(0, TOTAL, HEIGHT), 0);
    });
});

describe("nextPageDown", () => {
    test("stays pinned when already at the live tail", () => {
        assert.equal(nextPageDown(null, TOTAL, HEIGHT), null);
    });

    test("moves a full pane toward the tail", () => {
        assert.equal(nextPageDown(50, TOTAL, HEIGHT), 70);
    });

    test("snaps back to the tail when the page would overshoot", () => {
        assert.equal(nextPageDown(70, TOTAL, HEIGHT), null);
    });
});

describe("nextPageUp", () => {
    test("lifts a full pane off the live tail", () => {
        assert.equal(nextPageUp(null, TOTAL, HEIGHT), 60);
    });

    test("clamps at the top", () => {
        assert.equal(nextPageUp(10, TOTAL, HEIGHT), 0);
    });
});

describe("short buffers", () => {
    test("a buffer shorter than the pane has nowhere to scroll", () => {
        assert.equal(nextScrollDown(0, 10, HEIGHT), null);
        assert.equal(nextScrollUp(null, 10, HEIGHT), 0);
        assert.equal(nextPageDown(null, 10, HEIGHT), null);
        assert.equal(nextPageUp(null, 10, HEIGHT), 0);
    });
});

describe("wheel scrolling", () => {
    test("one tick applies the line transition three times", () => {
        let offset: number | null = null;

        for (let i = 0; i < WHEEL_SCROLL_LINES; i++) {
            offset = nextScrollUp(offset, TOTAL, HEIGHT);
        }

        assert.equal(offset, 77);
    });

    test("ticks down return to the live tail exactly like Down does", () => {
        let offset: number | null = 77;

        for (let i = 0; i < WHEEL_SCROLL_LINES; i++) {
            offset = nextScrollDown(offset, TOTAL, HEIGHT);
        }

        assert.equal(offset, null);
    });

    test("ticks up clamp at the top", () => {
        let offset: number | null = 5;

        for (let i = 0; i < 10; i++) {
            offset = nextScrollUp(offset, TOTAL, HEIGHT);
        }

        assert.equal(offset, 0);
    });
});
