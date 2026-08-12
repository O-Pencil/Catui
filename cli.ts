#!/usr/bin/env node
/**
 * [WHO]: CLI entry point, sets process.title, calls main()
 * [FROM]: Depends on main.ts
 * [TO]: Consumed by bin/catui and bin/catui (npm binaries)
 * [HERE]: Entry point; orchestrates argument parsing and mode selection
 */
process.title = "catui";

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installOutputDisconnectHandlers } from "./cli/output-disconnect.js";

installOutputDisconnectHandlers();

const args = process.argv.slice(2);

// Fast path: --version, --help don't need full module loading
if (args.includes("--version")) {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	// In dev, package.json is in project root; in bundle, it's two levels up from dist/cli.js
	const pkgPath = __dirname.endsWith("dist") ? join(__dirname, "..", "package.json") : join(__dirname, "package.json");
	const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
	console.log(pkg.version);
	process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
	console.log(`Catui AI coding agent`);
	console.log(`Usage: catui [options]`);
	console.log(`       catui [command] [options]`);
	console.log(`Options:`);
	console.log(`  --version    Show version`);
	console.log(`  --help, -h   Show this help`);
	process.exit(0);
}

// Dynamic import: ESM static imports are hoisted to the top of the module, so
// `import { main } from "./main.js"` would pull main.js's entire dependency
// graph (≈2.4k modules, including TUI, AI SDKs, highlight.js) before the
// fast-path short-circuits above could run. With dynamic import, --version /
// --help finish in <200 ms instead of paying the full 9-15 s boot cost.
const { main } = await import("./main.js");
main(args);
