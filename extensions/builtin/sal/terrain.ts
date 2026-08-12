/**
 * [WHO]: TerrainNode, TerrainEdge, TerrainSnapshot, buildTerrainIndex(), checkDipCoverage(), CoverageReport
 * [FROM]: Depends on node:fs/promises, node:path
 * [TO]: Consumed by extensions/builtin/sal/anchors.ts, extensions/builtin/sal/index.ts
 * [HERE]: extensions/builtin/sal/terrain.ts - terrain graph builder from DIP P2/P3 headers
 */

import { open, opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse, relative, resolve, sep } from "node:path";

/**
 * Yield control back to Node's event loop so pending process.nextTick
 * callbacks (notably TUI render frames) can run between batches of fs work.
 * Without this, a full workspace scan can block stdout flushes long enough
 * for GPU block-terminals (e.g. Warp) to coalesce an entire turn into one
 * block and render it only at the end.
 */
async function yieldToEventLoop(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}

export type TerrainNodeKind = "root" | "module" | "file";

export interface TerrainNode {
	id: string; // canonical: posix-style relative path from workspace root
	kind: TerrainNodeKind;
	label: string;
	modulePath?: string; // posix-style module dir path
	filePath?: string; // posix-style file path
	// Parsed P3 fields when kind === "file"
	p3Who?: string;
	p3From?: string;
	p3To?: string;
	p3Here?: string;
	hasP3: boolean;
	// Parsed P2 summary line(s) when kind === "module"
	p2Summary?: string;
	mtimeMs: number;
}

export interface TerrainEdge {
	fromId: string;
	toId: string;
	type: "contains" | "adjacent-to";
}

export interface TerrainSnapshot {
	workspaceRoot: string;
	generatedAt: number;
	nodes: TerrainNode[];
	edges: TerrainEdge[];
	// fileId -> moduleId index for fast lookup
	moduleByFile: Record<string, string>;
	scan: TerrainScanStats;
}

export interface TerrainScanOptions {
	maxDirectories?: number;
	maxCandidateFiles?: number;
	maxFileBytes?: number;
	maxDurationMs?: number;
}

export interface TerrainScanStats {
	directoriesVisited: number;
	peakPendingDirectories: number;
	candidateFiles: number;
	truncatedFiles: number;
	durationMs: number;
	truncated: boolean;
	reason?: "unsafe-workspace-root" | "directory-budget" | "candidate-file-budget" | "time-budget";
}

export interface CoverageReport {
	module: string;
	totalFiles: number;
	filesWithP3: number;
	coveragePct: number;
	hasP2: boolean;
	missingFields: number; // count of files where any of WHO/FROM/TO/HERE empty
}

const IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".cache",
	"coverage",
	".memory-experiments",
	".catui",
	".catui",
	"out",
	".turbo",
]);

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);

const DEFAULT_SCAN_OPTIONS: Required<TerrainScanOptions> = {
	maxDirectories: 10_000,
	maxCandidateFiles: 50_000,
	maxFileBytes: 64 * 1024,
	maxDurationMs: 5_000,
};

/** P2 module map files: prefer AGENT.md; CLAUDE.md supported for legacy trees. */
const DIP_MODULE_MAP_FILENAMES = ["AGENT.md", "CLAUDE.md"] as const;

function dipModuleMapFileName(rel: string): (typeof DIP_MODULE_MAP_FILENAMES)[number] | undefined {
	for (const name of DIP_MODULE_MAP_FILENAMES) {
		if (rel === name || rel.endsWith(`/${name}`)) return name;
	}
	return undefined;
}

function toPosix(p: string): string {
	return p.split(sep).join("/");
}

interface WalkEntry {
	abs: string;
	rel: string; // posix-style
	mtimeMs: number;
	size: number;
}

interface WalkResult {
	files: WalkEntry[];
	scan: TerrainScanStats;
}

