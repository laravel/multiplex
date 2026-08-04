export const hexToRgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
];

export const systemMsg = (text: string) =>
    `\x1b[2m\x1b[3m${text}\x1b[0m`;

export const formatTimestamp = (time: Date) =>
    `\x1b[90m${time.toLocaleTimeString("en-GB")} \x1b[0m`;

export const TIMESTAMP_WIDTH = 9;
export const SIDEBAR_WIDTH = 20;
export const CONTENT_BORDER = 2;
export const CONTENT_PADDING = 1;
export const SCROLLBAR_WIDTH = 2;
