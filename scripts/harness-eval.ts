import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { runHarnessEval } from "../core/harness-eval/runner.js";
import { BUILTIN_HARNESS_EVAL_FIXTURES, BUILTIN_HARNESS_EVAL_MANIFEST } from "../core/harness-eval/scenarios.js";

const { values } = parseArgs({ options: { output: { type: "string", short: "o" } } });
const report = await runHarnessEval(BUILTIN_HARNESS_EVAL_MANIFEST, BUILTIN_HARNESS_EVAL_FIXTURES);
const json = `${JSON.stringify(report, null, 2)}\n`;
if (values.output) await writeFile(values.output, json, { encoding: "utf8", mode: 0o600 });
process.stdout.write(json);
if (!report.passed) process.exitCode = 1;
