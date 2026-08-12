import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const builtOutputDisconnectModule = new URL("../dist/cli/output-disconnect.js", import.meta.url).href;

test("CLI exits quietly when its stdout consumer disconnects", async () => {
	const script = [
		'import { installOutputDisconnectHandlers } from "./cli/output-disconnect.js";',
		"installOutputDisconnectHandlers();",
		'for (let index = 0; index < 100_000; index += 1) process.stdout.write("catui output\\n");',
	].join("\n");
	const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: new URL("..", import.meta.url),
		stdio: ["ignore", "pipe", "pipe"],
	});

	child.stdout.destroy();
	const stderr: Buffer[] = [];
	child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

	const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve({ code, signal }));
	});

	assert.deepEqual(result, { code: 0, signal: null });
	assert.doesNotMatch(Buffer.concat(stderr).toString("utf8"), /EPIPE|Unhandled 'error' event/);
});

test("CLI does not hide unexpected stdout errors", async () => {
	const script = [
		'import { installOutputDisconnectHandlers } from "./cli/output-disconnect.js";',
		"installOutputDisconnectHandlers();",
		'process.stdout.emit("error", Object.assign(new Error("unexpected output failure"), { code: "EIO" }));',
	].join("\n");
	const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: new URL("..", import.meta.url),
		stdio: ["ignore", "ignore", "pipe"],
	});
	const stderr: Buffer[] = [];
	child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

	const code = await new Promise<number | null>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", resolve);
	});

	assert.equal(code, 1);
	assert.match(Buffer.concat(stderr).toString("utf8"), /unexpected output failure/);
});

test("built output guard exits quietly when its stdout consumer disconnects", async () => {
	const script = [
		`import { installOutputDisconnectHandlers } from ${JSON.stringify(builtOutputDisconnectModule)};`,
		"installOutputDisconnectHandlers();",
		'for (let index = 0; index < 100_000; index += 1) process.stdout.write("catui output\\n");',
	].join("\n");
	const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
		stdio: ["ignore", "pipe", "pipe"],
	});

	child.stdout.destroy();
	const stderr: Buffer[] = [];
	child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
	const code = await new Promise<number | null>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", resolve);
	});

	assert.equal(code, 0);
	assert.doesNotMatch(Buffer.concat(stderr).toString("utf8"), /EPIPE|Unhandled 'error' event/);
});
