import { Box, Text, useInput, useStdout } from "ink";
import { type ChildProcess, spawn } from "node:child_process";
import { useCallback, useEffect, useRef, useState } from "react";
import { highlightSearch } from "./search.js";

export interface CommandDef {
    label: string;
    color: string;
    command: string[];
}

interface StreamLine {
    cmdIndex: number;
    text: string;
}

interface AppProps {
    commandDefs: CommandDef[];
    cwd: string;
    initialStreamMode: boolean;
}

function hexToRgb(hex: string): [number, number, number] {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
}

export function App({ commandDefs, cwd, initialStreamMode }: AppProps) {
    const { stdout } = useStdout();

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

    const outputBuffersRef = useRef<string[]>(commandDefs.map(() => ""));
    const streamLinesRef = useRef<StreamLine[]>([]);
    const partialsRef = useRef<string[]>(commandDefs.map(() => ""));
    const procsRef = useRef<ChildProcess[]>([]);
    const matchCountRef = useRef(0);
    const matchLinesRef = useRef<number[]>([]);
    const totalLinesRef = useRef(0);

    const pendingRender = useRef(false);
    const triggerRender = useCallback(() => {
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
        const procs = commandDefs.map((cmd, i) => {
            const cmdStr = cmd.command.join(" ");
            const needsShell = /[&|;<>()]/.test(cmdStr);
            const spawnArgs: [string, string[]] = needsShell
                ? ["sh", ["-c", cmdStr]]
                : [cmd.command[0], cmd.command.slice(1)];

            const proc = spawn(spawnArgs[0], spawnArgs[1], {
                cwd,
                env: { ...process.env, FORCE_COLOR: "1" },
                stdio: ["ignore", "pipe", "pipe"],
            });

            const handleData = (data: Buffer) => {
                const text = data.toString().replace(/\r/g, "");

                if (
                    outputBuffersRef.current[i] === "" &&
                    !text.startsWith("\n")
                ) {
                    outputBuffersRef.current[i] = "\n";
                }
                outputBuffersRef.current[i] += text;

                partialsRef.current[i] += text;
                const lines = partialsRef.current[i].split("\n");
                partialsRef.current[i] = lines.pop() ?? "";
                for (const line of lines) {
                    if (line.trim()) {
                        streamLinesRef.current.push({
                            cmdIndex: i,
                            text: line,
                        });
                    }
                }

                triggerRender();
            };

            proc.stdout?.on("data", handleData);
            proc.stderr?.on("data", handleData);

            proc.on("exit", (exitCode) => {
                const exitMsg = `[Process exited with code ${exitCode}]`;
                outputBuffersRef.current[i] += `\n${exitMsg}`;
                streamLinesRef.current.push({ cmdIndex: i, text: exitMsg });

                if (partialsRef.current[i].trim()) {
                    streamLinesRef.current.push({
                        cmdIndex: i,
                        text: partialsRef.current[i],
                    });
                    partialsRef.current[i] = "";
                }

                triggerRender();
            });

            return proc;
        });

        procsRef.current = procs;

        return () => {
            procs.forEach((proc) => {
                try {
                    proc.kill();
                } catch {}
            });
        };
    }, [commandDefs, cwd, triggerRender]);

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

        if (key.escape && searchQuery) {
            setSearchQuery("");
            setCurrentMatch(0);
            setScrollOffset(null);
            return;
        }

        if (searchQuery) {
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

        if (input === "t") {
            setStreamMode((m) => !m);
            setCurrentMatch(0);
            setScrollOffset(null);

            return;
        }

        if (!streamMode && key.tab) {
            setFocus((f) => (f === "sidebar" ? "content" : "sidebar"));

            return;
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
                    const oh = streamMode ? rows - 1 : rows - 2;
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
                    const oh = streamMode ? rows - 1 : rows - 2;
                    const currentStart = prev ?? Math.max(0, total - oh);

                    return Math.max(0, currentStart - 1);
                });
            }

            return;
        }
    });

    const maxLabelLen = Math.max(...commandDefs.map((c) => c.label.length));
    const sidebarWidth = 20;
    const outputHeight = streamMode ? rows - 1 : rows - 4;

    let displayLines: string[];

    if (streamMode) {
        displayLines = streamLinesRef.current.map((sl) => {
            const cmd = commandDefs[sl.cmdIndex];
            const [r, g, b] = hexToRgb(cmd.color);
            const padding = " ".repeat(maxLabelLen - cmd.label.length);
            return `\x1b[1;38;2;${r};${g};${b}m[${cmd.label}]${padding} \x1b[0m${sl.text}`;
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
                  ["/", "search"],
                  ["t", "tabs"],
              ]
            : focus === "sidebar"
              ? [
                    ["↑/↓", "navigate"],
                    ["tab", "logs"],
                    ["/", "search"],
                    ["t", "stream"],
                ]
              : [
                    ["↑/↓", "scroll"],
                    ["tab", "tabs"],
                    ["/", "search"],
                    ["t", "stream"],
                ];

        footer = (
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
        );
    }

    const outputContent = visibleLines.map((line, i) => (
        <Text key={i} wrap="truncate-end">
            {line || " "}
        </Text>
    ));

    if (streamMode) {
        return (
            <Box flexDirection="column" height={rows} width={cols}>
                <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
                    {outputContent}
                </Box>
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
                    {commandDefs.map((cmd, i) => (
                        <Text key={i} color={cmd.color}>
                            {i === selectedIndex ? " ▶ " : "   "}
                            {cmd.label}
                        </Text>
                    ))}
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
                        marginBottom={1}
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
