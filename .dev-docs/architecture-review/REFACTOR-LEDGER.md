# 重构总结清单（Refactor Ledger）

> 活文档（living doc）。一处看清：本次重构**设计了什么 / 解决了什么 / 发现了什么 / 还有什么没解决**。
> 每完成或发现一项，更新对应表格。详细 WHY 见各专项评审目录的 finding 卡与 §Resolution。

```yaml
doc: REFACTOR-LEDGER
branch: refactor/arch-candidate-d        # 签字前禁止合 main
baseline_main: 0eea985 (frozen)
updated_at: 2026-06-05
```

---

## 1. 范围与阶段状态

执行分支 `refactor/arch-candidate-d`，全程不合 main，sign-off 签字后一次 PR 合入。

| Phase | 内容 | 状态 | 专项评审 |
|-------|------|------|----------|
| P0 基线 | baseline 数字 + characterization | 🟡 数字已采(main dist 3.61MB / 符号 296)；门组 A 重型验证待补 | — |
| P1 骨架搬迁 | D 直搬 + R blob + workspace 接线 + DIP | 🟡 实现完成；门组 A 待补 | — |
| P2 治环+守门 | F03/F04 治环、F08 守门、telemetry | 🟡 实现完成，重型验证待补 | — |
| P3 扩展 SDK | extension-sdk(N) + 4-tier loader + S3 依赖反转 | ✅ done | — |
| P4 runtime 拆 | `agent-session.ts` 拆 7 子模块 + S2 | ✅ done | runtime-session-review（AS01–AS12）|
| P5 UI 拆 | `interactive-mode.ts` 拆 controllers/state/mount | ✅ 结构完成（scope C）| interactive-ui-review（F02 + UI01–UI08）|
| P6 入口体积 | lazy 入口 / browser opt-in / ai lazy provider | 🟡 代码大半 landed；DoD 测量 + 收缩刀未完 | entry-volume-review（EV01–EV05）|
| P7 体积重设计 | esbuild / models.generated 拆分 | ⬜ 可选，未启 | — |
| P8 SDK 收窄 | index.ts 收窄 | ⬜ 可选，未启 | — |
| Sign-off | S-1..S-6 跨分支验收 + 签字 | ⬜ 待全 phase landed | execution-plan/sign-off-main.md |

---

## 2. 设计了什么 / 解决了什么问题

### P4 runtime 拆（agent-session god）
- **问题**：`agent-session.ts` 是 runtime god，混合 session 生命周期 / model / tool / reload / 事件。
- **设计**：拆出 model-controller、tool-runtime-controller、session-tree-controller 等；`AgentSession` 退化为 facade（公共面稳定，RS-4）。capability-context 模式（窄能力闭包，RS-2）。
- **解决**：危险耦合下沉到单一 owner（RS-3）；可单测；12 张卡全部终态。

### P5 interactive 拆（interactive-mode god，7960→…）
- **问题**：`interactive-mode.ts` 仓库最大非生成文件，混合渲染 / 提交 / overlay / 中断 / model/auth/tree/settings/slash 分派 + ~80 状态字段。
- **设计**：12 个 controller（image-pipeline / self-update / extension-ui×4 host / state 合一 / model-overlay / auth-provider-config / tree-overlay / settings-overlay / slash-dispatcher / input-submit / interrupt / stream-render），全部 capability-context、无反向 import、单 owner。
- **解决**：**危险耦合全部出 mount**（render loop / submit pipeline / overlay escape seam / 各 dispatch）；token 中性逐刀验证；可单测。
- **关键判断**：mount `<500` 行目标**不可达且失真**（mount = 组合根 + ~12 controller 的 port 面，地板 ~1500-1700）→ 目标修正；god 已拆即满足 S-3"无冗余"。

### P6 入口体积
- **EV02 mode lazy dispatch**：`main.ts` 不再 eager import modes barrel；rpc/interactive/print 按需 `await import`（ACP 早如此）。**冷启动**改善（非 dist）。
- **EV03 browser opt-in（registration slice）**：browser 退出默认加载（`category: optional`，移出 `getBuiltinExtensionPaths()`）；补轻量 `/browser` fallback 提示 opt-in。
- **EV04 provider runtime lazy**：按 `model.api` 首次使用才 import provider runtime；`stream()` 保持同步返回、events 逐条转发（token 中性）、加载失败转 `stopReason:error`。
- **EV05 AI subpath exports + 内部迁移**：新增 additive `@pencil-agent/ai/*` subpaths（root 不收窄，EV-G4）；内部普通代码迁到 explicit subpaths（type-only，行为中性）。

