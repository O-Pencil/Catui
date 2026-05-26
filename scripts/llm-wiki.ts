#!/usr/bin/env tsx
/**
 * [WHO]: Provides LLM Wiki scan, update, verify, and build commands for code-document isomorphism
 * [FROM]: Depends on TypeScript AST parsing, DIP P1/P2/P3 docs, Markdown pages, and node filesystem APIs
 * [TO]: Invoked by npm wiki:* scripts and maintainers who need auditable project wiki artifacts
 * [HERE]: scripts/llm-wiki.ts - deterministic fact layer and renderer for the project-local LLM Wiki
 */
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { argv, cwd, exit, stderr, stdout } from "node:process";
import ts from "typescript";
import YAML from "yaml";

import { buildSearchIndex, buildSite } from "./llm-wiki-artifacts.js";
import { buildPageSpecs, expectedWikiPageCount } from "./llm-wiki-pages.js";

type NodeType = "project" | "module" | "file" | "doc" | "wiki-page" | "package" | "symbol" | "local-import";
type EdgeType = "contains" | "imports" | "exports" | "documents" | "derived_from";
type CheckStatus = "pass" | "warn" | "fail";

interface GraphNode {
	id: string;
	type: NodeType;
	title: string;
	path?: string;
	meta?: Record<string, unknown>;
}

interface GraphEdge {
	from: string;
	to: string;
	type: EdgeType;
	label?: string;
}

interface P3Contract {
	valid: boolean;
	who?: string;
	from?: string;
	to?: string;
	here?: string;
}

interface SourceFileInfo {
	id: string;
	path: string;
	moduleId?: string;
	p2Path?: string;
	exports: string[];
	imports: string[];
	localImports: string[];
	packageImports: string[];
	p3: P3Contract;
	contentHash: string;
}

interface P2ModuleInfo {
	id: string;
	path: string;
	docPath: string;
	memberCount: number;
	sourceCount: number;
}

interface WikiGraph {
	schemaVersion: 1;
	generatedAt: string;
	project: {
		name: string;
		version: string;
		root: string;
	};
	contentHash: string;
	summary: {
		sourceFiles: number;
		modules: number;
		docs: number;
		exports: number;
		imports: number;
		p3Contracts: number;
	};
	nodes: GraphNode[];
	edges: GraphEdge[];
	sources: SourceFileInfo[];
	modules: P2ModuleInfo[];
}

interface DiagnosticCheck {
	id: string;
	status: CheckStatus;
	message: string;
	evidence?: string;
}

interface Diagnostics {
	generatedAt: string;
	status: "pass" | "fail";
	graphHash: string;
	checks: DiagnosticCheck[];
}

interface SearchIndexEntry {
	id: string;
	kind: "page" | "module" | "file" | "symbol";
	title: string;
	path: string;
	sources: string[];
	graphHash: string;
	textHash: string;
	terms: string[];
}

interface SearchIndex {
	schemaVersion: 1;
	generatedAt: string;
	graphHash: string;
	entries: SearchIndexEntry[];
}

interface PageSpec {
	path: string;
	id: string;
	title: string;
	sources: string[];
	body: string;
}

const ROOT = cwd();
const WIKI_DIR = join(ROOT, "llm-wiki");
const PAGES_DIR = join(WIKI_DIR, "pages");
const SITE_DIR = join(WIKI_DIR, "site");
const GRAPH_PATH = join(WIKI_DIR, "graph.json");
const DIAGNOSTICS_PATH = join(WIKI_DIR, "diagnostics.json");
const SEARCH_INDEX_PATH = join(WIKI_DIR, "search-index.json");
const MANIFEST_PATH = join(WIKI_DIR, "manifest.json");
const P1_PATH = join(ROOT, "AGENTS.md");

const SKIP_DIRS = new Set([
	".git",
	".grub",
	".nanopencil",
	"node_modules",
	"dist",
	"coverage",
	"llm-wiki",
	"docs",
]);

