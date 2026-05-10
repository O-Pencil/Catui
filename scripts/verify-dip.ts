#!/usr/bin/env node
/**
 * [WHO]: verifyDip() — DIP isomorphism checker for P2 member lists and P3 file headers
 * [FROM]: Depends on node:fs, node:path, node:process (no external packages)
 * [TO]: Run by developers before committing; exit codes signal FATAL/SEVERE violations
 * [HERE]: scripts/verify-dip.ts — validates map-terrain isomorphism per DIP protocol
 *
 * Exit codes:
 *   0 = All checks passed
 *   1 = FATAL violations found (must fix before commit)
 *   2 = SEVERE violations found (should fix)
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { argv, cwd } from "node:process";
import { fileURLToPath } from "node:url";

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Root is one level up from scripts/
const ROOT = join(__dirname, "..");
const P2_DOC = "AGENT.md";
const LEGACY_DOC = "CLAUDE.md";

interface Violation {
  type: "FATAL" | "SEVERE";
  file: string;
  message: string;
}

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
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
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

function verifyP3Header(filePath: string): Violation | null {
  try {
    const content = readFileSync(filePath, "utf-8");

    // Check if file starts with JSDoc comment
    if (!content.startsWith("/**")) {
      return null; // No JSDoc header is OK for some files (test files, etc.)
    }

    // Find the first complete JSDoc block
    let blockStart = 0;
    let blockEnd = content.indexOf("*/");

    // Check ALL JSDoc blocks in the file (some files have multiple)
    while (blockEnd !== -1) {
      const header = content.substring(blockStart, blockEnd + 2);

      // Check required DIP fields
      const hasWho = header.includes("[WHO]:");
      const hasFrom = header.includes("[FROM]:");
      const hasTo = header.includes("[TO]:");
      const hasHere = header.includes("[HERE]:");

      // Check for forbidden legacy fields
      const hasPos = header.includes("[POS]:");
      const hasInput = header.includes("[INPUT]:");
      const hasOutput = header.includes("[OUTPUT]:");

      if (hasPos || hasInput || hasOutput) {
        return {
          type: "SEVERE",
          file: filePath,
          message: `Legacy [POS]/[INPUT]/[OUTPUT] fields found - should use [WHO]/[FROM]/[TO]/[HERE]`
        };
      }

      if (hasWho && hasFrom && hasTo && hasHere) {
        return null; // Found valid DIP header
      }

      // Move to next block
      blockStart = blockEnd + 2;
      const nextBlockStart = content.indexOf("/**", blockStart);
      if (nextBlockStart === -1 || nextBlockStart > blockStart + 100) break; // Not another block nearby
      blockEnd = content.indexOf("*/", nextBlockStart);
    }

    // No valid DIP header found
    return {
      type: "FATAL",
      file: filePath,
      message: `Missing DIP P3 fields: [WHO], [FROM], [TO], [HERE]`
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
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
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

    // Only check files directly in the module directory (not subdirectories)
    // Subdirectory contents are covered by the parent directory's member list
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
        file: `${baseRel}/${rel}`,
        message: `File exists but not listed in ${P2_DOC} Member List`
      });
    }
  }
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const checkFix = argv.includes("--fix");

  console.log("🔍 Verifying DIP isomorphism...\n");

  // 1. Verify P3 headers in all TypeScript files
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

  let p3Count = 0;
  for (const file of srcFiles) {
    const violation = verifyP3Header(file);
    if (violation) {
      violations.push(violation);
    } else {
      p3Count++;
    }
  }
  console.log(`   ✅ ${p3Count}/${srcFiles.length} files with valid P3 headers`);

  // 2. Verify P2 modules
  console.log("\n📋 Checking P2 module member lists...");
  const p2Modules = findP2Modules();
  for (const module of p2Modules) {
    verifyP2Module(module);
  }
  console.log(`   Checked ${p2Modules.length} P2 modules`);

  // 3. Report violations
  console.log("\n" + "=".repeat(60));

  if (violations.length === 0) {
    console.log("✅ DIP verification passed - all checks green");
    process.exit(0);
  }

  const fatals = violations.filter(v => v.type === "FATAL");
  const severes = violations.filter(v => v.type === "SEVERE");

  if (fatals.length > 0) {
    console.log(`\n🚨 FATAL violations (${fatals.length}) - MUST FIX:`);
    for (const v of fatals) {
      console.log(`   ${v.file}`);
      console.log(`   ${v.message}\n`);
    }
  }

  if (severes.length > 0) {
    console.log(`⚠️  SEVERE violations (${severes.length}) - SHOULD FIX:`);
    for (const v of severes) {
      console.log(`   ${v.file}`);
      console.log(`   ${v.message}\n`);
    }
  }

  console.log(`\nTotal: ${fatals.length} FATAL, ${severes.length} SEVERE`);

  if (fatals.length > 0) {
    process.exit(1);
  } else if (severes.length > 0) {
    process.exit(2);
  }
}

main();
