import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBuiltinExtensionPaths } from "../builtin-extensions.ts";
import { executeBash } from "../core/platform/exec/bash-executor.ts";
import { loadTokenSaveConfigFilters } from "../extensions/builtin/token-save/config.ts";
import { classifyCommand, estimateTokens, filterTokenSaveOutput } from "../extensions/builtin/token-save/filters.ts";
import { splitShellSegments } from "../extensions/builtin/token-save/lexer.ts";
import { applyTokenSavePlan, applyTokenSaveStream } from "../extensions/builtin/token-save/runner.ts";
import { planCommand } from "../extensions/builtin/token-save/rewrite.ts";
import { applyTomlStyleFilter } from "../extensions/builtin/token-save/toml-dsl.ts";

test("builtin extensions include token-save by default", () => {
	const paths = getBuiltinExtensionPaths();
	assert.ok(
		paths.some((entry) => entry.includes("extensions") && entry.includes("defaults") && entry.includes("token-save")),
		`Expected token-save extension in builtin paths, got: ${paths.join(", ")}`,
	);
});

test("token-save classifies high-noise commands and honors disable/write guards", () => {
	assert.equal(classifyCommand("git status --short").category, "git-status");
	assert.equal(classifyCommand("pnpm exec tsc --noEmit").category, "typescript");
	assert.equal(classifyCommand("cat src/main.ts | grep foo").category, "read-file");
	assert.equal(classifyCommand("TOKEN_SAVE_DISABLED=1 git status").mode, "passthrough");
	assert.equal(classifyCommand("cat > generated.txt").mode, "passthrough");
});

test("token-save lexer handles quoted operators and pipes", () => {
	const segments = splitShellSegments("echo 'a && b' && cat file.ts | grep symbol");
	assert.deepEqual(segments, [
		{ text: "echo 'a && b'", operator: "&&" },
		{ text: "cat file.ts", operator: "|" },
		{ text: "grep symbol", operator: "" },
	]);
});

test("token-save rewrite registry plans capture, stream, and passthrough modes", () => {
	assert.deepEqual(planCommand("git status --short").target, "tokensave git status");
	assert.equal(planCommand("pnpm exec tsc --noEmit").mode, "stream");
	assert.equal(planCommand("cat > generated.txt").mode, "passthrough");
	assert.equal(planCommand("TOKEN_SAVE_DISABLED=1 git status").mode, "passthrough");
});

test("token-save compacts git status output", () => {
	const raw = [
		"On branch main",
		"Changes not staged for commit:",
		"  modified:   core/tools/bash.ts",
		"  modified:   extensions/AGENT.md",
		...Array.from({ length: 30 }, (_, i) => `  modified:   packages/example/file-${i}.ts`),
		"Untracked files:",
		"  extensions/builtin/token-save/index.ts",
		"no changes added to commit",
	].join("\n");

	const result = filterTokenSaveOutput("git status", raw);

	assert.equal(result.mode, "filtered");
	assert.equal(result.category, "git-status");
	assert.match(result.text, /On branch main/);
	assert.match(result.text, /Changes not staged for commit: 32/);
	assert.ok(estimateTokens(result.text) < estimateTokens(raw));
});

test("token-save focuses test output on failures and summary", () => {
	const noisy = Array.from({ length: 240 }, (_, i) => `log line ${i}`).join("\n");
	const raw = `${noisy}\nFAIL test/example.test.ts\nAssertionError: expected true to be false\nTests: 1 failed, 25 passed`;

	const result = filterTokenSaveOutput("npm test", raw);

	assert.match(result.text, /FAIL test\/example\.test\.ts/);
	assert.match(result.text, /AssertionError/);
	assert.match(result.text, /Tests: 1 failed/);
	assert.doesNotMatch(result.text, /log line 1\nlog line 2\nlog line 3/);
});

