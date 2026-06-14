import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

// We test loadProjectContextFiles indirectly through DefaultResourceLoader
// since loadProjectContextFiles is a private function.
// We import the module to verify the additionalAgentDirs plumbing works.

import { DefaultResourceLoader } from "../core/platform/config/resource-loader.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
	return mkdirSync(join(tmpdir(), `resource-loader-test-${Date.now()}-${Math.random().toString(36).slice(2)}`), { recursive: true });
}

// ── DefaultResourceLoader with additionalAgentDirs ───────────────────────────

test("DefaultResourceLoader: additionalAgentDirs loads context from extra directories", async () => {
	const dir = makeTmpDir();
	try {
		const agentDir = join(dir, "agent");
		const extraDir = join(dir, "extra");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(extraDir, { recursive: true });

		// Write AGENT.md in extra dir
		writeFileSync(join(extraDir, "AGENT.md"), "# Extra Agent Instructions", "utf-8");

		const loader = new DefaultResourceLoader({
			cwd: dir,
			agentDir,
			additionalAgentDirs: [extraDir],
		});

		await loader.reload();
		const { agentsFiles } = loader.getAgentsFiles();

		const paths = agentsFiles.map((f) => f.path);
		const extraPath = resolve(join(extraDir, "AGENT.md"));
		assert.ok(paths.some((p) => resolve(p) === extraPath), `Expected ${extraPath} in ${paths}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("DefaultResourceLoader: additionalAgentDirs deduplicates same path", async () => {
	const dir = makeTmpDir();
	try {
		const agentDir = join(dir, "agent");
		mkdirSync(agentDir, { recursive: true });

		// Write AGENT.md in agent dir
		writeFileSync(join(agentDir, "AGENT.md"), "# Agent Instructions", "utf-8");

		// Point additionalAgentDirs to the same agentDir
		const loader = new DefaultResourceLoader({
			cwd: dir,
			agentDir,
			additionalAgentDirs: [agentDir],
		});

		await loader.reload();
		const { agentsFiles } = loader.getAgentsFiles();

		// Should only appear once despite being in both agentDir and additionalAgentDirs
		const agentPath = resolve(join(agentDir, "AGENT.md"));
		const count = agentsFiles.filter((f) => resolve(f.path) === agentPath).length;
		assert.equal(count, 1, `Expected 1 occurrence, got ${count}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("DefaultResourceLoader: additionalAgentDirs with missing directory is silent", async () => {
	const dir = makeTmpDir();
	try {
		const agentDir = join(dir, "agent");
		mkdirSync(agentDir, { recursive: true });

		const loader = new DefaultResourceLoader({
			cwd: dir,
			agentDir,
			additionalAgentDirs: ["/non/existent/dir/that/does/not/exist"],
		});

		// Should not throw
		await loader.reload();
		const { agentsFiles } = loader.getAgentsFiles();
		assert.ok(Array.isArray(agentsFiles));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("DefaultResourceLoader: additionalAgentDirs empty array has no effect", async () => {
	const dir = makeTmpDir();
	try {
		const agentDir = join(dir, "agent");
		mkdirSync(agentDir, { recursive: true });

		const loader = new DefaultResourceLoader({
			cwd: dir,
			agentDir,
			additionalAgentDirs: [],
		});

		await loader.reload();
		const { agentsFiles } = loader.getAgentsFiles();
		assert.ok(Array.isArray(agentsFiles));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("DefaultResourceLoader: additionalAgentDirs loads CLAUDE.md too", async () => {
	const dir = makeTmpDir();
	try {
		const agentDir = join(dir, "agent");
		const extraDir = join(dir, "extra");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(extraDir, { recursive: true });

		// Write CLAUDE.md (legacy name) in extra dir
		writeFileSync(join(extraDir, "CLAUDE.md"), "# Legacy Instructions", "utf-8");

		const loader = new DefaultResourceLoader({
			cwd: dir,
			agentDir,
			additionalAgentDirs: [extraDir],
		});

		await loader.reload();
		const { agentsFiles } = loader.getAgentsFiles();

		const extraPath = resolve(join(extraDir, "CLAUDE.md"));
		assert.ok(agentsFiles.some((f) => resolve(f.path) === extraPath));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("DefaultResourceLoader: additionalAgentDirs respects priority order", async () => {
	const dir = makeTmpDir();
	try {
		const agentDir = join(dir, "agent");
		const extra1 = join(dir, "extra1");
		const extra2 = join(dir, "extra2");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(extra1, { recursive: true });
		mkdirSync(extra2, { recursive: true });

		writeFileSync(join(extra1, "AGENT.md"), "# Extra 1", "utf-8");
		writeFileSync(join(extra2, "AGENT.md"), "# Extra 2", "utf-8");

		const loader = new DefaultResourceLoader({
			cwd: dir,
			agentDir,
			additionalAgentDirs: [extra1, extra2],
		});

		await loader.reload();
		const { agentsFiles } = loader.getAgentsFiles();

		const path1 = resolve(join(extra1, "AGENT.md"));
		const path2 = resolve(join(extra2, "AGENT.md"));
		const idx1 = agentsFiles.findIndex((f) => resolve(f.path) === path1);
		const idx2 = agentsFiles.findIndex((f) => resolve(f.path) === path2);

		assert.ok(idx1 >= 0, "extra1 should be present");
		assert.ok(idx2 >= 0, "extra2 should be present");
		// extra1 should come before extra2 (array order)
		assert.ok(idx1 < idx2, `extra1 (${idx1}) should come before extra2 (${idx2})`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ── DefaultResourceLoader with additionalSkillPaths ──────────────────────────

test("DefaultResourceLoader: additionalSkillPaths is accepted without error", async () => {
	const dir = makeTmpDir();
	try {
		const agentDir = join(dir, "agent");
		const skillsDir = join(dir, "skills");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(skillsDir, { recursive: true });

		const loader = new DefaultResourceLoader({
			cwd: dir,
			agentDir,
			additionalSkillPaths: [skillsDir],
		});

		await loader.reload();
		const { skills } = loader.getSkills();
		assert.ok(Array.isArray(skills));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("DefaultResourceLoader: additionalSkillPaths missing dir is silent", async () => {
	const dir = makeTmpDir();
	try {
		const agentDir = join(dir, "agent");
		mkdirSync(agentDir, { recursive: true });

		const loader = new DefaultResourceLoader({
			cwd: dir,
			agentDir,
			additionalSkillPaths: ["/non/existent/skills"],
		});

		await loader.reload();
		const { skills } = loader.getSkills();
		assert.ok(Array.isArray(skills));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