---

## 3. 发现的问题（重构过程中暴露）

| # | 问题 | 严重度 | 状态 | 记录 |
|---|------|--------|------|------|
| D1 | **builtin↔defaults 命名分裂**：P1 骨架搬迁后 `copy-assets.js` / 多个测试 / `idle-think` / `types.ts` 引用不存在的 `extensions/defaults/`，实际目录是 `extensions/builtin/` | 高 | ✅ 已修（`06f54fb`）| 见 §5 D1 |
| D2 | **browser 资产从未进 dist**：因 D1，`copy-assets` 复制死路径 `defaults/`（no-op），browser 的 1.6M `agent-workspace` **从未被打包** → 发布的包里 browser harness 资产缺失（latent packaging bug）| 高 | ✅ 随 D1 修复（dist 因此 +1.6M，是"终于正确装上"，非回归）| 见 §6 |
| D3 | **custom-overlay-host 漏提交**：P5 切片中新文件未 `git add`，导致 maintainer checkout 编译失败 | 中 | ✅ 已修 | — |
| D4 | **mount `<500` 不可达**：god 拆完后 mount 仍是组合根 + port 面，地板 ~1500-1700 | 中 | ✅ 目标已修正（scope C）| mount-shell-evaluation.md |
| D5 | **beta install 404**：重构新增的 first-party workspace 包 `@pencil-agent/extension-sdk` + `@pencil-agent/soul-core` 被列进 host `dependencies` 但**从未发布到 npm**，`npm i` 去 registry 找它们 → 404（mem-core@1.1.0 已发布故无此问题）。main(1.14.6) 不含这些 dep，属重构引入 | 高 | ✅ 已修（beta.2 `c15bc57`）：**发布这两个包**（它们无 first-party 传递依赖、有 build/files，是干净的独立包，与已发布的 mem-core 一致），恢复三者为 host `dependencies`（不改引用）。soul 运行时可选（找不到降级 null），404 纯安装期。⚠️ 维护代价：first-party 包改动需协调 version bump + 重发 | — |

---

## 4. 未解决 / 待办（按优先级）

| # | 待办 | 类型 | 阻塞了什么 |
|---|------|------|-----------|
| O1 | **P0/P1/P2 门组 A 重型验证**（build + characterization + mode smoke on 算力机）| 验证 | sign-off 大阶段一 |
| O2 | **P6 DoD 测量**：V6-1 冷启动 / V6-2 dist / V6-3 mode smoke / V6-5 provider smoke matrix（需算力机）| 验证 | P6 收口 |
| O3 | **dist 收缩刀**（若产品要求安装体积↓）：EV04 metadata chunking（models.generated 分片）/ EV03 browser 独立包（Q2①，砍 1.6M）| 代码（可选）| F07 体积目标 |
| O4 | **EV03 browser 物理迁移**：`builtin/`→`optional/` 或独立包（Q2 当前选 scope A = 暂不移）| 代码（暂停）| — |
| O5 | **interactive 域内 post-P5 清理**：resources-display(481) / slash-handlers(981) 等扁平 handler（**非** phase P6）| 代码（可选 backlog）| — |
| O6 | **sign-off S-1..S-6**：llm-wiki 重生成 + symbols diff + characterization + 性能基线 + 接缝 review + 用户态 smoke + 签字 | 验证 | 合 main |
| O7 | **P7/P8（可选）**：bundle 重设计 / SDK 收窄 | 代码（可选）| — |

---

## 5. 关键发现详记

