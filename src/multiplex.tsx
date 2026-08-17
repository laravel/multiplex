import { existsSync, statSync } from "node:fs";
import { constants } from "node:os";
import { resolve } from "node:path";
import { render } from "ink";
import { App } from "./app.js";
import { normalizeCommands } from "./args.js";
import { runInline } from "./inline.js";
import type { MultiplexOptions, OutputRef, SupervisorRef } from "./types.js";
import {
    fitsTui,
    formatStreamContinuation,
    formatStreamLabel,
    inlineChildColumns,
    MIN_COLUMNS,
    MIN_ROWS,
    sanitizeTitle,
    systemMsg,
} from "./util.js";

export { DEFAULT_COLORS } from "./color.js";
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
function installTeardown(shutdown: () => Promise<void>, onExit: () => void) {
    const handlers = SIGNALS.map((signal) => {
        // Waits for the shutdown so the children get their chance to clean up,
        // which is only safe because a second signal re-enters here, finds the
        // shutdown already running and exits through onExit — SIGKILL and no
        // waiting. Someone who wants out now presses it again.
        const handler = () => {
            shutdown().finally(() => {
                process.exit(128 + constants.signals[signal]);
            });
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
 * when it cannot, so a pipe, a CI job or a window too small to draw a layout in
 * gets usable output rather than an error.
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
    const columns = process.stdout.columns ?? 0;
    const rows = process.stdout.rows ?? 0;
    const tooSmall = interactive && !fitsTui(columns, rows);
    const inline =
        json || (options.inline ?? false) || !interactive || tooSmall;

    const cwd = resolve(options.cwd ?? process.cwd());

    if (!existsSync(cwd)) {
        throw new Error(`cwd path does not exist: ${cwd}`);
    }

    if (!statSync(cwd).isDirectory()) {
        throw new Error(`cwd path is not a directory: ${cwd}`);
    }

    const supervisorRef: SupervisorRef = { current: null };

    /** SIGTERM, a grace period, then SIGKILL for anything still standing. */
    function terminate(): Promise<void> {
        return supervisorRef.current?.terminate() ?? Promise.resolve();
    }

    /** The synchronous last resort, for the paths that cannot wait. */
    function killAll() {
        supervisorRef.current?.killAll();
    }

    return inline ? runInlineMode() : runTui();

    async function runInlineMode(): Promise<number> {
        const color = !json && supportsColor();
        const useTitle = title && !json && process.stdout.isTTY;

        let shuttingDown = false;

        function restoreTitle() {
            if (!useTitle) {
                return;
            }

            try {
                process.stdout.write("\x1b[23;0t");
            } catch {
                //
            }
        }

        async function shutdown() {
            if (shuttingDown) {
                return;
            }

            shuttingDown = true;

            await terminate();

            restoreTitle();
        }

        const uninstall = installTeardown(shutdown, () => {
            killAll();
            restoreTitle();
        });

        // Without a TTY inline mode is the expected outcome and needs no
        // explanation; in a real terminal the missing TUI does.
        if (tooSmall && !json) {
            const notice = `Terminal is ${columns}x${rows}; the TUI needs at least ${MIN_COLUMNS}x${MIN_ROWS}. Running inline.`;

            process.stderr.write(`${color ? systemMsg(notice) : notice}\n`);
        }

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
                supervisorRef,
            });

            const code = await done;

            await shutdown();

            return code;
        } catch {
            await shutdown();

            return 1;
        } finally {
            uninstall();
        }
    }

    async function runTui(): Promise<number> {
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
                    const prefix = sl.cont
                        ? formatStreamContinuation(maxLabelLen, true)
                        : formatStreamLabel(
                              cmd.label,
                              cmd.color,
                              maxLabelLen,
                              true,
                          );

                    process.stdout.write(`${sl.ts}${prefix}${sl.text}\n`);
                }
            } catch {
                // The terminal can already be gone when we got here via SIGHUP.
            }
        }

        /**
         * Unmount first, so Ink's final frame and its raw-mode teardown happen
         * while we still own the alternate screen, then leave the screen before
         * flushing so the logs land in the real scrollback. The wait for the
         * children sits between the two: they can still be printing, and the
         * flush should carry whatever they say on their way out, but nobody
         * should have to watch a dead frame while they take it.
         */
        async function shutdown() {
            if (shuttingDown) {
                return;
            }

            shuttingDown = true;

            try {
                instance?.unmount();
            } catch {
                //
            }

            restoreTerminal();

            await terminate();

            killAll();
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
                    supervisorRef={supervisorRef}
                />,
                { exitOnCtrlC: true },
            );

            await instance.waitUntilExit();

            await shutdown();

            return 0;
        } catch {
            await shutdown();

            return 1;
        } finally {
            uninstall();
        }
    }
}
