/**
 * SGR mouse reporting: terminal setup, byte decoding, hit-testing and action
 * planning. The terminal is told to report clicks and scrolls as escape
 * sequences on stdin; those bytes are decoded here into plain objects,
 * mapped against the current layout regions, and turned into scroll,
 * select-tab and focus plans that the caller applies through the same
 * setState calls the equivalent keypresses use.
 *
 * Two constraints shape this module:
 *
 * - Ink's stdin pump reads via `readable` + `read()`, and a second plain
 *   `data` listener still receives a copy of every chunk, so an
 *   observe-only listener coexists with `useInput` without starving the
 *   keyboard. What does NOT work is consuming inside that listener and
 *   pushing the remainder back with `unshift`: the pushed chunk is
 *   re-emitted to the same listener synchronously and the handler loops
 *   until the heap is gone. Mouse bytes therefore cannot be filtered out
 *   before Ink sees them with an `unshift` filter; withholding them would
 *   take a proxy stdin handed to `render()`.
 * - Ink does not understand SGR mouse sequences. Each one arrives at
 *   `useInput` as a junk keypress (`name: ""`, input `"[<0;5;10M"` and the
 *   like). The key handler only matches exact single characters and
 *   arrows, so the junk is inert — any looser matching must keep ignoring
 *   it.
 */

export const MOUSE_ENABLE_SEQUENCE = "\x1b[?1000h\x1b[?1006h";
export const MOUSE_DISABLE_SEQUENCE = "\x1b[?1000l\x1b[?1006l";

/** Ask the terminal to report clicks and wheel ticks as SGR sequences. */
export function enableMouseReporting(): void {
    try {
        process.stdout.write(MOUSE_ENABLE_SEQUENCE);
    } catch {
        // The terminal can already be gone on the way out.
    }
}

/**
 * Stop mouse reporting. Synchronous by design: it runs inside
 * `restoreTerminal()`, which is also the `process.on("exit")` fallback that
 * cannot wait for anything. A crash must never leave the shell reporting
 * mouse events into every later command line.
 */
export function disableMouseReporting(): void {
    try {
        process.stdout.write(MOUSE_DISABLE_SEQUENCE);
    } catch {
        //
    }
}

export type MouseEventType =
    | "wheel-up"
    | "wheel-down"
    | "left-click"
    | "left-release"
    | "other";

export type MouseEvent = {
    type: MouseEventType;
    /** 1-based column as reported by the terminal. */
    x: number;
    /** 1-based row as reported by the terminal. */
    y: number;
    /** Raw Cb button code from the SGR sequence. */
    button: number;
    /** True for `m`-terminated (release) sequences. */
    release: boolean;
    /** The exact sequence this event was decoded from. */
    raw: string;
};

// One complete SGR mouse sequence: ESC [ < Cb ; Cx ; Cy M|m. `M` terminates a
// press (or a wheel tick, which has no release); `m` terminates a release.
// Same care as search.ts's STRIP_PATTERN: the parameter fields are digits
// only and the terminator is exactly one of the two letters.
const SGR_MOUSE_SOURCE = "\\x1b\\[<(\\d+);(\\d+);(\\d+)([Mm])";
const SGR_MOUSE_PATTERN = new RegExp(SGR_MOUSE_SOURCE, "g");