### D1/D2 builtin↔defaults 分裂 + browser 资产漏装（已修）
- **根因**：`332551f refactor(p1b)` 骨架搬迁把引用改成 `extensions/defaults/`，但目录实际仍叫 `extensions/builtin/`，`defaults/` 不存在。
- **后果链**：`scripts/copy-assets.js` 复制 `extensions/defaults`（不存在）→ 静默不复制任何 builtin 资产 → browser 1.6M `agent-workspace`、各 builtin 扩展的非 `.ts` 资产**都没进 dist**；同时 6+ 测试 `readdirSync(defaults)` 会 ENOENT（因门组 A 重型验证未跑而未被发现）。
- **修复**：`06f54fb fix(p1): align builtin extension paths` 把 copy-assets + types.ts + idle-think + 6 测试统一对齐到 `builtin/`。
- **教训**：骨架搬迁类改动**必须**配套重型验证（build + 资产 diff），否则 packaging 层 bug 会潜伏到 sign-off。

---

## 6. 度量（持续更新）

| 指标 | main 基线(0eea985) | P5 收尾(1b2da59) | HEAD(P6) | 说明 |
|------|--------------------|-------------------|----------|------|
| public 符号 | 296 | — | **296** | ✅ public API 未变（EV-G4 / S-1 利好）|
| dist `du -sh` | — | 5.2M | **6.8M** | +1.6M = D2 修复后 browser `agent-workspace` 终于正确打包（**非回归**）|
| dist `--build`(collect-baseline) | 3.61 MB | — | 4.89 MB | 同上口径差异；增长大头 = D2(+1.6M 资产) + P5 结构性新文件(.js/.d.ts) |
| cold-start `--list-models` | **mean 4.136s / min 2.757s**（2026-06-05 补采）| mean 2.772s / min 2.149s | **mean 1.028s / min 0.508s** | ✅ **V6-1 通过 + S-4 强数据**：vs P5 mean −63%/min −76%；**vs main mean −75%/min −82%**（hyperfine -w3 -r10）。EV02+EV04 显著；重构拆文件的 boot 代价被 lazy 反超。min 最可信(P6 σ 大含系统 outlier) |
| provider smoke(EV04)| — | — | **openai-completions(MiMo)✅ 真流式 `ok`** | EV04 lazy 端到端证实可用；anthropic/google/bedrock 等其余 api 未逐一 smoke（beta notes 已标 pending）|
| cycle(verify-quality SCC) | — | 0 | 0 | ✅ 无环 |

**dist 增长结论（已接受，记录原因）**：HEAD dist > main 基线，原因有二且**均非性能回归**：
1. **D2 修复**：browser 1.6M 资产从"漏装"变"正确装"（本就该在包里）；
2. **P5 结构**：god 拆成 ~12 controller + 新 AI subpath barrel，新增 `.js`/`.d.ts`。
P6 的 lazy 改动（EV02/04/05）对 dist **基本中性**（lazy 改的是"何时加载"，不删代码）。
真正缩 dist 需 O3 的收缩刀（EV04 metadata chunking / EV03 browser 独立包）——**已知 trade-off，按 GB-2 接受当前体积**。

---

## 7. 冷启动测量方法（V6-1，算力机）

冷启动 = 进程启动到"选定 mode 就绪"的耗时；EV02/EV04 把**未选中 mode + 未使用 provider** 的 import 推迟，应体现在此。

> ⚠️ **别用 `--version` / `--help`**：`cli.ts` 对这俩做了 fast-path，在 `await import("./main.js")` **之前**就退出（注释自述 <200ms vs 9-15s 全量 boot）——它们**根本不加载 main.js**，测不到 EV02/EV04。
>
> 正确指标 = **`--list-models`**：加载 main.js 全图 + 建 model registry 后 `process.exit(0)`（main.ts:870-873），**不触发 LLM / 不进 TUI / 不联网**。EV02 删的是 main.ts **顶层** `import {…} from modes/index`，任何加载 main.js 的命令都受影响 → `--list-models` 能干净测到。

```bash
brew install hyperfine    # 可选;没有就用下面的 time fallback

# A/B 对比(隔离 EV02/EV04 的冷启动收益,这是 V6-1 判据):
git checkout 1b2da59 && npm run build
hyperfine -w3 -r10 'node dist/cli.js --list-models'      # P5 收尾点(pre-EV02:顶层 eager 拉 interactive)
git checkout refactor/arch-candidate-d && npm run build
hyperfine -w3 -r10 'node dist/cli.js --list-models'      # HEAD(interactive 不再加载)→ 应 ≤ 前者

# 没 hyperfine —— bash 内建 time,读 real 行,跑 5 次取最小:
for i in 1 2 3 4 5; do time node dist/cli.js --list-models >/dev/null; done
```

