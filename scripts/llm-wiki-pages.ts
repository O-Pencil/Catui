/**
 * [WHO]: Provides human-first Markdown page specs for the generated LLM Wiki
 * [FROM]: Depends on the WikiGraph shape emitted by scripts/llm-wiki.ts
 * [TO]: Consumed by scripts/llm-wiki.ts during wiki:update and wiki:all
 * [HERE]: scripts/llm-wiki-pages.ts - curated narrative pages; file/module detail stays virtual in search/explorer data
 */

interface GraphEdge {
	from: string;
	to: string;
	type: "contains" | "imports" | "exports" | "documents" | "derived_from";
	label?: string;
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
	p3: {
		valid: boolean;
		who?: string;
		from?: string;
		to?: string;
		here?: string;
	};
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
	contentHash: string;
	project: {
		name: string;
		version: string;
		root: string;
	};
	summary: {
		sourceFiles: number;
		modules: number;
		docs: number;
		exports: number;
		imports: number;
		p3Contracts: number;
	};
	nodes: Array<{ id: string; type: string }>;
	edges: GraphEdge[];
	sources: SourceFileInfo[];
	modules: P2ModuleInfo[];
}

export interface PageSpec {
	path: string;
	id: string;
	title: string;
	sources: string[];
	body: string;
}

export function expectedWikiPageCount(): number {
	return 8;
}

export function buildPageSpecs(graph: WikiGraph): PageSpec[] {
	return [
		{
			path: "index.md",
			id: "wiki:index",
			title: "LLM Wiki Index",
			sources: ["AGENTS.md", "llm-wiki/graph.json", "llm-wiki/search-index.json"],
			body: renderIndexPage(graph),
		},
		{
			path: "architecture.md",
			id: "wiki:architecture",
			title: "Architecture Projection",
			sources: ["AGENTS.md", "llm-wiki/graph.json"],
			body: renderArchitecturePage(graph),
		},
		{
			path: "modules.md",
			id: "wiki:modules",
			title: "Module Map",
			sources: ["AGENTS.md", "llm-wiki/graph.json", ...graph.modules.map(module => module.docPath)],
			body: renderModulesPage(graph),
		},
		{
			path: "files.md",
			id: "wiki:files",
			title: "Source File Map",
			sources: ["llm-wiki/graph.json"],
			body: renderFilesPage(graph),
		},
		{
			path: "symbols.md",
			id: "wiki:symbols",
			title: "Exported Symbol Map",
			sources: ["llm-wiki/graph.json"],
			body: renderSymbolsPage(graph),
		},
		{
			path: "dependencies.md",
			id: "wiki:dependencies",
			title: "Dependency Map",
			sources: ["llm-wiki/graph.json"],
			body: renderDependenciesPage(graph),
		},
		{
			path: "health.md",
			id: "wiki:health",
			title: "DIP Health",
			sources: ["AGENTS.md", "llm-wiki/graph.json", ...graph.modules.map(module => module.docPath)],
			body: renderHealthPage(graph),
		},
		{
			path: "retrieval.md",
			id: "wiki:retrieval",
			title: "LLM Retrieval Guide",
			sources: ["llm-wiki/graph.json", "llm-wiki/search-index.json"],
			body: renderRetrievalPage(graph),
		},
	];
}

function renderIndexPage(graph: WikiGraph): string {
	return `# LLM Wiki

This wiki is a human-first map of the nanoPencil codebase backed by a complete machine graph.

## Current Shape

- Project: \`${graph.project.name}\` \`${graph.project.version}\`
- Graph hash: \`${graph.contentHash}\`
- Source files represented virtually: ${graph.summary.sourceFiles}
- P2 modules represented virtually: ${graph.summary.modules}
- P3 contracts: ${graph.summary.p3Contracts}/${graph.summary.sourceFiles}
- Exported symbols: ${graph.summary.exports}
- Import edges: ${graph.summary.imports}

## Human Navigation

- [Architecture Projection](./architecture.md)
- [Module Map](./modules.md)
- [Source File Map](./files.md)
- [Exported Symbol Map](./symbols.md)
- [Dependency Map](./dependencies.md)
- [DIP Health](./health.md)
- [LLM Retrieval Guide](./retrieval.md)
- Browser site: \`llm-wiki/site/index.html\`
- Interactive explorer: \`llm-wiki/site/explorer.html\`

## Design Contract

The wiki keeps only a small set of narrative Markdown pages in the source layer. Detailed module, file, and symbol pages are virtual entries in \`search-index.json\` and the interactive explorer. This avoids hundreds of mechanical files while preserving complete addressability.
`;
}

