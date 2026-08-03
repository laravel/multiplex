import { spawn } from "node:child_process";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { highlightSearch } from "./search.js";

function hexToRgb(hex) {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
}
export function App({ commandDefs, cwd, initialStreamMode }) {
    const { exit } = useApp();
    const { stdout } = useStdout();
    const [rows, setRows] = useState(stdout?.rows ?? 24);
    const [cols, setCols] = useState(stdout?.columns ?? 80);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [streamMode, setStreamMode] = useState(initialStreamMode);
    const [searchInputMode, setSearchInputMode] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [currentMatch, setCurrentMatch] = useState(0);
    const [, setRenderTick] = useState(0);
    const outputBuffersRef = useRef(commandDefs.map(() => ""));
    const streamLinesRef = useRef([]);
    const partialsRef = useRef(commandDefs.map(() => ""));
    const procsRef = useRef([]);
    const matchCountRef = useRef(0);
    const matchLinesRef = useRef([]);
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
            const spawnArgs = needsShell
                ? ["sh", ["-c", cmdStr]]
                : [cmd.command[0], cmd.command.slice(1)];
            const proc = spawn(spawnArgs[0], spawnArgs[1], {
                cwd,
                env: { ...process.env, FORCE_COLOR: "1" },
                stdio: ["ignore", "pipe", "pipe"],
            });
            const handleData = (data) => {
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
            return;
        }
        if (searchQuery) {
            if (input === "n") {
                const mc = matchCountRef.current;
                if (mc > 0) setCurrentMatch((m) => (m + 1) % mc);
                return;
            }
            if (input === "N") {
                const mc = matchCountRef.current;
                if (mc > 0) setCurrentMatch((m) => (m - 1 + mc) % mc);
                return;
            }
        }
        if (input === "t") {
            setStreamMode((m) => !m);
            setCurrentMatch(0);
            return;
        }
        if (!streamMode) {
            if (key.downArrow || input === "j") {
                setSelectedIndex((i) =>
                    Math.min(i + 1, commandDefs.length - 1),
                );
                setCurrentMatch(0);
                return;
            }
            if (key.upArrow || input === "k") {
                setSelectedIndex((i) => Math.max(i - 1, 0));
                setCurrentMatch(0);
                return;
            }
        }
    });
    const maxLabelLen = Math.max(...commandDefs.map((c) => c.label.length));
    const sidebarWidth = 20;
    const outputHeight = streamMode ? rows - 1 : rows - 2;
    let displayLines;
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
    let visibleLines;
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
        visibleLines = displayLines.slice(-outputHeight);
    }
    while (visibleLines.length < outputHeight) {
        visibleLines.unshift("");
    }
    const effectiveMatch =
        matchCount > 0
            ? ((currentMatch % matchCount) + matchCount) % matchCount
            : 0;
    let footer;
    if (searchInputMode) {
        footer = _jsxs(Text, {
            children: [
                _jsxs(Text, {
                    color: "#e5c07b",
                    bold: true,
                    children: ["/", " "],
                }),
                _jsx(Text, { color: "#cccccc", children: searchQuery }),
                _jsx(Text, { color: "#e5c07b", children: "█" }),
                searchQuery &&
                    matchCount === 0 &&
                    _jsx(Text, { color: "#e06c75", children: " no matches" }),
                searchQuery &&
                    matchCount > 0 &&
                    _jsxs(Text, {
                        color: "#555555",
                        children: [
                            " ",
                            matchCount,
                            " match",
                            matchCount === 1 ? "" : "es",
                        ],
                    }),
            ],
        });
    } else if (searchQuery && matchCount > 0) {
        footer = _jsxs(Text, {
            children: [
                _jsxs(Text, {
                    color: "#e5c07b",
                    bold: true,
                    children: ["[", effectiveMatch + 1, "/", matchCount, "]"],
                }),
                _jsxs(Text, { color: "#888888", children: [" ", searchQuery] }),
                _jsx(Text, { color: "#555555", children: " " }),
                _jsx(Text, { color: "#888888", bold: true, children: "n" }),
                _jsx(Text, { color: "#555555", children: " next" }),
                _jsx(Text, { color: "#555555", children: " " }),
                _jsx(Text, { color: "#888888", bold: true, children: "N" }),
                _jsx(Text, { color: "#555555", children: " prev" }),
                _jsx(Text, { color: "#555555", children: " " }),
                _jsx(Text, { color: "#888888", bold: true, children: "Esc" }),
                _jsx(Text, { color: "#555555", children: " clear" }),
            ],
        });
    } else {
        const bindings = streamMode
            ? [
                  ["/", "search"],
                  ["t", "tabs"],
              ]
            : [
                  ["↑/↓", "navigate"],
                  ["/", "search"],
                  ["t", "stream"],
              ];
        footer = _jsx(Text, {
            children: bindings.map(([k, desc], i) =>
                _jsxs(
                    Text,
                    {
                        children: [
                            i > 0 &&
                                _jsx(Text, { color: "#555555", children: " " }),
                            _jsx(Text, {
                                color: "#888888",
                                bold: true,
                                children: k,
                            }),
                            _jsxs(Text, {
                                color: "#555555",
                                children: [" ", desc],
                            }),
                        ],
                    },
                    i,
                ),
            ),
        });
    }
    const outputContent = visibleLines.map((line, i) =>
        _jsx(Text, { wrap: "truncate-end", children: line || " " }, i),
    );
    if (streamMode) {
        return _jsxs(Box, {
            flexDirection: "column",
            height: rows,
            width: cols,
            children: [
                _jsx(Box, {
                    flexDirection: "column",
                    flexGrow: 1,
                    paddingLeft: 1,
                    children: outputContent,
                }),
                _jsx(Box, { height: 1, paddingLeft: 1, children: footer }),
            ],
        });
    }
    return _jsxs(Box, {
        flexDirection: "column",
        height: rows,
        width: cols,
        children: [
            _jsxs(Box, {
                flexDirection: "row",
                flexGrow: 1,
                children: [
                    _jsx(Box, {
                        flexDirection: "column",
                        width: sidebarWidth,
                        borderStyle: "single",
                        borderRight: true,
                        borderTop: false,
                        borderBottom: false,
                        borderLeft: false,
                        borderColor: "#333333",
                        children: commandDefs.map((cmd, i) =>
                            _jsxs(
                                Text,
                                {
                                    color: cmd.color,
                                    children: [
                                        i === selectedIndex ? " ▶ " : "   ",
                                        cmd.label,
                                    ],
                                },
                                i,
                            ),
                        ),
                    }),
                    _jsxs(Box, {
                        flexDirection: "column",
                        flexGrow: 1,
                        paddingLeft: 1,
                        children: [
                            _jsxs(Text, {
                                color: "#888888",
                                children: [
                                    " ",
                                    "$ ",
                                    commandDefs[selectedIndex].command.join(
                                        " ",
                                    ),
                                ],
                            }),
                            outputContent,
                        ],
                    }),
                ],
            }),
            _jsx(Box, { height: 1, paddingLeft: 1, children: footer }),
        ],
    });
}
