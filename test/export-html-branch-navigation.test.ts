/**
 * [WHO]: Verifies export-html branch navigation data functions against branch-heavy session shapes
 * [FROM]: Depends on node:test, node:assert, node:fs, node:vm, core/export-html/template.js
 * [TO]: Guards the standalone export template used by core/export-html and extensions/optional/export-html
 * [HERE]: test/export-html-branch-navigation.test.ts - focused snapshot coverage for exported branch tree navigation
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function extractFunction(source: string, name: string): string {
	const start = source.indexOf(`function ${name}`);
	assert.notEqual(start, -1, `Expected template function ${name} to exist.`);
	const firstBrace = source.indexOf("{", start);
	assert.notEqual(firstBrace, -1, `Expected template function ${name} to have a body.`);

	let depth = 0;
	for (let i = firstBrace; i < source.length; i++) {
		const char = source[i];
		if (char === "{") depth++;
		if (char === "}") {
			depth--;
			if (depth === 0) {
				return source.slice(start, i + 1);
			}
		}
	}
	throw new Error(`Could not extract template function ${name}.`);
}

function runBranchNavigationProbe() {
	const template = readFileSync("core/export-html/template.js", "utf-8");
	const functions = [
		"buildTree",
		"buildActivePathIds",
		"getPath",
		"findNewestLeaf",
		"flattenTree",
		"buildTreePrefix",
	].map((name) => extractFunction(template, name)).join("\n\n");

	const entries = [
		message("root-user", null, "2026-01-01T00:00:00.000Z", "user", "Start export session."),
		message("root-assistant", "root-user", "2026-01-01T00:00:01.000Z", "assistant", "Choose an implementation path."),
		message("left-user", "root-assistant", "2026-01-01T00:00:02.000Z", "user", "Explore branch A."),
		message("left-assistant", "left-user", "2026-01-01T00:00:03.000Z", "assistant", "Branch A details."),
		branchSummary("summary-a", "left-assistant", "2026-01-01T00:00:04.000Z", "Branch A was abandoned."),
		message("left-leaf", "summary-a", "2026-01-01T00:00:05.000Z", "user", "Resume branch A."),
		message("right-user", "root-assistant", "2026-01-01T00:00:06.000Z", "user", "Explore branch B."),
		message("right-assistant", "right-user", "2026-01-01T00:00:07.000Z", "assistant", "Branch B details."),
		message("right-leaf", "right-assistant", "2026-01-01T00:00:08.000Z", "user", "Finish branch B."),
	];

	const script = `
		const entries = ${JSON.stringify(entries)};
		const byId = new Map(entries.map((entry) => [entry.id, entry]));
		const labelMap = new Map();
		let treeNodeMap = null;
		${functions}

		const currentLeafId = "left-leaf";
		const tree = buildTree();
		const activePathIds = buildActivePathIds(currentLeafId);
		const flatNodes = flattenTree(tree, activePathIds);
		const newestFromFork = findNewestLeaf("root-assistant");

		result = {
			activePath: [...activePathIds],
			leftPath: getPath("left-leaf").map((entry) => entry.id),
			rightPath: getPath("right-leaf").map((entry) => entry.id),
			newestFromFork,
			treeSnapshot: flatNodes.map((flatNode) => ({
				id: flatNode.node.entry.id,
				prefix: buildTreePrefix(flatNode),
				inPath: activePathIds.has(flatNode.node.entry.id),
			})),
		};
	`;

	const context = { result: undefined };
	vm.runInNewContext(script, context);
	return JSON.parse(JSON.stringify(context.result)) as {
		activePath: string[];
		leftPath: string[];
		rightPath: string[];
		newestFromFork: string;
		treeSnapshot: Array<{ id: string; prefix: string; inPath: boolean }>;
	};
}

function message(id: string, parentId: string | null, timestamp: string, role: "user" | "assistant", text: string) {
	return {
		type: "message",
		id,
		parentId,
		timestamp,
		message: {
			role,
			content: role === "user" ? text : [{ type: "text", text }],
		},
	};
}

function branchSummary(id: string, parentId: string, timestamp: string, summary: string) {
	return {
		type: "branch_summary",
		id,
		parentId,
		timestamp,
		fromId: parentId,
		summary,
	};
}

test("export-html branch navigation keeps active path and newest descendant distinct", () => {
	const result = runBranchNavigationProbe();

	assert.deepEqual(result.activePath, [
		"left-leaf",
		"summary-a",
		"left-assistant",
		"left-user",
		"root-assistant",
		"root-user",
	]);
	assert.deepEqual(result.leftPath, [
		"root-user",
		"root-assistant",
		"left-user",
		"left-assistant",
		"summary-a",
		"left-leaf",
	]);
	assert.deepEqual(result.rightPath, [
		"root-user",
		"root-assistant",
		"right-user",
		"right-assistant",
		"right-leaf",
	]);
	assert.equal(result.newestFromFork, "right-leaf");
});

test("export-html branch tree snapshot renders active branch before sibling branch", () => {
	const result = runBranchNavigationProbe();
	const snapshot = result.treeSnapshot.map((node) => `${node.prefix}${node.inPath ? "*" : " "} ${node.id}`);

	assert.deepEqual(snapshot, [
		"* root-user",
		"* root-assistant",
		"├─ * left-user",
		"│     * left-assistant",
		"│     * summary-a",
		"│     * left-leaf",
		"└─   right-user",
		"        right-assistant",
		"        right-leaf",
	]);
});
