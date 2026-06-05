/**
 * [WHO]: Provides runCase() — builds an AgentSession with a cassette-backed model and captures print-mode stdout
 * [FROM]: Depends on core/runtime/sdk (createAgentSession), modes/print-mode (runPrintMode), @pencil-agent/ai (getModel, Model/Api types), fetch-cassette, normalize
 * [TO]: Consumed by tests/characterization/characterization.test.ts
 * [HERE]: tests/characterization/harness/run-case.ts — single-case characterization runner
 *
 * Option names { model, tools, cwd, sessionManager } are confirmed against core/runtime/sdk.ts.
 * apiKey resolution (VERIFIED): in record mode the real `<PROVIDER>_API_KEY` env flows via
 *   auth-storage.getApiKey → getEnvApiKey(provider); in replay we set a dummy key (fetch mocked).
 *   Provider name must be one getEnvApiKey() maps (e.g. "openai" → OPENAI_API_KEY) — there is no
 *   generic ${PROVIDER}_API_KEY fallback. For an OpenAI-compatible third-party endpoint, set
 *   provider:"openai" and put that endpoint's key in OPENAI_API_KEY, plus baseUrl/api in case.json.
 */

import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@pencil-agent/ai/models";
import type { Api, Model } from "@pencil-agent/ai/types";
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
  /**
   * Optional: OpenAI-compatible third-party endpoint (e.g. a proxy/self-hosted
   * chat-completions base). When set, the model is synthesized directly instead
   * of looked up in the static registry, so the harness can record against any
   * chat-completions-compatible host. The key still resolves via `provider`
   * (use "openai" → OPENAI_API_KEY).
   */
  baseUrl?: string;
  /** Optional: API dialect for a custom `baseUrl`; defaults to "openai-completions". */
  api?: string;
}

/**
 * Resolve the model for a case. Built-in models come from the static registry
 * (getModel). When the case supplies a `baseUrl`, synthesize a Model so the
 * harness works with any OpenAI-compatible endpoint not in the registry.
 */
function buildModel(spec: CharacterizationCase): Model<Api> {
  if (spec.baseUrl) {
    return {
      id: spec.model,
      name: spec.model,
      api: (spec.api ?? "openai-completions") as Api,
      provider: spec.provider,
      baseUrl: spec.baseUrl,
      // compat omitted on purpose: auto-detected from baseUrl by the provider.
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 204800,
      maxTokens: 65536,
    } as Model<Api>;
  }
  return getModel(spec.provider, spec.model);
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

  const model = buildModel(spec);
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
