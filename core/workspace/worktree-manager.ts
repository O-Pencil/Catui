/**
 * [WHO]: WorktreeManager class - temporary workspace and git worktree management
 * [FROM]: Depends on node:fs/promises, node:path, node:child_process
 * [TO]: Consumed by ./index.ts, core/sub-agent/*, extensions/builtin/subagent/*, extensions/builtin/team/*
 * [HERE]: core/workspace/worktree-manager.ts - workspace management for SubAgents
 */

import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

export interface WorkspacePath {
  /** Absolute path to the workspace */
  readonly path: string;
  /** Type of workspace */
  readonly type: "temp" | "worktree";
}

export interface WorkspaceChange {
  path: string;
  status: "added" | "modified" | "deleted";
}

interface ExecFileErrorWithStdout {
  stdout?: unknown;
}

function getStdoutFromExecError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const stdout = (error as ExecFileErrorWithStdout).stdout;
    return typeof stdout === "string" ? stdout : "";
  }
  return "";
}

/**
 * Manager for creating and disposing workspaces for SubAgents.
 * Provides temporary directories and git worktrees.
 */
export class WorktreeManager {
  private tempDirs: Set<string> = new Set();
  private worktrees: Map<string, string> = new Map(); // workspacePath -> originalCwd
  private snapshots: Map<string, string> = new Map(); // workspacePath -> originalCwd

  /**
   * Create a temporary workspace.
   * Copies seed files to a new temp directory.
   * @param seedFiles Files to copy to the temp workspace
   * @param prefix Prefix for the temp directory name
   */
  async createTempWorkspace(
    seedFiles: string[] = [],
    prefix = "nanopencil-subagent",
    sourceCwd = process.cwd(),
  ): Promise<WorkspacePath> {
    const tmpDir = await import("node:os").then((m) => m.tmpdir());
    const dirName = `${prefix}-${crypto.randomUUID()}`;
    const workspacePath = join(tmpDir, dirName);

    await mkdir(workspacePath, { recursive: true });
    this.tempDirs.add(workspacePath);

    // Copy seed files
    for (const seedFile of seedFiles) {
      try {
        const absoluteSeedFile = resolve(sourceCwd, seedFile);
        const relativeSeedPath = relative(sourceCwd, absoluteSeedFile);
        const targetPath = relativeSeedPath && !relativeSeedPath.startsWith("..")
          ? relativeSeedPath
          : basename(absoluteSeedFile);
        const destPath = join(workspacePath, targetPath);
        await mkdir(dirname(destPath), { recursive: true });
        await cp(absoluteSeedFile, destPath, { recursive: true });
      } catch {
        // Ignore errors copying individual files
      }
    }

    return {
      path: workspacePath,
      type: "temp",
    };
  }

  /**
   * Create a temporary snapshot workspace by copying the current project tree.
   * Used as a fallback when git worktree is unavailable.
   */
  async createSnapshotWorkspace(sourceCwd: string, prefix = "nanopencil-subagent-snapshot"): Promise<WorkspacePath> {
    const workspace = await this.createTempWorkspace([], prefix, sourceCwd);
    this.snapshots.set(workspace.path, sourceCwd);
    await cp(sourceCwd, workspace.path, {
      recursive: true,
      force: true,
      filter: (src) => {
        const relativePath = relative(sourceCwd, src);
        if (!relativePath) return true;
        if (relativePath === ".git") return false;
        if (relativePath.startsWith(".git/")) return false;
        if (relativePath === "node_modules") return false;
        if (relativePath.startsWith("node_modules/")) return false;
        if (relativePath === "dist") return false;
        if (relativePath.startsWith("dist/")) return false;
        if (relativePath === ".codex") return false;
        if (relativePath.startsWith(".codex/")) return false;
        return true;
      },
    });
    return workspace;
  }

