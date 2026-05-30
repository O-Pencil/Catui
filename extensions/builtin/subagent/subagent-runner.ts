/**
 * [WHO]: SubAgentRunner class - spawns and manages SubAgents
 * [FROM]: Depends on node:fs/promises, node:path, core/sub-agent, core/workspace, core/tools, ./subagent-types
 * [TO]: Consumed by ./index.ts
 * [HERE]: extensions/builtin/subagent/subagent-runner.ts - SubAgent orchestration logic
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Model } from "@pencil-agent/ai";
import { SubAgentRuntime } from "../../../core/sub-agent/index.js";
import type { WorkspacePath } from "../../../core/workspace/index.js";
import { WorktreeManager } from "../../../core/workspace/index.js";
import {
  createBashTool,
  createCodingTools,
  createReadOnlyTools,
  createSandboxHook,
  type Tool,
} from "../../../core/tools/index.js";
import type { SubAgentRunReport, SubAgentRunState } from "./subagent-types.js";

/**
 * SubAgent Runner - handles spawning and managing SubAgents.
 */
export class SubAgentRunner {
  private runtime: SubAgentRuntime;
  private worktreeManager: WorktreeManager;
  private currentState: SubAgentRunState | null = null;
  private abortController: AbortController | null = null;
  private activeWorkspace: WorkspacePath | null = null;
  private currentBaseCwd: string | null = null;

  constructor() {
    this.runtime = new SubAgentRuntime();
    this.worktreeManager = new WorktreeManager();
  }

  /**
   * Start a new SubAgent run.
   * @param task The task description
   * @param options.runRole Worker role: "research" (read-only) or "implement" (can write)
   * @param options.model Model to use (reuses main session's model and auth)
   */
  async run(
    task: string,
    options?: { runRole?: "research" | "implement"; model?: Model<any>; cwd?: string; timeoutMs?: number },
  ): Promise<SubAgentRunReport> {
    if (this.currentState && (this.currentState.phase === "planning" || this.currentState.phase === "research" || this.currentState.phase === "implementing" || this.currentState.phase === "reviewing")) {
      throw new Error("A SubAgent run is already active. Stop it before starting a new one.");
    }

    const runId = crypto.randomUUID();
    this.abortController = new AbortController();
    const baseCwd = options?.cwd ?? process.cwd();
    this.currentBaseCwd = baseCwd;
    const role = options?.runRole ?? "research";

    this.currentState = {
      runId,
      phase: "planning",
      startTime: Date.now(),
      workers: [],
    };

    try {
      let workspace: WorkspacePath | null = null;
      if (role === "implement") {
        workspace = await this.worktreeManager.createGitWorktree(undefined, baseCwd);
        this.activeWorkspace = workspace;
      }

      const workerCwd = workspace?.path ?? baseCwd;
      const tools = role === "research" ? this.createReadOnlyTools(workerCwd) : this.createSandboxedTools(workerCwd);

      this.currentState.phase = role === "research" ? "research" : "implementing";

      // Create worker
      const workerId = `${role}-worker-1`;
      this.currentState.workers.push({
        id: workerId,
        role: role === "research" ? "Research Worker" : "Implementation Worker",
        status: "running",
      });

      // Spawn the worker
      const handle = await this.runtime.spawn({
        prompt: task,
        tools,
        cwd: workerCwd,
        signal: this.abortController.signal,
        model: options?.model,
        timeoutMs: options?.timeoutMs,
      });

      // Update worker with handle
      const worker = this.currentState.workers.find(w => w.id === workerId);
      if (worker) {
        worker.handle = handle;
      }

      const result = await handle.result();

      worker!.status = result.success ? "done" : result.error === "Aborted" ? "aborted" : "error";

      // Extract summary from result
      let summary = result.error ?? "No result";
      if (result.success && result.response) {
        summary = result.response;
      } else if (result.success) {
        summary = "Task completed successfully";
      }

      const changedFiles = workspace ? await this.worktreeManager.listChangedFiles(workspace) : [];
      const report: SubAgentRunReport = {
        runId,
        summary,
        findings: [],
        changedFiles,
        duration: Date.now() - this.currentState.startTime,
        success: result.success,
        workspacePath: workspace?.path,
      };
      if (workspace && changedFiles.length > 0) {
        const patchPath = join(baseCwd, ".nanopencil", "subagent-runs", `${runId}.patch`);
        if (await this.worktreeManager.writePatch(workspace, patchPath)) {
          report.patchPath = patchPath;
          report.patchPreview = await this.readPatchPreview(patchPath);
        }
      }
      report.reportPath = await this.writeReport(baseCwd, report);

      this.currentState.report = report;
      this.currentState.phase = "done";
      this.currentState.error = result.error;

      return report;
    } catch (error: unknown) {
      this.currentState.phase = "error";
      this.currentState.error = error instanceof Error ? error.message : String(error);

      const report: SubAgentRunReport = {
        runId,
        summary: this.currentState.error,
        findings: [],
        changedFiles: [],
        duration: Date.now() - this.currentState.startTime,
        success: false,
      };
      report.reportPath = await this.writeReport(baseCwd, report);
      this.currentState.report = report;
      return report;
    } finally {
      const shouldKeepWorkspace = !!this.currentState?.report?.workspacePath && this.currentState.report.success;
      if (this.activeWorkspace && !shouldKeepWorkspace) {
        await this.worktreeManager.dispose(this.activeWorkspace);
      }
      if (!shouldKeepWorkspace) {
        this.activeWorkspace = null;
        this.currentBaseCwd = null;
      }
    }
  }

