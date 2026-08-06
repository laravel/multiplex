import { existsSync, statSync } from "node:fs";
import { constants } from "node:os";
import { resolve } from "node:path";
import { render } from "ink";
import { App } from "./app.js";
import { normalizeCommands } from "./args.js";
import { runInline } from "./inline.js";
import type { MultiplexOptions, OutputRef, ProcsRef } from "./types.js";
import {
    formatStreamLabel,
    inlineChildColumns,
    MIN_ROWS,
    sanitizeTitle,
} from "./util.js";

export { DEFAULT_COLORS } from "./args.js";
export type { CommandInput, MultiplexOptions } from "./types.js";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const;

function positiveInt(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer, got ${value}.`);
    }

    return value;
}

function supportsColor(): boolean {
    if (process.env.NO_COLOR) {
        return false;
    }

    if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") {
        return true;
    }

    return Boolean(process.stdout.isTTY);
}

/**
 * Installs the teardown that has to survive a signal. `process.on("exit")` does
 * not run when we are killed by one, and the children sit in their own process
 * groups so they never see the terminal's own SIGHUP — without these, closing
 * the window leaves every dev server running and holding its port.
 */
function installTeardown(shutdown: () => void, onExit: () => void) {
    const handlers = SIGNALS.map((signal) => {
        const handler = () => {
            shutdown();
            process.exit(128 + constants.signals[signal]);
        };

        process.on(signal, handler);

        return [signal, handler] as const;
    });

    process.on("exit", onExit);

    return () => {
        for (const [signal, handler] of handlers) {
            process.removeListener(signal, handler);
        }

        process.removeListener("exit", onExit);
    };
}

/**
 * Runs the commands and resolves with an exit code once everything has exited,
 * the terminal is restored and every child process is gone. Options are
 * validated before we touch the terminal, so a bad option throws with the screen
 * untouched.
 *
 * Renders the TUI when the terminal can support it and falls back to inline
 * output — every line printed as it arrives, no alternate screen, no input —
 * when it cannot, so a pipe or a CI job gets usable output rather than an error.
 */
export async function multiplex(options: MultiplexOptions): Promise<number> {
    const commandDefs = normalizeCommands(options.commands ?? []);
    const bufferSize = positiveInt(options.bufferSize ?? 2_000, "bufferSize");
    const streamBufferSize = positiveInt(
        options.streamBufferSize ?? 10_000,
        "streamBufferSize",
    );
    const timestamps = options.timestamps ?? false;
    const title = options.title ? sanitizeTitle(options.title) : undefined;
    const json = options.json ?? false;
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const inline = json || (options.inline ?? false) || !interactive;

    const cwd = resolve(options.cwd ?? process.cwd());

    if (!existsSync(cwd)) {
        throw new Error(`cwd path does not exist: ${cwd}`);
    }

    if (!statSync(cwd).isDirectory()) {
        throw new Error(`cwd path is not a directory: ${cwd}`);
    }

    const procsRef: ProcsRef = { current: [] };

    function killAll() {
        for (const proc of procsRef.current) {
            try {
                if (proc?.pid) {
                    process.kill(-proc.pid, "SIGKILL");
                }
            } catch {
                //
            }
        }
    }

    return inline ? runInlineMode() : runTui();

    async function runInlineMode(): Promise<number> {
        const color = !json && supportsColor();
        const useTitle = title && !json && process.stdout.isTTY;

        let shuttingDown = false;

        function shutdown() {
            if (shuttingDown) {
                return;
            }

            shuttingDown = true;

            killAll();

            if (useTitle) {
                try {
                    process.stdout.write("\x1b[23;0t");
                } catch {
                    //
                }
            }
        }

        const uninstall = installTeardown(shutdown, killAll);

        if (useTitle) {
            process.stdout.write(`\x1b[22;0t\x1b]0;${title}\x07`);
        }

        try {
            const { done } = runInline({
                commandDefs,
                cwd,
                timestamps,
                autoRestart: options.restart ?? true,
                json,
                color,
                columns: inlineChildColumns(
                    commandDefs.map((c) => c.label),
                    process.stdout.columns ?? 80,
                    timestamps,
                ),
                procsRef,
            });

            const code = await done;

            shutdown();

            return code;
        } catch {
            shutdown();

            return 1;
        } finally {
            uninstall();
        }
    }

    async function runTui(): Promise<number> {
        const rows = process.stdout.rows ?? 0;

        if (rows < MIN_ROWS) {
            throw new Error(
                `multiplex needs at least ${MIN_ROWS} terminal rows, but this terminal has ${rows}. Make the window taller and try again.`,
            );
        }

        const outputRef: OutputRef = { current: [] };

        let instance: ReturnType<typeof render> | undefined;
        let shuttingDown = false;
        let titlePushed = false;

        function restoreTerminal() {
            try {
                process.stdout.write("\x1b[?25h\x1b[?1049l");

                // Guarded: restoreTerminal runs twice, and a second pop would take someone else's title off the stack.
                if (titlePushed) {
                    titlePushed = false;

                    process.stdout.write("\x1b[23;0t");
                }
            } catch {
                //
            }
        }

        function flushOutput() {
            if (outputRef.current.length === 0) {
                return;
            }

            const maxLabelLen = Math.max(
                ...commandDefs.map((c) => c.label.length),
            );

            try {
                for (const sl of outputRef.current) {
                    const cmd = commandDefs[sl.cmdIndex];

                    process.stdout.write(
                        `${sl.ts}${formatStreamLabel(cmd.label, cmd.color, maxLabelLen, true)}${sl.text}\n`,
                    );
                }
            } catch {
                // The terminal can already be gone when we got here via SIGHUP.
            }
        }

        /**
         * Unmount first, so Ink's final frame and its raw-mode teardown happen
         * while we still own the alternate screen, then leave the screen before
         * flushing so the logs land in the real scrollback.
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

        const uninstall = installTeardown(shutdown, () => {
            killAll();
            restoreTerminal();
        });

        if (title) {
            process.stdout.write(`\x1b[22;0t\x1b]0;${title}\x07`);

            titlePushed = true;
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
                    title={title}
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
            uninstall();
        }
    }
}