function renderArchitecturePage(graph: WikiGraph): string {
	const topLevelRows = sourceCountsByTopLevel(graph)
		.map(([area, count]) => `| \`${area}\` | ${count} |`)
		.join("\n");
	const packageRows = packageDependencyCounts(graph)
		.slice(0, 30)
		.map(([pkg, count]) => `| \`${pkg}\` | ${count} |`)
		.join("\n");
	return `# Architecture Projection

This page is the human narrative view. Use \`graph.json\` for exact node/edge traversal and \`explorer.html\` for interactive lookup.

## Source Distribution

| Area | Source Files |
| --- | ---: |
${topLevelRows}

## Runtime Shape

- Entry points live at the top level and under \`modes/\`.
- Core agent behavior lives under \`core/\`.
- Built-in and optional behaviors live under \`extensions/\`.
- Bundled packages live under \`packages/\`.
- Scripts are maintenance/runtime tooling, not product runtime.

## Most Referenced Packages

| Package | Importing Files |
| --- | ---: |
${packageRows || "| None | 0 |"}
`;
}

function renderModulesPage(graph: WikiGraph): string {
	const rows = graph.modules
		.map(module => {
			const files = sourcesForModule(graph, module);
			const exports = files.reduce((sum, source) => sum + source.exports.length, 0);
			return `| \`${module.path}\` | \`${module.docPath}\` | ${files.length} | ${exports} |`;
		})
		.join("\n");
	return `# Module Map

Every P2 module is represented here and has a virtual entry in \`search-index.json\`.

| Module | P2 Document | Files | Exports |
| --- | --- | ---: | ---: |
${rows}
`;
}

function renderFilesPage(graph: WikiGraph): string {
	const topModules = graph.modules
		.map(module => [module.path, sourcesForModule(graph, module).length] as [string, number])
		.sort((a, b) => b[1] - a[1])
		.slice(0, 40)
		.map(([module, count]) => `| \`${module}\` | ${count} |`)
		.join("\n");
	return `# Source File Map

The wiki does not materialize one Markdown file per source file. Each source file is still represented as a virtual search-index entry and can be inspected in \`site/explorer.html\`.

## Coverage

- Indexed source files: ${graph.summary.sourceFiles}
- Source files with P3: ${graph.summary.p3Contracts}
- Virtual file entries required by verify: ${graph.summary.sourceFiles}

## Largest Module Areas

| Module | Files |
| --- | ---: |
${topModules}
`;
}

function renderSymbolsPage(graph: WikiGraph): string {
	const topFiles = graph.sources
		.filter(source => source.exports.length > 0)
		.sort((a, b) => b.exports.length - a.exports.length || a.path.localeCompare(b.path))
		.slice(0, 60)
		.map(source => `| \`${source.path}\` | ${source.exports.length} | ${truncateList(source.exports, 8)} |`)
		.join("\n");
	return `# Exported Symbol Map

Exported symbols are extracted from the TypeScript AST. Full symbol lookup lives in \`search-index.json\` and \`site/explorer.html\`.

| Source File | Exports | Examples |
| --- | ---: | --- |
${topFiles || "| None | 0 | None |"}
`;
}