function isTerrainCandidate(name: string): boolean {
	if ((DIP_MODULE_MAP_FILENAMES as readonly string[]).includes(name)) return true;
	const dotIdx = name.lastIndexOf(".");
	return dotIdx >= 0 && SOURCE_EXTS.has(name.slice(dotIdx));
}

function resolveScanOptions(options?: TerrainScanOptions): Required<TerrainScanOptions> {
	return {
		maxDirectories: Math.max(1, options?.maxDirectories ?? DEFAULT_SCAN_OPTIONS.maxDirectories),
		maxCandidateFiles: Math.max(1, options?.maxCandidateFiles ?? DEFAULT_SCAN_OPTIONS.maxCandidateFiles),
		maxFileBytes: Math.max(1, options?.maxFileBytes ?? DEFAULT_SCAN_OPTIONS.maxFileBytes),
		maxDurationMs: Math.max(1, options?.maxDurationMs ?? DEFAULT_SCAN_OPTIONS.maxDurationMs),
	};
}

function isUnsafeWorkspaceRoot(workspaceRoot: string): boolean {
	const absoluteRoot = resolve(workspaceRoot);
	return absoluteRoot === parse(absoluteRoot).root || absoluteRoot === resolve(homedir());
}

function emptyTerrainSnapshot(workspaceRoot: string, reason: TerrainScanStats["reason"]): TerrainSnapshot {
	return {
		workspaceRoot,
		generatedAt: Date.now(),
		nodes: [],
		edges: [],
		moduleByFile: {},
		scan: {
			directoriesVisited: 0,
			peakPendingDirectories: 0,
			candidateFiles: 0,
			truncatedFiles: 0,
			durationMs: 0,
			truncated: true,
			reason,
		},
	};
}

async function walkAsync(
	root: string,
	options: Required<TerrainScanOptions>,
	startedAt: number,
): Promise<WalkResult> {
	const files: WalkEntry[] = [];
	const stack: string[] = [root];
	const scan: TerrainScanStats = {
		directoriesVisited: 0,
		peakPendingDirectories: 1,
		candidateFiles: 0,
		truncatedFiles: 0,
		durationMs: 0,
		truncated: false,
	};
	while (stack.length > 0) {
		if (performance.now() - startedAt >= options.maxDurationMs) {
			scan.truncated = true;
			scan.reason = "time-budget";
			break;
		}
		if (scan.directoriesVisited >= options.maxDirectories) {
			scan.truncated = true;
			scan.reason = "directory-budget";
			break;
		}
		const current = stack.pop();
		if (!current) break;
		scan.directoriesVisited += 1;
		let directory: Awaited<ReturnType<typeof opendir>>;
		try {
			directory = await opendir(current);
		} catch {
			continue;
		}
		for await (const entry of directory) {
			if (performance.now() - startedAt >= options.maxDurationMs) {
				scan.truncated = true;
				scan.reason = "time-budget";
				break;
			}
			if (entry.name.startsWith(".") && entry.name !== ".") {
				if (entry.isDirectory()) continue;
			}
			if (entry.isDirectory()) {
				if (IGNORED_DIRS.has(entry.name)) continue;
				if (scan.directoriesVisited + stack.length >= options.maxDirectories) {
					scan.truncated = true;
					scan.reason ??= "directory-budget";
					continue;
				}
				stack.push(join(current, entry.name));
				scan.peakPendingDirectories = Math.max(scan.peakPendingDirectories, stack.length);
			} else if (entry.isFile() && isTerrainCandidate(entry.name)) {
				if (files.length >= options.maxCandidateFiles) {
					scan.truncated = true;
					scan.reason = "candidate-file-budget";
					break;
				}
				const abs = join(current, entry.name);
				const rel = toPosix(relative(root, abs));
				try {
					const fileStat = await stat(abs);
					files.push({ abs, rel, mtimeMs: fileStat.mtimeMs, size: fileStat.size });
				} catch {
					files.push({ abs, rel, mtimeMs: 0, size: 0 });
				}
			}
		}
		if (scan.reason === "candidate-file-budget" || scan.reason === "time-budget") break;
		if (scan.directoriesVisited % 16 === 0) await yieldToEventLoop();
	}
	scan.candidateFiles = files.length;
	scan.durationMs = Math.round(performance.now() - startedAt);
	return { files, scan };
}

