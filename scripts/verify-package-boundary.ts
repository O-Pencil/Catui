/**
 * [WHO]: Provides verify-package-boundary CLI for P7 package/publication invariants
 * [FROM]: Depends on node:child_process, node:fs/path/module/url only; no project runtime imports
 * [TO]: Consumed by release maintainers before npm beta publish and install smoke
 * [HERE]: scripts/verify-package-boundary.ts - executable guard for public package vs embedded-lib boundaries
 */

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;
type PackageJson = JsonObject & {
	name?: string;
	version?: string;
	private?: boolean;
	files?: unknown;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	publishConfig?: { access?: string };
};

interface Violation {
	scope: string;
	message: string;
}

interface PublicPackageSpec {
	name: string;
	path: string;
	hostRange: string;
	requiredExports?: string[];
}

interface InternalLibSpec {
	name: string;
	path: string;
	entry: string;
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_MAIN = join(REPO, "dist", "main.js");
const PUBLIC_PACKAGES: PublicPackageSpec[] = [
	{ name: "catui-protocol", path: "packages/protocol", hostRange: "^0.1.1" },
	{ name: "catui-mem", path: "packages/mem-core", hostRange: "^1.1.2", requiredExports: [".", "./extension"] },
];
const INTERNAL_LIBS: InternalLibSpec[] = [
	{ name: "@catui/ai", path: "core/lib/ai", entry: "dist/index.js" },
	{ name: "@catui/agent-core", path: "core/lib/agent-core", entry: "dist/index.js" },
	{ name: "@catui/tui", path: "core/lib/tui", entry: "dist/index.js" },
];
const ROOT_PACKAGE_FILES = ["dist/**/*.js", "dist/**/*.d.ts", "dist/**/*.json"];
const PROD_DEP_SECTIONS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

function toRepoPath(abs: string): string {
	return normalize(relative(REPO, abs)).replaceAll("\\", "/");
}

function readJson(path: string): PackageJson {
	return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function dependencyMap(pkg: PackageJson, section: (typeof PROD_DEP_SECTIONS)[number]): Record<string, string> {
	const value = pkg[section];
	return isRecord(value) ? (value as Record<string, string>) : {};
}

function add(violations: Violation[], scope: string, message: string): void {
	violations.push({ scope, message });
}

function checkRootManifest(violations: Violation[]): void {
	const root = readJson(join(REPO, "package.json"));
	const rootDeps = dependencyMap(root, "dependencies");
	const rootFiles = new Set(asStringArray(root.files));

	for (const requiredFile of ROOT_PACKAGE_FILES) {
		if (!rootFiles.has(requiredFile)) {
			add(violations, "package.json", `files must include ${requiredFile} so embedded dist packages are published.`);
		}
	}

	for (const publicPackage of PUBLIC_PACKAGES) {
		if (rootDeps[publicPackage.name] !== publicPackage.hostRange) {
			add(
				violations,
				"package.json",
				`dependency ${publicPackage.name} must be ${publicPackage.hostRange}; found ${rootDeps[publicPackage.name] ?? "<missing>"}.`,
			);
		}
	}

	for (const internalLib of INTERNAL_LIBS) {
		for (const section of PROD_DEP_SECTIONS) {
			const deps = dependencyMap(root, section);
			if (deps[internalLib.name]) {
				add(
					violations,
					"package.json",
					`host ${section} must not publish-resolve private internal lib ${internalLib.name}; embed it via copy:internal-libs.`,
				);
			}
		}
	}
}

function checkSourcePackageManifests(violations: Violation[]): void {
	const publicNames = new Set(PUBLIC_PACKAGES.map((pkg) => pkg.name));
	const internalNames = new Set(INTERNAL_LIBS.map((pkg) => pkg.name));

	for (const publicPackage of PUBLIC_PACKAGES) {
		const scope = `${publicPackage.path}/package.json`;
		const pkg = readJson(join(REPO, publicPackage.path, "package.json"));
		if (pkg.name !== publicPackage.name) {
			add(violations, scope, `name must be ${publicPackage.name}; found ${pkg.name ?? "<missing>"}.`);
		}
		if (pkg.publishConfig?.access !== "public") {
			add(violations, scope, "scoped public package must declare publishConfig.access = public.");
		}
		for (const requiredExport of publicPackage.requiredExports ?? []) {
			const exportsValue = pkg.exports;
			if (!isRecord(exportsValue) || !(requiredExport in exportsValue)) {
				add(violations, scope, `exports must include ${requiredExport}.`);
			}
		}
		for (const section of PROD_DEP_SECTIONS) {
			const deps = dependencyMap(pkg, section);
			for (const depName of Object.keys(deps)) {
				if (depName === "catui-agent") {
					add(violations, scope, `${section} must not depend on the host package; use catui-protocol.`);
				}
				if (internalNames.has(depName)) {
					add(violations, scope, `${section} must not expose private embedded lib ${depName}.`);
				}
			}
		}
	}

	for (const internalLib of INTERNAL_LIBS) {
		const scope = `${internalLib.path}/package.json`;
		const pkg = readJson(join(REPO, internalLib.path, "package.json"));
		if (pkg.name !== internalLib.name) {
			add(violations, scope, `name must be ${internalLib.name}; found ${pkg.name ?? "<missing>"}.`);
		}
		if (pkg.private !== true) {
			add(violations, scope, "internal lib must remain private and embedded by the host package.");
		}
		for (const section of PROD_DEP_SECTIONS) {
			const deps = dependencyMap(pkg, section);
			for (const depName of Object.keys(deps)) {
				if (publicNames.has(depName)) {
					add(violations, scope, `${section} must not depend on public host plugin package ${depName}.`);
				}
			}
		}
	}
}

function checkSanitizedEmbeddedPackage(scope: string, pkg: PackageJson, violations: Violation[]): void {
	for (const forbidden of ["private", "scripts", "devDependencies", "files", "bin"]) {
		if (forbidden in pkg) {
			add(violations, scope, `embedded package.json must not include ${forbidden}.`);
		}
	}

	const exportsValue = pkg.exports;
	if (!isRecord(exportsValue)) return;
	for (const [key, value] of Object.entries(exportsValue)) {
		if (!isRecord(value)) continue;
		if (typeof value.import === "string" && value.default !== value.import) {
			add(violations, scope, `exports.${key} must include default equal to import for require.resolve compatibility.`);
		}
	}
}

function checkDist(violations: Violation[]): void {
	if (!existsSync(DIST_MAIN)) {
		add(violations, "dist/main.js", "missing dist/main.js; run npm run build on a capable machine before --dist validation.");
		return;
	}

	for (const internalLib of INTERNAL_LIBS) {
		const targetDir = join(REPO, "dist", "node_modules", ...internalLib.name.split("/"));
		const packageJsonPath = join(targetDir, "package.json");
		const entryPath = join(targetDir, internalLib.entry);
		const scope = toRepoPath(packageJsonPath);
		if (!existsSync(packageJsonPath)) {
			add(violations, scope, `embedded package.json for ${internalLib.name} is missing.`);
			continue;
		}
		if (!existsSync(entryPath)) {
			add(violations, toRepoPath(entryPath), `embedded entry for ${internalLib.name} is missing.`);
		}
		const pkg = readJson(packageJsonPath);
		checkSanitizedEmbeddedPackage(scope, pkg, violations);
		const resolved = resolveFromDistWithoutLoaders(internalLib.name);
		if (toRepoPath(resolved) !== toRepoPath(entryPath)) {
			add(violations, scope, `${internalLib.name} resolves to ${toRepoPath(resolved)} instead of ${toRepoPath(entryPath)}.`);
		}
	}

	const memCoreDist = join(REPO, "packages", "mem-core", "dist");
	for (const file of ["extension.js", "config.js"]) {
		const abs = join(memCoreDist, file);
		if (!existsSync(abs)) {
			add(violations, toRepoPath(abs), `mem-core published dist must include ${file}.`);
		}
	}
}

function resolveFromDistWithoutLoaders(specifier: string): string {
	const code = [
		"const { createRequire } = require('node:module');",
		`const req = createRequire(${JSON.stringify(DIST_MAIN)});`,
		`process.stdout.write(req.resolve(${JSON.stringify(specifier)}));`,
	].join("\n");
	return execFileSync(process.execPath, ["-e", code], {
		cwd: REPO,
		encoding: "utf8",
	});
}

function main(): void {
	const withDist = process.argv.includes("--dist");
	const violations: Violation[] = [];
	checkRootManifest(violations);
	checkSourcePackageManifests(violations);
	if (withDist) checkDist(violations);

	if (violations.length > 0) {
		console.error(`verify-package-boundary failed: ${violations.length} violation(s)`);
		for (const violation of violations) {
			console.error(`- ${violation.scope}: ${violation.message}`);
		}
		process.exit(1);
	}

	console.log(`verify-package-boundary passed (${withDist ? "static + dist" : "static"} checks)`);
}

main();
