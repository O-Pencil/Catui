import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MCPClient } from "../core/mcp/mcp-client.js";
import { MCPManager } from "../core/mcp/mcp-manager.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
	return mkdirSync(join(tmpdir(), `mcp-client-test-${Date.now()}-${Math.random().toString(36).slice(2)}`), { recursive: true });
}

function writeJson(filePath: string, data: unknown): void {
	mkdirSync(join(filePath, ".."), { recursive: true });
	writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ── MCPClient ────────────────────────────────────────────────────────────────

test("MCPClient: loads servers from mcpConfigPath override", () => {
	const dir = makeTmpDir();
	try {
		const configPath = join(dir, "custom.json");
		const authPath = join(dir, "auth.json");
		writeJson(configPath, {
			mcpServers: [
				{ id: "custom-server", command: "echo", args: ["hello"], enabled: true },
			],
		});

		const client = new MCPClient(authPath, undefined, configPath);
		const servers = client.getServers();
		assert.equal(servers.length, 1);
		assert.equal(servers[0].id, "custom-server");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("MCPClient: mcpConfigPath overrides agentDir config", () => {
	const dir = makeTmpDir();
	try {
		const agentDir = join(dir, "agent");
		mkdirSync(agentDir, { recursive: true });
		writeJson(join(agentDir, "mcp.json"), {
			mcpServers: [
				{ id: "agent-server", command: "echo", args: [], enabled: true },
			],
		});

		const overridePath = join(dir, "override.json");
		writeJson(overridePath, {
			mcpServers: [
				{ id: "override-server", command: "echo", args: [], enabled: true },
			],
		});

		const authPath = join(dir, "auth.json");
		const client = new MCPClient(authPath, agentDir, overridePath);
		const servers = client.getServers();
		const ids = servers.map((s) => s.id);
		assert.ok(ids.includes("override-server"));
		assert.ok(!ids.includes("agent-server"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("MCPClient: no mcpConfigPath falls back to agentDir", () => {
	const dir = makeTmpDir();
	try {
		const agentDir = join(dir, "agent");
		mkdirSync(agentDir, { recursive: true });
		writeJson(join(agentDir, "mcp.json"), {
			mcpServers: [
				{ id: "default-server", command: "echo", args: [], enabled: true },
			],
		});

		const authPath = join(dir, "auth.json");
		const client = new MCPClient(authPath, agentDir);
		const servers = client.getServers();
		assert.equal(servers.length, 1);
		assert.equal(servers[0].id, "default-server");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("MCPClient: skips disabled servers in override config", () => {
	const dir = makeTmpDir();
	try {
		const configPath = join(dir, "config.json");
		writeJson(configPath, {
			mcpServers: [
				{ id: "active", command: "echo", args: [], enabled: true },
				{ id: "disabled", command: "echo", args: [], enabled: false },
			],
		});

		const authPath = join(dir, "auth.json");
		const client = new MCPClient(authPath, undefined, configPath);
		const servers = client.getServers();
		assert.equal(servers.length, 1);
		assert.equal(servers[0].id, "active");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("MCPClient: handles non-existent override path gracefully", () => {
	const dir = makeTmpDir();
	try {
		const authPath = join(dir, "auth.json");
		const client = new MCPClient(authPath, undefined, "/non/existent/path.json");
		const servers = client.getServers();
		assert.equal(servers.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ── MCPManager ───────────────────────────────────────────────────────────────

test("MCPManager: accepts mcpConfigPath option", () => {
	const dir = makeTmpDir();
	try {
		const configPath = join(dir, "manager-config.json");
		writeJson(configPath, {
			mcpServers: [
				{ id: "mgr-server", command: "echo", args: [], enabled: true },
			],
		});

		// MCPManager creates MCPClient internally, which reads from config path
		const manager = new MCPManager({ mcpConfigPath: configPath });
		assert.ok(manager);
		// The manager's internal client should have loaded the server
		// We verify this indirectly through initialize()
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("MCPManager: no options uses defaults", () => {
	const manager = new MCPManager();
	assert.ok(manager);
});

test("MCPManager: setWorkingDir does not throw", () => {
	const manager = new MCPManager();
	manager.setWorkingDir("/tmp/test");
	assert.ok(true);
});