function toUnix(path: string): string {
	return path.replace(/\\/g, "/");
}

function rel(path: string): string {
	return toUnix(relative(ROOT, path));
}

function ensureDir(path: string): void {
	if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	if (value && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		return `{${Object.keys(obj)
			.sort()
			.map(key => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function readJson<T>(path: string): T | undefined {
	if (!existsSync(path)) return undefined;
	return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function writeJson(path: string, value: unknown): void {
	ensureDir(dirname(path));
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function isSourceFile(path: string): boolean {
	const normalized = toUnix(path);
	if (!normalized.endsWith(".ts")) return false;
	if (normalized.endsWith(".d.ts")) return false;
	if (normalized.endsWith(".generated.ts")) return false;
	if (normalized.includes("/test/") || normalized.includes("/tests/") || normalized.includes("/__tests__/")) return false;
	if (basename(normalized).endsWith(".test.ts") || basename(normalized).startsWith("test-")) return false;
	return true;
}

function walkFiles(dir: string, predicate: (path: string) => boolean, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			walkFiles(join(dir, entry.name), predicate, out);
			continue;
		}
		if (entry.isFile()) {
			const full = join(dir, entry.name);
			if (predicate(full)) out.push(full);
		}
	}
	return out;
}

function extractP3(content: string): P3Contract {
	const blocks = content.match(/\/\*\*[\s\S]*?\*\//g) ?? [];
	for (const block of blocks.slice(0, 4)) {
		const who = extractP3Field(block, "WHO");
		const from = extractP3Field(block, "FROM");
		const to = extractP3Field(block, "TO");
		const here = extractP3Field(block, "HERE");
		if (who && from && to && here) {
			return { valid: true, who, from, to, here };
		}
	}
	return { valid: false };
}

function extractP3Field(block: string, field: "WHO" | "FROM" | "TO" | "HERE"): string | undefined {
	const match = block.match(new RegExp(`\\[${field}\\]:\\s*([^\\n]+)`));
	if (!match) return undefined;
	return match[1].replace(/\*\/$/, "").trim();
}

function parseTypeScriptFile(path: string): Pick<SourceFileInfo, "exports" | "imports" | "localImports" | "packageImports"> {
	const content = readFileSync(path, "utf-8");
	const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const exports = new Set<string>();
	const imports = new Set<string>();

	function addExport(name: string): void {
		if (name) exports.add(name);
	}

	function hasExportModifier(node: ts.Node): boolean {
		return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword));
	}

	function visit(node: ts.Node): void {
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			imports.add(node.moduleSpecifier.text);
		}
		if (ts.isExportDeclaration(node)) {
			if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.add(node.moduleSpecifier.text);
			if (node.exportClause && ts.isNamedExports(node.exportClause)) {
				for (const element of node.exportClause.elements) addExport(element.name.text);
			}
		}
		if (ts.isExportAssignment(node)) {
			addExport(node.isExportEquals ? "export=" : "default");
		}
		if (
			(ts.isFunctionDeclaration(node) ||
				ts.isClassDeclaration(node) ||
				ts.isInterfaceDeclaration(node) ||
				ts.isTypeAliasDeclaration(node) ||
				ts.isEnumDeclaration(node)) &&
			hasExportModifier(node)
		) {
			addExport(node.name?.text ?? "default");
		}
		if (ts.isVariableStatement(node) && hasExportModifier(node)) {
			for (const declaration of node.declarationList.declarations) {
				if (ts.isIdentifier(declaration.name)) addExport(declaration.name.text);
			}
		}
		ts.forEachChild(node, visit);
	}

	visit(source);
	const allImports = [...imports].sort();
	return {
		exports: [...exports].sort(),
		imports: allImports,
		localImports: allImports.filter(item => item.startsWith(".")),
		packageImports: allImports.filter(item => !item.startsWith(".")),
	};
}

function extractMemberCount(path: string): number {
	const content = readFileSync(path, "utf-8");
	let count = 0;
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (/^(?:[-*]\s+)?`?[\w./-]+(?:\.ts|\/)`?:\s+.+$/.test(line)) count++;
	}
	return count;
}

function findP2Modules(): P2ModuleInfo[] {
	const docs = walkFiles(ROOT, path => basename(path) === "AGENT.md");
	return docs
		.filter(path => readFileSync(path, "utf-8").includes("Member List"))
		.map(path => {
			const modulePath = dirname(path);
			return {
				id: `module:${rel(modulePath)}`,
				path: rel(modulePath),
				docPath: rel(path),
				memberCount: extractMemberCount(path),
				sourceCount: 0,
			};
		})
		.sort((a, b) => a.path.localeCompare(b.path));
}

function nearestModule(filePath: string, modules: P2ModuleInfo[]): P2ModuleInfo | undefined {
	const fileRel = rel(filePath);
	return [...modules]
		.filter(module => fileRel === module.path || fileRel.startsWith(`${module.path}/`))
		.sort((a, b) => b.path.length - a.path.length)[0];
}

function scanProject(): WikiGraph {
	const packageJson = readJson<{ name?: string; version?: string }>(join(ROOT, "package.json")) ?? {};
	const modules = findP2Modules();
	const sourcePaths = walkFiles(ROOT, isSourceFile).sort((a, b) => rel(a).localeCompare(rel(b)));
	const sourcePathSet = new Set(sourcePaths.map(path => rel(path)));
	const sources: SourceFileInfo[] = sourcePaths.map(path => {
		const content = readFileSync(path, "utf-8");
		const parsed = parseTypeScriptFile(path);
		const module = nearestModule(path, modules);
		if (module) module.sourceCount++;
		return {
			id: `file:${rel(path)}`,
			path: rel(path),
			moduleId: module?.id,
			p2Path: module?.docPath,
			...parsed,
			p3: extractP3(content),
			contentHash: sha256(content),
		};
	});

	const nodes: GraphNode[] = [
		{
			id: "project:nanoPencil",
			type: "project",
			title: packageJson.name ?? "nanoPencil",
			path: ".",
			meta: { version: packageJson.version ?? "0.0.0" },
		},
	];
	const edges: GraphEdge[] = [];

	if (existsSync(P1_PATH)) {
		nodes.push({
			id: "doc:p1:AGENTS.md",
			type: "doc",
			title: "P1 Project Charter",
			path: "AGENTS.md",
			meta: { contentHash: sha256(readFileSync(P1_PATH, "utf-8")) },
		});
		edges.push({ from: "doc:p1:AGENTS.md", to: "project:nanoPencil", type: "documents" });
	}

	for (const module of modules) {
		nodes.push({
			id: module.id,
			type: "module",
			title: module.path,
			path: module.path,
			meta: { p2: module.docPath, memberCount: module.memberCount, sourceCount: module.sourceCount },
		});
		nodes.push({
			id: `doc:p2:${module.docPath}`,
			type: "doc",
			title: `P2 ${module.path}`,
			path: module.docPath,
			meta: { contentHash: sha256(readFileSync(join(ROOT, module.docPath), "utf-8")) },
		});
		edges.push({ from: "project:nanoPencil", to: module.id, type: "contains" });
		edges.push({ from: `doc:p2:${module.docPath}`, to: module.id, type: "documents" });
	}

	for (const source of sources) {
		nodes.push({
			id: source.id,
			type: "file",
			title: source.path,
			path: source.path,
			meta: {
				exports: source.exports,
				imports: source.imports,
				p3: source.p3,
			},
		});
		if (source.moduleId) edges.push({ from: source.moduleId, to: source.id, type: "contains" });
		if (source.p2Path) edges.push({ from: `doc:p2:${source.p2Path}`, to: source.id, type: "documents" });
		for (const exported of source.exports) {
			const symbolId = `symbol:${source.path}#${exported}`;
			nodes.push({ id: symbolId, type: "symbol", title: exported, path: source.path });
			edges.push({ from: source.id, to: symbolId, type: "exports", label: exported });
		}
		for (const imported of source.imports) {
			const target = imported.startsWith(".") ? resolveLocalImport(source.path, imported, sourcePathSet) : `package:${imported}`;
			if (!imported.startsWith(".")) {
				nodes.push({ id: target, type: "package", title: imported });
			} else if (!target.startsWith("file:")) {
				nodes.push({ id: target, type: "local-import", title: imported });
			}
			edges.push({ from: source.id, to: target, type: "imports", label: imported });
		}
	}

	const docs = nodes.filter(node => node.type === "doc").length;
	const graphWithoutHash = {
		schemaVersion: 1 as const,
		generatedAt: new Date().toISOString(),
		project: {
			name: packageJson.name ?? "nanoPencil",
			version: packageJson.version ?? "0.0.0",
			root: basename(ROOT),
		},
		contentHash: "",
		summary: {
			sourceFiles: sources.length,
			modules: modules.length,
			docs,
			exports: sources.reduce((sum, source) => sum + source.exports.length, 0),
			imports: sources.reduce((sum, source) => sum + source.imports.length, 0),
			p3Contracts: sources.filter(source => source.p3.valid).length,
		},
		nodes: dedupeNodes(nodes).sort((a, b) => a.id.localeCompare(b.id)),
		edges: edges.sort((a, b) => `${a.from}:${a.type}:${a.to}`.localeCompare(`${b.from}:${b.type}:${b.to}`)),
		sources,
		modules,
	};

	return {
		...graphWithoutHash,
		contentHash: sha256(stableStringify({ ...graphWithoutHash, generatedAt: "" })),
	};
}

