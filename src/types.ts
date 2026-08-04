import type { ChildProcess } from "node:child_process";

export type CommandDef = {
    label: string;
    color: string;
    command: string[];
};

export type StreamLine = {
    cmdIndex: number;
    text: string;
    time: Date;
};

export type OutputRef = {
    current: StreamLine[];
};

export type ProcsRef = {
    current: ChildProcess[];
};
