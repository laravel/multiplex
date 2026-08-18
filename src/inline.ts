import { stripAnsi } from "./search.js";
import { createSupervisor, type Supervisor } from "./supervisor.js";
import type { CommandDef, SupervisorRef } from "./types.js";
import { formatStreamLabel, formatTimestamp } from "./util.js";

const JSON_SCHEMA_VERSION = 1;

export type InlineOptions = {
    commandDefs: CommandDef[];
    cwd: string;
    timestamps: boolean;
    autoRestart: boolean;
    json: boolean;
    color: boolean;
    columns: number;
    supervisorRef?: SupervisorRef;
};

export type InlineRun = {
    supervisor: Supervisor;
    /** Resolves with the exit code once every command has stopped for good. */
    done: Promise<number>;
};

function write(stream: NodeJS.WriteStream, text: string) {
    try {
        stream.write(text);
    } catch {
        // The other end of the pipe can close before we are finished.
    }
}

/**
 * Runs the commands without taking over the terminal: no alternate screen, no
 * Ink, no input handling — every line is written to stdout (or stderr) the
 * moment it arrives, and the run ends when the last command does.
 */
export function runInline({
    commandDefs,
    cwd,
    timestamps,
    autoRestart,
    json,
    color,
    columns,
    supervisorRef,
}: InlineOptions): InlineRun {
    const maxLabelLen = Math.max(...commandDefs.map((c) => c.label.length));

    let resolveDone: (code: number) => void = () => {};
    let settled = false;
    // Only permanent failures count. A command that crashed, auto-restarted and
    // then ran clean did not fail the run.
    let failureCode: number | null = null;

    const done = new Promise<number>((resolve) => {
        resolveDone = resolve;
    });

    const emit = (event: Record<string, unknown>, time: Date) => {
        write(
            process.stdout,
            `${JSON.stringify({ v: JSON_SCHEMA_VERSION, time: time.toISOString(), ...event })}\n`,
        );
    };

    const label = (index: number) =>
        formatStreamLabel(
            commandDefs[index].label,
            commandDefs[index].color,
            maxLabelLen,
            color,
        );

    const printLine = (
        index: number,
        text: string,
        time: Date,
        stream: NodeJS.WriteStream,
    ) => {
        const ts = timestamps ? formatTimestamp(time) : "";

        write(stream, `${ts}${label(index)}${text}\n`);
    };

    // Multiplex's own notices are diagnostics, so they go to stderr and leave a
    // redirected stdout holding nothing but the commands' own output.
    const printSystem = (index: number, text: string, time: Date) => {
        printLine(
            index,
            color ? `\x1b[2m\x1b[3m${text}\x1b[0m` : text,
            time,
            process.stderr,
        );
    };

    const finish = (time: Date) => {
        if (settled) {
            return;
        }

        settled = true;

        const code = failureCode ?? 0;

        if (json) {
            emit({ type: "done", code }, time);
        }

        resolveDone(code);
    };

    const supervisor = createSupervisor({
        commandDefs,
        cwd,
        columns,
        autoRestart,
        forceColor: color,
        handlers: {
            onSpawn({ index, pid, time }) {
                if (json) {
                    emit(
                        {
                            type: "start",
                            label: commandDefs[index].label,
                            command: commandDefs[index].command,
                            pid,
                        },
                        time,
                    );
                }
            },

            onLine({ index, text, stream, time }) {
                if (json) {
                    emit(
                        {
                            type: "output",
                            label: commandDefs[index].label,
                            stream,
                            text: stripAnsi(text),
                        },
                        time,
                    );

                    return;
                }

                printLine(
                    index,
                    text,
                    time,
                    stream === "stderr" ? process.stderr : process.stdout,
                );
            },

            onSpawnError({ index, message, time }) {
                if (json) {
                    emit(
                        {
                            type: "error",
                            label: commandDefs[index].label,
                            message,
                        },
                        time,
                    );

                    return;
                }

                printSystem(index, `Failed to start: ${message}`, time);
            },

            onExit({ index, code, signal, time }) {
                if (json) {
                    emit(
                        {
                            type: "exit",
                            label: commandDefs[index].label,
                            code,
                            signal,
                        },
                        time,
                    );

                    return;
                }

                printSystem(
                    index,
                    signal
                        ? `Process killed by ${signal}`
                        : `Process exited with code ${code}`,
                    time,
                );
            },

            onRestartScheduled({ index, attempt, max, time }) {
                if (json) {
                    emit(
                        {
                            type: "restarting",
                            label: commandDefs[index].label,
                            attempt,
                            max,
                        },
                        time,
                    );

                    return;
                }

                printSystem(index, `Restarting (${attempt}/${max})...`, time);
            },

            onFailed({ index, code, reason, time }) {
                if (failureCode === null) {
                    failureCode = code === null || code === 0 ? 1 : code;
                }

                if (json) {
                    emit(
                        {
                            type: "failed",
                            label: commandDefs[index].label,
                            code,
                            reason,
                        },
                        time,
                    );
                }
            },

            onSettled({ time }) {
                finish(time);
            },
        },
    });

    supervisor.start();

    if (supervisorRef) {
        supervisorRef.current = supervisor;
    }

    return { supervisor, done };
}