test("token-save compacts TypeScript errors by file and code", () => {
	const raw = [
		"src/a.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
		"src/a.ts(11,7): error TS2322: Type 'boolean' is not assignable to type 'number'.",
		"src/b.ts(3,1): error TS2304: Cannot find name 'missing'.",
		"Found 3 errors in 2 files.",
	].join("\n");

	const result = filterTokenSaveOutput("pnpm exec tsc --noEmit", raw);

	assert.match(result.text, /TypeScript compact: 2 file\/code group/);
	assert.match(result.text, /src\/a\.ts TS2322/);
	assert.match(result.text, /10:5/);
});

test("token-save compacts search output by file groups", () => {
	const raw = Array.from({ length: 240 }, (_, i) => `src/file-${i % 6}.ts:${i}:needle ${i}`).join("\n");
	const result = filterTokenSaveOutput("rg needle src", raw);

	assert.match(result.text, /Search compact: 240 line/);
	assert.match(result.text, /src\/file-0\.ts: 40/);
	assert.ok(estimateTokens(result.text) < estimateTokens(raw));
});

test("token-save runner writes raw recovery for filtered output", async () => {
	const project = await mkdtemp(join(tmpdir(), "tokensave-test-"));
	const raw = Array.from({ length: 260 }, (_, i) => `log line ${i}`).join("\n") +
		"\nFAIL test/example.test.ts\nAssertionError: expected true to be false\nTests: 1 failed, 25 passed";

	const result = await applyTokenSavePlan("npm test", raw, project);

	assert.equal(result.plan.mode, "stream");
	assert.equal(result.shouldReplace, true);
	assert.ok(result.rawRecoveryPath);
	assert.equal(await readFile(result.rawRecoveryPath!, "utf8"), raw);
});

test("token-save stream runner filters accumulated chunks", async () => {
	const project = await mkdtemp(join(tmpdir(), "tokensave-stream-"));
	const chunks = [
		Array.from({ length: 120 }, (_, i) => `log line ${i}\n`).join(""),
		"FAIL test/example.test.ts\n",
		"AssertionError: expected true to be false\n",
		"Tests: 1 failed, 25 passed\n",
	];

	const result = await applyTokenSaveStream("npm test", chunks, project);

	assert.equal(result.plan.mode, "stream");
	assert.equal(result.shouldReplace, true);
	assert.match(result.filteredText, /FAIL test\/example\.test\.ts/);
	assert.doesNotMatch(result.filteredText, /log line 1\nlog line 2\nlog line 3/);
});

test("token-save config DSL applies pipeline stages in order", () => {
	const raw = "\u001b[31mprogress 10%\u001b[0m\nkeep: first value that is very long\nnoise\nkeep: second";
	const result = applyTomlStyleFilter(
		{
			stripLines: ["^noise$"],
			keepLines: ["^keep:"],
			truncateLine: 18,
			maxLines: 1,
			emptyMessage: "empty",
		},
		raw,
	);

	assert.equal(result, "keep: first val...");
});

test("token-save loads project config filters only when trusted", async () => {
	const project = await mkdtemp(join(tmpdir(), "tokensave-config-"));
	const configDir = join(project, ".nanopencil", "token-save");
	await mkdir(configDir, { recursive: true });
	await writeFile(
		join(configDir, "filters.json"),
		JSON.stringify({
			filters: [
				{
					name: "build-summary",
					commandPattern: "npm run build",
					filter: { keepLines: ["error|warning"], maxLines: 10 },
				},
			],
		}),
	);

	assert.equal((await loadTokenSaveConfigFilters(project)).length, 0);
	await writeFile(join(configDir, "trust.json"), JSON.stringify({ trusted: true }));
	const filters = await loadTokenSaveConfigFilters(project);
	assert.equal(filters.length, 1);
	assert.equal(filters[0].source, "project");
});

test("bash executor honors explicit cwd for TokenSave user bash integration", async () => {
	const project = await mkdtemp(join(tmpdir(), "tokensave-cwd-"));
	const result = await executeBash("node -e \"console.log(process.cwd())\"", { cwd: project });
	assert.equal(result.exitCode, 0);
	assert.equal(await realpath(result.output.trim()), await realpath(project));
});