  async applyLatest(): Promise<SubAgentRunReport> {
    const report = this.currentState?.report;
    if (!report || !this.activeWorkspace || !this.currentBaseCwd) {
      throw new Error("No isolated SubAgent run is waiting to be applied.");
    }
    if (!report.success) {
      throw new Error("The last SubAgent run did not complete successfully.");
    }
    if (report.appliedAt) {
      throw new Error("The last SubAgent run has already been applied.");
    }

    const changes = await this.worktreeManager.applyChanges(this.activeWorkspace, this.currentBaseCwd);
    report.changedFiles = changes.map((change) => change.path);
    report.appliedAt = Date.now();
    report.summary = `${report.summary}\n\nApplied ${changes.length} file change(s) to the main workspace.`;
    report.reportPath = await this.writeReport(this.currentBaseCwd, report);
    await this.worktreeManager.dispose(this.activeWorkspace);
    this.activeWorkspace = null;
    this.currentBaseCwd = null;
    return report;
  }

  /**
   * Stop the current run.
   */
  async stop(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }
    await this.runtime.terminateAll();
    if (this.activeWorkspace) {
      await this.worktreeManager.dispose(this.activeWorkspace);
      this.activeWorkspace = null;
    }
    this.currentBaseCwd = null;
    if (this.currentState) {
      this.currentState.phase = "error";
      this.currentState.error = "Stopped by user";
      this.currentState.workers.forEach(w => {
        w.status = "aborted";
      });
    }
  }

  /**
   * Get the current run state.
   */
  getState(): SubAgentRunState | null {
    return this.currentState;
  }

  /**
   * Get status text for display.
   */
  getStatusText(): string {
    const state = this.currentState;
    if (!state) {
      return "No active SubAgent run.";
    }

    const lines = [
      `Run ID: ${state.runId}`,
      `Phase: ${state.phase}`,
      `Duration: ${Math.round((Date.now() - state.startTime) / 1000)}s`,
      "",
      "Workers:",
    ];

    for (const worker of state.workers) {
      lines.push(`  - ${worker.role}: ${worker.status}`);
    }

    if (state.error) {
      lines.push("", `Error: ${state.error}`);
    }

    if (state.report?.workspacePath && !state.report.appliedAt) {
      lines.push("", "Pending write-back: run /subagent:apply to copy changes into the main workspace.");
      if (state.report.patchPreview) {
        lines.push("", "Patch Preview:", state.report.patchPreview);
      }
    }

    return lines.join("\n");
  }

  private createReadOnlyTools(cwd: string): Tool[] {
    // Read-only tools with sandbox hook for bash (blocks write operations)
    const baseTools = createReadOnlyTools(cwd);

    // Replace bash tool with sandboxed version
    const sandboxBash = createBashTool(cwd, {
      spawnHook: createSandboxHook(),
    });

    return [
      ...baseTools.filter(t => t.name !== "bash"),
      sandboxBash,
    ];
  }

  private createSandboxedTools(cwd: string): Tool[] {
    // Full coding tools but with sandboxed bash
    const baseTools = createCodingTools(cwd);

    const sandboxBash = createBashTool(cwd, {
      spawnHook: createSandboxHook(),
    });

    return [
      ...baseTools.filter(t => t.name !== "bash"),
      sandboxBash,
    ];
  }

  private async writeReport(baseCwd: string, report: SubAgentRunReport): Promise<string> {
    const reportsDir = join(baseCwd, ".nanopencil", "subagent-runs");
    await mkdir(reportsDir, { recursive: true });
    const reportPath = join(reportsDir, `${report.runId}.md`);
    const lines = [
      `# SubAgent Run ${report.runId}`,
      "",
      `- Success: ${report.success ? "Yes" : "No"}`,
      `- Duration: ${Math.round(report.duration / 1000)}s`,
      `- Workspace: ${report.workspacePath ?? "(main workspace / read-only)"}`,
      `- Patch: ${report.patchPath ?? "(none)"}`,
      `- Applied: ${report.appliedAt ? new Date(report.appliedAt).toISOString() : "No"}`,
      "",
      "## Summary",
      "",
      report.summary || "(no summary)",
      "",
      "## Changed Files",
      "",
      ...(report.changedFiles.length > 0 ? report.changedFiles.map((file) => `- ${file}`) : ["- (none)"]),
      ...(report.patchPreview ? ["", "## Patch Preview", "", "```diff", report.patchPreview, "```"] : []),
      ...(report.workspacePath && !report.appliedAt
        ? ["", "## Next Step", "", "Review the patch and run `/subagent:apply` to write these changes back."]
        : []),
    ];
    await writeFile(reportPath, `${lines.join("\n")}\n`, "utf-8");
    return reportPath;
  }

  private async readPatchPreview(patchPath: string): Promise<string | undefined> {
    try {
      const content = await readFile(patchPath, "utf-8");
      const lines = content.split("\n").slice(0, 80);
      const preview = lines.join("\n").trim();
      return preview || undefined;
    } catch {
      return undefined;
    }
  }
}
