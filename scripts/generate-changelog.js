/**
 * Changelog Generator
 *
 * 自动生成 changelog，基于 git commit 历史
 * 用法: node scripts/generate-changelog.js [version]
 *
 * 示例:
 *   node scripts/generate-changelog.js 1.12.0
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const CHANGELOG_PATH = "CHANGELOG.md";

function getCurrentVersion() {
  const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
  return pkg.version;
}

function getLastTag() {
  try {
    const pkgVersion = getCurrentVersion();
    const [major, minor] = pkgVersion.split(".").map(Number);
    // Only consider tags on the current major.minor line. A higher-line tag
    // (e.g. v2.0.0-beta.2 while releasing 1.2.x) must not become the base.
    const prefix = `v${major}.${minor}.`;
    const tags = execSync("git tag --sort=-v:refname", { encoding: "utf-8" });
    const first = tags
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((t) => t.startsWith(prefix))[0];
    return first ?? "v0.0.0";
  } catch {
    return "v0.0.0";
  }
}

function getCommitsSince(tag) {
  try {
    const range = tag === "v0.0.0" ? "HEAD" : `${tag}..HEAD`;
    const commits = execSync(`git log ${range} --oneline --format="%s|%h|%ad" --date=short`, {
      encoding: "utf-8",
    });
    return commits.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function categorizeCommit(message) {
  const lower = message.toLowerCase();

  if (lower.startsWith("feat") || lower.includes("新增") || lower.includes("添加")) {
    return "Added";
  }
  if (lower.startsWith("fix") || lower.includes("修复") || lower.includes("修复")) {
    return "Fixed";
  }
  if (lower.startsWith("refactor") || lower.includes("重构")) {
    return "Changed";
  }
  if (lower.startsWith("perf") || lower.includes("性能")) {
    return "Performance";
  }
  if (lower.startsWith("docs") || lower.includes("文档")) {
    return "Documentation";
  }
  if (lower.startsWith("chore") || lower.includes("维护") || lower.includes("构建")) {
    return "Maintenance";
  }
  if (lower.startsWith("style") || lower.includes("格式")) {
    return "Style";
  }

  return "Unknown";
}

function formatChangelog(commits, version, date) {
  const categories = {
    Added: [],
    Fixed: [],
    Changed: [],
    Performance: [],
    Documentation: [],
    Maintenance: [],
    Style: [],
  };

  for (const commit of commits) {
    const [message] = commit.split("|");
    const category = categorizeCommit(message);

    if (category !== "Unknown") {
      categories[category].push(`- ${message}`);
    }
  }

  let output = `## [${version}] - ${date}\n\n`;

  const categoryNames = {
    Added: "### Added",
    Fixed: "### Fixed",
    Changed: "### Changed",
    Performance: "### Performance",
    Documentation: "### Documentation",
    Maintenance: "### Maintenance",
    Style: "### Style",
  };

  for (const [key, name] of Object.entries(categoryNames)) {
    if (categories[key].length > 0) {
      output += `${name}\n${categories[key].join("\n")}\n\n`;
    }
  }

  return output;
}

function generateChangelog(version) {
  const lastTag = getLastTag();
  const commits = getCommitsSince(lastTag);

  if (commits.length === 0) {
    console.log("No commits since last release.");
    return;
  }

  const date = new Date().toISOString().split("T")[0];
  const changelogEntry = formatChangelog(commits, version, date);

  // Read existing changelog
  let existingContent = "";
  try {
    existingContent = readFileSync(CHANGELOG_PATH, "utf-8");
  } catch {
    // File doesn't exist, create new
  }

  // Insert after the first line (title) if it exists
  const lines = existingContent.split("\n");
  const insertIndex = lines.findIndex((line) => line.startsWith("---"));

  let newContent;
  if (insertIndex !== -1) {
    const before = lines.slice(0, insertIndex + 1).join("\n");
    const after = lines.slice(insertIndex + 1).join("\n");
    newContent = `${before}\n\n${changelogEntry}${after}`;
  } else {
    newContent = changelogEntry + existingContent;
  }

  writeFileSync(CHANGELOG_PATH, newContent);
  console.log(`Changelog updated for version ${version}`);
  console.log(`Commits processed: ${commits.length}`);
}

// Main
const version = process.argv[2] || getCurrentVersion();
generateChangelog(version);
