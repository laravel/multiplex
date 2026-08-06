import { execSync, spawn } from "node:child_process";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSupervisor, type Supervisor } from "./supervisor.js";
import type { CommandDef, OutputRef, ProcsRef, StreamLine } from "./types.js";
import { childColumns, formatTimestamp, systemMsg } from "./util.js";

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
    stdout: NodeJS.WriteStream | undefined;
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
    stdout,
    triggerRender,
    outputRef,
    externalProcsRef,
}: UseProcessesOptions) {
    const outputBuffersRef = useRef<string[]>(commandDefs.map(() => ""));
    const outputLineCountsRef = useRef<number[]>(commandDefs.map(() => 1));
    const streamLinesRef = useRef<StreamLine[]>([]);
    const spawnTimeRef = useRef<number[]>(commandDefs.map(() => 0));
    const pendingRestartsRef = useRef<Set<number>>(new Set());
    const supervisorRef = useRef<Supervisor | null>(null);
    const [failedProcs, setFailedProcs] = useState<Set<number>>(new Set());

    if (outputRef) {
        outputRef.current = streamLinesRef.current;
    }

    const pushLine = useCallback(
        (index: number, text: string, time: Date) => {
            const ts = timestamps ? formatTimestamp(time) : "";

            if (timestamps) {
                outputBuffersRef.current[index] += `${ts}${text}\n`;
            }

            streamLinesRef.current.push({ cmdIndex: index, text, ts });

            if (streamLinesRef.current.length > streamBufferSize * 1.5) {
                streamLinesRef.current.splice(
                    0,
                    streamLinesRef.current.length - streamBufferSize,
                );
            }
        },
        [timestamps, streamBufferSize],
    );

    // A system message is not process output, so it never carries a timestamp
    // prefix in the buffer the way a real line does.
    const pushSystem = useCallback(
        (index: number, text: string, time: Date) => {
            const msg = systemMsg(text);
            const ts = timestamps ? formatTimestamp(time) : "";

            outputBuffersRef.current[index] += `\n${ts}${msg}`;
            outputLineCountsRef.current[index]++;

            streamLinesRef.current.push({ cmdIndex: index, text: msg, ts });
        },
        [timestamps],
    );

    if (!supervisorRef.current) {
        supervisorRef.current = createSupervisor({
            commandDefs,
            cwd,
            columns: childColumns(
                commandDefs.map((c) => c.label),
                stdout?.columns ?? 80,
                timestamps,
            ),
            autoRestart,
            forceColor: true,
            handlers: {
                onSpawn({ index, time }) {
                    spawnTimeRef.current[index] = time.getTime();
                },

                onData({ index, chunk }) {
                    if (!timestamps) {
                        outputBuffersRef.current[index] += chunk;
                    }

                    let newLines = 0;

                    for (let c = 0; c < chunk.length; c++) {
                        if (chunk[c] === "\n") {
                            newLines++;
                        }
                    }

                    outputLineCountsRef.current[index] += newLines;

                    if (outputLineCountsRef.current[index] > bufferSize * 1.5) {
                        const bufLines =
                            outputBuffersRef.current[index].split("\n");

                        outputBuffersRef.current[index] = bufLines
                            .slice(-bufferSize)
                            .join("\n");
                        outputLineCountsRef.current[index] = bufferSize;
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

                    outputBuffersRef.current[index] = `${ts}${msg}\n`;
                    outputLineCountsRef.current[index] = 2;

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

            outputBuffersRef.current[index] = `${ts}${msg}`;
            outputLineCountsRef.current[index] = 1;

            streamLinesRef.current.push({ cmdIndex: index, text: msg, ts });
        },
        [timestamps],
    );

    const clearStream = useCallback(() => {
        streamLinesRef.current.length = 0;
    }, []);

    return {
        outputBuffersRef,
        streamLinesRef,
        failedProcs,
        restartProcess,
        clearOutput,
        clearStream,
        spawnTimeRef,
        pendingRestartsRef,
    };
}