function resolveLocalImport(sourcePath: string, specifier: string, sourcePathSet: Set<string>): string {
	const base = join(ROOT, dirname(sourcePath), specifier);
	const candidates = [
		base,
		base.replace(/\.js$/, ".ts"),
		`${base}.ts`,
		join(base, "index.ts"),
		join(base.replace(/\.js$/, ""), "index.ts"),
	];
	for (const candidate of candidates) {
		const candidateRel = rel(candidate);
		if (sourcePathSet.has(candidateRel)) return `file:${candidateRel}`;
	}
	return `local:${toUnix(join(dirname(sourcePath), specifier))}`;
}

function dedupeNodes(nodes: GraphNode[]): GraphNode[] {
	const byId = new Map<string, GraphNode>();
	for (const node of nodes) {
		if (!byId.has(node.id)) byId.set(node.id, node);
	}
	return [...byId.values()];
}

function writeGraph(graph: WikiGraph): void {
	writeJson(GRAPH_PATH, graph);
	stdout.write(`graph: ${rel(GRAPH_PATH)} (${graph.summary.sourceFiles} source files, hash ${graph.contentHash.slice(0, 12)})\n`);
}

function writePage(spec: PageSpec): void {
	const fullPath = join(PAGES_DIR, spec.path);
	ensureDir(dirname(fullPath));
	writeFileSync(
		fullPath,
		`---\n${wikiFrontmatter(spec.id, spec.title, spec.sources, currentGraphForPage)}---\n\n${spec.body.trim()}\n`,
		"utf-8",
	);
}

