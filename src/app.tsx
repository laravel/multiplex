import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { highlightSearch } from "./search.js";
import type { CommandDef, OutputRef, ProcsRef } from "./types.js";
import { useProcesses } from "./use-processes.js";
import { useScroll } from "./use-scroll.js";
import { formatTimestamp, hexToRgb, sidebarWidth } from "./util.js";

type AppProps = {
    commandDefs: CommandDef[];
    cwd: string;
    initialStreamMode: boolean;
    bufferSize?: number;
    streamBufferSize?: number;
    timestamps?: boolean;
    autoRestart?: boolean;
    title?: string;
    outputRef?: OutputRef;
    procsRef?: ProcsRef;
};

const KeyBindings = ({ bindings }: { bindings: [string, string][] }) => {
    return (
        <Text>
            {bindings.map(([k, desc], i) => (
                <Text key={i}>
                    {i > 0 && <Text color="#555555">{" ".repeat(3)}</Text>}
                    <Text color="#888888" bold>
                        {k}
                    </Text>
                    <Text color="#555555"> {desc}</Text>
                </Text>
            ))}
        </Text>
    );
};

export function App({
    commandDefs,
    cwd,
    initialStreamMode,
    bufferSize = 2_000,
    streamBufferSize = 10_000,
    timestamps = false,
    autoRestart = true,
    title,
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
    const [focus, setFocus] = useState<"sidebar" | "content">("content");
    const [filterMode, setFilterMode] = useState(false);
    const [hiddenProcs, setHiddenProcs] = useState<Set<number>>(new Set());

    const outputHeight = streamMode ? rows - 2 : rows - 4;

    const {
        scrollOffset,
        hasNewOutput,
        totalLinesRef,
        notifyNewOutput,
        scrollDown,
        scrollUp,
        pageDown,
        pageUp,
        scrollToTop,
        scrollToBottom,
        resetScroll,
    } = useScroll(outputHeight);

    const matchCountRef = useRef(0);
    const matchLinesRef = useRef<number[]>([]);

    const pendingRender = useRef(false);
    const triggerRender = useCallback(() => {
        notifyNewOutput();

        if (!pendingRender.current) {
            pendingRender.current = true;

            setTimeout(() => {
                pendingRender.current = false;
                setRenderTick((t) => t + 1);
            }, 16);
        }
    }, [notifyNewOutput]);

    const {
        outputBuffersRef,
        streamLinesRef,
        failedProcs,
        restartProcess,
        clearOutput,
        clearStream,
    } = useProcesses({
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
    });

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

    const getVisibleLinesAndMatchCount = (
        lines: string[],
    ): {
        visibleLines: string[];
        matchCount: number;
    } => {
        if (!searchQuery) {
            matchCountRef.current = 0;
            matchLinesRef.current = [];

            return {
                matchCount: 0,
                visibleLines:
                    scrollOffset === null
                        ? lines.slice(-outputHeight)
                        : lines.slice(
                              scrollOffset,
                              scrollOffset + outputHeight,
                          ),
            };
        }

        const fullContent = lines.join("\n");
        const hl = highlightSearch(
            fullContent,
            searchQuery,
            searchInputMode ? -1 : currentMatch,
        );

        const matchCount = hl.count;

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

            return {
                matchCount,
                visibleLines: highlightedLines.slice(
                    scrollStart,
                    scrollStart + outputHeight,
                ),
            };
        }

        return {
            matchCount,
            visibleLines: highlightedLines.slice(-outputHeight),
        };
    };

    const resolveFooter = (): React.ReactNode => {
        if (filterMode) {
            return (
                <Box width="100%">
                    <Text color="#e5c07b" bold>
                        filter:{" "}
                    </Text>
                    {commandDefs.map((cmd, i) => {
                        const hidden = hiddenProcs.has(i);

                        return (
                            <Text key={i}>
                                {i > 0 && <Text>{" ".repeat(3)}</Text>}
                                <Text
                                    color={hidden ? "#555555" : cmd.color}
                                    strikethrough={hidden}
                                    dimColor={hidden}
                                    bold
                                >
                                    {i < 9 ? `${i + 1}` : " "}{" "}
                                </Text>
                                <Text
                                    color={hidden ? "#555555" : cmd.color}
                                    strikethrough={hidden}
                                    dimColor
                                >
                                    {cmd.label}
                                </Text>
                            </Text>
                        );
                    })}
                    <Box flexGrow={1} />
                    <KeyBindings
                        bindings={[
                            ["1-9", "toggle"],
                            ["f", "done"],
                        ]}
                    />
                </Box>
            );
        }

        if (searchInputMode) {
            return (
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
        }

        if (searchQuery && matchCount > 0) {
            return (
                <Text>
                    <Text color="#e5c07b" bold>
                        [{effectiveMatch + 1}/{matchCount}]
                    </Text>
                    <Text color="#888888"> {searchQuery}</Text>
                    <Text color="#555555"> </Text>
                    <KeyBindings
                        bindings={[
                            ["n", "next"],
                            ["N", "prev"],
                            ["Esc", "clear"],
                        ]}
                    />
                </Text>
            );
        }

        const bindings: [string, string][] = (() => {
            if (streamMode) {
                return [
                    ["↑/↓", "scroll"],
                    ["f", "filter"],
                    ["c", "clear"],
                    ["/", "search"],
                    ["t", "tabs"],
                    ["q", "quit"],
                ];
            }

            if (focus === "sidebar") {
                return [
                    ["↑/↓", "navigate"],
                    ["tab", "logs"],
                    ["r", "restart"],
                    ["c", "clear"],
                    ["/", "search"],
                    ["t", "stream"],
                    ["q", "quit"],
                ];
            }

            if (focus === "content") {
                return [
                    ["↑/↓", "scroll"],
                    ["tab", "tabs"],
                    ["c", "clear"],
                    ["/", "search"],
                    ["t", "stream"],
                    ["q", "quit"],
                ];
            }

            return [];
        })();

        return (
            <Box width="100%">
                <KeyBindings bindings={bindings} />
                <Box flexGrow={1} />
                {hiddenProcs.size > 0 && (
                    <Text color="#e5c07b">◆ filtered </Text>
                )}
                {hasNewOutput && <Text color="#e5c07b">↓ new output </Text>}
            </Box>
        );
    };

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

        if (filterMode) {
            if (key.escape || input === "f") {
                setFilterMode(false);

                return;
            }

            if (input && input >= "1" && input <= "9") {
                const idx = parseInt(input, 10) - 1;

                if (idx < commandDefs.length) {
                    setHiddenProcs((prev) => {
                        const next = new Set(prev);

                        if (next.has(idx)) {
                            next.delete(idx);
                        } else {
                            if (next.size < commandDefs.length - 1) {
                                next.add(idx);
                            }
                        }

                        return next;
                    });
                    resetScroll();
                }

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
                resetScroll();

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
                clearStream();
            } else {
                clearOutput(selectedIndex);
            }

            resetScroll();
            triggerRender();

            return;
        }

        if (input && input >= "1" && input <= "9") {
            const idx = parseInt(input, 10) - 1;

            if (idx < commandDefs.length) {
                setSelectedIndex(idx);
                setCurrentMatch(0);
                scrollToBottom();
            }

            return;
        }

        if (input === "t") {
            setStreamMode((m) => !m);
            setCurrentMatch(0);
            resetScroll();

            return;
        }

        if (streamMode && input === "f") {
            setFilterMode(true);

            return;
        }

        if (!streamMode) {
            if (input === "r") {
                restartProcess(selectedIndex);
                resetScroll();

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
                resetScroll();
            } else {
                scrollDown();
            }

            return;
        }

        if (key.upArrow || input === "k") {
            if (effectiveFocus === "sidebar") {
                setSelectedIndex((i) => Math.max(i - 1, 0));
                setCurrentMatch(0);
                resetScroll();
            } else {
                scrollUp();
            }

            return;
        }

        if (effectiveFocus === "content") {
            if (key.pageDown) {
                pageDown();

                return;
            }

            if (key.pageUp) {
                pageUp();

                return;
            }

            if (input === "g") {
                scrollToTop();

                return;
            }

            if (input === "G") {
                scrollToBottom();

                return;
            }
        }
    });

    const maxLabelLen = Math.max(...commandDefs.map((c) => c.label.length));
    const computedSidebarWidth = sidebarWidth(commandDefs.map((c) => c.label));

    const displayLines = !streamMode
        ? outputBuffersRef.current[selectedIndex].split("\n")
        : streamLinesRef.current
              .filter((sl) => !hiddenProcs.has(sl.cmdIndex))
              .map((sl) => {
                  const cmd = commandDefs[sl.cmdIndex];
                  const [r, g, b] = hexToRgb(cmd.color);
                  const padding = " ".repeat(maxLabelLen - cmd.label.length);
                  const ts = timestamps ? formatTimestamp(sl.time) : "";

                  return `${ts}\x1b[1;38;2;${r};${g};${b}m[${cmd.label}]${padding} \x1b[0m${sl.text}`;
              });

    const { visibleLines, matchCount } =
        getVisibleLinesAndMatchCount(displayLines);

    totalLinesRef.current = displayLines.length;

    while (visibleLines.length < outputHeight) {
        visibleLines.push("");
    }

    const effectiveMatch =
        matchCount > 0
            ? ((currentMatch % matchCount) + matchCount) % matchCount
            : 0;

    const Footer = resolveFooter();

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
                    {i >= thumbStart && i < thumbEnd ? "┃" : "│"}
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
                    {Footer}
                </Box>
            </Box>
        );
    }

    const focusedBorder = "#93c5fd";
    const unfocusedBorder = "#333333";

    return (
        <Box flexDirection="column" height={rows} width={cols}>
            <Box flexDirection="row" flexGrow={1}>
                <Box
                    flexDirection="column"
                    width={computedSidebarWidth}
                    borderStyle="round"
                    borderColor={
                        focus === "sidebar" ? focusedBorder : unfocusedBorder
                    }
                >
                    {commandDefs.map((cmd, i) => {
                        const selected = i === selectedIndex;
                        const failed = failedProcs.has(i);
                        const innerWidth = computedSidebarWidth - 2;
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
                            focus === "content" ? "#666666" : unfocusedBorder
                        }
                        borderTop={false}
                        borderLeft={false}
                        borderRight={false}
                        borderStyle="single"
                        paddingX={1}
                    >
                        <Text color="#888888">
                            {commandDefs[selectedIndex].command}
                        </Text>
                    </Box>
                    <Box paddingLeft={1} flexDirection="column" flexGrow={1}>
                        {outputContent}
                    </Box>
                </Box>
            </Box>
            <Box height={1} paddingLeft={1}>
                {Footer}
            </Box>
        </Box>
    );
}