function renderDependenciesPage(graph: WikiGraph): string {
	const resolvedLocal = graph.edges.filter(edge => edge.type === "imports" && edge.to.startsWith("file:")).length;
	const unresolvedLocal = graph.edges.filter(edge => edge.type === "imports" && edge.to.startsWith("local:")).length;
	const packageRows = packageDependencyCounts(graph)
		.map(([pkg, count]) => `| \`${pkg}\` | ${count} |`)
		.join("\n");
	return `# Dependency Map

Dependencies stay queryable in the graph while this page gives the human overview.

## Summary

- Resolved local import edges: ${resolvedLocal}
- Package import edges: ${graph.edges.filter(edge => edge.type === "imports" && edge.to.startsWith("package:")).length}
- Unresolved local import edges: ${unresolvedLocal}

## Package Imports

| Package | Importing Files |
| --- | ---: |
${packageRows || "| None | 0 |"}
`;
}

function renderHealthPage(graph: WikiGraph): string {
	const modulesWithCountMismatch = graph.modules.filter(module => module.sourceCount !== module.memberCount);
	const mismatchRows = modulesWithCountMismatch
		.map(module => `| \`${module.path}\` | ${module.sourceCount} | ${module.memberCount} | \`${module.docPath}\` |`)
		.join("\n");
	return `# DIP Health

This page keeps document drift visible without turning generated details into hand-maintained prose.

## Hard Gates

- Indexed sources with P3 contracts: ${graph.summary.p3Contracts}/${graph.summary.sourceFiles}
- P2 modules indexed: ${graph.summary.modules}
- P1 document indexed: ${graph.nodes.some(node => node.id === "doc:p1:AGENTS.md") ? "yes" : "no"}
- Virtual file entries required: ${graph.summary.sourceFiles}
- Virtual module entries required: ${graph.summary.modules}

## P2 Count Differences

These are review signals, not automatic failures, because P2 lists may include directories, generated files, or non-source artifacts.

| Module | Source Files | Listed Members | P2 |
| --- | ---: | ---: | --- |
${mismatchRows || "| None | 0 | 0 | None |"}
`;
}

function renderRetrievalPage(graph: WikiGraph): string {
	return `# LLM Retrieval Guide

Use the wiki in this order:

1. Search \`llm-wiki/search-index.json\` for page, module, file, or symbol entries.
2. Read the matching narrative Markdown page for orientation.
3. Use the virtual entry source list to jump to P1, P2, P3, or source files.
4. Use \`llm-wiki/graph.json\` for exact dependencies.
5. Use \`llm-wiki/site/explorer.html\` for human browsing.

## Completeness Contract

- Only curated narrative Markdown pages are materialized.
- Every indexed module has a virtual module entry.
- Every indexed source file has a virtual file entry.
- Every exported symbol has a virtual symbol entry.
- \`npm run wiki:verify\` fails when graph, search index, virtual coverage, manifest, or page hashes drift.

## Current Scope

- Narrative Markdown pages: ${expectedWikiPageCount()}
- Source files represented virtually: ${graph.summary.sourceFiles}
- Modules represented virtually: ${graph.summary.modules}
- Exported symbols represented virtually: ${graph.summary.exports}
`;
}

function sourcesForModule(graph: WikiGraph, module: P2ModuleInfo): SourceFileInfo[] {
	return graph.sources.filter(source => source.moduleId === module.id).sort((a, b) => a.path.localeCompare(b.path));
}

function sourceCountsByTopLevel(graph: WikiGraph): [string, number][] {
	const counts = new Map<string, number>();
	for (const source of graph.sources) {
		const key = source.path.split("/")[0] ?? source.path;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function packageDependencyCounts(graph: WikiGraph): [string, number][] {
	const counts = new Map<string, Set<string>>();
	for (const source of graph.sources) {
		for (const pkg of source.packageImports) {
			if (!counts.has(pkg)) counts.set(pkg, new Set());
			counts.get(pkg)?.add(source.path);
		}
	}
	return [...counts.entries()]
		.map(([pkg, files]) => [pkg, files.size] as [string, number])
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function truncateList(values: string[], limit: number): string {
	if (values.length === 0) return "None";
	const shown = values.slice(0, limit).map(value => `\`${value}\``).join(", ");
	return values.length > limit ? `${shown}, and ${values.length - limit} more` : shown;
}