let currentGraphForPage: WikiGraph;

function wikiFrontmatter(id: string, title: string, sources: string[], graph: WikiGraph): string {
	return YAML.stringify({
		id,
		title,
		sources,
		generatedFromGraphHash: graph.contentHash,
		generatedAt: new Date().toISOString(),
	});
}

function updateWiki(): WikiGraph {
	const graph = scanProject();
	currentGraphForPage = graph;
	writeGraph(graph);
	rmSync(PAGES_DIR, { recursive: true, force: true });
	ensureDir(PAGES_DIR);
	const pages = buildPageSpecs(graph);
	for (const page of pages) writePage(page);
	const searchIndex = buildSearchIndex(graph, PAGES_DIR, ROOT);
	writeJson(SEARCH_INDEX_PATH, searchIndex);
	writeJson(MANIFEST_PATH, {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		graphHash: graph.contentHash,
		pageCount: pages.length,
		sourceFileCount: graph.sources.length,
		moduleCount: graph.modules.length,
		searchEntryCount: searchIndex.entries.length,
		virtualModuleCount: graph.modules.length,
		virtualFileCount: graph.sources.length,
		virtualSymbolCount: graph.summary.exports,
		artifacts: {
			graph: "llm-wiki/graph.json",
			diagnostics: "llm-wiki/diagnostics.json",
			searchIndex: "llm-wiki/search-index.json",
			pages: "llm-wiki/pages",
			site: "llm-wiki/site",
		},
	});
	stdout.write(`pages: llm-wiki/pages (${pages.length} markdown pages)\n`);
	stdout.write(`search: llm-wiki/search-index.json (${searchIndex.entries.length} entries)\n`);
	return graph;
}