async function readFilePrefix(file: WalkEntry, maxFileBytes: number, scan: TerrainScanStats): Promise<string> {
	const bytesToRead = Math.min(file.size, maxFileBytes);
	if (file.size > maxFileBytes) scan.truncatedFiles += 1;
	if (bytesToRead <= 0) return "";
	const handle = await open(file.abs, "r");
	try {
		const buffer = Buffer.allocUnsafe(bytesToRead);
		const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
		return buffer.toString("utf8", 0, bytesRead);
	} finally {
		await handle.close();
	}
}

const P3_BLOCK_RE = /\/\*\*([\s\S]*?)\*\//;

interface P3Fields {
	who?: string;
	from?: string;
	to?: string;
	here?: string;
}

function parseP3Header(content: string): P3Fields | undefined {
	const match = content.match(P3_BLOCK_RE);
	if (!match) return undefined;
	const block = match[1];
	if (!/\[WHO\]|\[FROM\]|\[TO\]|\[HERE\]/.test(block)) return undefined;
	const lines = block.split("\n").map((l) => l.replace(/^\s*\*\s?/, "").trim());
	const fields: P3Fields = {};
	let currentKey: keyof P3Fields | undefined;
	for (const line of lines) {
		const tagMatch = line.match(/^\[(WHO|FROM|TO|HERE)\]:\s*(.*)$/);
		if (tagMatch) {
			currentKey = tagMatch[1].toLowerCase() as keyof P3Fields;
			fields[currentKey] = tagMatch[2].trim();
		} else if (currentKey && line.length > 0) {
			fields[currentKey] = `${fields[currentKey] ?? ""} ${line}`.trim();
		}
	}
	return fields;
}

function parseP2Summary(content: string): string | undefined {
	// Take the first non-empty paragraph below "## Overview" or the first H2 description.
	const lines = content.split("\n");
	let inOverview = false;
	const buf: string[] = [];
	for (const line of lines) {
		if (/^##\s+Overview/i.test(line)) {
			inOverview = true;
			continue;
		}
		if (inOverview) {
			if (/^##\s+/.test(line)) break;
			if (line.trim().length > 0) buf.push(line.trim());
			if (buf.join(" ").length > 400) break;
		}
	}
	if (buf.length > 0) return buf.join(" ").slice(0, 400);
	// Fallback: first non-header non-empty line
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith("#") || trimmed.startsWith(">")) continue;
		return trimmed.slice(0, 400);
	}
	return undefined;
}

/**
 * Build a terrain index from a workspace root.
 * Coarse, file/module-level only. Symbol-level deferred.
 *
 * Async by design: walks the filesystem and reads DIP headers without blocking
 * the Node event loop, so TUI render frames (e.g. the user's message bubble
 * queued via process.nextTick right before session.prompt()) can flush between
 * fs operations. A synchronous implementation holds stdout long enough that
 * GPU block terminals (Warp) coalesce a whole turn into a single block and
 * only render it when the turn ends.
 */
