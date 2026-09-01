/**
 * [WHO]: auditWorkspace(), runCli() - read-only structural checks for CATAIL research artifacts
 * [FROM]: Depends only on node:fs, node:path, node:url, and project-local research files
 * [TO]: Invoked explicitly by the CATAIL audit playbook and focused tests
 * [HERE]: extensions/builtin/catail/scripts/audit.mjs - deterministic artifact gate, not a scientific merit evaluator
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STAGES = ["frame", "search", "claim", "design", "experiment", "analyze", "write"];

const CONTRACTS = {
	RESEARCH: [
		"Purpose",
		"Accountable Owner",
		"Intended Use",
		"Primary Question",
		"Scope",
		"Out of Scope",
		"Falsification Conditions",
		"Governance and Safety",
		"Current Stage",
		"Open Decisions",
	],
	METHOD: [
		"Evidence Policy",
		"Literature Search Policy",
		"Claim Lifecycle",
		"Protocol Revision Policy",
		"Analysis Classes",
		"Reproducibility Policy",
		"Confidentiality and External Services",
		"Human Approval Gates",
	],
	STUDY: [
		"Study ID and Revision",
		"Status",
		"Research Question",
		"Claim IDs",
		"Hypotheses and Predictions",
		"Units and Population",
		"Conditions and Controls",
		"Variables and Metrics",
		"Allocation and Replication",
		"Data and Code Versions",
		"Planned Analysis",
		"Exclusions and Missingness",
		"Stopping and Failure Rules",
		"Safety and Governance",
		"Amendments",
	],
	search: ["search_id", "source", "query", "filters", "accessed_at", "result_count", "retained_ids", "status", "notes"],
	claims: ["claim_id", "statement", "claim_type", "status", "scope", "rival_explanations", "prediction", "evidence_needed", "evidence_ids", "source_ids", "analysis_class", "owner", "verified_at"],
	analysis: ["analysis_id", "study_id", "run_ids", "analysis_class", "plan_reference", "status", "artifact_path", "deviations", "created_at", "owner"],
	evidence: ["evidence_id", "claim_id", "evidence_type", "artifact_path", "source_ids", "direction", "scope", "uncertainty", "verification_status", "verified_by", "verified_at", "limitations"],
};

function readText(path) {
	return readFileSync(path, "utf8");
}

function parseCsv(text) {
	const rows = [];
	let row = [];
	let field = "";
	let quoted = false;
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if (character === '"') {
			if (quoted && text[index + 1] === '"') {
				field += '"';
				index += 1;
			} else {
				quoted = !quoted;
			}
		} else if (character === "," && !quoted) {
			row.push(field.trim());
			field = "";
		} else if ((character === "\n" || character === "\r") && !quoted) {
			if (character === "\r" && text[index + 1] === "\n") index += 1;
			row.push(field.trim());
			field = "";
			if (row.some((value) => value !== "")) rows.push(row);
			row = [];
		} else {
			field += character;
		}
	}
	if (quoted) throw new Error("CSV contains an unterminated quoted field.");
	row.push(field.trim());
	if (row.some((value) => value !== "")) rows.push(row);
	if (rows.length === 0) return { headers: [], records: [] };
	const headers = rows[0];
	const records = rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
	return { headers, records };
}

function markdownSections(text) {
	const sections = new Map();
	const matches = [...text.matchAll(/^##\s+(.+?)\s*$/gm)];
	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index];
		const start = (match.index ?? 0) + match[0].length;
		const end = matches[index + 1]?.index ?? text.length;
		sections.set(match[1].trim(), text.slice(start, end).trim());
	}
	return sections;
}

function listFiles(root, name) {
	if (!existsSync(root)) return [];
	const results = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) results.push(...listFiles(path, name));
		else if (entry.isFile() && entry.name === name) results.push(path);
	}
	return results;
}

function issue(code, path, message) {
	return { code, path, message };
}

function checkMarkdown(path, headings, requiredValues = []) {
	if (!existsSync(path)) return [issue("missing-file", path, "Required artifact is missing.")];
	const sections = markdownSections(readText(path));
	const issues = [];
	for (const heading of headings) {
		if (!sections.has(heading)) issues.push(issue("missing-heading", path, `Missing heading: ${heading}`));
	}
	for (const heading of requiredValues) {
		const value = sections.get(heading)?.trim().toLowerCase() ?? "";
		if (!value || value === "unresolved" || value === "not_started") {
			issues.push(issue("unresolved-value", path, `Section must be resolved before this gate: ${heading}`));
		}
	}
	return issues;
}

function checkCsv(path, requiredHeaders, requireRows) {
	if (!existsSync(path)) return { issues: [issue("missing-file", path, "Required register is missing.")], records: [] };
	try {
		const { headers, records } = parseCsv(readText(path));
		const issues = requiredHeaders.filter((header) => !headers.includes(header)).map((header) => issue("missing-column", path, `Missing CSV column: ${header}`));
		if (requireRows && records.length === 0) issues.push(issue("empty-register", path, "At least one record is required for this gate."));
		return { issues, records };
	} catch (error) {
		return { issues: [issue("invalid-csv", path, error instanceof Error ? error.message : String(error))], records: [] };
	}
}

function checkUniqueIds(records, field, path) {
	const issues = [];
	const seen = new Set();
	for (const record of records) {
		const id = record[field]?.trim() ?? "";
		if (!id) {
			issues.push(issue("missing-id", path, `Record is missing ${field}.`));
		} else if (seen.has(id)) {
			issues.push(issue("duplicate-id", path, `Duplicate ${field}: ${id}`));
		} else {
			seen.add(id);
		}
	}
	return issues;
}

function checkRunManifest(path) {
	try {
		const manifest = JSON.parse(readText(path));
		const required = ["runId", "studyId", "protocolRevision", "status", "operator", "startedAt", "codeRevision", "environment", "configuration", "command", "outputs", "deviations"];
		const issues = required.filter((field) => !(field in manifest)).map((field) => issue("missing-field", path, `Missing run manifest field: ${field}`));
		for (const field of ["runId", "studyId", "protocolRevision", "status", "operator", "startedAt", "codeRevision", "command"]) {
			const value = manifest[field];
			if (value === null || value === "" || value === "unresolved" || value === "not_started") issues.push(issue("unresolved-value", path, `Run manifest field must be resolved: ${field}`));
		}
		if (!Array.isArray(manifest.outputs) || manifest.outputs.length === 0) issues.push(issue("missing-output", path, "Run manifest must identify at least one output or log."));
		return issues;
	} catch (error) {
		return [issue("invalid-json", path, error instanceof Error ? error.message : String(error))];
	}
}

export function auditWorkspace({ root = process.cwd(), stage = "write" } = {}) {
	if (!STAGES.includes(stage)) throw new Error(`Unknown stage '${stage}'. Expected one of: ${STAGES.join(", ")}.`);
	const projectRoot = resolve(root);
	const researchRoot = join(projectRoot, "research");
	const issues = [];
	const stageIndex = STAGES.indexOf(stage);
	const reaches = (name) => stageIndex >= STAGES.indexOf(name);

	issues.push(...checkMarkdown(join(researchRoot, "RESEARCH.md"), CONTRACTS.RESEARCH, ["Purpose", "Accountable Owner", "Intended Use", "Primary Question", "Scope", "Falsification Conditions", "Governance and Safety"]));
	issues.push(...checkMarkdown(join(researchRoot, "METHOD.md"), CONTRACTS.METHOD, ["Confidentiality and External Services", "Human Approval Gates"]));

	const search = checkCsv(join(researchRoot, "literature", "search-log.csv"), CONTRACTS.search, reaches("search"));
	issues.push(...search.issues);
	issues.push(...checkUniqueIds(search.records, "search_id", join(researchRoot, "literature", "search-log.csv")));
	const claims = checkCsv(join(researchRoot, "claims", "claims.csv"), CONTRACTS.claims, reaches("claim"));
	issues.push(...claims.issues);
	issues.push(...checkUniqueIds(claims.records, "claim_id", join(researchRoot, "claims", "claims.csv")));

	if (reaches("design")) {
		const studies = listFiles(join(researchRoot, "studies"), "STUDY.md");
		if (studies.length === 0) issues.push(issue("missing-study", join(researchRoot, "studies"), "At least one study contract is required."));
		for (const path of studies) {
			issues.push(...checkMarkdown(path, CONTRACTS.STUDY, ["Study ID and Revision", "Status", "Research Question", "Claim IDs", "Units and Population", "Conditions and Controls", "Planned Analysis", "Safety and Governance"]));
			const status = markdownSections(readText(path)).get("Status")?.toLowerCase() ?? "";
			if (!status.includes("frozen")) issues.push(issue("study-not-frozen", path, "Study status must identify a frozen protocol revision."));
		}
	}

	if (reaches("experiment")) {
		const manifests = listFiles(join(researchRoot, "runs"), "manifest.json");
		if (manifests.length === 0) issues.push(issue("missing-run", join(researchRoot, "runs"), "At least one run manifest is required."));
		for (const path of manifests) issues.push(...checkRunManifest(path));
	}

	const analyses = checkCsv(join(researchRoot, "analysis", "analysis-register.csv"), CONTRACTS.analysis, reaches("analyze"));
	issues.push(...analyses.issues);
	issues.push(...checkUniqueIds(analyses.records, "analysis_id", join(researchRoot, "analysis", "analysis-register.csv")));
	for (const record of analyses.records) {
		if (!["confirmatory", "exploratory", "post-hoc"].includes(record.analysis_class)) issues.push(issue("invalid-analysis-class", join(researchRoot, "analysis", "analysis-register.csv"), `Analysis ${record.analysis_id || "<missing-id>"} has invalid class '${record.analysis_class}'.`));
	}

	const evidence = checkCsv(join(researchRoot, "evidence", "claim-evidence.csv"), CONTRACTS.evidence, reaches("write"));
	issues.push(...evidence.issues);
	issues.push(...checkUniqueIds(evidence.records, "evidence_id", join(researchRoot, "evidence", "claim-evidence.csv")));
	if (reaches("write")) {
		const evidenceById = new Map(evidence.records.map((record) => [record.evidence_id, record]));
		for (const claim of claims.records.filter((record) => ["supported", "mixed"].includes(record.status))) {
			const ids = claim.evidence_ids.split(/[;|]/).map((value) => value.trim()).filter(Boolean);
			if (ids.length === 0) issues.push(issue("unbound-claim", join(researchRoot, "claims", "claims.csv"), `Claim ${claim.claim_id || "<missing-id>"} has status '${claim.status}' but no evidence IDs.`));
			for (const id of ids) {
				const record = evidenceById.get(id);
				if (!record) issues.push(issue("missing-evidence", join(researchRoot, "evidence", "claim-evidence.csv"), `Claim ${claim.claim_id} references unknown evidence ${id}.`));
				else if (record.claim_id !== claim.claim_id) issues.push(issue("claim-evidence-mismatch", join(researchRoot, "evidence", "claim-evidence.csv"), `Evidence ${id} is bound to ${record.claim_id}, not ${claim.claim_id}.`));
				else if (record.verification_status !== "verified") issues.push(issue("unverified-evidence", join(researchRoot, "evidence", "claim-evidence.csv"), `Evidence ${id} is not verified.`));
			}
		}
	}

	return { ok: issues.length === 0, stage, root: projectRoot, checks: { searches: search.records.length, claims: claims.records.length, analyses: analyses.records.length, evidence: evidence.records.length }, issues };
}

function parseArgs(args) {
	let root = process.cwd();
	let stage = "write";
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "--root") root = args[++index] ?? root;
		else if (args[index] === "--stage") stage = args[++index] ?? stage;
		else if (args[index] === "--help" || args[index] === "-h") return { help: true, root, stage };
		else throw new Error(`Unknown argument: ${args[index]}`);
	}
	return { help: false, root, stage };
}

export function runCli(args = process.argv.slice(2)) {
	const options = parseArgs(args);
	if (options.help) {
		console.log("Usage: node audit.mjs [--root <project>] [--stage <frame|search|claim|design|experiment|analyze|write>]");
		return 0;
	}
	const result = auditWorkspace(options);
	console.log(JSON.stringify(result, null, 2));
	return result.ok ? 0 : 2;
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryPath === import.meta.url) {
	try {
		process.exitCode = runCli();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
