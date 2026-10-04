#!/usr/bin/env node
/**
 * [WHO]: verifyDip() — DIP isomorphism checker for P1 extension table, P2
 *        member lists and P2 doc coverage, and P3 file headers; ratcheted
 *        against .dev-docs/structure-baseline.json
 * [FROM]: Depends on node:fs, node:path, node:process, scripts/lib/dip-baseline.ts
 *         (no external packages)
 * [TO]: Run by CI (ci.yml, quality.yml) and local `npm run verify:all`; exit
 *       codes signal new FATAL/SEVERE violations outside the baseline
 * [HERE]: scripts/verify-dip.ts — validates map-terrain isomorphism per DIP protocol
 *
 * Exit codes:
 *   0 = No violations outside the baseline
 *   1 = New FATAL violations found (must fix before commit)
 *   2 = New SEVERE violations found (should fix)
 *
 * Flags:
 *   --update-baseline  rewrite the shared baseline from current state
 *   --allow-grow       permit that rewrite to add entries (refused by default)
 */

import { readdirSync, readFileSync, existsSync, type Dirent } from "node:fs";
import { join, relative, dirname } from "node:path";
import { argv, cwd } from "node:process";
import { fileURLToPath } from "node:url";
import { partitionByBaseline, saveBaseline } from "./lib/dip-baseline.js";

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Root is one level up from scripts/
const ROOT = join(__dirname, "..");
const P2_DOC = "AGENT.md";
const LEGACY_DOC = "CLAUDE.md";

interface Violation {
  type: "FATAL" | "SEVERE";
  /** Stable machine key. The message is prose and may be reworded freely;
   *  the code must not change or the baseline ratchet goes stale. */
  code: ViolationCode;
  file: string;
  message: string;
}

/** Ledger identity. Deliberately coarser than the diagnosis: all four ways a
 *  P3 header can be wrong share one code, because "how it is wrong" is checker
 *  detail. Keying on the specific code made a checker improvement look like new
 *  debt — fixing the shebang handling reclassified 18 files and the ratchet
 *  refused the write, reporting a change in diagnosis as a change in debt.
 *  The specific reason travels in the message. */
type ViolationCode =
  | "P3-HEADER"
  | "P2-NO-MODULE-DOC"
  | "P2-NOT-IN-MEMBER-LIST"
  | "P1-EXT-TABLE-DRIFT"
  | "P1-EXT-ROW-ORPHAN";

function violationKey(v: Violation): string {
  return `${v.code}:${v.file}`;
}

/** Key namespaces this gate owns inside the shared structural baseline.
 *  Keys outside this set belong to other gates (verify-structure owns
 *  SIZE-OVER-LIMIT) and are carried over, never erased, on update. */
const DIP_OWNED_PREFIXES: readonly string[] = [
  "P1-EXT-TABLE-DRIFT:",
  "P1-EXT-ROW-ORPHAN:",
  "P2-NO-MODULE-DOC:",
  "P2-NOT-IN-MEMBER-LIST:",
  "P3-HEADER:",
];

const violations: Violation[] = [];

// ============================================================================
// P2 Module Member List Extraction
// ============================================================================

function extractMemberList(p2Path: string): Map<string, string> {
  // For P2 AGENT.md files with Member List sections
  const content = readFileSync(p2Path, "utf-8");
  const members = new Map<string, string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^(?:[-*]\s+)?`?([\w./-]+(?:\.ts|\/))`?:\s*(.+)$/);
    if (!match) continue;
    const [, key, description] = match;
    members.set(key, description);
  }

  return members;
}

function getActualFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git" || entry.name === ".tmp") continue;
        if (entry.name === P2_DOC || entry.name === "AGENTS.md" || entry.name === LEGACY_DOC) continue;

        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          // Recurse into directories (except skipped ones above)
          walk(fullPath);
        } else if (entry.isFile()) {
          // Only include .ts source files
          if (entry.name.endsWith(".ts")) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  walk(dir);
  return files;
}

function getRelativePath(base: string, full: string): string {
  let rel = relative(base, full);
  // Normalize path separators
  rel = rel.replace(/\\/g, "/");
  return rel;
}

