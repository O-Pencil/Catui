/**
 * [WHO]: StructuralAnchor, AnchorResolution, locateTask(), locateAction(), scoreNode()
 * [FROM]: Depends on extensions/builtin/sal/terrain.ts, extensions/builtin/sal/weights.ts
 * [TO]: Consumed by extensions/builtin/sal/index.ts
 * [HERE]: extensions/builtin/sal/anchors.ts - evidence-driven anchor inference and scoring
 */

import { moduleIdForPath, toPosixPath, type TerrainNode, type TerrainSnapshot } from "./terrain.js";
import type { SalWeights } from "./weights.js";

export interface StructuralAnchor {
	workspaceId: string;
	modulePath?: string;
	filePath?: string;
	confidence: number;
	source: Array<"prompt" | "tool" | "file" | "p3" | "import-graph" | "manual">;
}

export interface AnchorCandidate {
	anchor: StructuralAnchor;
	score: number;
	reasons: string[];
}

export type AnchorTargetKind = "task" | "memory" | "action";

export interface AnchorResolution {
	targetKind: AnchorTargetKind;
	candidates: AnchorCandidate[];
	selected?: StructuralAnchor;
	unresolvedSignals?: string[];
}

const FILE_HINT_RE = /[\w./-]+\.(ts|tsx|js|jsx|md|json)/g;
const PATH_HINT_RE = /\b([a-zA-Z][\w-]*\/[\w/.-]+)/g;
const STOPWORDS = new Set([
	"the",
	"and",
	"for",
	"with",
	"this",
	"that",
	"from",
	"into",
	"about",
	"please",
	"file",
	"files",
	"code",
	"function",
	"module",
	"a",
	"an",
	"of",
	"to",
	"in",
	"on",
	"is",
	"how",
	"why",
	"what",
	"when",
	"can",
	"you",
	"i",
	"we",
	"it",
]);

// CJK Unified Ideographs block (basic): U+4E00–U+9FFF
const CJK_RE = /[\u4e00-\u9fff]+/g;

function tokenize(text: string): string[] {
	const ascii = text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 2 && !STOPWORDS.has(t));
	// Also extract CJK bigrams so Chinese prompts can score against Chinese P2 summaries
	const cjkBigrams: string[] = [];
	for (const block of text.match(CJK_RE) ?? []) {
		for (let i = 0; i < block.length - 1; i++) {
			cjkBigrams.push(block.slice(i, i + 2));
		}
		if (block.length === 1) cjkBigrams.push(block);
	}
	return [...ascii, ...cjkBigrams];
}

function normalizeRel(workspaceRoot: string, p: string): string {
	const posix = toPosixPath(p);
	const root = toPosixPath(workspaceRoot);
	if (posix.startsWith(`${root}/`)) return posix.slice(root.length + 1);
	if (posix === root) return "";
	return posix;
}

interface PromptSignals {
	mentionedFiles: string[];
	mentionedPaths: string[];
	tokens: string[];
}

function extractSignals(prompt: string): PromptSignals {
	const mentionedFiles = Array.from(new Set(prompt.match(FILE_HINT_RE) ?? []));
	const mentionedPaths = Array.from(
		new Set((prompt.match(PATH_HINT_RE) ?? []).filter((p) => !mentionedFiles.includes(p))),
	);
	const tokens = tokenize(prompt);
	return { mentionedFiles, mentionedPaths, tokens };
}

interface ScoringContext {
	snapshot: TerrainSnapshot;
	weights: SalWeights;
	signals: PromptSignals;
	explicitFilePaths: Set<string>; // posix-relative paths that came from tool args / explicit mentions
}

function scoreNode(ctx: ScoringContext, node: TerrainNode): { score: number; reasons: string[] } | null {
	if (node.kind === "root") return null;
	const reasons: string[] = [];
	const w = ctx.weights;

	// directFileEvidence: explicit file path matches the node's file or contains it
	let directFileEvidence = 0;
	if (node.filePath) {
		if (ctx.explicitFilePaths.has(node.filePath)) {
			directFileEvidence = 1;
			reasons.push(`tool/explicit reference to ${node.filePath}`);
		} else {
			for (const mention of ctx.signals.mentionedFiles) {
				if (node.filePath.endsWith(mention)) {
					directFileEvidence = Math.max(directFileEvidence, 0.9);
					reasons.push(`prompt mentions filename '${mention}'`);
					break;
				}
			}
		}
	} else if (node.modulePath) {
		// module nodes inherit a fraction when an explicit file lives inside them
		for (const fp of ctx.explicitFilePaths) {
			if (fp.startsWith(`${node.modulePath}/`)) {
				directFileEvidence = Math.max(directFileEvidence, 0.6);
				reasons.push(`tool/explicit reference inside ${node.modulePath}`);
				break;
			}
		}
	}

	// moduleResponsibilityMatch: prompt token overlap with module path segments + p2 summary
	let moduleResponsibilityMatch = 0;
	if (node.modulePath) {
		const segments = node.modulePath.split("/").map((s) => s.toLowerCase());
		const summaryTokens = node.p2Summary ? tokenize(node.p2Summary) : [];
		const matched =
			segments.filter((s) => ctx.signals.tokens.includes(s)).length +
			summaryTokens.filter((t) => ctx.signals.tokens.includes(t)).length;
		const denom = Math.max(1, segments.length + Math.min(8, summaryTokens.length));
		moduleResponsibilityMatch = Math.min(1, matched / denom);
		if (matched > 0) reasons.push(`module path/summary token overlap=${matched}`);
	}

	// dipContractMatch: prompt token overlap with P3 WHO/FROM/TO/HERE
	let dipContractMatch = 0;
	if (node.kind === "file" && node.hasP3) {
		const p3Text = [node.p3Who, node.p3From, node.p3To, node.p3Here].filter(Boolean).join(" ");
		const p3Tokens = tokenize(p3Text);
		const matched = p3Tokens.filter((t) => ctx.signals.tokens.includes(t)).length;
		dipContractMatch = Math.min(1, matched / Math.max(8, p3Tokens.length / 2));
		if (matched > 0) reasons.push(`P3 contract token overlap=${matched}`);
	}

	// importNeighborhoodMatch: P3 [FROM]/[TO] mentions another node in explicitFilePaths
	let importNeighborhoodMatch = 0;
	if (node.kind === "file" && node.hasP3) {
		const fromTo = `${node.p3From ?? ""} ${node.p3To ?? ""}`;
		for (const fp of ctx.explicitFilePaths) {
			if (fromTo.includes(fp)) {
				importNeighborhoodMatch = 1;
				reasons.push(`P3 FROM/TO references explicit file ${fp}`);
				break;
			}
		}
	}

	// memoryHistoryMatch: not yet implemented (would consult anchor sidecar)
	const memoryHistoryMatch = 0;

	const score =
		directFileEvidence * w.directFileEvidence +
		moduleResponsibilityMatch * w.moduleResponsibilityMatch +
		dipContractMatch * w.dipContractMatch +
		importNeighborhoodMatch * w.importNeighborhoodMatch +
		memoryHistoryMatch * w.memoryHistoryMatch;

	if (score <= 0) return null;
	return { score, reasons };
}

