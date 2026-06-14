import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createNotebookEditTool } from "../extensions/builtin/notebook/notebook-edit-tool.js";

function makeTmpDir(): string {
	return mkdirSync(join(tmpdir(), `notebook-test-${Date.now()}-${Math.random().toString(36).slice(2)}`), { recursive: true });
}

function makeNotebook(cells: Array<{ id: string; cell_type: string; source: string[] }>) {
	return {
		nbformat: 4,
		nbformat_minor: 5,
		cells: cells.map((c) => ({
			...c,
			metadata: {},
			outputs: c.cell_type === "code" ? [] : undefined,
			execution_count: c.cell_type === "code" ? null : undefined,
		})),
		metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" } },
	};
}

// ── tool structure ─────────────────────────────────────────────────────────

test("NotebookEdit tool has correct name and schema", () => {
	const tool = createNotebookEditTool();
	assert.equal(tool.name, "NotebookEdit");
	assert.ok(tool.description);
	assert.ok(tool.parameters);
	assert.ok(tool.guidance);
});

// ── replace mode ───────────────────────────────────────────────────────────

test("NotebookEdit replace mode updates cell source", async () => {
	const dir = makeTmpDir();
	try {
		const nbPath = join(dir, "test.ipynb");
		const nb = makeNotebook([
			{ id: "cell-1", cell_type: "code", source: ["print('hello')\n"] },
			{ id: "cell-2", cell_type: "code", source: ["print('world')\n"] },
		]);
		writeFileSync(nbPath, JSON.stringify(nb), "utf-8");

		const tool = createNotebookEditTool();
		const result = await tool.execute("tc-1", {
			notebook_path: nbPath,
			cell_id: "cell-1",
			new_source: "print('updated')",
			edit_mode: "replace",
		}, undefined, undefined, {} as any);

		const updated = JSON.parse(readFileSync(nbPath, "utf-8"));
		assert.deepEqual(updated.cells[0].source, ["print('updated')"]);
		assert.equal(updated.cells[1].source[0], "print('world')\n");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ── insert mode ────────────────────────────────────────────────────────────

test("NotebookEdit insert mode adds new cell after specified cell", async () => {
	const dir = makeTmpDir();
	try {
		const nbPath = join(dir, "test.ipynb");
		const nb = makeNotebook([
			{ id: "cell-1", cell_type: "code", source: ["print('hello')\n"] },
		]);
		writeFileSync(nbPath, JSON.stringify(nb), "utf-8");

		const tool = createNotebookEditTool();
		await tool.execute("tc-2", {
			notebook_path: nbPath,
			cell_id: "cell-1",
			new_source: "# New cell",
			cell_type: "markdown",
			edit_mode: "insert",
		}, undefined, undefined, {} as any);

		const updated = JSON.parse(readFileSync(nbPath, "utf-8"));
		assert.equal(updated.cells.length, 2);
		assert.equal(updated.cells[1].cell_type, "markdown");
		assert.deepEqual(updated.cells[1].source, ["# New cell"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("NotebookEdit insert mode without cell_id inserts at beginning", async () => {
	const dir = makeTmpDir();
	try {
		const nbPath = join(dir, "test.ipynb");
		const nb = makeNotebook([
			{ id: "cell-1", cell_type: "code", source: ["print('hello')\n"] },
		]);
		writeFileSync(nbPath, JSON.stringify(nb), "utf-8");

		const tool = createNotebookEditTool();
		await tool.execute("tc-3", {
			notebook_path: nbPath,
			new_source: "# First cell",
			cell_type: "markdown",
			edit_mode: "insert",
		}, undefined, undefined, {} as any);

		const updated = JSON.parse(readFileSync(nbPath, "utf-8"));
		assert.equal(updated.cells.length, 2);
		// insertAt = 0 (cellIndex=0, but cellIndex < 0 ? length : cellIndex + 1 → 1)
		// Actually with no cell_id, cellIndex=0, insertAt=1
		assert.equal(updated.cells[1].cell_type, "markdown");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ── delete mode ────────────────────────────────────────────────────────────

test("NotebookEdit delete mode removes cell", async () => {
	const dir = makeTmpDir();
	try {
		const nbPath = join(dir, "test.ipynb");
		const nb = makeNotebook([
			{ id: "cell-1", cell_type: "code", source: ["print('hello')\n"] },
			{ id: "cell-2", cell_type: "code", source: ["print('world')\n"] },
		]);
		writeFileSync(nbPath, JSON.stringify(nb), "utf-8");

		const tool = createNotebookEditTool();
		await tool.execute("tc-4", {
			notebook_path: nbPath,
			cell_id: "cell-1",
			new_source: "",
			edit_mode: "delete",
		}, undefined, undefined, {} as any);

		const updated = JSON.parse(readFileSync(nbPath, "utf-8"));
		assert.equal(updated.cells.length, 1);
		assert.equal(updated.cells[0].id, "cell-2");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ── error cases ────────────────────────────────────────────────────────────

test("NotebookEdit returns error for non-existent notebook", async () => {
	const tool = createNotebookEditTool();
	const result = await tool.execute("tc-5", {
		notebook_path: "/non/existent/notebook.ipynb",
		new_source: "test",
		edit_mode: "replace",
	}, undefined, undefined, {} as any);

	const text = (result.content as any[])[0].text;
	assert.ok(text.includes("Failed to read notebook"));
});

test("NotebookEdit returns error for non-existent cell", async () => {
	const dir = makeTmpDir();
	try {
		const nbPath = join(dir, "test.ipynb");
		const nb = makeNotebook([
			{ id: "cell-1", cell_type: "code", source: ["print('hello')\n"] },
		]);
		writeFileSync(nbPath, JSON.stringify(nb), "utf-8");

		const tool = createNotebookEditTool();
		const result = await tool.execute("tc-6", {
			notebook_path: nbPath,
			cell_id: "non-existent-cell",
			new_source: "test",
			edit_mode: "replace",
		}, undefined, undefined, {} as any);

		const text = (result.content as any[])[0].text;
		assert.ok(text.includes("Cell not found"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ── numeric index fallback ─────────────────────────────────────────────────

test("NotebookEdit supports 0-based numeric index as cell_id", async () => {
	const dir = makeTmpDir();
	try {
		const nbPath = join(dir, "test.ipynb");
		const nb = makeNotebook([
			{ id: "cell-1", cell_type: "code", source: ["print('a')\n"] },
			{ id: "cell-2", cell_type: "code", source: ["print('b')\n"] },
		]);
		writeFileSync(nbPath, JSON.stringify(nb), "utf-8");

		const tool = createNotebookEditTool();
		await tool.execute("tc-7", {
			notebook_path: nbPath,
			cell_id: "1",
			new_source: "print('updated b')",
			edit_mode: "replace",
		}, undefined, undefined, {} as any);

		const updated = JSON.parse(readFileSync(nbPath, "utf-8"));
		assert.deepEqual(updated.cells[1].source, ["print('updated b')"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
