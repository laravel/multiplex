import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, test } from "node:test";
import {
    attachMouseListener,
    createMouseAccumulator,
    parseMouseEvents,
    stripMouseSequences,
} from "./mouse.js";

describe("parseMouseEvents", () => {
    test("returns no events for keyboard input and plain text", () => {
        assert.deepEqual(parseMouseEvents("q"), []);
        assert.deepEqual(parseMouseEvents("\x1b[A"), []);
        assert.deepEqual(parseMouseEvents("hello world"), []);
        assert.deepEqual(parseMouseEvents(""), []);
    });

    test("decodes a left press with 1-based coordinates", () => {
        assert.deepEqual(parseMouseEvents("\x1b[<0;5;10M"), [
            {
                type: "left-click",
                x: 5,
                y: 10,
                button: 0,
                release: false,
                raw: "\x1b[<0;5;10M",
            },
        ]);
    });

    test("decodes a left release as the second half of a click", () => {
        const [event] = parseMouseEvents("\x1b[<3;5;10m");

        assert.equal(event?.type, "left-release");
        assert.equal(event?.release, true);
    });

    test("decodes wheel up and wheel down", () => {
        assert.equal(parseMouseEvents("\x1b[<64;5;10M")[0]?.type, "wheel-up");
        assert.equal(parseMouseEvents("\x1b[<65;5;10M")[0]?.type, "wheel-down");
    });

    test("leaves drags and other buttons as other", () => {
        // Motion bit set: a left-drag, not a click.
        assert.equal(parseMouseEvents("\x1b[<32;5;10M")[0]?.type, "other");
        assert.equal(parseMouseEvents("\x1b[<35;5;10m")[0]?.type, "other");
        // Middle and right presses.
        assert.equal(parseMouseEvents("\x1b[<1;5;10M")[0]?.type, "other");
        assert.equal(parseMouseEvents("\x1b[<2;5;10M")[0]?.type, "other");
        // Modified wheel ticks are not plain scrolls.
        assert.equal(parseMouseEvents("\x1b[<68;5;10M")[0]?.type, "other");
    });

    test("treats a modified left press as a left click", () => {
        // Shift held still clicks the same tab.
        assert.equal(parseMouseEvents("\x1b[<4;5;10M")[0]?.type, "left-click");
    });

    test("decodes several sequences in one chunk", () => {
        const events = parseMouseEvents(
            "\x1b[<0;1;1Mq\x1b[<64;2;3M\x1b[<65;4;5M",
        );

        assert.deepEqual(
            events.map((e) => e.type),
            ["left-click", "wheel-up", "wheel-down"],
        );
        assert.deepEqual(
            events.map((e) => [e.x, e.y]),
            [
                [1, 1],
                [2, 3],
                [4, 5],
            ],
        );
    });

    test("ignores a sequence split across the end of the chunk", () => {
        assert.deepEqual(parseMouseEvents("ab\x1b[<0;5;1"), []);
        assert.deepEqual(parseMouseEvents("ab\x1b"), []);
    });

    test("supports large coordinates past the old X10 overflow", () => {
        // SGR sends coordinates in decimal, so column 300 arrives intact where
        // the legacy protocol would have wrapped past 223.
        const [event] = parseMouseEvents("\x1b[<0;300;100M");

        assert.equal(event?.x, 300);
        assert.equal(event?.y, 100);
    });
});

describe("stripMouseSequences", () => {
    test("removes sequences and leaves everything else intact", () => {
        assert.equal(stripMouseSequences("q\x1b[<0;5;10M\x1b[A"), "q\x1b[A");
        assert.equal(stripMouseSequences("plain"), "plain");
    });
});

describe("createMouseAccumulator", () => {
    test("reassembles a sequence split across chunks", () => {
        const next = createMouseAccumulator();

        assert.deepEqual(next("\x1b[<0;5;"), []);
        assert.deepEqual(
            next("10M").map((e) => [e.type, e.x, e.y]),
            [["left-click", 5, 10]],
        );
    });

    test("holds back a bare escape without losing it", () => {
        const next = createMouseAccumulator();

        assert.deepEqual(next("\x1b"), []);
        // An arrow key completing the escape is not a mouse event.
        assert.deepEqual(next("[A"), []);
    });

    test("recovers when the pending prefix was never a mouse sequence", () => {
        const next = createMouseAccumulator();

        assert.deepEqual(next("\x1b[<12"), []);
        // Keyboard text ends the prefix; nothing is stuck for the next chunk.
        assert.deepEqual(next("q"), []);
        assert.deepEqual(
            next("\x1b[<64;1;1M").map((e) => e.type),
            ["wheel-up"],
        );
    });
});

describe("attachMouseListener", () => {
    const fakeStdin = () => new EventEmitter() as unknown as NodeJS.ReadStream;

    test("forwards decoded events and detaches cleanly", () => {
        const stdin = fakeStdin();
        const seen: string[] = [];
        const detach = attachMouseListener((e) => seen.push(e.type), stdin);

        stdin.emit("data", "q\x1b[<64;1;1M");
        assert.deepEqual(seen, ["wheel-up"]);

        detach();
        stdin.emit("data", "\x1b[<65;1;1M");
        assert.deepEqual(seen, ["wheel-up"]);
    });

    test("accepts Buffer chunks", () => {
        const stdin = fakeStdin();
        const seen: string[] = [];
        const detach = attachMouseListener((e) => seen.push(e.type), stdin);

        stdin.emit("data", Buffer.from("\x1b[<0;2;3M", "utf8"));
        assert.deepEqual(seen, ["left-click"]);

        detach();
    });

    test("a throwing handler does not break later events", () => {
        const stdin = fakeStdin();
        const seen: string[] = [];
        const detach = attachMouseListener((e) => {
            if (e.type === "wheel-up") {
                throw new Error("debug logger blew up");
            }

            seen.push(e.type);
        }, stdin);

        stdin.emit("data", "\x1b[<64;1;1M\x1b[<0;2;3M");
        assert.deepEqual(seen, ["left-click"]);

        detach();
    });
});
