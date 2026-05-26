/**
 * [WHO]: Provides generated search-index and HTML site builders for the LLM Wiki
 * [FROM]: Depends on Markdown pages, YAML frontmatter, marked, and node filesystem APIs
 * [TO]: Consumed by scripts/llm-wiki.ts after Markdown page generation
 * [HERE]: scripts/llm-wiki-artifacts.ts - derived artifact layer for retrieval and browsing
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { marked } from "marked";
import YAML from "yaml";

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

interface SearchIndexGraph {
	contentHash: string;
	sources: Array<{
		id: string;
		path: string;
		moduleId?: string;
		p2Path?: string;
		exports: string[];
		imports: string[];
		packageImports: string[];
		p3: { valid: boolean; who?: string; from?: string; to?: string; here?: string };
	}>;
	modules: Array<{ id: string; path: string; docPath: string; sourceCount: number; memberCount: number }>;
}

export function buildSearchIndex(graph: SearchIndexGraph, pagesDir: string, root: string): SearchIndex {
	const entries = collectMarkdownPages(pagesDir).map(path => {
		const markdown = readFileSync(path, "utf-8");
		const frontmatter = parsePageFrontmatter(path) ?? {};
		const text = stripFrontmatter(markdown);
		const title = typeof frontmatter.title === "string" ? frontmatter.title : pageTitle(path, markdown);
		const sources = Array.isArray(frontmatter.sources) ? frontmatter.sources.map(String) : [];
		return {
			id: String(frontmatter.id ?? toUnix(relative(root, path))),
			kind: "page" as const,
			title,
			path: toUnix(relative(root, path)),
			sources,
			graphHash: String(frontmatter.generatedFromGraphHash ?? ""),
			textHash: sha256(text),
			terms: extractTerms(`${title}\n${sources.join("\n")}\n${text}`),
		};
	});
	for (const module of graph.modules) {
		const files = graph.sources.filter(source => source.moduleId === module.id);
		entries.push({
			id: module.id,
			kind: "module",
			title: `Module ${module.path}`,
			path: `llm-wiki/site/explorer.html#module=${encodeURIComponent(module.path)}`,
			sources: ["llm-wiki/graph.json", module.docPath, ...files.map(file => file.path)],
			graphHash: graph.contentHash,
			textHash: sha256(`${module.path}\n${module.docPath}\n${files.map(file => file.path).join("\n")}`),
			terms: extractTerms(`${module.path}\n${module.docPath}\n${files.map(file => `${file.path} ${file.exports.join(" ")}`).join("\n")}`),
		});
	}
	for (const source of graph.sources) {
		entries.push({
			id: source.id,
			kind: "file",
			title: source.path,
			path: `llm-wiki/site/explorer.html#file=${encodeURIComponent(source.path)}`,
			sources: ["llm-wiki/graph.json", source.path, ...(source.p2Path ? [source.p2Path] : [])],
			graphHash: graph.contentHash,
			textHash: sha256(`${source.path}\n${source.p3.who ?? ""}\n${source.exports.join("\n")}\n${source.imports.join("\n")}`),
			terms: extractTerms(`${source.path}\n${source.p3.who ?? ""}\n${source.p3.from ?? ""}\n${source.p3.to ?? ""}\n${source.p3.here ?? ""}\n${source.exports.join(" ")}\n${source.imports.join(" ")}`),
		});
		for (const symbol of source.exports) {
			entries.push({
				id: `symbol:${source.path}#${symbol}`,
				kind: "symbol",
				title: symbol,
				path: `llm-wiki/site/explorer.html#symbol=${encodeURIComponent(`${source.path}#${symbol}`)}`,
				sources: ["llm-wiki/graph.json", source.path],
				graphHash: graph.contentHash,
				textHash: sha256(`${symbol}\n${source.path}`),
				terms: extractTerms(`${symbol}\n${source.path}\n${source.p3.who ?? ""}`),
			});
		}
	}
	return {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		graphHash: graph.contentHash,
		entries,
	};
}

export function buildSite(pagesDir: string, siteDir: string, graph: SearchIndexGraph, searchIndex: SearchIndex): void {
	ensureDir(siteDir);
	rmSync(siteDir, { recursive: true, force: true });
	ensureDir(siteDir);
	const pages = collectMarkdownPages(pagesDir).map(path => {
		const pageRel = toUnix(relative(pagesDir, path));
		const markdown = readFileSync(path, "utf-8");
		return {
			path,
			pageRel,
			outRel: pageRel.replace(/\.md$/, ".html"),
			title: pageTitle(path, markdown),
			html: marked.parse(stripFrontmatter(markdown)) as string,
		};
	});

	for (const page of pages) {
		const nav = pages
			.map(target => {
				const href = toUnix(relative(dirname(page.outRel), target.outRel)) || basename(target.outRel);
				return `<a href="${href}">${escapeHtml(target.title)}</a>`;
			})
			.join("");
		const outputPath = join(siteDir, page.outRel);
		ensureDir(dirname(outputPath));
		writeFileSync(outputPath, renderHtml(page.title, nav, page.html), "utf-8");
	}
	writeFileSync(join(siteDir, "explorer.html"), renderExplorer(graph, searchIndex), "utf-8");
}

function renderHtml(title: string, nav: string, html: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; --bg: #f8fafc; --fg: #111827; --muted: #64748b; --line: #d8dee9; --accent: #0f766e; }
@media (prefers-color-scheme: dark) { :root { --bg: #0f172a; --fg: #e5e7eb; --muted: #94a3b8; --line: #334155; --accent: #5eead4; } }
body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--fg); line-height: 1.65; }
main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
nav { display: flex; gap: 14px; flex-wrap: wrap; padding-bottom: 20px; border-bottom: 1px solid var(--line); margin-bottom: 28px; }
nav a { color: var(--accent); text-decoration: none; font-weight: 650; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 0.94em; }
pre { overflow: auto; padding: 14px 16px; border: 1px solid var(--line); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; }
th, td { border-bottom: 1px solid var(--line); padding: 8px 10px; text-align: left; }
th { color: var(--muted); font-size: 0.9em; }
</style>
</head>
<body>
<main>
<nav>${nav}</nav>
${html}
</main>
</body>
</html>
`;
}

function renderExplorer(graph: SearchIndexGraph, searchIndex: SearchIndex): string {
	const data = JSON.stringify({
		graphHash: graph.contentHash,
		modules: graph.modules,
		sources: graph.sources,
		search: searchIndex.entries,
	});
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LLM Wiki Explorer</title>
<style>
:root { color-scheme: light dark; --bg: #f8fafc; --fg: #111827; --muted: #64748b; --line: #d8dee9; --accent: #0f766e; }
@media (prefers-color-scheme: dark) { :root { --bg: #0f172a; --fg: #e5e7eb; --muted: #94a3b8; --line: #334155; --accent: #5eead4; } }
body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--fg); }
main { max-width: 1180px; margin: 0 auto; padding: 28px 20px 52px; }
.top { display: flex; gap: 12px; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); padding-bottom: 18px; }
a { color: var(--accent); text-decoration: none; font-weight: 650; }
input { width: 100%; box-sizing: border-box; margin: 22px 0 14px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--fg); font: inherit; }
.layout { display: grid; grid-template-columns: minmax(260px, 0.9fr) minmax(0, 1.5fr); gap: 18px; }
.list, .detail { border: 1px solid var(--line); border-radius: 8px; min-height: 520px; overflow: auto; }
.item { display: block; padding: 10px 12px; border-bottom: 1px solid var(--line); color: var(--fg); font-weight: 500; }
.item small { display: block; color: var(--muted); font-weight: 400; overflow-wrap: anywhere; }
.detail { padding: 18px; }
.meta { color: var(--muted); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
@media (max-width: 820px) { .layout { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
<div class="top"><div><strong>LLM Wiki Explorer</strong><div class="meta">Graph ${escapeHtml(graph.contentHash.slice(0, 12))}</div></div><a href="index.html">Wiki Home</a></div>
<input id="q" placeholder="Search pages, modules, files, symbols..." autofocus>
<div class="layout"><div id="list" class="list"></div><div id="detail" class="detail"></div></div>
</main>
<script type="application/json" id="wiki-data">${escapeHtml(data)}</script>
<script>
const data = JSON.parse(document.getElementById('wiki-data').textContent);
const list = document.getElementById('list');
const detail = document.getElementById('detail');
const q = document.getElementById('q');
const byFile = new Map(data.sources.map(s => [s.path, s]));
const byModule = new Map(data.modules.map(m => [m.path, m]));
function match(entry, query) {
  if (!query) return true;
  const hay = [entry.id, entry.kind, entry.title, entry.path, ...(entry.sources || []), ...(entry.terms || [])].join(' ').toLowerCase();
  return query.toLowerCase().split(/\\s+/).every(part => hay.includes(part));
}
function renderList() {
  const query = q.value.trim();
  const entries = data.search.filter(e => match(e, query)).slice(0, 300);
  list.innerHTML = entries.map(e => '<a class="item" href="#id=' + encodeURIComponent(e.id) + '">' + esc(e.title) + '<small>' + e.kind + ' · ' + esc(e.id) + '</small></a>').join('');
  if (!location.hash && entries[0]) renderDetail(entries[0].id);
}
function renderDetail(id) {
  const entry = data.search.find(e => e.id === id);
  if (!entry) { detail.innerHTML = '<p class="meta">No selection.</p>'; return; }
  let extra = '';
  if (entry.kind === 'file') extra = fileDetail(entry.id.replace(/^file:/, ''));
  if (entry.kind === 'module') extra = moduleDetail(entry.id.replace(/^module:/, ''));
  if (entry.kind === 'symbol') extra = symbolDetail(entry.id);
  detail.innerHTML = '<h1>' + esc(entry.title) + '</h1><p class="meta">' + entry.kind + ' · ' + esc(entry.id) + '</p><h2>Sources</h2><pre>' + esc((entry.sources || []).join('\\n')) + '</pre>' + extra;
}
function fileDetail(path) {
  const s = byFile.get(path);
  if (!s) return '';
  return '<h2>P3</h2><pre>WHO: ' + esc(s.p3.who || '') + '\\nFROM: ' + esc(s.p3.from || '') + '\\nTO: ' + esc(s.p3.to || '') + '\\nHERE: ' + esc(s.p3.here || '') + '</pre><h2>Surface</h2><pre>Exports: ' + esc(s.exports.join(', ') || 'None') + '\\nImports: ' + esc(s.imports.join(', ') || 'None') + '</pre>';
}
function moduleDetail(path) {
  const m = byModule.get(path);
  const files = data.sources.filter(s => s.moduleId === 'module:' + path);
  if (!m) return '';
  return '<h2>Module</h2><pre>P2: ' + esc(m.docPath) + '\\nFiles: ' + files.length + '\\nListed members: ' + m.memberCount + '</pre><h2>Files</h2><pre>' + esc(files.map(f => f.path).join('\\n')) + '</pre>';
}
function symbolDetail(id) {
  const raw = id.replace(/^symbol:/, '');
  const [file, symbol] = raw.split('#');
  return '<h2>Symbol</h2><pre>' + esc(symbol || '') + '\\n' + esc(file || '') + '</pre>';
}
function esc(v) { return String(v).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
q.addEventListener('input', renderList);
window.addEventListener('hashchange', () => {
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get('id');
  if (id) renderDetail(id);
});
renderList();
const initial = new URLSearchParams(location.hash.slice(1)).get('id');
if (initial) renderDetail(initial);
</script>
</body>
</html>
`;
}

function collectMarkdownPages(pagesDir: string): string[] {
	if (!existsSync(pagesDir)) return [];
	const out: string[] = [];
	function walk(dir: string): void {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
		}
	}
	walk(pagesDir);
	return out.sort((a, b) => a.localeCompare(b));
}

function parsePageFrontmatter(path: string): Record<string, unknown> | undefined {
	const content = readFileSync(path, "utf-8");
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return undefined;
	return YAML.parse(match[1]) as Record<string, unknown>;
}

function stripFrontmatter(markdown: string): string {
	return markdown.replace(/^---\n[\s\S]*?\n---\n*/, "");
}

function pageTitle(path: string, markdown: string): string {
	const frontmatter = parsePageFrontmatter(path);
	if (typeof frontmatter?.title === "string") return frontmatter.title;
	const match = stripFrontmatter(markdown).match(/^#\s+(.+)$/m);
	return match?.[1] ?? basename(path, ".md");
}

function extractTerms(text: string): string[] {
	const terms = new Set<string>();
	for (const raw of text.toLowerCase().split(/[^a-z0-9_./:-]+/)) {
		if (raw.length < 3) continue;
		terms.add(raw);
		if (terms.size >= 240) break;
	}
	return [...terms].sort();
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function ensureDir(path: string): void {
	if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function toUnix(path: string): string {
	return path.replace(/\\/g, "/");
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
