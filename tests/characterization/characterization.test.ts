/**
 * [WHO]: vitest suite — replays each characterization case and diffs against the recorded golden
 * [FROM]: Depends on vitest, harness/run-case, node:fs; reads cases/*\/case.json + __golden__/*.txt
 * [TO]: Run via `vitest --config tests/characterization/vitest.config.ts` (RECORD=1 to (re)record)
 * [HERE]: tests/characterization/characterization.test.ts — behavior-baseline gate
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CharacterizationCase, runCase } from "./harness/run-case.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, "cases");
const GOLDEN_DIR = join(HERE, "__golden__");
const RECORD = !!process.env.RECORD;

function listCases(): string[] {
  if (!existsSync(CASES_DIR)) return [];
  return readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(CASES_DIR, d.name, "case.json")))
    .map((d) => d.name)
    .sort();
}

describe("characterization (print-mode golden)", () => {
  const names = listCases();
  if (names.length === 0) {
    it.skip("no cases defined", () => {});
    return;
  }

  for (const name of names) {
    it(
      name,
      async () => {
        const caseDir = join(CASES_DIR, name);
        const spec = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8")) as CharacterizationCase;
        const actual = await runCase(caseDir, spec, RECORD);
        const goldenPath = join(GOLDEN_DIR, `${name}.txt`);

        if (RECORD) {
          mkdirSync(GOLDEN_DIR, { recursive: true });
          writeFileSync(goldenPath, actual, "utf8");
          expect(existsSync(join(caseDir, "cassette.json"))).toBe(true);
          return;
        }

        expect(existsSync(goldenPath), `missing golden for "${name}" — run RECORD=1 on main first`).toBe(true);
        expect(actual).toBe(readFileSync(goldenPath, "utf8"));
      },
      120_000,
    );
  }
});