// A chunk can end mid-sequence when the terminal splits a write. The tail is
// held back and prepended to the next chunk rather than parsed half-formed.
const TRAILING_PARTIAL_PATTERN = /\x1b(?:\[<[\d;]*)?$/;

// Cb bit layout: bits 0-1 button (0 left, 1 middle, 2 right, 3 released),
// bit 2 shift, bit 3 alt, bit 4 ctrl, bit 5 motion (drag), bit 6 wheel.
const WHEEL_UP = 64;
const WHEEL_DOWN = 65;
const BUTTON_MASK = 0b11;
const MOTION_BIT = 32;
const WHEEL_BIT = 64;

function decodeMouseEvent(
    button: number,
    x: number,
    y: number,
    release: boolean,
    raw: string,
): MouseEvent {
    let type: MouseEventType = "other";

    if (release) {
        // A bare release (button bits 3, no motion) is the second half of a
        // left click; anything else released is not something we act on.
        if (button === 3) {
            type = "left-release";
        }
    } else if (button === WHEEL_UP) {
        type = "wheel-up";
    } else if (button === WHEEL_DOWN) {
        type = "wheel-down";
    } else if (
        (button & BUTTON_MASK) === 0 &&
        (button & (MOTION_BIT | WHEEL_BIT)) === 0
    ) {
        // Left press, with or without shift/alt/ctrl held. Drags carry the
        // motion bit and middle/right presses set the button bits, so both
        // fall through to "other".
        type = "left-click";
    }

    return { type, x, y, button, release, raw };
}

/**
 * Decodes every complete SGR mouse sequence in a chunk. Anything else in the
 * chunk — keyboard input, output echoes, pasted text — is ignored, so the
 * same bytes can keep flowing to Ink untouched.
 */
export function parseMouseEvents(chunk: string): MouseEvent[] {
    const events: MouseEvent[] = [];

    // matchAll clones the pattern, so the shared /g regex keeps no lastIndex
    // between calls.
    for (const match of chunk.matchAll(SGR_MOUSE_PATTERN)) {
        const button = parseInt(match[1], 10);
        const x = parseInt(match[2], 10);
        const y = parseInt(match[3], 10);

        if (
            !Number.isSafeInteger(button) ||
            !Number.isSafeInteger(x) ||
            !Number.isSafeInteger(y)
        ) {
            continue;
        }

        events.push(decodeMouseEvent(button, x, y, match[4] === "m", match[0]));
    }

    return events;
}

/**
 * Removes complete SGR mouse sequences from a chunk, leaving everything else
 * byte-for-byte intact. Not called by shipped code — input handling is
 * deliberately observe-only — but kept, and pinned by tests, as the
 * stripping primitive for withholding mouse bytes from Ink: the proxy-stdin
 * approach described at the top of this file filters with this exact
 * pattern, which must keep matching precisely what the parser accepts
 * above.
 */
export function stripMouseSequences(chunk: string): string {
    // Safe to share the global regex: replace() resets lastIndex on every call.
    return chunk.replace(SGR_MOUSE_PATTERN, "");
}

/**
 * Reassembles sequences split across stdin chunks. Returns a function that
 * takes each incoming chunk and emits the events completed by it; a trailing
 * `\x1b`, `\x1b[` or `\x1b[<Cb;Cx` prefix is held back for the next chunk.
 */
export function createMouseAccumulator(): (chunk: string) => MouseEvent[] {
    let pending = "";

    return (chunk: string) => {
        const text = pending + chunk;
        pending = "";

        const events = parseMouseEvents(text);

        // A complete sequence at the end of the text never matches the
        // partial pattern (its M/m terminator is outside [\d;]), so whatever
        // matches here is genuinely still arriving.
        pending = text.match(TRAILING_PARTIAL_PATTERN)?.[0] ?? "";

        return events;
    };
}

export type MouseHandler = (event: MouseEvent) => void;

/**
 * Observe-only stdin tap running alongside Ink's own input handling. Chunks
 * are never consumed or rewritten — Ink still receives everything, including
 * the mouse bytes (see the note at the top of this file) — so attaching this
 * cannot starve or duplicate keyboard input.
 */
export function attachMouseListener(
    onEvent: MouseHandler,
    stdin: NodeJS.ReadStream = process.stdin,
): () => void {
    const accumulate = createMouseAccumulator();

    const onData = (data: string | Buffer) => {
        const chunk = typeof data === "string" ? data : data.toString("utf8");

        let events: MouseEvent[];

        try {
            events = accumulate(chunk);
        } catch {
            return;
        }

        for (const event of events) {
            try {
                onEvent(event);
            } catch {
                // A logging handler must never break stdin delivery.
            }
        }
    };

    stdin.on("data", onData);

    return () => {
        stdin.removeListener("data", onData);
    };
}

/**
 * Lines scrolled per wheel tick. Keyboard Up/Down move one line and PageUp/
 * PageDown move a full pane; the wheel sits between the two at three lines,
 * the step most terminal apps (less, vim with `set mouse=a`) use.
 */
export const WHEEL_SCROLL_LINES = 3;

export type ContentViewport =
    | { mode: "stream"; rows: number; cols: number }
    | { mode: "tabbed"; rows: number; cols: number; sidebarWidth: number };

/**
 * Whether 1-based terminal coordinates fall on the scrollable output rows:
 * inside the content pane and clear of borders, headers and the footer, so a
 * wheel tick over the sidebar or the chrome never scrolls. Coordinates are
 * compared against the caller's current render dimensions — pass the live
 * rows/cols, not a cached copy, because a resize moves every region below it.
 */
export function mouseInContentViewport(
    x: number,
    y: number,
    viewport: ContentViewport,
): boolean {
    if (viewport.mode === "stream") {
        // Header rows 1-2, output 3..rows-2, spacer and footer after that.
        return x >= 1 && x <= viewport.cols && y >= 3 && y <= viewport.rows - 2;
    }

    // Sidebar and the content box's left border end at sidebarWidth + 1, the
    // right border sits at cols; the box's top border, command header and its
    // rule occupy rows 2-4, the bottom border row rows - 1.
    return (
        x >= viewport.sidebarWidth + 2 &&
        x <= viewport.cols - 1 &&
        y >= 5 &&
        y <= viewport.rows - 2
    );
}

export type SidebarLayout = {
    rows: number;
    sidebarWidth: number;
    commandCount: number;
};

/**
 * Maps 1-based terminal coordinates to a sidebar row index, or null when the
 * click is not on a command row: outside the box, on its border, on empty
 * space below the last command, or past the rows that fit on screen.
 *
 * Offset math: the tabbed layout stacks a 1-row title header above a middle
 * row whose sidebar box draws its top border on terminal row 2, so the first
 * command row is terminal row 3 and command i sits at 3 + i. The sidebar's
 * own left/right borders are columns 1 and sidebarWidth, hence excluded.
 */
export function sidebarRowAt(
    x: number,
    y: number,
    layout: SidebarLayout,
): number | null {
    if (x < 2 || x > layout.sidebarWidth - 1) {
        return null;
    }

    const index = y - 3;

    if (index < 0 || index >= layout.commandCount) {
        return null;
    }

    // Past the last visible row: clipped by Ink, or into the bottom border.
    if (y > layout.rows - 2) {
        return null;
    }

    return index;
}