function parsePageFrontmatter(path: string): Record<string, unknown> | undefined {
	const content = readFileSync(path, "utf-8");
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return undefined;
	return YAML.parse(match[1]) as Record<string, unknown>;
}

function collectMarkdownPages(): string[] {
	if (!existsSync(PAGES_DIR)) return [];
	return walkFiles(PAGES_DIR, path => path.endsWith(".md")).sort((a, b) => rel(a).localeCompare(rel(b)));
}

function verifyWiki(): Diagnostics {
	const fresh = scanProject();
	const existing = readJson<WikiGraph>(GRAPH_PATH);
	const checks: DiagnosticCheck[] = [];

	if (!existing) {
		checks.push({ id: "graph.exists", status: "fail", message: "llm-wiki/graph.json is missing" });
	} else if (existing.contentHash !== fresh.contentHash) {
		checks.push({
			id: "graph.fresh",
			status: "fail",
			message: "llm-wiki/graph.json is stale",
			evidence: `expected ${fresh.contentHash}, found ${existing.contentHash}`,
		});
	} else {
		checks.push({ id: "graph.fresh", status: "pass", message: "llm-wiki/graph.json matches the current source graph" });
	}

	const missingP3 = fresh.sources.filter(source => !source.p3.valid);
	checks.push({
		id: "source.p3",
		status: missingP3.length === 0 ? "pass" : "fail",
		message: missingP3.length === 0 ? "Every indexed source has a P3 contract" : `${missingP3.length} indexed sources are missing P3 contracts`,
		evidence: missingP3.slice(0, 10).map(source => source.path).join(", "),
	});

	if (!existsSync(join(WIKI_DIR, "README.md"))) {
		checks.push({ id: "wiki.readme", status: "fail", message: "llm-wiki/README.md is missing" });
	} else {
		checks.push({ id: "wiki.readme", status: "pass", message: "llm-wiki/README.md exists" });
	}

	const pagePaths = collectMarkdownPages();
	const expectedPageCount = expectedWikiPageCount();
	checks.push({
		id: "pages.exists",
		status: pagePaths.length > 0 ? "pass" : "fail",
		message: pagePaths.length > 0 ? `${pagePaths.length} wiki pages found` : "No llm-wiki/pages/*.md files found",
	});
	checks.push({
		id: "pages.complete",
		status: pagePaths.length === expectedPageCount ? "pass" : "fail",
		message:
			pagePaths.length === expectedPageCount
				? "Wiki page count matches complete module/file coverage"
				: `Expected ${expectedPageCount} pages, found ${pagePaths.length}`,
	});

	const knownSources = new Set<string>(["AGENTS.md", "llm-wiki/graph.json", "llm-wiki/search-index.json", ...fresh.sources.map(source => source.path), ...fresh.modules.map(module => module.docPath)]);
	for (const page of pagePaths) {
		const frontmatter = parsePageFrontmatter(page);
		if (!frontmatter?.id) {
			checks.push({ id: `page.frontmatter:${rel(page)}`, status: "fail", message: "Wiki page is missing frontmatter id" });
			continue;
		}
		const declaredSources = Array.isArray(frontmatter.sources) ? frontmatter.sources.map(String) : [];
		const missingSources = declaredSources.filter(source => !knownSources.has(source) && !existsSync(join(ROOT, source)));
		const hash = frontmatter.generatedFromGraphHash;
		const pageHashCurrent = hash === fresh.contentHash;
		checks.push({
			id: `page.sources:${rel(page)}`,
			status: missingSources.length === 0 ? "pass" : "fail",
			message: missingSources.length === 0 ? "Declared page sources exist" : "Declared page sources are missing",
			evidence: missingSources.join(", "),
		});
		checks.push({
			id: `page.hash:${rel(page)}`,
			status: pageHashCurrent ? "pass" : "fail",
			message: pageHashCurrent ? "Page graph hash is current" : "Page graph hash is stale",
			evidence: pageHashCurrent ? undefined : `expected ${fresh.contentHash}, found ${String(hash)}`,
		});
	}

	const searchIndex = readJson<SearchIndex>(SEARCH_INDEX_PATH);
	if (!searchIndex) {
		checks.push({ id: "search.exists", status: "fail", message: "llm-wiki/search-index.json is missing" });
	} else {
		checks.push({
			id: "search.hash",
			status: searchIndex.graphHash === fresh.contentHash ? "pass" : "fail",
			message: searchIndex.graphHash === fresh.contentHash ? "Search index graph hash is current" : "Search index graph hash is stale",
			evidence: searchIndex.graphHash === fresh.contentHash ? undefined : `expected ${fresh.contentHash}, found ${searchIndex.graphHash}`,
		});
		checks.push({
			id: "search.coverage",
			status: searchIndex.entries.filter(entry => entry.kind === "page").length === pagePaths.length ? "pass" : "fail",
			message: "Search index has one page entry per narrative Markdown page",
		});
		const moduleEntryIds = new Set(searchIndex.entries.filter(entry => entry.kind === "module").map(entry => entry.id));
		const fileEntryIds = new Set(searchIndex.entries.filter(entry => entry.kind === "file").map(entry => entry.id));
		const symbolEntryIds = new Set(searchIndex.entries.filter(entry => entry.kind === "symbol").map(entry => entry.id));
		const missingModuleEntries = fresh.modules.map(module => module.id).filter(id => !moduleEntryIds.has(id));
		const missingFileEntries = fresh.sources.map(source => source.id).filter(id => !fileEntryIds.has(id));
		const missingSymbolEntries = fresh.sources
			.flatMap(source => source.exports.map(symbol => `symbol:${source.path}#${symbol}`))
			.filter(id => !symbolEntryIds.has(id));
		checks.push({
			id: "search.modules",
			status: missingModuleEntries.length === 0 ? "pass" : "fail",
			message: missingModuleEntries.length === 0 ? "Every P2 module has a virtual search entry" : `${missingModuleEntries.length} module entries are missing`,
			evidence: missingModuleEntries.slice(0, 20).join(", "),
		});
		checks.push({
			id: "search.files",
			status: missingFileEntries.length === 0 ? "pass" : "fail",
			message: missingFileEntries.length === 0 ? "Every indexed source has a virtual search entry" : `${missingFileEntries.length} file entries are missing`,
			evidence: missingFileEntries.slice(0, 20).join(", "),
		});
		checks.push({
			id: "search.symbols",
			status: missingSymbolEntries.length === 0 ? "pass" : "fail",
			message: missingSymbolEntries.length === 0 ? "Every exported symbol has a virtual search entry" : `${missingSymbolEntries.length} symbol entries are missing`,
			evidence: missingSymbolEntries.slice(0, 20).join(", "),
		});
	}

	const manifest = readJson<{
		graphHash?: string;
		pageCount?: number;
		sourceFileCount?: number;
		moduleCount?: number;
		searchEntryCount?: number;
		virtualModuleCount?: number;
		virtualFileCount?: number;
		virtualSymbolCount?: number;
	}>(MANIFEST_PATH);
	if (!manifest) {
		checks.push({ id: "manifest.exists", status: "fail", message: "llm-wiki/manifest.json is missing" });
	} else {
		const manifestCurrent =
				manifest.graphHash === fresh.contentHash &&
				manifest.pageCount === pagePaths.length &&
				manifest.sourceFileCount === fresh.sources.length &&
				manifest.moduleCount === fresh.modules.length &&
				manifest.virtualModuleCount === fresh.modules.length &&
				manifest.virtualFileCount === fresh.sources.length &&
				manifest.virtualSymbolCount === fresh.summary.exports;
		checks.push({
			id: "manifest.current",
			status: manifestCurrent ? "pass" : "fail",
			message: manifestCurrent ? "Manifest matches graph and page counts" : "Manifest is stale or incomplete",
		});
	}

	const failed = checks.some(check => check.status === "fail");
	const diagnostics: Diagnostics = {
		generatedAt: new Date().toISOString(),
		status: failed ? "fail" : "pass",
		graphHash: fresh.contentHash,
		checks,
	};
	writeJson(DIAGNOSTICS_PATH, diagnostics);
	return diagnostics;
}