export async function buildTerrainIndex(
	workspaceRoot: string,
	options?: TerrainScanOptions,
): Promise<TerrainSnapshot> {
	if (isUnsafeWorkspaceRoot(workspaceRoot)) return emptyTerrainSnapshot(workspaceRoot, "unsafe-workspace-root");
	const scanOptions = resolveScanOptions(options);
	const startedAt = performance.now();
	const { files, scan } = await walkAsync(workspaceRoot, scanOptions, startedAt);
	const nodes: TerrainNode[] = [];
	const edges: TerrainEdge[] = [];
	const moduleByFile: Record<string, string> = {};

	const moduleNodes = new Map<string, TerrainNode>();
	const fileNodes: TerrainNode[] = [];

	// Pass 1: P2 module nodes from AGENT.md (or legacy CLAUDE.md) files
	let pass1Count = 0;
	for (const f of files) {
		if (performance.now() - startedAt >= scanOptions.maxDurationMs) {
			scan.truncated = true;
			scan.reason = "time-budget";
			break;
		}
		const dipName = dipModuleMapFileName(f.rel);
		if (!dipName) continue;
		const modulePath = f.rel === dipName ? "" : f.rel.slice(0, f.rel.length - dipName.length - 1);
		let p2Summary: string | undefined;
		try {
			const content = await readFilePrefix(f, scanOptions.maxFileBytes, scan);
			p2Summary = parseP2Summary(content);
		} catch {
			// ignore
		}
		const id = modulePath || "<root>";
		const node: TerrainNode = {
			id,
			kind: modulePath ? "module" : "root",
			label: modulePath || "<root>",
			modulePath: modulePath || undefined,
			p2Summary,
			hasP3: false,
			mtimeMs: f.mtimeMs,
		};
		moduleNodes.set(id, node);
		nodes.push(node);
		if (++pass1Count % 32 === 0) await yieldToEventLoop();
	}

	// Pass 2: file nodes for source files
	let pass2Count = 0;
	for (const f of files) {
		if (performance.now() - startedAt >= scanOptions.maxDurationMs) {
			scan.truncated = true;
			scan.reason = "time-budget";
			break;
		}
		const dotIdx = f.rel.lastIndexOf(".");
		if (dotIdx < 0) continue;
		const ext = f.rel.slice(dotIdx);
		if (!SOURCE_EXTS.has(ext)) continue;

		let p3: P3Fields | undefined;
		try {
			const content = await readFilePrefix(f, scanOptions.maxFileBytes, scan);
			p3 = parseP3Header(content);
		} catch {
			// ignore unreadable files
		}

		// Find nearest module ancestor (longest matching modulePath)
		let bestModuleId = "<root>";
		let bestLen = -1;
		for (const m of moduleNodes.values()) {
			const mp = m.modulePath ?? "";
			if (mp === "" && bestLen < 0) bestModuleId = "<root>";
			if (mp && f.rel.startsWith(`${mp}/`) && mp.length > bestLen) {
				bestModuleId = m.id;
				bestLen = mp.length;
			}
		}

		const node: TerrainNode = {
			id: f.rel,
			kind: "file",
			label: f.rel,
			modulePath: moduleNodes.get(bestModuleId)?.modulePath,
			filePath: f.rel,
			p3Who: p3?.who,
			p3From: p3?.from,
			p3To: p3?.to,
			p3Here: p3?.here,
			hasP3: Boolean(p3),
			mtimeMs: f.mtimeMs,
		};
		fileNodes.push(node);
		nodes.push(node);
		moduleByFile[node.id] = bestModuleId;
		edges.push({ fromId: bestModuleId, toId: node.id, type: "contains" });
		if (++pass2Count % 32 === 0) await yieldToEventLoop();
	}

	scan.durationMs = Math.round(performance.now() - startedAt);
	return {
		workspaceRoot,
		generatedAt: Date.now(),
		nodes,
		edges,
		moduleByFile,
		scan,
	};
}

/**
 * Check DIP coverage for the requested module list.
 * Each module string is a posix-style path relative to workspace root, e.g. "core/runtime".
 * If modules is empty, all known modules are reported.
 */
