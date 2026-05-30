/**
 * 发布前从 package.json 移除「已打进 dist 的依赖」。
 *
 * 原因：
 * - @pencil-agent/agent-core 用的是 "file:./core/lib/agent-core"，发布后 tarball 里没有 packages/，npm install 会报错。
 * - @mariozechner/ai / @mariozechner/tui 在 npm 上的 API 和本地 core/lib/ai、core/lib/tui 不一致，已全部打进 dist/packages/，不应再依赖 npm 版本。
 *
 * 使用：发布前执行一次，然后 npm publish。发布后可 git checkout package.json 恢复（若需要继续本地开发）。
 *
 * 运行：node scripts/prepare-publish.js
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const PACKAGE_JSON = path.join(ROOT, "package.json");

const DEPS_TO_REMOVE = [
  "@pencil-agent/agent-core",
  "@pencil-agent/ai",
  "@pencil-agent/tui",
];

function main() {
  const pkgPath = PACKAGE_JSON;
  if (!fs.existsSync(pkgPath)) {
    console.error("package.json not found");
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const deps = pkg.dependencies || {};
  let changed = false;
  for (const key of DEPS_TO_REMOVE) {
    if (key in deps) {
      delete deps[key];
      changed = true;
      console.log(`  移除依赖: ${key}`);
    }
  }
  if (!changed) {
    console.log("  无需移除依赖，package.json 未修改");
    return;
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log("  已写回 package.json，可执行 npm publish");
}

main();
