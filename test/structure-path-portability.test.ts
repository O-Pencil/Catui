/**
 * [WHO]: Tests portable structural baseline keys and genuine size regressions
 * [FROM]: Depends on isolated filesystem fixtures and the real structure CLI/baseline owner
 * [TO]: Consumed by test:commands and native Windows pre-push acceptance
 * [HERE]: test/structure-path-portability.test.ts - structural ratchet portability regression
 */
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("portable keys preserve baseline/exemptions and still reject new oversized production files", (t) => {
  const fixture = mkdtempSync(join(tmpdir(), "catui-structure-paths-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const repo = dirname(dirname(fileURLToPath(import.meta.url)));
  const put = (path: string, content: string) => {
    const destination = join(fixture, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content, "utf8");
  };
  put("package.json", '{"type":"module"}');
  put("scripts/verify-structure.ts", "");
  put("scripts/lib/dip-baseline.ts", "");
  for (const path of ["scripts/verify-structure.ts", "scripts/lib/dip-baseline.ts"]) {
    copyFileSync(join(repo, path), join(fixture, path));
  }
  put(".dev-docs/structure-baseline.json", JSON.stringify({ keys: ["SIZE-OVER-LIMIT:core/known.ts"] }));
  const oversized = "// existing fixture\n".repeat(805);
  put("core/known.ts", oversized);
  put("core/lib/ai/test/exempt.ts", oversized);
  const run = () => spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "scripts/verify-structure.ts"], {
    cwd: fixture, encoding: "utf8", timeout: 15000,
  });
  const clean = run();
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /1 known oversize/);
  assert.match(clean.stdout, /no file outside the baseline/);
  put("core/fresh.ts", oversized);
  const regression = run();
  assert.equal(regression.status, 1, regression.stderr);
  assert.match(regression.stderr, /core\/fresh\.ts/);
  assert.match(regression.stderr, /1 new oversize/);
  assert.doesNotMatch(regression.stderr, /known\.ts|exempt\.ts/);
});
