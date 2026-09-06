import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();
const DIST_ROOT = join(ROOT, "dist");

function ensureDir(path) {
	if (!existsSync(path)) {
		mkdirSync(path, { recursive: true });
	}
}

function copyTreeAssets(srcDir, destDir, options = {}) {
	if (!existsSync(srcDir)) {
		return;
	}

	ensureDir(destDir);

	for (const entry of readdirSync(srcDir)) {
		const srcPath = join(srcDir, entry);
		const destPath = join(destDir, entry);
		const stats = statSync(srcPath);

		if (stats.isDirectory()) {
			copyTreeAssets(srcPath, destPath, options);
			continue;
		}

		const extension = extname(entry);
		if (options.skipExtensions?.has(extension)) {
			continue;
		}

		ensureDir(join(destPath, ".."));
		cpSync(srcPath, destPath);
	}
}

const extensionRoots = [
	join(ROOT, "extensions", "builtin"),
	join(ROOT, "extensions", "optional"),
];

for (const srcRoot of extensionRoots) {
	copyTreeAssets(srcRoot, join(DIST_ROOT, relative(ROOT, srcRoot)), {
		skipExtensions: new Set([".ts"]),
	});
}

copyTreeAssets(join(ROOT, "core", "export-html"), join(DIST_ROOT, "core", "export-html"), {
	skipExtensions: new Set([".ts"]),
});

// Mobile web UI for remote serve mode (built by scripts/build-mobile-web.js).
// Source is gitignored and only present after a mobile web build — skip silently.
copyTreeAssets(join(ROOT, "modes", "remote", "public"), join(DIST_ROOT, "modes", "remote", "public"));

console.log("Runtime assets copied to dist/");
