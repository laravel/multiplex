import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const cli = fileURLToPath(new URL("./cli.tsx", import.meta.url));

// stdio is piped, so none of these are a TTY and every run takes the inline
// path — which is the point: this is what a pipe, a Makefile or CI actually get.
function runCli(
    args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const proc = spawn(tsx, [cli, ...args], {
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, NO_COLOR: "1" },
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (d) => {
            stdout += d;
        });
        proc.stderr.on("data", (d) => {
            stderr += d;
        });
        proc.on("error", reject);
        proc.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

describe("inline mode", () => {
    it("runs instead of erroring when stdout is not a TTY", async () => {
        const { code, stdout } = await runCli([
            "web,echo hello",
            "api,echo world",
        ]);

        assert.equal(code, 0);
        assert.match(stdout, /web │ hello/);
        assert.match(stdout, /api │ world/);
    });

    it("keeps command output on stdout and its own notices on stderr", async () => {
        const { stdout, stderr } = await runCli(["a,echo out; echo err >&2"]);

        assert.match(stdout, /a │ out/);
        assert.match(stderr, /a │ err/);
        assert.doesNotMatch(stdout, /exited with code/);
        assert.match(stderr, /Process exited with code 0/);
    });

    it("exits nonzero when a command fails", async () => {
        const { code } = await runCli(["ok,true", "bad,exit 3"]);

        assert.equal(code, 3);
    });

    it("exits zero when every command succeeds", async () => {
        const { code } = await runCli(["a,true", "b,true"]);

        assert.equal(code, 0);
    });

    it("does not retry a command that crashes immediately", async () => {
        const { stderr } = await runCli(["a,exit 1"]);

        assert.doesNotMatch(stderr, /Restarting/);
    });

    it("does not retry at all with --no-restart", async () => {
        const { stderr } = await runCli([
            "--no-restart",
            "a,sleep 1.2; exit 1",
        ]);

        assert.doesNotMatch(stderr, /Restarting/);
    });

    it("emits one JSON event per line, with ANSI stripped", async () => {
        const { code, stdout } = await runCli([
            "--json",
            "a,printf '\\033[31mred\\033[0m\\n'; exit 2",
        ]);

        const events = stdout
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));

        assert.equal(code, 2);
        assert.deepEqual(
            events.map((e) => e.type),
            ["start", "output", "exit", "failed", "done"],
        );
        assert.equal(events.at(-2).reason, "crashed-immediately");
        assert.equal(events[1].text, "red");
        assert.equal(events[1].stream, "stdout");
        assert.equal(events.at(-1).code, 2);
        assert.ok(events.every((e) => e.v === 1 && typeof e.time === "string"));
    });

    it("accepts --inline even though it is already implied", async () => {
        const { code, stdout } = await runCli(["-i", "a,echo hello"]);

        assert.equal(code, 0);
        assert.match(stdout, /a │ hello/);
    });
});