export function checkDipCoverage(snapshot: TerrainSnapshot, modules: string[]): CoverageReport[] {
	const reports: CoverageReport[] = [];
	const requested = modules.length > 0 ? modules : null;
	const moduleIds = snapshot.nodes
		.filter((n) => n.kind === "module" || n.kind === "root")
		.map((n) => n.modulePath ?? "");
	const targets = requested ?? moduleIds;

	for (const mp of targets) {
		const moduleNode = snapshot.nodes.find(
			(n) => (n.kind === "module" || n.kind === "root") && (n.modulePath ?? "") === mp,
		);
		const filesInModule = snapshot.nodes.filter(
			(n) => n.kind === "file" && (n.modulePath ?? "") === mp,
		);
		const totalFiles = filesInModule.length;
		const filesWithP3 = filesInModule.filter((n) => n.hasP3).length;
		const missingFields = filesInModule.filter(
			(n) => n.hasP3 && (!n.p3Who || !n.p3From || !n.p3To || !n.p3Here),
		).length;
		reports.push({
			module: mp || "<root>",
			totalFiles,
			filesWithP3,
			coveragePct: totalFiles === 0 ? 0 : Math.round((filesWithP3 / totalFiles) * 1000) / 10,
			hasP2: Boolean(moduleNode),
			missingFields,
		});
	}

	return reports;
}

/**
 * Determine whether the snapshot is stale relative to current DIP files.
 * Returns true when any AGENT.md (or legacy CLAUDE.md) or source file mtime exceeds snapshot.generatedAt.
 *
 * Async to avoid blocking the event loop during the staleness probe that runs
 * at the top of every before_agent_start hook.
 */
export async function isSnapshotStale(
	snapshot: TerrainSnapshot,
	options?: TerrainScanOptions,
): Promise<boolean> {
	if (isUnsafeWorkspaceRoot(snapshot.workspaceRoot)) return false;
	const scanOptions = resolveScanOptions(options);
	const startedAt = performance.now();
	const stack: string[] = [snapshot.workspaceRoot];
	let directoriesVisited = 0;
	let candidateFiles = 0;
	while (stack.length > 0) {
		if (performance.now() - startedAt >= scanOptions.maxDurationMs) return false;
		if (directoriesVisited >= scanOptions.maxDirectories) return false;
		const current = stack.pop();
		if (!current) break;
		directoriesVisited += 1;
		let directory: Awaited<ReturnType<typeof opendir>>;
		try {
			directory = await opendir(current);
		} catch {
			continue;
		}
		for await (const entry of directory) {
			if (performance.now() - startedAt >= scanOptions.maxDurationMs) return false;
			if (entry.isDirectory()) {
				if (IGNORED_DIRS.has(entry.name)) continue;
				if (entry.name.startsWith(".")) continue;
				if (directoriesVisited + stack.length >= scanOptions.maxDirectories) continue;
				stack.push(join(current, entry.name));
				continue;
			}
			if (!entry.isFile() || !isTerrainCandidate(entry.name)) continue;
			if (candidateFiles >= scanOptions.maxCandidateFiles) return false;
			candidateFiles += 1;
			try {
				if ((await stat(join(current, entry.name))).mtimeMs > snapshot.generatedAt) return true;
			} catch {
				// Ignore files that disappear during the scan.
			}
		}
		if (directoriesVisited % 16 === 0) await yieldToEventLoop();
	}
	return false;
}

/**
 * Look up the module id that contains a given relative file path.
 * Used by action evidence accumulation to map touched files back to anchors.
 */
export function moduleIdForPath(snapshot: TerrainSnapshot, relPath: string): string | undefined {
	const posix = toPosix(relPath);
	if (snapshot.moduleByFile[posix]) return snapshot.moduleByFile[posix];
	// Best-effort longest module prefix match for paths not in the index yet.
	let best: string | undefined;
	let bestLen = -1;
	for (const node of snapshot.nodes) {
		if (node.kind !== "module") continue;
		const mp = node.modulePath ?? "";
		if (mp && posix.startsWith(`${mp}/`) && mp.length > bestLen) {
			best = node.id;
			bestLen = mp.length;
		}
	}
	return best;
}

export function toPosixPath(p: string): string {
	return toPosix(p);
}
