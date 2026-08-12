import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import { colorOpen } from "./color.js";

export const systemMsg = (text: string) => `\x1b[2m\x1b[3m${text}\x1b[0m`;

// OSC strings have no escape mechanism, so stripping is the only option: a BEL
// or ESC in the title ends the sequence early and the rest is read as commands.
export const sanitizeTitle = (title: string) =>
    title.replace(/[\x00-\x1f\x7f-\x9f]/g, "");

/**
 * A command on a single row. Ink breaks on a newline whatever the wrap mode, so
 * a command written across several lines would grow the tabbed header that shows
 * it — and the output pane's height is counted off a header one row tall.
 */
export const singleLine = (text: string) => text.replace(/\s+/g, " ").trim();

export const formatTimestamp = (time: Date) =>
    `\x1b[90m${time.toLocaleTimeString("en-GB")} \x1b[0m`;

const MIN_SIDEBAR_WIDTH = 15;
const MAX_SIDEBAR_WIDTH = 40;

export function sidebarWidth(labels: string[], totalColumns: number): number {
    const maxLen = Math.max(...labels.map((l) => l.length));
    const labelWidth = maxLen + 7;
    const targetWidth = Math.floor(totalColumns * 0.15);

    return Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, Math.max(labelWidth, targetWidth)),
    );
}

export const MIN_TABS_LAYOUT_WIDTH = 80;

const MIN_OUTPUT_LINES = 4;
const STREAM_CHROME = 4;
const TABBED_CHROME = 6;
const SIDEBAR_CHROME = 4;

/**
 * Rows needed before the tabbed layout is worth using. The sidebar renders one
 * row per command and silently drops the overflow, so it has to fit every label
 * as well as leave the content pane something to show.
 */
export function minTabsLayoutHeight(commandCount: number): number {
    return Math.max(
        commandCount + SIDEBAR_CHROME,
        TABBED_CHROME + MIN_OUTPUT_LINES,
    );
}

export const TIMESTAMP_WIDTH = 9;
const CONTENT_BORDER = 2;
const CONTENT_PADDING = 1;
const SCROLLBAR_WIDTH = 2;
const STREAM_PADDING = 1;
// The " │ " rule that separates the label from the output in stream mode.
const STREAM_LABEL_EXTRA = 3;
const MIN_CHILD_COLUMNS = 20;

/**
 * The smallest terminal the TUI is worth rendering into, measured against the
 * stream layout because that is the one a small terminal falls back to. Rows:
 * its chrome plus enough lines to be reading output rather than a header.
 * Columns: its padding, scrollbar and label rule plus the same floor every
 * width calculation here clamps to.
 *
 * The label itself is left out of the column figure on purpose. This is about
 * the terminal being too small for any TUI, not about this particular set of
 * commands — long labels squeeze the pane, and `streamTextWidth` already
 * clamps for that, but they should not decide whether there is a TUI at all.
 */
export const MIN_ROWS = STREAM_CHROME + MIN_OUTPUT_LINES;
export const MIN_COLUMNS =
    STREAM_PADDING + SCROLLBAR_WIDTH + STREAM_LABEL_EXTRA + MIN_CHILD_COLUMNS;

export const fitsTui = (columns: number, rows: number) =>
    columns >= MIN_COLUMNS && rows >= MIN_ROWS;

/** Columns left for output text in the tabbed content pane. */
export function tabbedTextWidth(
    labels: string[],
    totalColumns: number,
    timestamps: boolean,
): number {
    return Math.max(
        MIN_CHILD_COLUMNS,
        totalColumns -
            sidebarWidth(labels, totalColumns) -
            CONTENT_BORDER -
            CONTENT_PADDING -
            SCROLLBAR_WIDTH -
            (timestamps ? TIMESTAMP_WIDTH : 0),
    );
}

/** Columns left for output text in the stream pane, past the label prefix. */
export function streamTextWidth(
    labels: string[],
    totalColumns: number,
    timestamps: boolean,
): number {
    const maxLabelLen = Math.max(...labels.map((l) => l.length));

    return Math.max(
        MIN_CHILD_COLUMNS,
        totalColumns -
            STREAM_PADDING -
            SCROLLBAR_WIDTH -
            (maxLabelLen + STREAM_LABEL_EXTRA) -
            (timestamps ? TIMESTAMP_WIDTH : 0),
    );
}

/**
 * The width to advertise to children as COLUMNS. They get it once at spawn and
 * it can never be updated, so it has to hold for both layouts — switching mode
 * with `s` or `t` must not invalidate it — so we take whichever mode is narrower.
 *
 * Erring narrow is the point. Output wider than the pane is re-wrapped by the
 * renderer, which costs a ragged right edge; output narrower than it just wraps
 * early. Tabbed is the narrower mode for any sane label, but that is emergent
 * from MAX_SIDEBAR_WIDTH rather than guaranteed: the sidebar stops widening at
 * 40 while the stream label prefix keeps growing, so past a ~39 character label
 * stream becomes the narrower one.
 */
export function childColumns(
    labels: string[],
    totalColumns: number,
    timestamps: boolean,
): number {
    return Math.min(
        tabbedTextWidth(labels, totalColumns, timestamps),
        streamTextWidth(labels, totalColumns, timestamps),
    );
}

/**
 * Split one logical line into the screen rows it occupies. Callers treat the
 * result as independent buffer entries, which is what keeps the scroll, the
 * scrollbar and the search index working on a one-entry-per-row basis.
 *
 * stringWidth has its own ASCII fast path and costs a fraction of a microsecond
 * on the overwhelming majority of lines, so measuring first is far cheaper than
 * handing everything to wrapAnsi.
 */
export function wrapLine(text: string, width: number): string[] {
    if (width < 1 || stringWidth(text) <= width) {
        return [text];
    }

    return wrapAnsi(text, width, { hard: true, trim: false }).split("\n");
}

/**
 * The label prefix in front of every interleaved line. The only implementation:
 * the stream pane, the flush on exit and inline mode all call it, so the same
 * run cannot come out looking like two different programs depending on where you
 * happened to read it. Its width is STREAM_LABEL_EXTRA past the longest label.
 */
export function formatStreamLabel(
    label: string,
    color: string,
    maxLabelLen: number,
    useColor: boolean,
): string {
    const padding = " ".repeat(maxLabelLen - label.length);

    if (!useColor) {
        return `${padding}${label} │ `;
    }

    return `\x1b[1m${colorOpen(color)}${padding}${label}\x1b[0m\x1b[90m │ \x1b[0m`;
}

/**
 * The same prefix for the second and later rows of a wrapped line: the rule
 * carries on so the block still reads as one command's output, but the label is
 * blank rather than repeated, which would look like separate lines.
 */
export function formatStreamContinuation(
    maxLabelLen: number,
    useColor: boolean,
): string {
    const padding = " ".repeat(maxLabelLen);

    if (!useColor) {
        return `${padding} │ `;
    }

    return `${padding}\x1b[90m │ \x1b[0m`;
}

/**
 * COLUMNS for inline mode. There is no pane to truncate against, so this only
 * stops children wrapping under their own label prefix.
 */
export function inlineChildColumns(
    labels: string[],
    totalColumns: number,
    timestamps: boolean,
): number {
    const maxLabelLen = Math.max(...labels.map((l) => l.length));
    const prefix =
        maxLabelLen + STREAM_LABEL_EXTRA + (timestamps ? TIMESTAMP_WIDTH : 0);

    return Math.max(MIN_CHILD_COLUMNS, totalColumns - prefix);
}
