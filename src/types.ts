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