**判读**：
- HEAD `--list-models` ≤ P5 收尾 → EV02/EV04 冷启动收益成立 → **V6-1 拿到，P6 核心 DoD 达成**。
- 想看 EV02 的 per-mode 差异：比 `--list-models`(不进 mode 分派) 与真进 interactive 的差（interactive 仍要加载 TUI）。
- 数字贴回 §6 度量表 + execution-plan/P6-entry-volume.md V6-1。

---

## 8b. 门组 A 验收清单（O1 展开 · sign-off 大阶段一硬门）

> 选定 path A（2026-06-05）：不开 P7/P8，先收口 + 推 sign-off 前置。门组 A = P0/P1 目录级出口。
> ✅=已确认 · 🖥=需 maintainer 算力机 · 📝=需 maintainer 落字。

| 门 | 内容 | 状态 | 怎么验 |
|----|------|------|--------|
| GA-1 结构同构 | 目录树 == §4 端态树 | 🟡 强指标✅ | `core/lib`/`core/platform`/`core/extensions-host`/`core/runtime` 已就位、`bundle-deps.js` 已删（✅ 我确认）；完整 tree-diff vs §4 端态树 = 人工核 |
| GA-2 行为不变(硬) | 公共 API 符号 | 🟡 强指标✅ | 符号数 296=296（✅ 已确认，未变）；**完整 diff 需 🖥**：`npm run wiki:all` 重生成 → `symbols.md` 对 `baseline/public-api-symbols-main.txt` diff，应仅路径变化 |
| GA-3 逻辑零改(硬) | 被搬文件体内无逻辑 diff | 🟡 | `git diff` 抽查 P1 搬迁 commit（`332551f` 等）确认仅 path/import 行，文件体无逻辑变化（半人工，可抽样）|
| GA-4 可编译可跑 | tsc + 测试 + 4 mode smoke | 🟡 部分 | tsc ✅（你 build 已过）；**🖥 待**：全量 `vitest`（注意 D1 修复后 `defaults`→`builtin` 的 6 测试应已不再 ENOENT）+ CLI 4-mode smoke（见 beta-smoke-checklist §2）|
| GA-5 DIP 同构 | CLAUDE.md member + P3 + verify-dip | ✅ | `verify-dip.ts` exit 0（✅ 我确认，550 文件）|
| GA-6 R/U 已消化 | R blob 安置 + 拆分票；U 落点 | 🟡 📝 | R 单元（agent-session/interactive-mode 等）整块挪 ✅ 且拆分票=已完成的 P4/P5 评审；**待 📝**：`migration-classification.md` 仍 `draft`，R 4 行处置待落字（口头=整块挪）+ U 行补齐 → 转 `active` |
| 增量守门 | verify-quality 只 gate 增量 | ✅ | `verify-quality.ts` 绿（✅ 我确认）|

**maintainer 算力机命令集（GA-2 + GA-4）：**
```bash
# GA-4 测试 + tsc
npm run build && npx tsc --noEmit
npx vitest run                                  # 全量;关注 D1 后那 6 个 ex-defaults 测试
# GA-4 四 mode smoke → 见 beta-smoke-checklist.md §1/§2
# GA-2 符号 diff
npm run wiki:all
diff <(grep -oE '^[^ ]+' .baseline-out/public-api-symbols.txt | sort) \
     <(sort .dev-docs/architecture-review/baseline/public-api-symbols-main.txt)   # 应仅路径类变化
```

**门组 A 收口后** → P2/P3..P6 的门组 B 各域（多已 ✅）→ sign-off S-1..S-6 + 签字。

---

## 8. 维护约定

- 每完成一项 O*：把状态翻绿、补 commit 号、必要时挪进 §2。
- 每发现新问题：进 §3，详记进 §5。
- 每跑一次度量：更新 §6。
- 本文件是 sign-off 时 S-1..S-6 的"已知问题/已接受 trade-off"索引。
