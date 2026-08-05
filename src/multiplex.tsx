import { existsSync, statSync } from "node:fs";
import { constants } from "node:os";
import { resolve } from "node:path";
import { render } from "ink";
import { App } from "./app.js";
import { normalizeCommands } from "./args.js";
import type { MultiplexOptions, OutputRef, ProcsRef } from "./types.js";
import { formatTimestamp, hexToRgb } from "./util.js";

export { DEFAULT_COLORS } from "./args.js";
export type { CommandInput, MultiplexOptions } from "./types.js";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const;

function positiveInt(value: number, name: string): number {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer, got ${value}.`);
    }

    return value;
}

/**
 * Runs the TUI and resolves with an exit code once it has exited, the terminal
 * is restored and every child process is gone. Options are validated before we
 * touch the terminal, so a bad option throws with the screen untouched.
 */
export async function multiplex(options: MultiplexOptions): Promise<number> {
    const commandDefs = normalizeCommands(options.commands ?? []);
    const bufferSize = positiveInt(options.bufferSize ?? 2_000, "bufferSize");
    const streamBufferSize = positiveInt(
        options.streamBufferSize ?? 10_000,
        "streamBufferSize",
    );
    const timestamps = options.timestamps ?? false;

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        const stream = process.stdin.isTTY ? "stdout" : "stdin";

        throw new Error(
            `multiplex needs an interactive terminal, but ${stream} is not a TTY. Run it directly rather than through a pipe or redirect.`,
        );
    }

    const cwd = resolve(options.cwd ?? process.cwd());

    if (!existsSync(cwd)) {
        throw new Error(`cwd path does not exist: ${cwd}`);
    }

    if (!statSync(cwd).isDirectory()) {
        throw new Error(`cwd path is not a directory: ${cwd}`);
    }

    const outputRef: OutputRef = { current: [] };
    const procsRef: ProcsRef = { current: [] };

    let instance: ReturnType<typeof render> | undefined;
    let shuttingDown = false;

    function killAll() {
        for (const proc of procsRef.current) {
            try {
                if (proc.pid) {
                    process.kill(-proc.pid, "SIGKILL");
                }
            } catch {
                //
            }
        }
    }

    function restoreTerminal() {
        try {
            process.stdout.write("\x1b[?25h\x1b[?1049l");
        } catch {
            //
        }
    }

    function flushOutput() {
        if (outputRef.current.length === 0) {
            return;
        }

        const maxLabelLen = Math.max(...commandDefs.map((c) => c.label.length));

        try {
            for (const sl of outputRef.current) {
                const cmd = commandDefs[sl.cmdIndex];
                const [r, g, b] = hexToRgb(cmd.color);
                const padding = " ".repeat(maxLabelLen - cmd.label.length);
                const ts = timestamps ? formatTimestamp(sl.time) : "";

                process.stdout.write(
                    `${ts}\x1b[1;38;2;${r};${g};${b}m[${cmd.label}]${padding} \x1b[0m${sl.text}\n`,
                );
            }
        } catch {
            // The terminal can already be gone when we got here via SIGHUP.
        }
    }

    /**
     * Unmount first, so Ink's final frame and its raw-mode teardown happen while
     * we still own the alternate screen, then leave the screen before flushing so
     * the logs land in the real scrollback.
     */
    function shutdown() {
        if (shuttingDown) {
            return;
        }

        shuttingDown = true;

        try {
            instance?.unmount();
        } catch {
            //
        }

        killAll();
        restoreTerminal();
        flushOutput();
    }

    // Signals terminate the process without running exit handlers, and the
    // children sit in their own process groups so they never see the terminal's
    // own SIGHUP. Without these, closing the terminal window leaves every dev
    // server running and holding its port. A second signal mid-flush hits the
    // shuttingDown guard and force-exits rather than printing twice.
    const signalHandlers = SIGNALS.map((signal) => {
        const handler = () => {
            shutdown();
            process.exit(128 + constants.signals[signal]);
        };

        process.on(signal, handler);

        return [signal, handler] as const;
    });

    // Last resort for exits we did not route through shutdown().
    const exitHandler = () => {
        killAll();
        restoreTerminal();
    };

    process.on("exit", exitHandler);

    if (options.title) {
        process.stdout.write(`\x1b]0;${options.title}\x07`);
    }

    process.stdout.write("\x1b[?1049h\x1b[?25l");

    try {
        instance = render(
            <App
                commandDefs={commandDefs}
                cwd={cwd}
                initialStreamMode={options.stream ?? false}
                bufferSize={bufferSize}
                streamBufferSize={streamBufferSize}
                timestamps={timestamps}
                autoRestart={options.restart ?? true}
                title={options.title}
                outputRef={outputRef}
                procsRef={procsRef}
            />,
            { exitOnCtrlC: true },
        );

        await instance.waitUntilExit();

        shutdown();

        return 0;
    } catch {
        shutdown();

        return 1;
    } finally {
        for (const [signal, handler] of signalHandlers) {
            process.removeListener(signal, handler);
        }

        process.removeListener("exit", exitHandler);
    }
}
