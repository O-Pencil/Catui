/**
 * [WHO]: Verifies bundled Persona discovery, selection validation, and local customization preservation
 * [FROM]: Depends on node:test/assert/fs/os/path and core/persona/persona-manager
 * [TO]: Run by focused Persona regression checks and release verification
 * [HERE]: test/persona-manager.test.ts - generic PersonaManager behavior coverage
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PersonaManager } from "../core/persona/persona-manager.ts";

function withManager(run: (manager: PersonaManager, root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "catui-persona-manager-"));
	try {
		run(new PersonaManager({ id: "test", path: root }), root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("PersonaManager discovers bundled Vera during direct source execution", () => {
	withManager((manager, root) => {
		const personas = manager.listPersonas();
		assert.ok(personas.includes("vera"));
		assert.ok(personas.includes("vex"));
		assert.ok(existsSync(join(root, "personas", "vera", "CATUI.md")));
	});
});
test("PersonaManager preserves an existing customized persona file", () => {
	withManager((manager, root) => {
		manager.listPersonas();
		const path = join(root, "personas", "vera", "CATUI.md");
		writeFileSync(path, "# Vera\n\nlocal customization\n", "utf8");

		manager.listPersonas();

		assert.equal(readFileSync(path, "utf8"), "# Vera\n\nlocal customization\n");
	});
});

test("PersonaManager rejects unknown IDs without creating directories or changing active state", () => {
	withManager((manager, root) => {
		manager.setActivePersonaId("vex");
		assert.throws(() => manager.setActivePersonaId("scientst"), /Persona not found or missing CATUI\.md/);
		assert.equal(manager.getActivePersonaId(), "vex");
		assert.equal(existsSync(join(root, "personas", "scientst")), false);
	});
});

test("PersonaManager excludes directories without CATUI.md", () => {
	withManager((manager, root) => {
		manager.listPersonas();
		mkdirSync(join(root, "personas", "empty-persona"), { recursive: true });

		assert.equal(manager.listPersonas().includes("empty-persona"), false);
	});
});