// ============================================================================
// P3 Header Verification
// ============================================================================

/** Exemptions are explicit and narrow. Anything not named here is checked.
 *  `apps/` holds the Capacitor/Vite mobile client, which ships its own
 *  toolchain and its own AGENTS.md; a P3 block on a vite.config.ts is noise. */
function isP3Exempt(filePath: string): boolean {
  const rel = getRelativePath(ROOT, filePath);
  return (
    filePath.endsWith(".d.ts") ||
    /\.generated\.ts$/.test(filePath) ||
    rel === "apps" ||
    rel.startsWith("apps/")
  );
}

function verifyP3Header(filePath: string): Violation | null {
  try {
    if (isP3Exempt(filePath)) return null;
    const relPath = getRelativePath(ROOT, filePath);
    const content = readFileSync(filePath, "utf-8");

    // Two things legitimately precede the header and neither is content: a
    // shebang line on executables, and a UTF-8 BOM on files saved by Windows
    // editors. Both were previously read as "no header", which reported
    // compliant files as violations.
    const afterBom = content.charCodeAt(0) === 0xfeff ? 1 : 0;
    const afterShebang =
      content.slice(afterBom).startsWith("#!") ? content.indexOf("\n") + 1 : afterBom;
    const body = content.slice(afterShebang);

    // A file with no header is a violation, not a pass. The previous
    // `return null` here cleared every non-JSDoc file from the check, which
    // hid 21 production files (including cli.ts) behind a green CI badge.
    if (!body.startsWith("/**")) {
      return {
        type: "FATAL",
        code: "P3-HEADER",
        file: relPath,
        message: `[no header] Missing P3 header: file does not open with a /** block carrying [WHO]/[FROM]/[TO]/[HERE]`,
      };
    }

    // Only the file's opening JSDoc block can serve as a P3 header. Anything
    // deeper does not gatekeep: the premise in AGENTS.md is "read 4 lines,
    // decide instantly".
    const header = body.substring(0, body.indexOf("*/") + 2);

    if (header.includes("[POS]:") || header.includes("[INPUT]:") || header.includes("[OUTPUT]:")) {
      return {
        type: "SEVERE",
        code: "P3-HEADER",
        file: relPath,
        message: `[legacy fields] Legacy [POS]/[INPUT]/[OUTPUT] fields found - should use [WHO]/[FROM]/[TO]/[HERE]`,
      };
    }

    const complete =
      header.includes("[WHO]:") &&
      header.includes("[FROM]:") &&
      header.includes("[TO]:") &&
      header.includes("[HERE]:");
    if (complete) return null;

    // Distinguish "P3 exists but is buried" from "P3 was never written" — the
    // first is a 30-second move, the second needs the file to be read.
    const nextBlockStart = body.indexOf("/**", header.length);
    if (nextBlockStart !== -1) {
      const nextBlockEnd = body.indexOf("*/", nextBlockStart);
      if (nextBlockEnd !== -1) {
        const next = body.substring(nextBlockStart, nextBlockEnd + 2);
        if (
          next.includes("[WHO]:") &&
          next.includes("[FROM]:") &&
          next.includes("[TO]:") &&
          next.includes("[HERE]:")
        ) {
          return {
            type: "FATAL",
            code: "P3-HEADER",
            file: relPath,
            message:
              `[buried] P3 block sits at line ${body.slice(0, nextBlockStart).split("\n").length} ` +
              `behind a descriptive JSDoc, so it gatekeeps nothing. Move it to the top.`,
          };
        }
      }
    }

    return {
      type: "FATAL",
      code: "P3-HEADER",
      file: relPath,
      message: `[partial] P3 block present but missing [WHO]/[FROM]/[TO]/[HERE] markers`,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// P2 Module Verification
// ============================================================================

interface P2Module {
  p2Path: string;
  baseDir: string;
  memberList: Map<string, string>;
}

function findP2Modules(): P2Module[] {
  const modules: P2Module[] = [];

  function findP2Docs(startDir: string, depth: number = 0) {
    const p2Path = join(startDir, P2_DOC);
    if (existsSync(p2Path) && depth > 0) {
      // This is a P2 module (not the root P1)
      const content = readFileSync(p2Path, "utf-8");

      // Check if this is a P2 (has "Member List" section)
      if (content.includes("Member List")) {
        modules.push({
          p2Path,
          baseDir: startDir,
          memberList: extractMemberList(p2Path)
        });
      }
    }

    if (depth > 3) return; // Don't recurse too deep

    try {
      const entries = readdirSync(startDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git" || entry.name === ".tmp") continue;
        if (!entry.isDirectory()) continue;

        // Skip certain directories
        if (["test", "tests", "__tests__", "scripts", ".claude"].includes(entry.name)) continue;

        findP2Docs(join(startDir, entry.name), depth + 1);
      }
    } catch {
      // Skip inaccessible
    }
  }

  findP2Docs(ROOT, 0);
  return modules;
}

function verifyP2Module(module: P2Module) {
  const actualFiles = getActualFiles(module.baseDir);
  const baseRel = relative(ROOT, module.baseDir).replace(/\\/g, "/");

  // Get direct children of the module directory (files only, not recursive)
  const directChildren = new Set<string>();
  try {
    const entries = readdirSync(module.baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        directChildren.add(entry.name);
      }
    }
  } catch {}

  // Check for files that exist but aren't in the member list
  for (const file of actualFiles) {
    const rel = getRelativePath(module.baseDir, file);
    const relUnix = rel.replace(/\\/g, "/");

    // A module's member list covers its own direct .ts children. Nested files
    // are the responsibility of the *subdirectory's* AGENT.md — which is what
    // verifyP2DocCoverage() below enforces. The previous comment claimed the
    // parent covered them while the line below discarded them, leaving every
    // subdirectory unverified.
    if (relUnix.includes("/")) continue;

    // Skip test files — test coverage is verified separately
    if (relUnix.startsWith("test/") || relUnix.includes("/test/")) continue;

    // Check if this file is listed in the member list
    let found = false;

    for (const key of module.memberList.keys()) {
      if (key.includes("*")) continue; // Skip glob patterns
      if (key.endsWith("/")) continue; // Skip directory entries

      // Normalize for comparison
      const keyNorm = key.replace(/\\/g, "/");
      if (keyNorm === relUnix || keyNorm === rel.split("/").pop()) {
        found = true;
        break;
      }
    }

    if (!found) {
      violations.push({
        type: "SEVERE",
        code: "P2-NOT-IN-MEMBER-LIST",
        file: `${baseRel}/${rel}`,
        message: `File exists but not listed in ${P2_DOC} Member List`
      });
    }
  }
}

// ============================================================================
// P2 Doc Coverage — a directory needs its own P2 only when no ancestor has one
// ============================================================================

/** Directories that are not P2 modules by design: each .ts here is either a
 *  root entry point (covered by the P1), a test workspace, or a nested npm
 *  package with its own toolchain. */
const P2_EXEMPT_DIRS = new Set([
  "test", "tests", "__tests__", "dist", "node_modules",
  "scripts", "apps", "llm-wiki", "charter", "learning-framework",
  ".dev-docs", "docs", "assets",
]);

/** Nearest AGENT.md at or above `dir`, walking toward the repo root.
 *
 *  Coverage is inherited, not per-level. An earlier version of this check
 *  required *this exact directory* to hold an AGENT.md and reported 57
 *  violations — of which 56 were directories already documented by an ancestor
 *  (`core/lib/ai/src/providers/` is an implementation folder inside the
 *  `core/lib/ai` module, which has its own P2). Satisfying it would have meant
 *  writing 56 near-empty documents: more files to read, zero information gained.
 *  That is the cargo-cult failure mode the charter warns about, reached by
 *  obeying the letter of a rule whose purpose it contradicts. */
function nearestP2Doc(dir: string): string | null {
  const rel = getRelativePath(ROOT, dir);
  const parts = rel.split("/").filter(Boolean);
  for (let i = parts.length; i > 0; i--) {
    const candidate = parts.slice(0, i).join("/");
    if (existsSync(join(ROOT, candidate, P2_DOC))) return candidate;
  }
  return null;
}

function verifyP2DocCoverage(): { checked: number; undoced: number } {
  const dirsHoldingTs = new Map<string, number>();

  function scan(currentDir: string) {
    let entries: Dirent[];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    let tsCount = 0;
    for (const entry of entries) {
      if (P2_EXEMPT_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        tsCount++;
      }
    }
    if (tsCount > 0) {
      dirsHoldingTs.set(currentDir, tsCount);
    }
    for (const entry of entries) {
      if (P2_EXEMPT_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) scan(join(currentDir, entry.name));
    }
  }
  scan(ROOT);

  let undoced = 0;
  for (const [dir, count] of dirsHoldingTs) {
    // The repo root is the P1; it is covered by P1 checks, not by a P2.
    if (dir === ROOT) continue;
    if (nearestP2Doc(dir) !== null) continue;
    undoced++;
    violations.push({
      type: "SEVERE",
      code: "P2-NO-MODULE-DOC",
      file: getRelativePath(ROOT, dir),
      message: `Directory holds ${count} production .ts file(s) and no ${P2_DOC} exists at this level or anywhere above it — its members are invisible to P2 navigation`,
    });
  }
  return { checked: dirsHoldingTs.size, undoced };
}

// ============================================================================
// P1 — the root map must not drift from the terrain
// ============================================================================

/** AGENTS.md publishes an extension table. Every directory under
 *  extensions/builtin and extensions/optional must appear there, otherwise the
 *  P1 a new maintainer reads is missing an entry point that actually loads.
 *  verify:dip used to check P2 member lists only, which made SEVERE-003
 *  ("P1 out of sync") structurally undetectable.
 *
 *  The table is located by its shape (a markdown table with an `Extension`
 *  column), not by its heading text. Anchoring on a title means a harmless
 *  rewording silently disables the check — and a gate that can be turned off by
 *  editing prose is a gate that will be. */
function findExtensionTable(content: string): string | null {
  const lines = content.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\|\s*Extension\s*\|/i.test(lines[i])) continue;
    start = i + 1;
    break;
  }
  if (start === -1) return null;

  const rows: string[] = [];
  for (let i = start; i < lines.length; i++) {
    if (!lines[i].trimStart().startsWith("|")) break;
    rows.push(lines[i]);
  }
  return rows.length > 0 ? rows.join("\n") : null;
}

