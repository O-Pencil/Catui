/**
 * [WHO]: Locks the built-in extension registry's single-list invariant, load order, and activation policy
 * [FROM]: Depends on node:test, node:fs, builtin-extensions, and the real extensions/ directory layout
 * [TO]: Consumed by test:runtime-owners and the full test chain
 * [HERE]: test/builtin-extension-registry.test.ts - S01 registry invariants
 *
 * These tests read the real filesystem rather than comparing a generated list to its own input, so
 * a registry entry naming a directory that does not exist fails here.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { builtInExtensions, getBuiltinExtensionPaths } from "../builtin-extensions.js";

const REPO_ROOT = process.cwd();
const loadPaths = (): string[] => getBuiltinExtensionPaths();

/** Load order as stable ids. NanoMem ships as a package, so its directory is mem-core. */
function loadedIds(paths: readonly string[] = loadPaths()): string[] {
	return paths.map((entry) => {
		const normalized = entry.replaceAll(sep, "/");
		if (normalized.includes("/packages/mem-core/")) return "nanomem";
		return normalized.match(/\/(?:builtin|optional)\/([^/]+)\//)?.[1] ?? entry;
	});
}

/** Expected default load order recorded at the S01 base SHA. Changing it is a behavior change. */
const BASELINE_LOAD_ORDER = [
	"typesafe", "diagnostics", "sal", "nanomem", "link-world", "security-audit",
	"next-step", "presence", "ask-user-question", "teach", "grub", "context-management",
	"goal", "loop", "plan", "discipline", "subagent", "team", "idle-think", "btw",
	"recap", "debug", "mcp", "task", "lsp", "insights", "notebook", "skill-tool",
	"catpaw", "humanizer", "catail", "evolution",
];

test("main's session bridge precedes the unchanged S01 baseline load order", () => {
	const previous = process.env.CATUI_ENABLE_BROWSER_EXTENSION;
	try {
		delete process.env.CATUI_ENABLE_BROWSER_EXTENSION;
		assert.deepEqual(loadedIds(), ["session-bridge", ...BASELINE_LOAD_ORDER]);
	} finally {
		if (previous === undefined) delete process.env.CATUI_ENABLE_BROWSER_EXTENSION;
		else process.env.CATUI_ENABLE_BROWSER_EXTENSION = previous;
	}
});

test("defaultEnabled is the loading decision, under both browser switch states", () => {
	const previous = process.env.CATUI_ENABLE_BROWSER_EXTENSION;
	try {
		for (const browserEnabled of [undefined, "1"] as const) {
			if (browserEnabled === undefined) delete process.env.CATUI_ENABLE_BROWSER_EXTENSION;
			else process.env.CATUI_ENABLE_BROWSER_EXTENSION = browserEnabled;

			const activated = new Set(loadedIds());
			for (const extension of builtInExtensions) {
				// The browser harness is the only entry an activation switch can turn on.
				const shouldLoad = extension.defaultEnabled || (extension.id === "browser" && browserEnabled === "1");
				assert.equal(
					activated.has(extension.id),
					shouldLoad,
					`${extension.id}: defaultEnabled=${extension.defaultEnabled} but loaded=${activated.has(extension.id)} (browser env=${browserEnabled ?? "unset"})`,
				);
			}
		}
	} finally {
		if (previous === undefined) delete process.env.CATUI_ENABLE_BROWSER_EXTENSION;
		else process.env.CATUI_ENABLE_BROWSER_EXTENSION = previous;
	}
});

test("public metadata order matches load order for every entry that can load", () => {
	const previous = process.env.CATUI_ENABLE_BROWSER_EXTENSION;
	let orderWithBrowser: string[];
	try {
		process.env.CATUI_ENABLE_BROWSER_EXTENSION = "1";
		orderWithBrowser = loadedIds();
	} finally {
		if (previous === undefined) delete process.env.CATUI_ENABLE_BROWSER_EXTENSION;
		else process.env.CATUI_ENABLE_BROWSER_EXTENSION = previous;
	}
	// The registry is one array in one order, so the metadata projection can never tell a
	// different load-order story from the loader. Opt-in entries that never load are excluded.
	const loadable = new Set(orderWithBrowser);
	assert.deepEqual(
		builtInExtensions.map((e) => e.id).filter((id) => loadable.has(id)),
		orderWithBrowser,
	);
});

test("the registry is one list: no second load list reappears beside it", () => {
	const source = readFileSync(join(REPO_ROOT, "builtin-extensions.ts"), "utf8");
	assert.equal(/\bBUILTIN_LOAD_PLAN\b/.test(source), false, "A second load list must not reappear.");
	assert.equal(/\bconst REGISTRY\b/.test(source), true);
	// Metadata is projected from the registry rather than declared alongside it.
	assert.match(source, /export const builtInExtensions: readonly BuiltinExtension\[\] = REGISTRY\.map/);
});

test("the registry has no duplicate ids", () => {
	const ids = builtInExtensions.map((e) => e.id);
	assert.equal(new Set(ids).size, ids.length, `Duplicate registry id: ${ids.join(", ")}`);
});

test("every default-loaded built-in resolves to a unique, existing entry point", () => {
	const seen = new Set<string>();
	for (const entry of loadPaths()) {
		assert.equal(seen.has(entry), false, `Duplicate built-in extension path: ${entry}`);
		seen.add(entry);
		assert.ok(existsSync(entry), `Resolved built-in extension path does not exist: ${entry}`);
	}
});

test("turn-context producers load before their consumers", () => {
	const ids = loadedIds();
	const index = (id: string): number => {
		const at = ids.indexOf(id);
		assert.notEqual(at, -1, `Expected ${id} in load order.`);
		return at;
	};
	assert.ok(index("diagnostics") < index("sal"), "diagnostics must precede sal.");
	assert.ok(index("sal") < index("nanomem"), "sal must precede nanomem.");
});

test("next-step rule text precedes presence content in the merged system prompt", () => {
	const ids = loadedIds();
	assert.ok(ids.indexOf("next-step") < ids.indexOf("presence"), "next-step must precede presence.");
	assert.equal(ids.indexOf("next-step"), ids.lastIndexOf("next-step"), "next-step must be registered once.");
});

test("browser stays absent by default and appears at its registry position when env-enabled", () => {
	const previous = process.env.CATUI_ENABLE_BROWSER_EXTENSION;
	try {
		delete process.env.CATUI_ENABLE_BROWSER_EXTENSION;
		assert.equal(loadPaths().some((entry) => entry.includes(`${sep}browser${sep}`)), false);

		process.env.CATUI_ENABLE_BROWSER_EXTENSION = "1";
		const enabled = loadPaths();
		assert.ok(enabled.some((entry) => entry.includes(`${sep}browser${sep}`)), "env switch should enable browser.");
		const browserAt = enabled.findIndex((entry) => entry.includes(`${sep}browser${sep}`));
		const linkWorldAt = enabled.findIndex((entry) => entry.includes(`${sep}link-world${sep}`));
		const securityAt = enabled.findIndex((entry) => entry.includes(`${sep}security-audit${sep}`));
		assert.ok(browserAt > linkWorldAt && browserAt < securityAt, "browser must keep its planned position.");
	} finally {
		if (previous === undefined) delete process.env.CATUI_ENABLE_BROWSER_EXTENSION;
		else process.env.CATUI_ENABLE_BROWSER_EXTENSION = previous;
	}
});

test("nanomem keeps package-precedence resolution ahead of node_modules", () => {
	const nanoMem = loadPaths().find((entry) => entry.replaceAll(sep, "/").includes("mem-core"));
	assert.ok(nanoMem, "Expected NanoMem to resolve through the package path.");
	assert.ok(
		nanoMem!.replaceAll(sep, "/").includes("packages/mem-core"),
		`Expected the workspace/bundled mem-core path, got: ${nanoMem}`,
	);
});

test("evolution loads from optional/ without moving its source directory", () => {
	const evolution = loadPaths().find((entry) => entry.replaceAll(sep, "/").includes("/optional/evolution/"));
	assert.ok(evolution, "Expected evolution to load from extensions/optional/evolution/.");
	assert.ok(existsSync(join(REPO_ROOT, "extensions", "optional", "evolution", "index.ts")));
});

test("opt-in extensions stay out of the default load and keep their metadata", () => {
	for (const id of ["simplify", "export-html"]) {
		const metadata = builtInExtensions.find((e) => e.id === id);
		assert.ok(metadata, `${id} must keep its metadata descriptor.`);
		assert.equal(metadata?.defaultEnabled, false);
		assert.equal(metadata?.category, "optional");
		assert.equal(loadedIds().includes(id), false, `${id} must not load by default.`);
	}
});

test("every extensions/builtin directory is registered, and non-opt-in ones load", () => {
	const optIn = new Set(builtInExtensions.filter((e) => !e.defaultEnabled).map((e) => e.id));
	const directories = readdirSync(join(REPO_ROOT, "extensions", "builtin"))
		.filter((entry) => statSync(join(REPO_ROOT, "extensions", "builtin", entry)).isDirectory());
	const loaded = new Set(loadedIds());
	for (const directory of directories) {
		assert.ok(
			builtInExtensions.some((extension) => extension.id === directory),
			`extensions/builtin/${directory} has no registry entry.`,
		);
		if (optIn.has(directory)) continue;
		assert.ok(loaded.has(directory), `extensions/builtin/${directory} is registered but did not load.`);
	}
});
