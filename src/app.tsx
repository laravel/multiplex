import { Box, Text, useApp, useInput, useStdout } from "ink";
import { type ChildProcess, spawn } from "node:child_process";
import { useCallback, useEffect, useRef, useState } from "react";
import { highlightSearch } from "./search.js";
import type { CommandDef, OutputRef, ProcsRef, StreamLine } from "./types.js";
import { hexToRgb } from "./util.js";

type AppProps = {
    commandDefs: CommandDef[];
    cwd: string;
    initialStreamMode: boolean;
    bufferSize?: number;
    streamBufferSize?: number;
    timestamps?: boolean;
    outputRef?: OutputRef;
    procsRef?: ProcsRef;
};

const SIDEBAR_WIDTH = 20;
const CONTENT_BORDER = 2;
const CONTENT_PADDING = 1;
const SCROLLBAR_WIDTH = 2;

export function App({
    commandDefs,
    cwd,
    initialStreamMode,
    bufferSize = 2_000,
    streamBufferSize = 10_000,
    timestamps = false,
    outputRef,
    procsRef: externalProcsRef,
}: AppProps) {
    const { stdout } = useStdout();
    const { exit } = useApp();

    const [rows, setRows] = useState(stdout?.rows ?? 24);
    const [cols, setCols] = useState(stdout?.columns ?? 80);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [streamMode, setStreamMode] = useState(initialStreamMode);
    const [searchInputMode, setSearchInputMode] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [currentMatch, setCurrentMatch] = useState(0);
    const [, setRenderTick] = useState(0);
    const [scrollOffset, setScrollOffset] = useState<number | null>(null);
    const [focus, setFocus] = useState<"sidebar" | "content">("sidebar");
    const [failedProcs, setFailedProcs] = useState<Set<number>>(new Set());
    const [hasNewOutput, setHasNewOutput] = useState(false);

    const outputBuffersRef = useRef<string[]>(commandDefs.map(() => ""));
    const outputLineCountsRef = useRef<number[]>(commandDefs.map(() => 1));
    const streamLinesRef = useRef<StreamLine[]>([]);
    const partialsRef = useRef<string[]>(commandDefs.map(() => ""));
    const procsRef = useRef<ChildProcess[]>([]);
    const restartingRef = useRef<Set<number>>(new Set());
    const matchCountRef = useRef(0);
    const matchLinesRef = useRef<number[]>([]);
    const totalLinesRef = useRef(0);
    const scrollOffsetRef = useRef<number | null>(null);

    if (outputRef) {
        outputRef.current = streamLinesRef.current;
    }

    scrollOffsetRef.current = scrollOffset;

    const pendingRender = useRef(false);
    const triggerRender = useCallback(() => {
        if (scrollOffsetRef.current !== null) {
            setHasNewOutput(true);
        }

        if (!pendingRender.current) {
            pendingRender.current = true;

            setTimeout(() => {
                pendingRender.current = false;
                setRenderTick((t) => t + 1);
            }, 16);
        }
    }, []);

    useEffect(() => {
        const handleResize = () => {
            setRows(stdout?.rows ?? 24);
            setCols(stdout?.columns ?? 80);
        };

        stdout?.on("resize", handleResize);

        return () => {
            stdout?.off("resize", handleResize);
        };
    }, [stdout]);

    useEffect(() => {
        if (scrollOffset === null) {
            setHasNewOutput(false);
        }
    }, [scrollOffset]);

    const spawnProcess = useCallback(
        (cmd: CommandDef, i: number) => {
            const cmdStr = cmd.command.join(" ");
            const needsShell = /[&|;<>()]/.test(cmdStr);
            const spawnArgs: [string, string[]] = needsShell
                ? ["sh", ["-c", cmdStr]]
                : [cmd.command[0], cmd.command.slice(1)];

            const proc = spawn(spawnArgs[0], spawnArgs[1], {
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
                    if (line.trim()) {
                        streamLinesRef.current.push({
                            cmdIndex: i,
                            text: line,
                            time: new Date(),
                        });
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
                const errorMsg = `[Failed to start: ${err.message}]`;

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

                const exitMsg = `[Process exited with code ${exitCode}]`;

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

            outputBuffersRef.current[i] = "";
            outputLineCountsRef.current[i] = 1;
            partialsRef.current[i] = "";

            setFailedProcs((prev) => {
                const next = new Set(prev);

                next.delete(i);

                return next;
            });

            setScrollOffset(null);

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

    useInput((input, key) => {
        if (searchInputMode) {
            if (key.escape) {
                setSearchInputMode(false);
                setSearchQuery("");
                setCurrentMatch(0);

                return;
            }

            if (key.return) {
                setSearchInputMode(false);

                if (matchCountRef.current > 0) {
                    setCurrentMatch(0);
                }

                return;
            }

            if (key.backspace || key.delete) {
                setSearchQuery((q) => q.slice(0, -1));
                setCurrentMatch(0);

                return;
            }

            if (input && input.length === 1 && input.charCodeAt(0) >= 32) {
                setSearchQuery((q) => q + input);
                setCurrentMatch(0);

                return;
            }

            return;
        }

        if (input === "/") {
            setSearchInputMode(true);
            setSearchQuery("");
            setCurrentMatch(0);

            return;
        }

        if (searchQuery) {
            if (key.escape) {
                setSearchQuery("");
                setCurrentMatch(0);
                setScrollOffset(null);

                return;
            }

            if (input === "n") {
                const mc = matchCountRef.current;

                if (mc > 0) {
                    setCurrentMatch((m) => (m + 1) % mc);
                }

                return;
            }

            if (input === "N") {
                const mc = matchCountRef.current;

                if (mc > 0) {
                    setCurrentMatch((m) => (m - 1 + mc) % mc);
                }

                return;
            }
        }

        if (input === "q") {
            exit();

            return;
        }

        if (input === "c") {
            if (streamMode) {
                streamLinesRef.current.length = 0;
            } else {
                outputBuffersRef.current[selectedIndex] = "";
                outputLineCountsRef.current[selectedIndex] = 1;
            }

            setScrollOffset(null);
            triggerRender();

            return;
        }

        if (input && input >= "1" && input <= "9") {
            const idx = parseInt(input, 10) - 1;

            if (idx < commandDefs.length) {
                setSelectedIndex(idx);
                setCurrentMatch(0);
                setScrollOffset(null);
                setHasNewOutput(false);
            }

            return;
        }

        if (input === "t") {
            setStreamMode((m) => !m);
            setCurrentMatch(0);
            setScrollOffset(null);

            return;
        }

        if (!streamMode) {
            if (input === "r") {
                restartProcess(selectedIndex);

                return;
            }

            if (key.tab) {
                setFocus((f) => (f === "sidebar" ? "content" : "sidebar"));

                return;
            }

            if (key.leftArrow) {
                setFocus("sidebar");

                return;
            }

            if (key.rightArrow) {
                setFocus("content");

                return;
            }
        }

        const effectiveFocus = streamMode ? "content" : focus;

        if (key.downArrow || input === "j") {
            if (effectiveFocus === "sidebar") {
                setSelectedIndex((i) =>
                    Math.min(i + 1, commandDefs.length - 1),
                );
                setCurrentMatch(0);
                setScrollOffset(null);
            } else {
                setScrollOffset((prev) => {
                    if (prev === null) {
                        return null;
                    }

                    const total = totalLinesRef.current;
                    const oh = streamMode ? rows - 2 : rows - 4;
                    const maxOffset = Math.max(0, total - oh);
                    const newOffset = prev + 1;

                    return newOffset >= maxOffset ? null : newOffset;
                });
            }

            return;
        }

        if (key.upArrow || input === "k") {
            if (effectiveFocus === "sidebar") {
                setSelectedIndex((i) => Math.max(i - 1, 0));
                setCurrentMatch(0);
                setScrollOffset(null);
            } else {
                setScrollOffset((prev) => {
                    const total = totalLinesRef.current;
                    const oh = streamMode ? rows - 2 : rows - 4;
                    const currentStart = prev ?? Math.max(0, total - oh);

                    return Math.max(0, currentStart - 1);
                });
            }

            return;
        }

        if (effectiveFocus === "content") {
            if (key.pageDown) {
                const oh = streamMode ? rows - 2 : rows - 4;

                setScrollOffset((prev) => {
                    if (prev === null) {
                        return null;
                    }

                    const total = totalLinesRef.current;
                    const maxOffset = Math.max(0, total - oh);
                    const newOffset = prev + oh;

                    return newOffset >= maxOffset ? null : newOffset;
                });

                return;
            }

            if (key.pageUp) {
                const oh = streamMode ? rows - 2 : rows - 4;

                setScrollOffset((prev) => {
                    const total = totalLinesRef.current;
                    const currentStart = prev ?? Math.max(0, total - oh);
                    return Math.max(0, currentStart - oh);
                });

                return;
            }

            if ((key as Record<string, boolean>).home) {
                setScrollOffset(0);

                return;
            }

            if ((key as Record<string, boolean>).end) {
                setScrollOffset(null);
                setHasNewOutput(false);

                return;
            }
        }
    });

    const maxLabelLen = Math.max(...commandDefs.map((c) => c.label.length));
    const sidebarWidth = SIDEBAR_WIDTH;
    const outputHeight = streamMode ? rows - 2 : rows - 4;

    let displayLines: string[];

    if (streamMode) {
        displayLines = streamLinesRef.current.map((sl) => {
            const cmd = commandDefs[sl.cmdIndex];
            const [r, g, b] = hexToRgb(cmd.color);
            const padding = " ".repeat(maxLabelLen - cmd.label.length);
            const ts = timestamps
                ? `\x1b[90m${sl.time.toLocaleTimeString("en-GB")} \x1b[0m`
                : "";

            return `${ts}\x1b[1;38;2;${r};${g};${b}m[${cmd.label}]${padding} \x1b[0m${sl.text}`;
        });
    } else {
        displayLines = outputBuffersRef.current[selectedIndex].split("\n");
    }

    let visibleLines: string[];
    let matchCount = 0;

    if (searchQuery) {
        const fullContent = displayLines.join("\n");
        const hl = highlightSearch(
            fullContent,
            searchQuery,
            searchInputMode ? -1 : currentMatch,
        );

        matchCount = hl.count;

        matchCountRef.current = matchCount;
        matchLinesRef.current = hl.linePositions;

        const highlightedLines = hl.result.split("\n");

        if (!searchInputMode && matchCount > 0 && hl.linePositions.length > 0) {
            const effectiveMatch =
                ((currentMatch % matchCount) + matchCount) % matchCount;
            const targetLine = hl.linePositions[effectiveMatch] ?? 0;
            const halfWindow = Math.floor(outputHeight / 2);
            const maxStart = Math.max(
                0,
                highlightedLines.length - outputHeight,
            );
            const scrollStart = Math.max(
                0,
                Math.min(targetLine - halfWindow, maxStart),
            );

            visibleLines = highlightedLines.slice(
                scrollStart,
                scrollStart + outputHeight,
            );
        } else {
            visibleLines = highlightedLines.slice(-outputHeight);
        }
    } else {
        matchCountRef.current = 0;
        matchLinesRef.current = [];

        if (scrollOffset !== null) {
            visibleLines = displayLines.slice(
                scrollOffset,
                scrollOffset + outputHeight,
            );
        } else {
            visibleLines = displayLines.slice(-outputHeight);
        }
    }

    totalLinesRef.current = displayLines.length;

    while (visibleLines.length < outputHeight) {
        visibleLines.push("");
    }

    const effectiveMatch =
        matchCount > 0
            ? ((currentMatch % matchCount) + matchCount) % matchCount
            : 0;

    let footer: React.ReactNode;

    if (searchInputMode) {
        footer = (
            <Text>
                <Text color="#e5c07b" bold>
                    /{" "}
                </Text>
                <Text color="#cccccc">{searchQuery}</Text>
                <Text color="#e5c07b">{"█"}</Text>
                {searchQuery && matchCount === 0 && (
                    <Text color="#e06c75"> no matches</Text>
                )}
                {searchQuery && matchCount > 0 && (
                    <Text color="#555555">
                        {" "}
                        {matchCount} match{matchCount === 1 ? "" : "es"}
                    </Text>
                )}
            </Text>
        );
    } else if (searchQuery && matchCount > 0) {
        footer = (
            <Text>
                <Text color="#e5c07b" bold>
                    [{effectiveMatch + 1}/{matchCount}]
                </Text>
                <Text color="#888888"> {searchQuery}</Text>
                <Text color="#555555"> </Text>
                <Text color="#888888" bold>
                    n
                </Text>
                <Text color="#555555"> next</Text>
                <Text color="#555555"> </Text>
                <Text color="#888888" bold>
                    N
                </Text>
                <Text color="#555555"> prev</Text>
                <Text color="#555555"> </Text>
                <Text color="#888888" bold>
                    Esc
                </Text>
                <Text color="#555555"> clear</Text>
            </Text>
        );
    } else {
        const bindings = streamMode
            ? [
                  ["↑/↓", "scroll"],
                  ["c", "clear"],
                  ["/", "search"],
                  ["t", "tabs"],
                  ["q", "quit"],
              ]
            : focus === "sidebar"
              ? [
                    ["↑/↓", "navigate"],
                    ["tab", "logs"],
                    ["r", "restart"],
                    ["c", "clear"],
                    ["/", "search"],
                    ["t", "stream"],
                    ["q", "quit"],
                ]
              : [
                    ["↑/↓", "scroll"],
                    ["tab", "tabs"],
                    ["c", "clear"],
                    ["/", "search"],
                    ["t", "stream"],
                    ["q", "quit"],
                ];

        footer = (
            <Box width="100%">
                <Text>
                    {bindings.map(([k, desc], i) => (
                        <Text key={i}>
                            {i > 0 && <Text color="#555555"> </Text>}
                            <Text color="#888888" bold>
                                {k}
                            </Text>
                            <Text color="#555555"> {desc}</Text>
                        </Text>
                    ))}
                </Text>
                <Box flexGrow={1} />
                {hasNewOutput && <Text color="#e5c07b">↓ new output </Text>}
            </Box>
        );
    }

    const totalLines = displayLines.length;
    const showScrollbar = totalLines > outputHeight;

    let thumbStart = 0;
    let thumbEnd = 0;

    if (showScrollbar) {
        const currentOffset =
            scrollOffset ?? Math.max(0, totalLines - outputHeight);
        const maxOffset = Math.max(1, totalLines - outputHeight);
        const thumbSize = Math.max(
            1,
            Math.round((outputHeight / totalLines) * outputHeight),
        );

        thumbStart = Math.round(
            (currentOffset / maxOffset) * (outputHeight - thumbSize),
        );

        thumbEnd = thumbStart + thumbSize;
    }

    const outputContent = visibleLines.map((line, i) => (
        <Box key={i} height={1}>
            <Box flexGrow={1}>
                <Text wrap="truncate-end">{line || " "}</Text>
            </Box>
            {showScrollbar && (
                <Text
                    color={
                        i >= thumbStart && i < thumbEnd ? "#666666" : "#333333"
                    }
                >
                    {" "}
                    {i >= thumbStart && i < thumbEnd ? "█" : "│"}
                </Text>
            )}
        </Box>
    ));

    if (streamMode) {
        return (
            <Box flexDirection="column" height={rows} width={cols}>
                <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
                    {outputContent}
                </Box>
                <Box height={1} />
                <Box height={1} paddingLeft={1}>
                    {footer}
                </Box>
            </Box>
        );
    }

    const focusedBorder = "#61afef";
    const unfocusedBorder = "#333333";

    return (
        <Box flexDirection="column" height={rows} width={cols}>
            <Box flexDirection="row" flexGrow={1}>
                <Box
                    flexDirection="column"
                    width={sidebarWidth}
                    borderStyle="round"
                    borderColor={
                        focus === "sidebar" ? focusedBorder : unfocusedBorder
                    }
                >
                    {commandDefs.map((cmd, i) => {
                        const selected = i === selectedIndex;
                        const failed = failedProcs.has(i);
                        const innerWidth = sidebarWidth - 2;
                        const indicator = failed
                            ? "✕"
                            : i < 9
                              ? `${i + 1}`
                              : " ";
                        const pad = Math.max(
                            0,
                            innerWidth - 3 - cmd.label.length,
                        );
                        const bg = selected ? cmd.color : undefined;
                        return (
                            <Box key={i}>
                                <Text
                                    backgroundColor={bg}
                                    color={
                                        failed
                                            ? "#ef4444"
                                            : selected
                                              ? "#000000"
                                              : "#555555"
                                    }
                                    dimColor={!failed && !selected}
                                >
                                    {" "}
                                    {indicator}{" "}
                                </Text>
                                <Text
                                    backgroundColor={bg}
                                    color={
                                        selected
                                            ? "#000000"
                                            : failed
                                              ? "#ef4444"
                                              : cmd.color
                                    }
                                >
                                    {cmd.label}
                                    {" ".repeat(pad)}
                                </Text>
                            </Box>
                        );
                    })}
                </Box>
                <Box
                    flexDirection="column"
                    flexGrow={1}
                    borderStyle="round"
                    borderColor={
                        focus === "content" ? focusedBorder : unfocusedBorder
                    }
                >
                    <Box
                        borderColor={
                            focus === "content"
                                ? focusedBorder
                                : unfocusedBorder
                        }
                        borderDimColor={true}
                        borderTop={false}
                        borderLeft={false}
                        borderRight={false}
                        borderStyle="single"
                        paddingX={1}
                    >
                        <Text color="#888888">
                            {commandDefs[selectedIndex].command.join(" ")}
                        </Text>
                    </Box>
                    <Box paddingLeft={1} flexDirection="column" flexGrow={1}>
                        {outputContent}
                    </Box>
                </Box>
            </Box>
            <Box height={1} paddingLeft={1}>
                {footer}
            </Box>
        </Box>
    );
}
