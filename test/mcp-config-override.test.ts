import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { getMCPConfigPath, loadMCPConfig, listEnabledMCPServers } from "../core/mcp/mcp-config.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
	return mkdirSync(join(tmpdir(), `mcp-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`), { recursive: true });
}

function writeJson(filePath: string, data: unknown): void {
	mkdirSync(join(filePath, ".."), { recursive: true });
	writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ── getMCPConfigPath ─────────────────────────────────────────────────────────

test("getMCPConfigPath: returns agentDir/mcp.json when no override", () => {
	const agentDir = "/tmp/test-agent";
	const result = getMCPConfigPath(agentDir);
	assert.equal(result, join(agentDir, "mcp.json"));
});

test("getMCPConfigPath: configPathOverride takes highest priority", () => {
	const override = "/custom/path/config.json";
	const result = getMCPConfigPath("/tmp/agent", override);
	assert.equal(result, resolve(override));
});

test("getMCPConfigPath: configPathOverride with ~ expansion", () => {
	const result = getMCPConfigPath("/tmp/agent", "~/my-config.json");
	assert.equal(result, join(homedir(), "my-config.json"));
});

test("getMCPConfigPath: configPathOverride with just ~", () => {
	const result = getMCPConfigPath("/tmp/agent", "~");
	assert.equal(result, homedir());
});

test("getMCPConfigPath: configPathOverride with ~no-slash", () => {
	const result = getMCPConfigPath("/tmp/agent", "~something");
	assert.equal(result, join(homedir(), "something"));
});

test("getMCPConfigPath: configPathOverride beats env var", () => {
	const original = process.env.MCP_CONFIG_PATH;
	try {
		process.env.MCP_CONFIG_PATH = "/env/path.json";
		const result = getMCPConfigPath("/tmp/agent", "/override/path.json");
		assert.equal(result, resolve("/override/path.json"));
	} finally {
		if (original === undefined) delete process.env.MCP_CONFIG_PATH;
		else process.env.MCP_CONFIG_PATH = original;
	}
});

test("getMCPConfigPath: env var beats agentDir default", () => {
	const original = process.env.MCP_CONFIG_PATH;
	try {
		process.env.MCP_CONFIG_PATH = "/env/path.json";
		const result = getMCPConfigPath("/tmp/agent");
		assert.equal(result, resolve("/env/path.json"));
	} finally {
		if (original === undefined) delete process.env.MCP_CONFIG_PATH;
		else process.env.MCP_CONFIG_PATH = original;
	}
});

test("getMCPConfigPath: env var ~ expansion", () => {
	const original = process.env.MCP_CONFIG_PATH;
	try {
		process.env.MCP_CONFIG_PATH = "~/custom-mcp.json";
		const result = getMCPConfigPath("/tmp/agent");
		assert.equal(result, join(homedir(), "custom-mcp.json"));
	} finally {
		if (original === undefined) delete process.env.MCP_CONFIG_PATH;
		else process.env.MCP_CONFIG_PATH = original;
	}
});

test("getMCPConfigPath: empty override falls through to env", () => {
	const original = process.env.MCP_CONFIG_PATH;
	try {
		process.env.MCP_CONFIG_PATH = "/env/path.json";
		const result = getMCPConfigPath("/tmp/agent", "  ");
		assert.equal(result, resolve("/env/path.json"));
	} finally {
		if (original === undefined) delete process.env.MCP_CONFIG_PATH;
		else process.env.MCP_CONFIG_PATH = original;
	}
});

test("getMCPConfigPath: no override, no env, uses agentDir", () => {
	const original = process.env.MCP_CONFIG_PATH;
	try {
		delete process.env.MCP_CONFIG_PATH;
		const result = getMCPConfigPath("/my/agent/dir");
		assert.equal(result, "/my/agent/dir/mcp.json");
	} finally {
		if (original === undefined) delete process.env.MCP_CONFIG_PATH;
		else process.env.MCP_CONFIG_PATH = original;
	}
});

// ── loadMCPConfig with override ──────────────────────────────────────────────

test("loadMCPConfig: reads from override path", () => {
	const dir = makeTmpDir();
	try {
		const configPath = join(dir, "custom-mcp.json");
		writeJson(configPath, {
			mcpServers: [
				{ id: "test-server", command: "echo", args: ["hello"], enabled: true },
			],
		});

		const config = loadMCPConfig(undefined, configPath);
		const ids = config.mcpServers.map((s) => s.id);
		assert.ok(ids.includes("test-server"), "custom server should be present");
		// loadMCPConfig merges with defaults, so length > 1 is expected
		assert.ok(config.mcpServers.length >= 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadMCPConfig: override path takes priority over agentDir", () => {
	const dir = makeTmpDir();
	try {
		// Agent dir config
		const agentDir = join(dir, "agent");
		mkdirSync(agentDir, { recursive: true });
		writeJson(join(agentDir, "mcp.json"), {
			mcpServers: [{ id: "agent-server", command: "echo", args: [], enabled: true }],
		});

		// Override config
		const overridePath = join(dir, "override.json");
		writeJson(overridePath, {
			mcpServers: [{ id: "override-server", command: "echo", args: [], enabled: true }],
		});

		const config = loadMCPConfig(agentDir, overridePath);
		const ids = config.mcpServers.map((s) => s.id);
		assert.ok(ids.includes("override-server"));
		// agent-server should NOT be loaded since we read from override path
		assert.ok(!ids.includes("agent-server"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ── listEnabledMCPServers with override ──────────────────────────────────────

test("listEnabledMCPServers: filters disabled servers from override path", () => {
	const dir = makeTmpDir();
	try {
		const configPath = join(dir, "servers.json");
		writeJson(configPath, {
			mcpServers: [
				{ id: "enabled-server", command: "echo", args: [], enabled: true },
				{ id: "disabled-server", command: "echo", args: [], enabled: false },
				{ id: "default-server", command: "echo", args: [] }, // no enabled field = enabled
			],
		});

		const servers = listEnabledMCPServers(undefined, configPath);
		const ids = servers.map((s) => s.id);
		assert.ok(ids.includes("enabled-server"));
		assert.ok(ids.includes("default-server"));
		assert.ok(!ids.includes("disabled-server"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("listEnabledMCPServers: throws for non-existent override path with no parent dir", () => {
	// loadMCPConfig tries to writeFileSync to the path when file doesn't exist,
	// which throws if the parent directory doesn't exist
	assert.throws(() => {
		listEnabledMCPServers(undefined, "/non/existent/path.json");
	});
});
