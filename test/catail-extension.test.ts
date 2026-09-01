/**
 * [WHO]: Verifies CATAIL explicit Skill registration, scientific-method routing resources, bootstrap behavior, and deterministic artifact audit
 * [FROM]: Depends on node:test/assert/fs/os/path, builtin-extensions, CATAIL extension, and CATAIL audit script
 * [TO]: Consumed by focused CATAIL verification and default extension contract checks
 * [HERE]: test/catail-extension.test.ts - CATAIL workflow regression coverage
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { builtInExtensions, getBuiltinExtensionPaths } from "../builtin-extensions.ts";
import catailExtension, { CATAIL_BOOTSTRAP_PROMPT } from "../extensions/builtin/catail/index.ts";
import { auditWorkspace } from "../extensions/builtin/catail/scripts/audit.mjs";
import type { ExtensionAPI, ExtensionContext, ResourcesDiscoverResult } from "../core/extensions-host/types.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function createApiHarness(): { api: ExtensionAPI; handlers: Map<string, Handler[]>; registeredCommands: string[] } {
	const handlers = new Map<string, Handler[]>();
	const registeredCommands: string[] = [];
	const api = {
		cwd: process.cwd(),
		agentDir: join(process.cwd(), ".catui-test-agent"),
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerCommand(name: string) {
			registeredCommands.push(name);
		},
	} as unknown as ExtensionAPI;
	return { api, handlers, registeredCommands };
}

test("builtin extensions include passive default CATAIL metadata and path", () => {
	assert.ok(
		builtInExtensions.some(
			(extension) =>
				extension.id === "catail" &&
				extension.defaultEnabled &&
				extension.riskLevel === "passive" &&
				!extension.writesWorkspace &&
				!extension.externalProcess &&
				extension.resourceDiscovery,
		),
	);
	assert.ok(getBuiltinExtensionPaths().some((path) => path.includes(join("extensions", "builtin", "catail"))));
});

test("CATAIL discovers one explicit-use skill without registering a dedicated slash command", async () => {
	const { api, handlers, registeredCommands } = createApiHarness();
	await catailExtension(api);

	const discover = handlers.get("resources_discover")?.[0];
	assert.ok(discover);
	const resources = discover({ type: "resources_discover", cwd: process.cwd(), reason: "startup" }, {} as ExtensionContext) as ResourcesDiscoverResult;
	assert.equal(resources.skillPaths?.length, 1);
	assert.ok(resources.skillPaths?.[0]?.endsWith(join("catail", "SKILL.md")));
	assert.deepEqual(registeredCommands, []);

	const before = handlers.get("before_agent_start")?.[0];
	assert.ok(before);
	const result = before({ type: "before_agent_start", prompt: "Design a study", systemPrompt: "base" }, {} as ExtensionContext) as { appendSystemPrompt?: string };
	assert.equal(result.appendSystemPrompt, CATAIL_BOOTSTRAP_PROMPT);
	assert.match(result.appendSystemPrompt ?? "", /only when the user explicitly invokes `\/skill:catail` or explicitly asks to use CATAIL/i);
	assert.match(result.appendSystemPrompt ?? "", /Do not infer activation/i);
	assert.match(result.appendSystemPrompt ?? "", /ordinary coding remains Catui's default behavior/i);
	assert.ok((result.appendSystemPrompt ?? "").length < 1_200, "Default prompt overhead should stay bounded.");
});

const CATAIL_ROOT = join(process.cwd(), "extensions", "builtin", "catail");

test("CATAIL routes through a resolvable nine-mode scientific method catalog", () => {
	const skill = readFileSync(join(CATAIL_ROOT, "SKILL.md"), "utf8");
	assert.match(skill, /CATAIL — Professional Scientific Agent/);
	assert.match(skill, /Use only when the user explicitly invokes \/skill:catail/);
	assert.match(skill, /foundations\/scientific-methods\.md/);
	assert.match(skill, /dialogue language/);
	assert.match(skill, /artifact language/);

	const linkedReferences = [...skill.matchAll(/\]\((references\/[^)]+\.md)\)/g)].map((match) => match[1]);
	assert.ok(linkedReferences.length >= 10);
	for (const relativePath of linkedReferences) {
		assert.ok(existsSync(join(CATAIL_ROOT, relativePath)), `Missing linked CATAIL reference: ${relativePath}`);
	}

	const catalog = readFileSync(join(CATAIL_ROOT, "references", "foundations", "scientific-methods.md"), "utf8");
	const modes = [
		"Evidence Synthesis",
		"Exploratory Discovery",
		"Theory Building",
		"Observational Research",
		"Experimental Research",
		"Computational Research",
		"Qualitative & Mixed Methods",
		"Method & Artifact Research",
		"Reproduction & Replication",
	];
	for (const [index, mode] of modes.entries()) {
		assert.ok(catalog.includes(`## ${index + 1}. ${mode}`), `Missing scientific mode: ${mode}`);
	}
	assert.match(catalog, /\*\*Cannot establish alone\*\*/);
	assert.match(catalog, /\*\*Validity risks and quality floor\*\*/);
	assert.match(catalog, /\*\*Common combinations\*\*/);
});

function copyResolvedTemplate(name: string, destination: string) {
	mkdirSync(dirname(destination), { recursive: true });
	const source = join(CATAIL_ROOT, "templates", name);
	writeFileSync(destination, readFileSync(source, "utf8").replaceAll("unresolved", "resolved").replaceAll("not_started", "resolved"), "utf8");
}

function makeCompleteWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "catail-audit-"));
	const research = join(root, "research");
	copyResolvedTemplate("RESEARCH.md", join(research, "RESEARCH.md"));
	copyResolvedTemplate("METHOD.md", join(research, "METHOD.md"));

	copyResolvedTemplate("search-log.csv", join(research, "literature", "search-log.csv"));
	writeFileSync(join(research, "literature", "search-log.csv"), `${readFileSync(join(research, "literature", "search-log.csv"), "utf8")}Q-001,OpenAlex,agent memory,year>=2024,2026-09-01,10,SRC-001,complete,bounded mapping\n`, "utf8");
	copyResolvedTemplate("source-register.csv", join(research, "literature", "source-register.csv"));
	writeFileSync(join(research, "literature", "source-register.csv"), `${readFileSync(join(research, "literature", "source-register.csv"), "utf8")}SRC-001,Q-001,Verified memory benchmark paper,10.0000/example,journal-article,published,2025,https://example.test/paper,full-text-checked,direct comparison,prior effect,boundary limits,synthetic fixture,owner,2026-09-01\n`, "utf8");

	copyResolvedTemplate("POSITION.md", join(research, "POSITION.md"));
	writeFileSync(join(research, "POSITION.md"), readFileSync(join(research, "POSITION.md"), "utf8").replaceAll("resolved", "resolved with SRC-001").replace("search-more — resolved with SRC-001", "advance — bounded contribution supported by SRC-001"), "utf8");

	copyResolvedTemplate("claims.csv", join(research, "claims", "claims.csv"));
	writeFileSync(join(research, "claims", "claims.csv"), `${readFileSync(join(research, "claims", "claims.csv"), "utf8")}C-001,Selective memory improves task success,associational,supported,coding agents,token budget,prespecified improvement,benchmark result,E-001,SRC-001,confirmatory,owner,2026-09-01\n`, "utf8");
	copyResolvedTemplate("hypothesis-register.csv", join(research, "claims", "hypothesis-register.csv"));
	writeFileSync(join(research, "claims", "hypothesis-register.csv"), `${readFileSync(join(research, "claims", "hypothesis-register.csv"), "utf8")}H-001,C-001,Selective memory improves task success,human,mechanism,SRC-001,none,memory tasks improve,no improvement,wide interval,SRC-001,planned\n`, "utf8");

	copyResolvedTemplate("STUDY.md", join(research, "studies", "S-001", "STUDY.md"));
	writeFileSync(join(research, "studies", "S-001", "STUDY.md"), readFileSync(join(research, "studies", "S-001", "STUDY.md"), "utf8").replace("## Status\n\ndraft", "## Status\n\nfrozen r1").replace("## Study Role\n\nresolved", "## Study Role\n\nconfirmatory"), "utf8");

	copyResolvedTemplate("run-manifest.json", join(research, "runs", "R-001", "manifest.json"));
	const manifestPath = join(research, "runs", "R-001", "manifest.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	Object.assign(manifest, { runId: "R-001", studyId: "S-001", protocolRevision: "r1", status: "complete", operator: "owner", startedAt: "2026-09-01T00:00:00Z", completedAt: "2026-09-01T01:00:00Z", codeRevision: "abc123", command: "npm test", outputs: ["results.json"] });
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

	copyResolvedTemplate("analysis-register.csv", join(research, "analysis", "analysis-register.csv"));
	writeFileSync(join(research, "analysis", "analysis-register.csv"), `${readFileSync(join(research, "analysis", "analysis-register.csv"), "utf8")}A-001,S-001,R-001,confirmatory,S-001-r1,complete,analysis.json,none,2026-09-01,owner\n`, "utf8");

	copyResolvedTemplate("claim-evidence.csv", join(research, "evidence", "claim-evidence.csv"));
	writeFileSync(join(research, "evidence", "claim-evidence.csv"), `${readFileSync(join(research, "evidence", "claim-evidence.csv"), "utf8")}E-001,C-001,analysis,analysis.json,SRC-001,supports,coding agents,95% CI,verified,owner,2026-09-01,bounded benchmark\n`, "utf8");

	copyResolvedTemplate("iteration-log.csv", join(research, "iterations", "iteration-log.csv"));
	return root;
}

test("CATAIL audit accepts a structurally complete evidence trail", () => {
	const root = makeCompleteWorkspace();
	try {
		const result = auditWorkspace({ root, stage: "write" });
		assert.equal(result.ok, true, JSON.stringify(result.issues));
		assert.deepEqual(result.checks, { searches: 1, sources: 1, claims: 1, hypotheses: 1, analyses: 1, evidence: 1, iterations: 0 });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("CATAIL design gate rejects a study created before research positioning", () => {
	const root = makeCompleteWorkspace();
	try {
		unlinkSync(join(root, "research", "POSITION.md"));
		const result = auditWorkspace({ root, stage: "design" });
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((entry) => entry.code === "missing-file" && entry.path.endsWith("POSITION.md")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("CATAIL design gate rejects a confirmatory study after a pilot-only decision", () => {
	const root = makeCompleteWorkspace();
	try {
		const path = join(root, "research", "POSITION.md");
		writeFileSync(path, readFileSync(path, "utf8").replace("advance —", "pilot-only —"), "utf8");
		const result = auditWorkspace({ root, stage: "design" });
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((entry) => entry.code === "pilot-only-role"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("CATAIL audit rejects a supported claim bound to unverified evidence", () => {
	const root = makeCompleteWorkspace();
	try {
		const path = join(root, "research", "evidence", "claim-evidence.csv");
		writeFileSync(path, readFileSync(path, "utf8").replace(",verified,", ",unverified,"), "utf8");
		const result = auditWorkspace({ root, stage: "write" });
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((entry) => entry.code === "unverified-evidence"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
