/**
 * [WHO]: Provides runCase() — builds an AgentSession with a cassette-backed model and captures print-mode stdout
 * [FROM]: Depends on core/runtime/sdk (createAgentSession), modes/print-mode (runPrintMode), @pencil-agent/ai (getModel), fetch-cassette, normalize
 * [TO]: Consumed by tests/characterization/characterization.test.ts
 * [HERE]: tests/characterization/harness/run-case.ts — single-case characterization runner
 *
 * Option names { model, tools, cwd, sessionManager } are confirmed against core/runtime/sdk.ts.
 * ⚠️ ONE ASSUMPTION TO VERIFY on the first `RECORD=1` run (could not run in sandbox — perf):
 *   apiKey presence — createAgentSession resolves the provider key internally; in replay we set a
 *   dummy `<PROVIDER>_API_KEY` so streaming proceeds past the key check (fetch is mocked, so the
 *   value is irrelevant). If your provider reads a different env var, adjust ENV_KEY_BY_PROVIDER.
 */

import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@pencil-agent/ai";
import { createAgentSession, createCodingTools } from "../../../core/runtime/sdk.js";
import { SessionManager } from "../../../core/session/session-manager.js";
import { runPrintMode } from "../../../modes/print-mode.js";
import { installCassette } from "./fetch-cassette.js";
import { type DynamicScrub, normalize } from "./normalize.js";

export interface CharacterizationCase {
  provider: string;
  /** model id within the provider */
  model: string;
  /** the prompt sent to the agent in print (text) mode */
  input: string;
  /** optional: relative path to a workspace seed dir under the case folder */
  workspace?: string;
}

const ENV_KEY_BY_PROVIDER: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  local: "OPENAI_API_KEY",
};

function captureStdio(): { stop: () => string } {
  let buf = "";
  const origLog = console.log;
  const origErr = console.error;
  const origOut = process.stdout.write.bind(process.stdout);
  const origErrW = process.stderr.write.bind(process.stderr);
  const sink = (...args: unknown[]) => {
    buf += args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n";
  };
  console.log = sink;
  console.error = sink;
  const writeToBuffer = (chunk: unknown, encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void), callback?: (err?: Error | null) => void) => {
    buf += typeof chunk === "string" ? chunk : String(chunk);
    const cb = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    cb?.();
    return true;
  };
  (process.stdout as NodeJS.WriteStream).write = writeToBuffer as typeof process.stdout.write;
  (process.stderr as NodeJS.WriteStream).write = writeToBuffer as typeof process.stderr.write;
  return {
    stop() {
      console.log = origLog;
      console.error = origErr;
      process.stdout.write = origOut;
      process.stderr.write = origErrW;
      return buf;
    },
  };
}

/**
 * Run one case end-to-end (build sandbox session → print mode → capture → normalize).
 * @param caseDir   absolute path to cases/<name>/
 * @param spec      parsed case.json
 * @param record    true → record cassette+golden from real fetch; false → replay
 */
export async function runCase(caseDir: string, spec: CharacterizationCase, record: boolean): Promise<string> {
  const agentDir = mkdtempSync(join(tmpdir(), "char-agentdir-"));
  const cwd = mkdtempSync(join(tmpdir(), "char-cwd-"));
  const prevAgentDir = process.env.NANOPENCIL_CODING_AGENT_DIR;
  const envKey = ENV_KEY_BY_PROVIDER[spec.provider] ?? "OPENAI_API_KEY";
  const prevApiKey = process.env[envKey];

  process.env.NANOPENCIL_CODING_AGENT_DIR = agentDir;
  if (!record) process.env[envKey] = "characterization-test-key";

  if (spec.workspace && existsSync(join(caseDir, spec.workspace))) {
    cpSync(join(caseDir, spec.workspace), cwd, { recursive: true });
  }

  const model = getModel(spec.provider, spec.model);
  const modelHost = (() => {
    try {
      return model?.baseUrl ? [new URL(model.baseUrl).host] : [];
    } catch {
      return [];
    }
  })();

  const cassette = installCassette(join(caseDir, "cassette.json"), modelHost, record);
  const capture = captureStdio();
  try {
    const { session } = await createAgentSession({
      model,
      tools: createCodingTools(cwd),
      cwd,
      sessionManager: SessionManager.inMemory(),
    });
    await runPrintMode(session, { mode: "text", initialMessage: spec.input });
  } finally {
    const raw = capture.stop();
    cassette.restore();
    process.env.NANOPENCIL_CODING_AGENT_DIR = prevAgentDir;
    if (prevApiKey === undefined) delete process.env[envKey];
    else process.env[envKey] = prevApiKey;
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });

    const scrubs: DynamicScrub[] = [
      { find: agentDir, to: "<AGENTDIR>" },
      { find: cwd, to: "<CWD>" },
    ];
    return normalize(raw, scrubs);
  }
}