function buildAnchor(node: TerrainNode, score: number): StructuralAnchor {
	return {
		workspaceId: "default",
		modulePath: node.modulePath,
		filePath: node.filePath,
		confidence: Math.min(1, Math.max(0, score)),
		source: node.filePath ? ["file"] : ["p3"],
	};
}

export interface LocateTaskInput {
	prompt: string;
	cwd: string;
	mentionedFiles?: string[]; // posix-relative paths
	snapshot: TerrainSnapshot;
	weights: SalWeights;
}

export function locateTask(input: LocateTaskInput): AnchorResolution {
	const signals = extractSignals(input.prompt);
	const explicit = new Set<string>();
	for (const f of input.mentionedFiles ?? []) explicit.add(toPosixPath(f));
	for (const f of signals.mentionedFiles) {
		// Try to resolve to a node by suffix matching
		for (const node of input.snapshot.nodes) {
			if (node.filePath && node.filePath.endsWith(f)) explicit.add(node.filePath);
		}
	}

	const ctx: ScoringContext = { snapshot: input.snapshot, weights: input.weights, signals, explicitFilePaths: explicit };
	const candidates: AnchorCandidate[] = [];
	for (const node of input.snapshot.nodes) {
		const scored = scoreNode(ctx, node);
		if (!scored) continue;
		candidates.push({ anchor: buildAnchor(node, scored.score), score: scored.score, reasons: scored.reasons });
	}
	candidates.sort((a, b) => b.score - a.score);
	const top = candidates.slice(0, 5);

	const unresolvedSignals: string[] = [];
	if (top.length === 0) {
		unresolvedSignals.push("no terrain node matched prompt signals");
	} else if (top[0].score < 0.15) {
		unresolvedSignals.push("top candidate confidence below 0.15 — task likely cross-cutting or under-localized");
	}

	return {
		targetKind: "task",
		candidates: top,
		selected: top[0]?.anchor,
		unresolvedSignals,
	};
}

export interface LocateActionInput {
	touchedFiles: string[]; // posix-relative paths captured from tool execution
	snapshot: TerrainSnapshot;
}

/**
 * locateAction collapses observed file touches into the highest-confidence module anchor.
 * If multiple modules are touched, the one with the most touches wins; ties broken by depth.
 */
export function locateAction(input: LocateActionInput): AnchorResolution {
	if (input.touchedFiles.length === 0) {
		return {
			targetKind: "action",
			candidates: [],
			unresolvedSignals: ["no tool touched any file this turn"],
		};
	}

	const moduleHits = new Map<string, { count: number; files: string[] }>();
	for (const f of input.touchedFiles) {
		const moduleId = moduleIdForPath(input.snapshot, f) ?? "<root>";
		const entry = moduleHits.get(moduleId) ?? { count: 0, files: [] };
		entry.count += 1;
		entry.files.push(f);
		moduleHits.set(moduleId, entry);
	}

	const candidates: AnchorCandidate[] = [];
	for (const [moduleId, entry] of moduleHits) {
		const node = input.snapshot.nodes.find(
			(n) => (n.kind === "module" || n.kind === "root") && n.id === moduleId,
		);
		const modulePath = node?.modulePath;
		const score = entry.count / input.touchedFiles.length;
		candidates.push({
			anchor: {
				workspaceId: "default",
				modulePath,
				filePath: entry.files[0],
				confidence: score,
				source: ["tool"],
			},
			score,
			reasons: [`tool touched ${entry.count} file(s) in this module`, ...entry.files.map((f) => `  - ${f}`)],
		});
	}
	candidates.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		const aDepth = (a.anchor.modulePath ?? "").split("/").length;
		const bDepth = (b.anchor.modulePath ?? "").split("/").length;
		return bDepth - aDepth;
	});

	return {
		targetKind: "action",
		candidates,
		selected: candidates[0]?.anchor,
	};
}

export { normalizeRel };
