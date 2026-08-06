import type { ChildProcess } from "node:child_process";

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
};

export type OutputRef = {
    current: StreamLine[];
};

export type ProcsRef = {
    current: ChildProcess[];
};
