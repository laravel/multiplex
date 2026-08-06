import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    createSupervisor,
    type FailureReason,
    type OutputStream,
} from "./supervisor.js";
import type { CommandDef } from "./types.js";

type Line = { label: string; text: string; stream: OutputStream };

type RunResult = {
    lines: Line[];
    exits: { label: string; code: number | null }[];
    failures: { label: string; code: number | null; reason: FailureReason }[];
    restarts: number;
};

// Retry timings are compressed so the exhaustion path costs a fraction of a
// second instead of the ~12s the real 1s uptime guard and 1s delay would need.
const FAST = { minUptimeMs: 50, restartDelayMs: 10, maxRestarts: 5 };

function run(
    commandDefs: CommandDef[],
    { autoRestart = false, fast = false } = {},
): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        const result: RunResult = {
            lines: [],
            exits: [],
            failures: [],
            restarts: 0,
        };

        const timer = setTimeout(() => {
            supervisor.stop();
            reject(new Error("supervisor never settled"));
        }, 15_000);

        const supervisor = createSupervisor({
            commandDefs,
            cwd: process.cwd(),
            columns: 80,
            autoRestart,
            forceColor: false,
            ...(fast ? FAST : {}),
            handlers: {
                onLine({ index, text, stream }) {
                    result.lines.push({
                        label: commandDefs[index].label,
                        text,
                        stream,
                    });
                },
                onExit({ index, code }) {
                    result.exits.push({
                        label: commandDefs[index].label,
                        code,
                    });
                },
                onFailed({ index, code, reason }) {
                    result.failures.push({
                        label: commandDefs[index].label,
                        code,
                        reason,
                    });
                },
                onRestartScheduled() {
                    result.restarts++;
                },
                onSettled() {
                    clearTimeout(timer);
                    supervisor.stop();
                    resolve(result);
                },
            },
        });

        supervisor.start();
    });
}

const cmd = (label: string, command: string): CommandDef => ({
    label,
    color: "#93c5fd",
    command,
});

describe("createSupervisor", () => {
    it("emits every line of output and settles once all commands exit", async () => {
        const result = await run([
            cmd("a", "printf 'one\\ntwo\\n'"),
            cmd("b", "printf 'three\\n'"),
        ]);

        assert.deepEqual(
            result.lines.map((l) => `${l.label}:${l.text}`).sort(),
            ["a:one", "a:two", "b:three"],
        );
        assert.equal(result.exits.length, 2);
        assert.equal(result.failures.length, 0);
    });

    it("tags stdout and stderr separately", async () => {
        const result = await run([
            cmd("a", "echo out; echo err >&2; echo out2"),
        ]);

        assert.deepEqual(result.lines.map((l) => [l.stream, l.text]).sort(), [
            ["stderr", "err"],
            ["stdout", "out"],
            ["stdout", "out2"],
        ]);
    });

    // Without this the last line of anything that does not end in a newline —
    // an unterminated error message, a prompt — is lost when the process dies.
    it("flushes a trailing partial line before the exit", async () => {
        const result = await run([cmd("a", "printf 'no newline'")]);

        assert.deepEqual(
            result.lines.map((l) => l.text),
            ["no newline"],
        );
    });

    it("reports a nonzero exit as a permanent failure when not restarting", async () => {
        const result = await run([cmd("a", "exit 3")]);

        assert.deepEqual(result.exits, [{ label: "a", code: 3 }]);
        assert.deepEqual(result.failures, [
            { label: "a", code: 3, reason: "restart-disabled" },
        ]);
    });

    it("does not report a clean exit as a failure", async () => {
        const result = await run([cmd("a", "true")]);

        assert.deepEqual(result.failures, []);
    });

    // The whole point of the uptime guard: a command that never got off the
    // ground is not going to be fixed by trying it four more times.
    it("does not retry a command that crashes immediately", async () => {
        const result = await run([cmd("a", "exit 1")], { autoRestart: true });

        assert.equal(result.restarts, 0);
        assert.equal(result.exits.length, 1);
        assert.deepEqual(result.failures, [
            { label: "a", code: 1, reason: "crashed-immediately" },
        ]);
    });

    it("retries a command that stayed up first, then gives up after five", async () => {
        const result = await run([cmd("a", "sleep 0.2; exit 1")], {
            autoRestart: true,
            fast: true,
        });

        assert.equal(result.restarts, 5);
        assert.equal(result.exits.length, 6);
        assert.deepEqual(result.failures, [
            { label: "a", code: 1, reason: "attempts-exhausted" },
        ]);
    });

    it("splits lines across chunk boundaries", async () => {
        const result = await run([
            cmd("a", "printf 'start'; sleep 0.2; printf 'end\\nnext\\n'"),
        ]);

        assert.deepEqual(
            result.lines.map((l) => l.text),
            ["startend", "next"],
        );
    });
});
