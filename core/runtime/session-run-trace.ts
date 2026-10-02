/**
 * [WHO]: SessionRunTrace owns recording, snapshots and persisted trace paths
 * [FROM]: agent-core trace recorder and run-trace-jsonl persistence
 * [TO]: AgentSession and regression tests
 * [HERE]: core/runtime/session-run-trace.ts - per-session trace lifecycle
 */
import { randomUUID } from "node:crypto";
import { InMemoryRunTraceSink, RunTraceRecorder, type RunTraceEventV1 } from "@catui/agent-core";
import { persistWorkspaceRunTrace, redactWorkspaceRunTraceEvent } from "./run-trace-jsonl.js";

export class SessionRunTrace {
  private _snapshot: RunTraceEventV1[] | undefined;
  private _path: string | undefined;
  get snapshot(): readonly RunTraceEventV1[] | undefined { return this._snapshot; }
  get path(): string | undefined { return this._path; }

  async run(cwd: string, sessionId: string,
    setRecorder: (recorder: RunTraceRecorder | undefined) => void,
    execute: () => Promise<void>, onError: (error: unknown) => void): Promise<void> {
    const sink = new InMemoryRunTraceSink();
    const recorder = new RunTraceRecorder({
      runId: `run-${randomUUID()}`, sessionId, sink,
      redactor: redactWorkspaceRunTraceEvent, failureMode: "best_effort",
    });
    setRecorder(recorder);
    try {
      await execute();
    } finally {
      try {
        await recorder.flush();
        this._snapshot = sink.snapshot();
        this._path = undefined;
        this._path = (await persistWorkspaceRunTrace(cwd, this._snapshot)).latestPath;
      } catch (error) {
        onError(error);
      } finally {
        setRecorder(undefined);
      }
    }
  }
}
