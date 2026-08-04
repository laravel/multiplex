import { type ChildProcess, execSync, spawn } from "node:child_process";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandDef, OutputRef, ProcsRef, StreamLine } from "./types.js";
import {
    CONTENT_BORDER,
    CONTENT_PADDING,
    SCROLLBAR_WIDTH,
    SIDEBAR_WIDTH,
    TIMESTAMP_WIDTH,
    formatTimestamp,
    systemMsg,
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

function notify(title: string, message: string) {
    try {
        if (process.platform === "darwin") {
            spawn("osascript", [
                "-e",
                `display notification "${message}" with title "${title}"`,
            ], { stdio: "ignore", detached: true }).unref();
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
    const partialsRef = useRef<string[]>(commandDefs.map(() => ""));
    const procsRef = useRef<ChildProcess[]>([]);
    const restartingRef = useRef<Set<number>>(new Set());
    const autoRestartTimersRef = useRef<
        Map<number, ReturnType<typeof setTimeout>>
    >(new Map());
    const autoRestartCountsRef = useRef<number[]>(commandDefs.map(() => 0));
    const restartProcessRef = useRef<(i: number, manual?: boolean) => void>(() => {});
    const [failedProcs, setFailedProcs] = useState<Set<number>>(new Set());

    if (outputRef) {
        outputRef.current = streamLinesRef.current;
    }

    const spawnProcess = useCallback(
        (cmd: CommandDef, i: number) => {
            const proc = spawn("sh", ["-c", cmd.command], {
                cwd,
                detached: true,
                env: {
                    ...process.env,
                    FORCE_COLOR: "1",
                    COLUMNS: String(
                        (stdout?.columns ?? 80) -
                            SIDEBAR_WIDTH -
                            CONTENT_BORDER -
                            CONTENT_PADDING -
                            SCROLLBAR_WIDTH -
                            (timestamps ? TIMESTAMP_WIDTH : 0),
                    ),
                },
                stdio: ["ignore", "pipe", "pipe"],
            });

            const handleData = (data: Buffer) => {
                const text = data.toString().replace(/\r/g, "");

                if (!timestamps) {
                    outputBuffersRef.current[i] += text;
                }

                let newLines = 0;

                for (let c = 0; c < text.length; c++) {
                    if (text[c] === "\n") {
                        newLines++;
                    }
                }

                outputLineCountsRef.current[i] += newLines;

                if (outputLineCountsRef.current[i] > bufferSize * 1.5) {
                    const bufLines = outputBuffersRef.current[i].split("\n");
                    outputBuffersRef.current[i] = bufLines
                        .slice(-bufferSize)
                        .join("\n");
                    outputLineCountsRef.current[i] = bufferSize;
                }

                partialsRef.current[i] += text;

                const lines = partialsRef.current[i].split("\n");

                partialsRef.current[i] = lines.pop() ?? "";

                const now = new Date();
                const tsPrefix = timestamps ? formatTimestamp(now) : "";

                for (const line of lines) {
                    streamLinesRef.current.push({
                        cmdIndex: i,
                        text: line,
                        time: now,
                    });

                    if (timestamps) {
                        outputBuffersRef.current[i] += `${tsPrefix}${line}\n`;
                    }
                }

                if (streamLinesRef.current.length > streamBufferSize * 1.5) {
                    streamLinesRef.current.splice(
                        0,
                        streamLinesRef.current.length - streamBufferSize,
                    );
                }

                triggerRender();
            };

            proc.stdout?.on("data", handleData);
            proc.stderr?.on("data", handleData);

            proc.on("error", (err) => {
                const now = new Date();
                const errorMsg = systemMsg(`Failed to start: ${err.message}`);
                const tsPrefix = timestamps ? formatTimestamp(now) : "";

                outputBuffersRef.current[i] += `\n${tsPrefix}${errorMsg}`;
                streamLinesRef.current.push({
                    cmdIndex: i,
                    text: errorMsg,
                    time: now,
                });

                setFailedProcs((prev) => new Set(prev).add(i));
                triggerRender();
            });

            proc.on("exit", (exitCode) => {
                if (restartingRef.current.has(i)) {
                    restartingRef.current.delete(i);

                    return;
                }

                const now = new Date();
                const exitMsg = systemMsg(
                    `Process exited with code ${exitCode}`,
                );
                const tsPrefix = timestamps ? formatTimestamp(now) : "";

                outputBuffersRef.current[i] += `\n${tsPrefix}${exitMsg}`;
                streamLinesRef.current.push({
                    cmdIndex: i,
                    text: exitMsg,
                    time: now,
                });

                if (partialsRef.current[i].trim()) {
                    streamLinesRef.current.push({
                        cmdIndex: i,
                        text: partialsRef.current[i],
                        time: new Date(),
                    });
                    partialsRef.current[i] = "";
                }

                if (exitCode === 0 || exitCode === null) {
                    autoRestartCountsRef.current[i] = 0;
                } else {
                    autoRestartCountsRef.current[i]++;

                    if (autoRestart && autoRestartCountsRef.current[i] <= 5) {
                        const attempt = autoRestartCountsRef.current[i];
                        const restartMsg = systemMsg(
                            `Restarting (${attempt}/5)...`,
                        );
                        const restartTsPrefix = timestamps
                            ? formatTimestamp(now)
                            : "";

                        outputBuffersRef.current[i] +=
                            `\n${restartTsPrefix}${restartMsg}`;
                        streamLinesRef.current.push({
                            cmdIndex: i,
                            text: restartMsg,
                            time: now,
                        });

                        const timer = setTimeout(() => {
                            autoRestartTimersRef.current.delete(i);
                            restartProcessRef.current(i, false);
                        }, 1000);

                        autoRestartTimersRef.current.set(i, timer);
                    } else {
                        setFailedProcs((prev) => new Set(prev).add(i));
                        notify(title ?? "Multiplex", `${cmd.label} crashed (exit code ${exitCode})`);
                    }
                }

                triggerRender();
            });

            return proc;
        },
        [
            autoRestart,
            cwd,
            bufferSize,
            streamBufferSize,
            timestamps,
            triggerRender,
        ],
    );

    const restartProcess = useCallback(
        (i: number, manual = true) => {
            const pendingTimer = autoRestartTimersRef.current.get(i);
            if (pendingTimer) {
                clearTimeout(pendingTimer);
                autoRestartTimersRef.current.delete(i);
            }

            if (manual) {
                autoRestartCountsRef.current[i] = 0;
                restartingRef.current.add(i);

                const proc = procsRef.current[i];

                if (proc) {
                    try {
                        if (proc.pid) {
                            process.kill(-proc.pid, "SIGKILL");
                        }
                    } catch {
                        //
                    }
                }
            }

            const now = new Date();
            const restartMsg = timestamps
                ? systemMsg("Restarted")
                : systemMsg(`Restarted at ${now.toLocaleTimeString("en-GB")}`);
            const tsPrefix = timestamps ? formatTimestamp(now) : "";

            outputBuffersRef.current[i] = `${tsPrefix}${restartMsg}\n`;
            outputLineCountsRef.current[i] = 2;
            partialsRef.current[i] = "";

            streamLinesRef.current.push({
                cmdIndex: i,
                text: restartMsg,
                time: now,
            });

            setFailedProcs((prev) => {
                const next = new Set(prev);

                next.delete(i);

                return next;
            });

            const newProc = spawnProcess(commandDefs[i], i);

            procsRef.current[i] = newProc;

            if (externalProcsRef) {
                externalProcsRef.current[i] = newProc;
            }

            triggerRender();
        },
        [commandDefs, spawnProcess, triggerRender],
    );

    restartProcessRef.current = restartProcess;

    useEffect(() => {
        const procs = commandDefs.map((cmd, i) => spawnProcess(cmd, i));

        procsRef.current = procs;

        if (externalProcsRef) {
            externalProcsRef.current = procs;
        }

        return () => {
            for (const timer of autoRestartTimersRef.current.values()) {
                clearTimeout(timer);
            }

            autoRestartTimersRef.current.clear();

            procs.forEach((proc) => {
                try {
                    if (proc.pid) {
                        process.kill(-proc.pid, "SIGKILL");
                    }
                } catch {
                    //
                }
            });
        };
    }, [commandDefs, spawnProcess]);

    const clearOutput = useCallback(
        (index: number) => {
            const now = new Date();
            const clearMsg = timestamps
                ? systemMsg("Cleared")
                : systemMsg(`Cleared at ${now.toLocaleTimeString("en-GB")}`);
            const tsPrefix = timestamps ? formatTimestamp(now) : "";

            outputBuffersRef.current[index] = `${tsPrefix}${clearMsg}`;
            outputLineCountsRef.current[index] = 1;

            streamLinesRef.current.push({
                cmdIndex: index,
                text: clearMsg,
                time: now,
            });
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
    };
}
