import { type ChildProcess, spawn } from "node:child_process";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandDef, OutputRef, ProcsRef, StreamLine } from "./types.js";
import {
    CONTENT_BORDER,
    CONTENT_PADDING,
    SCROLLBAR_WIDTH,
    SIDEBAR_WIDTH,
    systemMsg,
} from "./util.js";

type UseProcessesOptions = {
    commandDefs: CommandDef[];
    cwd: string;
    bufferSize: number;
    streamBufferSize: number;
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
                            SCROLLBAR_WIDTH,
                    ),
                },
                stdio: ["ignore", "pipe", "pipe"],
            });

            const handleData = (data: Buffer) => {
                const text = data.toString().replace(/\r/g, "");

                outputBuffersRef.current[i] += text;

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

                for (const line of lines) {
                    streamLinesRef.current.push({
                        cmdIndex: i,
                        text: line,
                        time: new Date(),
                    });
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
                const errorMsg = systemMsg(`Failed to start: ${err.message}`);

                outputBuffersRef.current[i] += `\n${errorMsg}`;
                streamLinesRef.current.push({
                    cmdIndex: i,
                    text: errorMsg,
                    time: new Date(),
                });

                setFailedProcs((prev) => new Set(prev).add(i));
                triggerRender();
            });

            proc.on("exit", (exitCode) => {
                if (restartingRef.current.has(i)) {
                    restartingRef.current.delete(i);

                    return;
                }

                const exitMsg = systemMsg(`Process exited with code ${exitCode}`);

                outputBuffersRef.current[i] += `\n${exitMsg}`;
                streamLinesRef.current.push({
                    cmdIndex: i,
                    text: exitMsg,
                    time: new Date(),
                });

                if (exitCode !== 0 && exitCode !== null) {
                    setFailedProcs((prev) => new Set(prev).add(i));
                }

                if (partialsRef.current[i].trim()) {
                    streamLinesRef.current.push({
                        cmdIndex: i,
                        text: partialsRef.current[i],
                        time: new Date(),
                    });
                    partialsRef.current[i] = "";
                }

                triggerRender();
            });

            return proc;
        },
        [cwd, bufferSize, streamBufferSize, triggerRender],
    );

    const restartProcess = useCallback(
        (i: number) => {
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

            const restartMsg = systemMsg(`Restarted at ${new Date().toLocaleTimeString("en-GB")}`);

            outputBuffersRef.current[i] = `${restartMsg}\n`;
            outputLineCountsRef.current[i] = 2;
            partialsRef.current[i] = "";

            streamLinesRef.current.push({
                cmdIndex: i,
                text: restartMsg,
                time: new Date(),
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

    useEffect(() => {
        const procs = commandDefs.map((cmd, i) => spawnProcess(cmd, i));

        procsRef.current = procs;

        if (externalProcsRef) {
            externalProcsRef.current = procs;
        }

        return () => {
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
            const clearMsg = systemMsg(`Cleared at ${new Date().toLocaleTimeString("en-GB")}`);

            outputBuffersRef.current[index] = clearMsg;
            outputLineCountsRef.current[index] = 1;

            streamLinesRef.current.push({
                cmdIndex: index,
                text: clearMsg,
                time: new Date(),
            });
        },
        [commandDefs],
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
