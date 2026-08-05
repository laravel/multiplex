export const hexToRgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
];

export const systemMsg = (text: string) => `\x1b[2m\x1b[3m${text}\x1b[0m`;

// OSC strings have no escape mechanism, so stripping is the only option: a BEL
// or ESC in the title ends the sequence early and the rest is read as commands.
export const sanitizeTitle = (title: string) =>
    title.replace(/[\x00-\x1f\x7f-\x9f]/g, "");

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

export const MIN_ROWS = STREAM_CHROME + MIN_OUTPUT_LINES;

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

const TIMESTAMP_WIDTH = 9;
const CONTENT_BORDER = 2;
const CONTENT_PADDING = 1;
const SCROLLBAR_WIDTH = 2;
const STREAM_PADDING = 1;
// The "[", the "]" and the space that follow the label in stream mode.
const STREAM_LABEL_EXTRA = 3;
const MIN_CHILD_COLUMNS = 20;

/**
 * The width to advertise to children as COLUMNS. They get it once at spawn and
 * it can never be updated, so it has to hold for both layouts — switching mode
 * with `s` or `t` must not invalidate it — so we take whichever mode is narrower.
 *
 * Erring narrow is the point. Output wider than the pane is truncated by the
 * renderer and lost silently; output narrower than it just wraps early and
 * leaves a ragged right edge. Tabbed is the narrower mode for any sane label,
 * but that is emergent from MAX_SIDEBAR_WIDTH rather than guaranteed: the
 * sidebar stops widening at 40 while the stream label prefix keeps growing, so
 * past a ~39 character label stream becomes the narrower one.
 */
export function childColumns(
    labels: string[],
    totalColumns: number,
    timestamps: boolean,
): number {
    const timestampWidth = timestamps ? TIMESTAMP_WIDTH : 0;
    const maxLabelLen = Math.max(...labels.map((l) => l.length));

    const tabbed =
        totalColumns -
        sidebarWidth(labels, totalColumns) -
        CONTENT_BORDER -
        CONTENT_PADDING -
        SCROLLBAR_WIDTH -
        timestampWidth;

    const stream =
        totalColumns -
        STREAM_PADDING -
        SCROLLBAR_WIDTH -
        (maxLabelLen + STREAM_LABEL_EXTRA) -
        timestampWidth;

    return Math.max(MIN_CHILD_COLUMNS, Math.min(tabbed, stream));
}
