import type { Supervisor } from "./supervisor.js";

export type CommandDef = {
    label: string;
    color: string;
    command: string;
};

export type CommandInput = {
    label: string;
    command: string;
    color?: string;
};

export type MultiplexOptions = {
    commands: CommandInput[];
    cwd?: string;
    /**
     * Print output inline instead of rendering the TUI. Already the behaviour
     * when stdin or stdout is not a TTY; this asks for it in a real terminal.
     */
    inline?: boolean;
    /** NDJSON on stdout, one object per event. Implies inline. */
    json?: boolean;
    stream?: boolean;
    timestamps?: boolean;
    restart?: boolean;
    bufferSize?: number;
    streamBufferSize?: number;
    title?: string;
};

export type StreamLine = {
    cmdIndex: number;
    text: string;
    ts: string;
    /** A second or later row of a line too wide for the pane. */
    cont?: boolean;
};

export type OutputRef = {
    current: StreamLine[];
};

/**
 * How the front ends hand `multiplex()` the supervisor they built, so its
 * shutdown can reach the children without owning the process layer itself.
 */
export type SupervisorRef = {
    current: Supervisor | null;
};