function verifyP1ExtensionTable(): { declared: number; onDisk: number } {
  const p1Path = join(ROOT, "AGENTS.md");
  const content = readFileSync(p1Path, "utf-8");

  const table = findExtensionTable(content);
  if (table === null) {
    violations.push({
      type: "SEVERE",
      code: "P1-EXT-TABLE-DRIFT",
      file: "AGENTS.md",
      message: `P1 has no markdown table with an "Extension" column — extension discovery has no declared source of truth`,
    });
    return { declared: 0, onDisk: 0 };
  }

  const declared = new Set<string>();
  for (const line of table.split(/\r?\n/)) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (m) declared.add(m[1]);
  }

  const onDisk: string[] = [];
  for (const tier of ["builtin", "optional"]) {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(ROOT, "extensions", tier), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "AGENT.md") continue;
      onDisk.push(entry.name);
    }
  }

  for (const name of onDisk.sort()) {
    if (declared.has(name)) continue;
    // Distinguish "undocumented" from "documented in prose but absent from the
    // table". Both are table drift; only the first is a discoverability hole.
    const documentedInProse = content.includes(`extensions/${name}`) || content.includes(`\`${name}\``);
    violations.push({
      type: "SEVERE",
      code: "P1-EXT-TABLE-DRIFT",
      file: `AGENTS.md#${name}`,
      message: documentedInProse
        ? `extensions/*/${name} appears in the P1 prose but has no row in the "Built-in Extensions" table — a reader scanning the table will not find it`
        : `extensions/*/${name} exists on disk and is not mentioned anywhere in the P1`,
    });
  }

  // The reverse direction is the more misleading one: a row pointing at a
  // directory that no longer exists sends a maintainer looking for nothing.
  // `interview` sat in this table for a long time after it had been folded
  // into discipline/skills/interview.
  for (const name of [...declared].sort()) {
    if (onDisk.includes(name)) continue;
    violations.push({
      type: "SEVERE",
      code: "P1-EXT-ROW-ORPHAN",
      file: `AGENTS.md#${name}`,
      message: `the "Built-in Extensions" table lists \`${name}\` but extensions/*/${name} does not exist — the row is stale`,
    });
  }

  return { declared: declared.size, onDisk: onDisk.length };
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const updateBaseline = argv.includes("--update-baseline");
  const allowGrow = argv.includes("--allow-grow");

  console.log("🔍 Verifying DIP isomorphism...\n");

  // 1. P3 headers
  console.log("📄 Checking P3 headers...");
  const allFiles = getActualFiles(ROOT);
  // Normalize paths and filter out test files and declaration files (don't need P3 headers)
  const srcFiles = allFiles.filter(f => {
    const normalized = f.replace(/\\/g, "/");
    return (
      !normalized.includes("/test/") &&
      !normalized.includes("/tests/") &&
      !normalized.includes("/__tests__/") &&
      !f.endsWith(".d.ts")
    );
  });

  let p3Ok = 0;
  for (const file of srcFiles) {
    const violation = verifyP3Header(file);
    if (violation) {
      violations.push(violation);
    } else {
      p3Ok++;
    }
  }
  const p3Bad = srcFiles.length - p3Ok;
  console.log(
    `   ${p3Ok}/${srcFiles.length} production files carry a complete P3 header` +
      (p3Bad > 0 ? `  (${p3Bad} deficient)` : ""),
  );

  // 2. P2 module member lists
  console.log("\n📋 Checking P2 module member lists...");
  const p2Modules = findP2Modules();
  for (const module of p2Modules) {
    verifyP2Module(module);
  }
  console.log(`   Checked ${p2Modules.length} P2 modules`);

  // 3. P2 doc coverage
  const coverage = verifyP2DocCoverage();
  console.log(
    `   ${coverage.checked} directories hold production .ts; ${coverage.undoced} lack a ${P2_DOC}`,
  );

  // 4. P1 extension table
  const p1 = verifyP1ExtensionTable();
  console.log(`   P1 declares ${p1.declared} extensions; ${p1.onDisk} exist on disk`);

  // 5. Baseline ratchet
  const ratchetable = violations.map(v => ({ key: violationKey(v) }));
  if (updateBaseline) {
    const written = saveBaseline(
      ratchetable.map(r => r.key),
      DIP_OWNED_PREFIXES,
      allowGrow,
    );
    console.log(
      `\n📌 Baseline written: ${written} total known violation(s) → .dev-docs/structure-baseline.json`,
    );
    process.exit(0);
  }

  const { known, fresh } = partitionByBaseline(ratchetable);
  const freshKeys = new Set(fresh.map(f => f.key));
  const freshViolations = violations.filter(v => freshKeys.has(violationKey(v)));

  console.log("\n" + "=".repeat(60));
  if (known.length > 0) {
    console.log(
      `📌 ${known.length} known violation(s) tracked in .dev-docs/structure-baseline.json (existing debt, not a regression)`,
    );
  }
  if (fresh.length === 0) {
    console.log("✅ DIP verification passed — no violations outside the baseline");
    process.exit(0);
  }

  const fatals = freshViolations.filter(v => v.type === "FATAL");
  const severes = freshViolations.filter(v => v.type === "SEVERE");

  if (fatals.length > 0) {
    console.log(`\n🚨 FATAL (${fatals.length}) — MUST FIX:`);
    for (const v of fatals) {
      console.log(`   ${v.file}`);
      console.log(`     [${v.code}] ${v.message}\n`);
    }
  }

  if (severes.length > 0) {
    console.log(`\n⚠️  SEVERE (${severes.length}) — SHOULD FIX:`);
    for (const v of severes) {
      console.log(`   ${v.file}`);
      console.log(`     [${v.code}] ${v.message}\n`);
    }
  }

  console.log(
    `\nTotal new: ${fatals.length} FATAL, ${severes.length} SEVERE (baseline: ${known.length})`,
  );

  if (fatals.length > 0) {
    process.exit(1);
  } else {
    process.exit(2);
  }
}

main();
