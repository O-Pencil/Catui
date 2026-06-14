/**
 * [WHO]: NotebookEdit tool - edit Jupyter notebook cells
 * [FROM]: Claude Code NotebookEdit tool (aligned)
 * [TO]: Consumed by notebook extension via registerTool()
 * [HERE]: extensions/builtin/notebook/notebook-edit-tool.ts
 *
 * Supports replace, insert, and delete operations on notebook cells.
 * Notebooks are JSON files with nbformat, cells[], and metadata.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@catui/agent-core";
import type { ExtensionContext } from "../../../core/extensions-host/types.js";

const notebookEditSchema = Type.Object({
	notebook_path: Type.String({ description: "Absolute path to the .ipynb file" }),
	cell_id: Type.Optional(Type.String({ description: "The ID of the cell to edit. For insert mode, the new cell is inserted after this ID. If omitted, operates on the first cell or inserts at the beginning." })),
	new_source: Type.String({ description: "The new source for the cell" }),
	cell_type: Type.Optional(Type.Union([Type.Literal("code"), Type.Literal("markdown")], { description: "The cell type (default: code). Only used for insert mode." })),
	edit_mode: Type.Optional(Type.Union([Type.Literal("replace"), Type.Literal("insert"), Type.Literal("delete")], { description: "The edit mode (default: replace)" })),
});

export type NotebookEditInput = Static<typeof notebookEditSchema>;

interface NotebookCell {
	id?: string;
	cell_type: string;
	source: string[];
	metadata: Record<string, unknown>;
	outputs?: unknown[];
	execution_count?: number | null;
	[key: string]: unknown;
}

interface Notebook {
	nbformat: number;
	nbformat_minor: number;
	cells: NotebookCell[];
	metadata: Record<string, unknown>;
	[key: string]: unknown;
}

function findCellIndex(cells: NotebookCell[], cellId: string | undefined): number {
	if (!cellId) return 0;
	// Try matching by id field
	const byId = cells.findIndex((c) => c.id === cellId);
	if (byId >= 0) return byId;
	// Fallback: try as 0-based index
	const idx = parseInt(cellId, 10);
	if (!isNaN(idx) && idx >= 0 && idx < cells.length) return idx;
	return -1;
}

function toSourceArray(source: string): string[] {
	const lines = source.split("\n");
	return lines.map((line, i) => (i < lines.length - 1 ? line + "\n" : line));
}

export function createNotebookEditTool() {
	return {
		name: "NotebookEdit",
		label: "Notebook Edit",
		description:
			"Edit a cell in a Jupyter notebook (.ipynb file). Supports replace, insert, and delete operations.",
		parameters: notebookEditSchema,

		guidance: `Use NotebookEdit to modify cells in Jupyter notebook files.

- replace: Replaces the source of an existing cell (requires cell_id)
- insert: Inserts a new cell after the specified cell_id (or at beginning if omitted)
- delete: Removes the specified cell (requires cell_id)
- cell_id can be the cell's id field or a 0-based index
- Source is the code or markdown content of the cell
- Always read the notebook first to understand its structure and find cell IDs`,

		async execute(
			_toolCallId: string,
			params: NotebookEditInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			const mode = params.edit_mode ?? "replace";

			let notebook: Notebook;
			try {
				const raw = readFileSync(params.notebook_path, "utf-8");
				notebook = JSON.parse(raw) as Notebook;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Failed to read notebook: ${message}` }],
					details: undefined,
				};
			}

			if (!notebook.nbformat || !Array.isArray(notebook.cells)) {
				return {
					content: [{ type: "text", text: "Invalid notebook format: missing nbformat or cells array" }],
					details: undefined,
				};
			}

			const cellIndex = findCellIndex(notebook.cells, params.cell_id);

			switch (mode) {
				case "replace": {
					if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
						return {
							content: [{ type: "text", text: `Cell not found: ${params.cell_id}` }],
							details: undefined,
						};
					}
					notebook.cells[cellIndex]!.source = toSourceArray(params.new_source);
					break;
				}

				case "insert": {
					const insertAt = cellIndex < 0 ? notebook.cells.length : cellIndex + 1;
					const newCell: NotebookCell = {
						cell_type: params.cell_type ?? "code",
						source: toSourceArray(params.new_source),
						metadata: {},
					};
					if (newCell.cell_type === "code") {
						newCell.outputs = [];
						newCell.execution_count = null;
					}
					notebook.cells.splice(insertAt, 0, newCell);
					break;
				}

				case "delete": {
					if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
						return {
							content: [{ type: "text", text: `Cell not found: ${params.cell_id}` }],
							details: undefined,
						};
					}
					notebook.cells.splice(cellIndex, 1);
					break;
				}
			}

			try {
				writeFileSync(params.notebook_path, JSON.stringify(notebook, null, 1), "utf-8");
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Failed to write notebook: ${message}` }],
					details: undefined,
				};
			}

			return {
				content: [{
					type: "text",
					text: `Notebook cell ${mode} successful. Cell ${params.cell_id ?? "(first)"} ${mode === "delete" ? "removed" : "updated"}. Total cells: ${notebook.cells.length}`,
				}],
				details: undefined,
			};
		},
	};
}