function printDiagnostics(diagnostics: Diagnostics): void {
	const verbose = argv.includes("--verbose");
	const checksToPrint = verbose ? diagnostics.checks : diagnostics.checks.filter(check => check.status !== "pass");
	for (const check of checksToPrint) {
		const marker = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
		stdout.write(`${marker} ${check.id}: ${check.message}\n`);
		if (check.evidence) stdout.write(`  ${check.evidence}\n`);
	}
	const passCount = diagnostics.checks.filter(check => check.status === "pass").length;
	const warnCount = diagnostics.checks.filter(check => check.status === "warn").length;
	const failCount = diagnostics.checks.filter(check => check.status === "fail").length;
	stdout.write(`checks: ${passCount} pass, ${warnCount} warn, ${failCount} fail\n`);
	if (!verbose && failCount === 0) stdout.write("all checks passed; use --verbose for per-page details\n");
	stdout.write(`diagnostics: ${rel(DIAGNOSTICS_PATH)} (${diagnostics.status})\n`);
}

function usage(): never {
	stderr.write(`usage: node --import tsx scripts/llm-wiki.ts <scan|update|verify|build|all>\n`);
	exit(2);
}

function main(): void {
	const command = argv[2];
	if (!command) usage();
	if (command === "scan") {
		writeGraph(scanProject());
		return;
	}
	if (command === "update") {
		updateWiki();
		return;
	}
	if (command === "verify") {
		const diagnostics = verifyWiki();
		printDiagnostics(diagnostics);
		exit(diagnostics.status === "pass" ? 0 : 1);
	}
		if (command === "build") {
			if (!existsSync(PAGES_DIR)) {
				stderr.write("llm-wiki/pages does not exist. Run npm run wiki:update first.\n");
				exit(1);
			}
			const graph = scanProject();
			const searchIndex = readJson<SearchIndex>(SEARCH_INDEX_PATH);
			if (!searchIndex) {
				stderr.write("llm-wiki/search-index.json does not exist. Run npm run wiki:update first.\n");
				exit(1);
			}
			buildSite(PAGES_DIR, SITE_DIR, graph, searchIndex);
			stdout.write(`site: ${rel(SITE_DIR)} (${collectMarkdownPages().length} pages + explorer)\n`);
			return;
		}
		if (command === "all") {
			const graph = updateWiki();
			const diagnostics = verifyWiki();
			printDiagnostics(diagnostics);
			if (diagnostics.status !== "pass") exit(1);
			const searchIndex = readJson<SearchIndex>(SEARCH_INDEX_PATH);
			if (!searchIndex) exit(1);
			buildSite(PAGES_DIR, SITE_DIR, graph, searchIndex);
			stdout.write(`site: ${rel(SITE_DIR)} (${collectMarkdownPages().length} pages + explorer)\n`);
			return;
		}
	usage();
}

main();
