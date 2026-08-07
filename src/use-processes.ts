import { execSync, spawn } from "node:child_process";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSupervisor, type Supervisor } from "./supervisor.js";
import type { CommandDef, OutputRef, ProcsRef, StreamLine } from "./types.js";
import {
    childColumns,
    formatTimestamp,
    streamTextWidth,
    systemMsg,
    TIMESTAMP_WIDTH,
    tabbedTextWidth,
    wrapLine,
} from "./util.js";

const hasNotifySend =
    process.platform === "linux" &&
    (() => {
        try {
            execSync("which notify-send", { stdio: "ignore" });
            return true;
        } catch {
            return false;
        }
    })();

function escapeAppleScript(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function notify(title: string, message: string) {
    try {
        if (process.platform === "darwin") {
            spawn(
                "osascript",
                [
                    "-e",
                    `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"`,
                ],
                { stdio: "ignore", detached: true },
            ).unref();
        } else if (hasNotifySend) {
            spawn("notify-send", [title, message], {
                stdio: "ignore",
                detached: true,
            }).unref();
        }
    } catch {
        //
    }
}

type UseProcessesOptions = {
    commandDefs: CommandDef[];
    cwd: string;
    bufferSize: number;
    streamBufferSize: number;
    timestamps: boolean;
    autoRestart: boolean;
    title?: string;
    columns: number;
    triggerRender: () => void;
    outputRef?: OutputRef;
    externalProcsRef?: ProcsRef;
};

export function useProcesses({
    commandDefs,
    cwd,
    bufferSize,
    streamBufferSize,
    timestamps,
    autoRestart,
    title,
    columns,
    triggerRender,
    outputRef,
    externalProcsRef,
}: UseProcessesOptions) {
    // Complete rows, already wrapped to the pane, plus the tail of output that
    // has not seen its newline yet. The tail stays raw because more of it is
    // still arriving; it is wrapped at render time instead.
    const outputRowsRef = useRef<string[][]>(commandDefs.map(() => []));
    const outputPendingRef = useRef<string[]>(commandDefs.map(() => ""));
    const streamLinesRef = useRef<StreamLine[]>([]);
    const spawnTimeRef = useRef<number[]>(commandDefs.map(() => 0));
    const pendingRestartsRef = useRef<Set<number>>(new Set());
    const supervisorRef = useRef<Supervisor | null>(null);
    const [failedProcs, setFailedProcs] = useState<Set<number>>(new Set());

    if (outputRef) {
        outputRef.current = streamLinesRef.current;
    }

    const labels = commandDefs.map((c) => c.label);

    // Read by the supervisor handlers, which are built once and would otherwise
    // keep wrapping to the width the terminal happened to be at startup.
    const wrapWidthRef = useRef({ tabbed: 0, stream: 0 });

    wrapWidthRef.current = {
        tabbed: tabbedTextWidth(labels, columns, timestamps),
        stream: streamTextWidth(labels, columns, timestamps),
    };

    const pushRows = useCallback(
        (index: number, rows: string[]) => {
            const buf = outputRowsRef.current[index];

            for (const row of rows) {
                buf.push(row);
            }

            if (buf.length > bufferSize * 1.5) {
                buf.splice(0, buf.length - bufferSize);
            }
        },
        [bufferSize],
    );

    // Terminates the buffered tail, exactly as writing a "\n" to the old string
    // buffer did — including when the tail is empty, which leaves a blank row.
    const commitPending = useCallback(
        (index: number) => {
            pushRows(
                index,
                wrapLine(
                    outputPendingRef.current[index],
                    wrapWidthRef.current.tabbed,
                ),
            );

            outputPendingRef.current[index] = "";
        },
        [pushRows],
    );

    // Only the first row carries the timestamp; the rest are padded to its width
    // so the label column stays straight.
    const pushStreamRows = useCallback(
        (index: number, text: string, ts: string) => {
            const rows = wrapLine(text, wrapWidthRef.current.stream);
            // ts carries escape codes, so its own length is not its width.
            const tsPad = ts === "" ? "" : " ".repeat(TIMESTAMP_WIDTH);

            for (let i = 0; i < rows.length; i++) {
                streamLinesRef.current.push({
                    cmdIndex: index,
                    text: rows[i],
                    ts: i === 0 ? ts : tsPad,
                    cont: i > 0,
                });
            }

            if (streamLinesRef.current.length > streamBufferSize * 1.5) {
                streamLinesRef.current.splice(
                    0,
                    streamLinesRef.current.length - streamBufferSize,
                );
            }
        },
        [streamBufferSize],
    );

    const pushLine = useCallback(
        (index: number, text: string, time: Date) => {
            const ts = timestamps ? formatTimestamp(time) : "";

            if (timestamps) {
                const tsPad = " ".repeat(TIMESTAMP_WIDTH);

                pushRows(
                    index,
                    wrapLine(text, wrapWidthRef.current.tabbed).map(
                        (row, i) => `${i === 0 ? ts : tsPad}${row}`,
                    ),
                );
            }

            pushStreamRows(index, text, ts);
        },
        [timestamps, pushRows, pushStreamRows],
    );

    // A system message is not process output, so it never carries a timestamp
    // prefix in the buffer the way a real line does.
    const pushSystem = useCallback(
        (index: number, text: string, time: Date) => {
            const msg = systemMsg(text);
            const ts = timestamps ? formatTimestamp(time) : "";

            commitPending(index);

            // Left as the tail rather than committed, so it is re-wrapped on a
            // resize and the buffer reads the same as the old "\n" + msg did.
            outputPendingRef.current[index] = `${ts}${msg}`;

            pushStreamRows(index, msg, ts);
        },
        [timestamps, commitPending, pushStreamRows],
    );

    if (!supervisorRef.current) {
        supervisorRef.current = createSupervisor({
            commandDefs,
            cwd,
            columns: childColumns(labels, columns, timestamps),
            autoRestart,
            forceColor: true,
            handlers: {
                onSpawn({ index, time }) {
                    spawnTimeRef.current[index] = time.getTime();
                },

                onData({ index, chunk }) {
                    if (!timestamps) {
                        const parts = (
                            outputPendingRef.current[index] + chunk
                        ).split("\n");

                        outputPendingRef.current[index] = parts.pop() as string;

                        for (const part of parts) {
                            pushRows(
                                index,
                                wrapLine(part, wrapWidthRef.current.tabbed),
                            );
                        }
                    }

                    triggerRender();
                },

                onLine({ index, text, time }) {
                    pushLine(index, text, time);
                },

                onSpawnError({ index, message, time }) {
                    pushSystem(index, `Failed to start: ${message}`, time);
                    triggerRender();
                },

                onExit({ index, code, time }) {
                    pushSystem(index, `Process exited with code ${code}`, time);
                    triggerRender();
                },

                onRestartScheduled({ index, attempt, max, time }) {
                    pendingRestartsRef.current.add(index);
                    pushSystem(
                        index,
                        `Restarting (${attempt}/${max})...`,
                        time,
                    );
                    triggerRender();
                },

                onRestarted({ index, time }) {
                    pendingRestartsRef.current.delete(index);

                    const msg = systemMsg(
                        timestamps
                            ? "Restarted"
                            : `Restarted at ${time.toLocaleTimeString("en-GB")}`,
                    );
                    const ts = timestamps ? formatTimestamp(time) : "";

                    outputRowsRef.current[index] = wrapLine(
                        `${ts}${msg}`,
                        wrapWidthRef.current.tabbed,
                    );
                    outputPendingRef.current[index] = "";

                    streamLinesRef.current.push({
                        cmdIndex: index,
                        text: msg,
                        ts,
                    });

                    setFailedProcs((prev) => {
                        const next = new Set(prev);

                        next.delete(index);

                        return next;
                    });

                    triggerRender();
                },

                onFailed({ index, code }) {
                    setFailedProcs((prev) => new Set(prev).add(index));

                    if (code !== null) {
                        notify(
                            title ?? "Multiplex",
                            `${commandDefs[index].label} crashed (exit code ${code})`,
                        );
                    }

                    triggerRender();
                },
            },
        });
    }

    const restartProcess = useCallback((index: number) => {
        supervisorRef.current?.restart(index, true);
    }, []);

    useEffect(() => {
        const supervisor = supervisorRef.current;

        if (!supervisor) {
            return;
        }

        supervisor.start();

        if (externalProcsRef) {
            externalProcsRef.current = supervisor.procs;
        }

        return () => supervisor.stop();
    }, []);

    const clearOutput = useCallback(
        (index: number) => {
            const now = new Date();
            const msg = systemMsg(
                timestamps
                    ? "Cleared"
                    : `Cleared at ${now.toLocaleTimeString("en-GB")}`,
            );
            const ts = timestamps ? formatTimestamp(now) : "";

            outputRowsRef.current[index] = [];
            outputPendingRef.current[index] = `${ts}${msg}`;

            streamLinesRef.current.push({ cmdIndex: index, text: msg, ts });
        },
        [timestamps],
    );

    const clearStream = useCallback(() => {
        streamLinesRef.current.length = 0;
    }, []);

    return {
        outputRowsRef,
        outputPendingRef,
        streamLinesRef,
        failedProcs,
        restartProcess,
        clearOutput,
        clearStream,
        spawnTimeRef,
        pendingRestartsRef,
    };
}