  /**
   * Create a git worktree for the given branch.
   * @param branch Branch name for the worktree
   * @param cwd Working directory for git operations
   */
  async createGitWorktree(branch?: string, cwd?: string): Promise<WorkspacePath> {
    const sourceCwd = cwd ?? process.cwd();
    const tmpDir = await import("node:os").then((m) => m.tmpdir());
    const workspacePath = join(tmpDir, `nanopencil-worktree-${crypto.randomUUID()}`);

    try {
      execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: sourceCwd, stdio: "ignore" });
      const args = branch
        ? ["worktree", "add", "-b", branch, workspacePath]
        : ["worktree", "add", "--detach", workspacePath];
      execFileSync("git", args, { cwd: sourceCwd, stdio: "ignore" });
      this.worktrees.set(workspacePath, sourceCwd);
      return {
        path: workspacePath,
        type: "worktree",
      };
    } catch {
      await rm(workspacePath, { recursive: true, force: true }).catch(() => {});
      return this.createSnapshotWorkspace(sourceCwd);
    }
  }

  /**
   * List changed files inside a workspace.
   */
  async listChangedFiles(workspace: WorkspacePath): Promise<string[]> {
    const changes = await this.listChanges(workspace);
    return changes.map((change) => change.path);
  }

  async listChanges(workspace: WorkspacePath): Promise<WorkspaceChange[]> {
    if (workspace.type === "worktree") {
      try {
        const output = execFileSync("git", ["status", "--porcelain"], {
          cwd: workspace.path,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        return output
          .split("\n")
          .map((line) => line.trimEnd())
          .filter(Boolean)
          .map((line) => this.parseGitStatusLine(line))
          .filter((change): change is WorkspaceChange => change !== null);
      } catch {
        return [];
      }
    }

    const sourceCwd = this.snapshots.get(workspace.path);
    if (!sourceCwd) {
      return [];
    }

    return this.collectSnapshotChanges(sourceCwd, workspace.path);
  }

  async writePatch(workspace: WorkspacePath, outputPath: string): Promise<boolean> {
    try {
      await mkdir(dirname(outputPath), { recursive: true });
      let patch = "";

      if (workspace.type === "worktree") {
        patch = execFileSync("git", ["diff", "--binary"], {
          cwd: workspace.path,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });
      } else {
        const sourceCwd = this.snapshots.get(workspace.path);
        if (!sourceCwd) {
          return false;
        }
        const changes = await this.collectSnapshotChanges(sourceCwd, workspace.path);
        const sections = await Promise.all(
          changes.map(async (change) => {
            const sourcePath = join(sourceCwd, change.path);
            const workspacePath = join(workspace.path, change.path);
            try {
              return execFileSync(
                "git",
                ["diff", "--no-index", "--binary", "--", sourcePath, workspacePath],
                {
                  cwd: sourceCwd,
                  encoding: "utf-8",
                  stdio: ["ignore", "pipe", "ignore"],
                },
              );
            } catch (error: unknown) {
              return getStdoutFromExecError(error);
            }
          }),
        );
        patch = sections.filter(Boolean).join("\n");
      }

      if (!patch.trim()) {
        return false;
      }

      await writeFile(outputPath, patch, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  async applyChanges(workspace: WorkspacePath, targetCwd: string): Promise<WorkspaceChange[]> {
    const changes = await this.listChanges(workspace);

    for (const change of changes) {
      const targetPath = join(targetCwd, change.path);
      const sourcePath = join(workspace.path, change.path);

      if (change.status === "deleted") {
        await rm(targetPath, { recursive: true, force: true }).catch(() => {});
        continue;
      }

      await mkdir(dirname(targetPath), { recursive: true });
      await cp(sourcePath, targetPath, { recursive: true, force: true });
    }

    // Normalize paths to use forward slashes for cross-platform consistency
    return changes.map((change) => ({
      ...change,
      path: change.path.replace(/\\/g, "/"),
    }));
  }

  /**
   * Dispose of a workspace.
   * Removes temp directories and worktrees.
   * @param workspace The workspace to dispose
   */
  async dispose(workspace: WorkspacePath): Promise<void> {
    if (workspace.type === "temp") {
      try {
        await rm(workspace.path, { recursive: true, force: true });
      } catch {
        // Ignore errors during cleanup
      }
      this.tempDirs.delete(workspace.path);
      this.snapshots.delete(workspace.path);
    } else if (workspace.type === "worktree") {
      const originalCwd = this.worktrees.get(workspace.path) ?? this.resolveWorktreeOwner(workspace.path);
      if (originalCwd) {
        // Try to remove the git worktree first
        const { execSync } = await import("node:child_process");
        try {
          execSync(`git worktree remove "${workspace.path}" --force`, {
            cwd: originalCwd,
            stdio: "ignore",
          });
        } catch {
          // Ignore errors
        }
        this.worktrees.delete(workspace.path);
      }

      // Then remove the directory
      try {
        await rm(workspace.path, { recursive: true, force: true });
      } catch {
        // Ignore errors during cleanup
      }
    }
  }

  /**
   * Get all active temp directories.
   */
  getActiveTempDirs(): string[] {
    return Array.from(this.tempDirs);
  }

  /**
   * Clean up all temp directories.
   */
  async disposeAll(): Promise<void> {
    await Promise.all(
      Array.from(this.tempDirs).map((dir) =>
        rm(dir, { recursive: true, force: true }).catch(() => {}),
      ),
    );
    this.tempDirs.clear();
    this.worktrees.clear();
    this.snapshots.clear();
  }

  private resolveWorktreeOwner(workspacePath: string): string | undefined {
    try {
      const commonDir = execFileSync(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        {
          cwd: workspacePath,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();

      return commonDir ? dirname(commonDir) : undefined;
    } catch {
      return undefined;
    }
  }

  private parseGitStatusLine(line: string): WorkspaceChange | null {
    const statusCode = line.slice(0, 2);
    const pathPart = line.slice(3).trim();
    if (!pathPart) {
      return null;
    }

    const normalizedPath = pathPart.includes(" -> ")
      ? pathPart.split(" -> ").pop() ?? pathPart
      : pathPart;
    const status = statusCode.includes("D")
      ? "deleted"
      : statusCode.includes("A") || statusCode === "??"
        ? "added"
        : "modified";
    return {
      path: normalizedPath,
      status,
    };
  }

  private async collectSnapshotChanges(sourceCwd: string, workspacePath: string): Promise<WorkspaceChange[]> {
    const sourceFiles = await this.collectWorkspaceFiles(sourceCwd, sourceCwd);
    const workspaceFiles = await this.collectWorkspaceFiles(workspacePath, workspacePath);
    const allPaths = new Set<string>([...sourceFiles.keys(), ...workspaceFiles.keys()]);
    const changes: WorkspaceChange[] = [];

    for (const relativePath of Array.from(allPaths).sort()) {
      const sourceEntry = sourceFiles.get(relativePath);
      const workspaceEntry = workspaceFiles.get(relativePath);

      if (!sourceEntry && workspaceEntry) {
        changes.push({ path: relativePath, status: "added" });
        continue;
      }
      if (sourceEntry && !workspaceEntry) {
        changes.push({ path: relativePath, status: "deleted" });
        continue;
      }
      if (sourceEntry && workspaceEntry && !sourceEntry.equals(workspaceEntry)) {
        changes.push({ path: relativePath, status: "modified" });
      }
    }

    // Normalize paths to use forward slashes for cross-platform consistency
    return changes.map((change) => ({
      ...change,
      path: change.path.replace(/\\/g, "/"),
    }));
  }

  private async collectWorkspaceFiles(rootPath: string, currentPath: string): Promise<Map<string, FileFingerprint>> {
    const files = new Map<string, FileFingerprint>();
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = join(currentPath, entry.name);
      const relativePath = relative(rootPath, absolutePath);
      if (this.shouldIgnoreRelativePath(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        const nested = await this.collectWorkspaceFiles(rootPath, absolutePath);
        for (const [pathKey, value] of nested) {
          files.set(pathKey, value);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const fileStat = await stat(absolutePath);
      const content = await readFile(absolutePath);
      files.set(relativePath, {
        size: fileStat.size,
        content,
        equals(other) {
          return this.size === other.size && Buffer.compare(this.content, other.content) === 0;
        },
      });
    }

    return files;
  }

  private shouldIgnoreRelativePath(relativePath: string): boolean {
    return (
      !relativePath ||
      relativePath === ".git" ||
      relativePath.startsWith(".git/") ||
      relativePath === ".nanopencil" ||
      relativePath.startsWith(".nanopencil/") ||
      relativePath === "node_modules" ||
      relativePath.startsWith("node_modules/") ||
      relativePath === "dist" ||
      relativePath.startsWith("dist/") ||
      relativePath === ".codex" ||
      relativePath.startsWith(".codex/")
    );
  }
}

interface FileFingerprint {
  size: number;
  content: Buffer;
  equals(other: FileFingerprint): boolean;
}

/**
 * Default global worktree manager instance.
 */
export const worktreeManager = new WorktreeManager();
