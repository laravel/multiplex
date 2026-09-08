import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, test } from "node:test";
import {
    attachMouseListener,
    createMouseAccumulator,
    type MouseEvent,
    mouseInContentViewport,
    parseMouseEvents,
    planClickResponse,
    planWheelResponse,
    sidebarRowAt,
    stripMouseSequences,
    WHEEL_SCROLL_LINES,
} from "./mouse.js";

const mouseAt = (
    type: MouseEvent["type"],
    x: number,
    y: number,
): MouseEvent => ({ type, x, y, button: 0, release: false, raw: "" });

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

    test("ignores malformed sequences without throwing", () => {
        assert.deepEqual(parseMouseEvents("\x1b[<;5;10M"), []);
        assert.deepEqual(parseMouseEvents("\x1b[<a;5;10M"), []);
        assert.deepEqual(parseMouseEvents("\x1b[<0;5M"), []);
        assert.deepEqual(parseMouseEvents("\x1b[<0;5;10X"), []);
        assert.deepEqual(parseMouseEvents("\x1b[<0;5;10"), []);
        assert.deepEqual(parseMouseEvents("\x1b[<0;-5;10M"), []);
        assert.deepEqual(parseMouseEvents("\x1b[<0;5;10MM"), [
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

    test("ignores the legacy X10 byte encoding", () => {
        // Three raw bytes after ESC[M instead of decimal SGR parameters.
        assert.deepEqual(parseMouseEvents("\x1b[M !!"), []);
    });

    test("skips coordinates too large to be exact", () => {
        assert.deepEqual(
            parseMouseEvents("\x1b[<99999999999999999999;1;1M"),
            [],
        );
    });

    test("treats a non-button release as other", () => {
        assert.equal(parseMouseEvents("\x1b[<0;5;10m")[0]?.type, "other");
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

describe("mouseInContentViewport", () => {
    test("wheel step is a few lines, not a full page", () => {
        assert.ok(WHEEL_SCROLL_LINES >= 2 && WHEEL_SCROLL_LINES <= 5);
    });

    test("stream mode covers the output rows but not the chrome", () => {
        const viewport = { mode: "stream", rows: 24, cols: 80 } as const;

        assert.equal(mouseInContentViewport(1, 3, viewport), true);
        assert.equal(mouseInContentViewport(80, 22, viewport), true);
        // Header rows, spacer and footer are not scrollable.
        assert.equal(mouseInContentViewport(40, 1, viewport), false);
        assert.equal(mouseInContentViewport(40, 2, viewport), false);
        assert.equal(mouseInContentViewport(40, 23, viewport), false);
        assert.equal(mouseInContentViewport(40, 24, viewport), false);
        assert.equal(mouseInContentViewport(0, 10, viewport), false);
        assert.equal(mouseInContentViewport(81, 10, viewport), false);
    });

    test("tabbed mode excludes the sidebar, borders and header", () => {
        const viewport = {
            mode: "tabbed",
            rows: 24,
            cols: 80,
            sidebarWidth: 18,
        } as const;

        assert.equal(mouseInContentViewport(20, 5, viewport), true);
        assert.equal(mouseInContentViewport(79, 22, viewport), true);
        // Sidebar and the content box's own left border.
        assert.equal(mouseInContentViewport(18, 10, viewport), false);
        assert.equal(mouseInContentViewport(19, 10, viewport), false);
        assert.equal(mouseInContentViewport(1, 10, viewport), false);
        // Right border, top chrome and footer.
        assert.equal(mouseInContentViewport(80, 10, viewport), false);
        assert.equal(mouseInContentViewport(40, 2, viewport), false);
        assert.equal(mouseInContentViewport(40, 3, viewport), false);
        assert.equal(mouseInContentViewport(40, 4, viewport), false);
        assert.equal(mouseInContentViewport(40, 23, viewport), false);
        assert.equal(mouseInContentViewport(40, 24, viewport), false);
    });

    test("follows the current dimensions, not a stale layout", () => {
        // A resize moves every region: the same coordinates scroll before a
        // shrink and miss after it.
        const before = { mode: "stream", rows: 24, cols: 80 } as const;
        const after = { mode: "stream", rows: 12, cols: 80 } as const;

        assert.equal(mouseInContentViewport(40, 20, before), true);
        assert.equal(mouseInContentViewport(40, 20, after), false);
    });
});

describe("sidebarRowAt", () => {
    const layout = { rows: 24, sidebarWidth: 18, commandCount: 3 };

    test("maps each command row index-based from row 3", () => {
        assert.equal(sidebarRowAt(5, 3, layout), 0);
        assert.equal(sidebarRowAt(5, 4, layout), 1);
        assert.equal(sidebarRowAt(5, 5, layout), 2);
    });

    test("ignores the box borders", () => {
        // Left and right border columns.
        assert.equal(sidebarRowAt(1, 4, layout), null);
        assert.equal(sidebarRowAt(18, 4, layout), null);
        // Top border row and bottom border row.
        assert.equal(sidebarRowAt(5, 2, layout), null);
        assert.equal(sidebarRowAt(5, 23, layout), null);
    });

    test("ignores empty space past the last command", () => {
        assert.equal(sidebarRowAt(5, 6, layout), null);
        assert.equal(sidebarRowAt(5, 22, layout), null);
    });

    test("ignores rows clipped off screen", () => {
        const crowded = { rows: 10, sidebarWidth: 18, commandCount: 9 };

        assert.equal(sidebarRowAt(5, 8, crowded), 5);
        assert.equal(sidebarRowAt(5, 9, crowded), null);
    });

    test("ignores clicks outside the sidebar entirely", () => {
        assert.equal(sidebarRowAt(19, 4, layout), null);
        assert.equal(sidebarRowAt(80, 4, layout), null);
        assert.equal(sidebarRowAt(5, 1, layout), null);
        assert.equal(sidebarRowAt(5, 24, layout), null);
    });
});

describe("planWheelResponse", () => {
    const tabbed = {
        streamMode: false,
        searchInputMode: false,
        filterMode: false,
        rows: 24,
        cols: 80,
        sidebarWidth: 18,
    };

    test("scrolls three lines per tick over the content pane", () => {
        assert.deepEqual(
            planWheelResponse(mouseAt("wheel-up", 40, 10), tabbed),
            {
                kind: "scroll",
                direction: "up",
                lines: 3,
            },
        );
        assert.deepEqual(
            planWheelResponse(mouseAt("wheel-down", 40, 10), tabbed),
            { kind: "scroll", direction: "down", lines: 3 },
        );
    });

    test("ignores ticks over the sidebar and the chrome", () => {
        assert.deepEqual(
            planWheelResponse(mouseAt("wheel-up", 5, 10), tabbed),
            {
                kind: "none",
            },
        );
        assert.deepEqual(
            planWheelResponse(mouseAt("wheel-up", 40, 2), tabbed),
            { kind: "none" },
        );
    });

    test("ignores anything but wheel events", () => {
        assert.deepEqual(
            planWheelResponse(mouseAt("left-click", 40, 10), tabbed),
            { kind: "none" },
        );
        assert.deepEqual(planWheelResponse(mouseAt("other", 40, 10), tabbed), {
            kind: "none",
        });
    });

    test("stays dead while search or filter owns the keyboard", () => {
        assert.deepEqual(
            planWheelResponse(mouseAt("wheel-up", 40, 10), {
                ...tabbed,
                searchInputMode: true,
            }),
            { kind: "none" },
        );
        assert.deepEqual(
            planWheelResponse(mouseAt("wheel-up", 40, 10), {
                ...tabbed,
                filterMode: true,
            }),
            { kind: "none" },
        );
    });

    test("works in stream mode wherever output scrolls", () => {
        const stream = { ...tabbed, streamMode: true };

        assert.deepEqual(
            planWheelResponse(mouseAt("wheel-up", 40, 10), stream),
            {
                kind: "scroll",
                direction: "up",
                lines: 3,
            },
        );
    });
});

describe("planClickResponse", () => {
    const tabbed = {
        streamMode: false,
        searchInputMode: false,
        filterMode: false,
        rows: 24,
        cols: 80,
        sidebarWidth: 18,
        commandCount: 3,
    };

    test("selects the command in the clicked row", () => {
        assert.deepEqual(
            planClickResponse(mouseAt("left-click", 5, 3), tabbed),
            { kind: "select-tab", index: 0 },
        );
        assert.deepEqual(
            planClickResponse(mouseAt("left-click", 5, 4), tabbed),
            { kind: "select-tab", index: 1 },
        );
    });

    test("moves focus to the content pane", () => {
        assert.deepEqual(
            planClickResponse(mouseAt("left-click", 40, 10), tabbed),
            { kind: "focus-content" },
        );
    });

    test("ignores borders and empty space", () => {
        assert.deepEqual(
            planClickResponse(mouseAt("left-click", 18, 4), tabbed),
            { kind: "none" },
        );
        assert.deepEqual(
            planClickResponse(mouseAt("left-click", 5, 6), tabbed),
            { kind: "none" },
        );
    });

    test("ignores clicks in stream mode and modal modes", () => {
        assert.deepEqual(
            planClickResponse(mouseAt("left-click", 5, 4), {
                ...tabbed,
                streamMode: true,
            }),
            { kind: "none" },
        );
        assert.deepEqual(
            planClickResponse(mouseAt("left-click", 5, 4), {
                ...tabbed,
                searchInputMode: true,
            }),
            { kind: "none" },
        );
        assert.deepEqual(
            planClickResponse(mouseAt("left-click", 5, 4), {
                ...tabbed,
                filterMode: true,
            }),
            { kind: "none" },
        );
    });

    test("ignores anything but a left press", () => {
        assert.deepEqual(planClickResponse(mouseAt("wheel-up", 5, 4), tabbed), {
            kind: "none",
        });
        assert.deepEqual(
            planClickResponse(
                { ...mouseAt("left-click", 5, 4), type: "left-release" },
                tabbed,
            ),
            { kind: "none" },
        );
    });
});
