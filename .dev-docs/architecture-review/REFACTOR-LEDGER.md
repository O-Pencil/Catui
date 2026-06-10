# 重构总结清单（Refactor Ledger）

> 活文档（living doc）。一处看清：本次重构**设计了什么 / 解决了什么 / 发现了什么 / 还有什么没解决**。
> 每完成或发现一项，更新对应表格。详细 WHY 见各专项评审目录的 finding 卡与 §Resolution。

```yaml
doc: REFACTOR-LEDGER
branch: main                             # cutover 2026-06-09：main=重构内容；旧 main 保存为 v1.0
baseline_main: 0eea985 (frozen → v1.0)
signoff: signed 2026-06-09（scope=行为不变结构重构 P0-P6；P7-code/P8 显式 deferred）
refactor_complete: partial               # 结构重构✅合 main；体积/构建(P7)+SDK收窄(P8)未执行
updated_at: 2026-06-09
```

---

## 1. 范围与阶段状态

~~执行分支 `refactor/arch-candidate-d`，全程不合 main~~ → **已合 main（cutover 2026-06-09）**：
`origin/main` reset 到 refactor tip（cb8c78d，force-push）；旧 main（0eea985）保存为 `origin/v1.0`。
后续开发基于 main。

> **重构完成度（诚实口径）**：**结构重构（P0–P6）+ 行为不变已完成并合 main**（public API 296=296）。
> **但重构整体未 100% 完成**：**P7 体积/构建优化（BR02 browser 包 / BR03 metadata chunking / BR04 esbuild）与 P8 SDK 收窄都只评审、未执行代码**。
> 包体积与 tsc 构建方式**仍是重构前的样子**——这两块是**遗留的后续重构任务**（见 §4 O3/O8/O9），不是"已完成"。

| Phase | 内容 | 状态 | 专项评审 |
|-------|------|------|----------|
| P0 基线 | baseline 数字 + characterization | ✅ done（sign-off Set A/D 验证；符号 296=296）| — |
| P1 骨架搬迁 | D 直搬 + R blob + workspace 接线 + DIP | ✅ done（门组 A 经 sign-off runbook 跑绿）| — |
| P2 治环+守门 | F03/F04 治环、F08 守门、telemetry | ✅ done（verify-quality 0 环）| — |
| P3 扩展 SDK | extension-sdk(N) + 4-tier loader + S3 依赖反转 | ✅ done | — |
| P4 runtime 拆 | `agent-session.ts` 拆 7 子模块 + S2 | ✅ done | runtime-session-review（AS01–AS12）|
| P5 UI 拆 | `interactive-mode.ts` 拆 controllers/state/mount | ✅ 结构完成（scope C）| interactive-ui-review（F02 + UI01–UI08）|
| P6 入口体积 | lazy 入口 / browser opt-in / ai lazy provider | ✅ done（EV02/03-reg/04/05 landed；DoD 已测，冷启动 −49% vs main）| entry-volume-review（EV01–EV05）|
| P7 启动+构建线 | MCP 异步非阻塞启动 / build:deps 并行+incremental | ✅ **已执行（2026-06-10）**：启动关键路径 MCP init 移出（默认配置 ~56s→1.9s）；no-op build:deps 109s→41.7s（−62%）| startup-async-review |
| P7 体积线 | browser 包 / metadata chunking / esbuild | ⚠️ **仍 deferred（gated）**：BR01 guard landed；**BR02/BR03/BR04 包体积未改**（需 metrics / install UX）| bundle-redesign-review（BR01–BR04 + closure）|
| P8 SDK 收窄 | root barrel → 稳定 SDK 面 | ⚠️ **仅评审（docs-only），未实现**：收窄会破 public API 不变量，推迟到未来 major 窗口 | sdk-surface-review（SK01–SK03）|
| Sign-off | S-1..S-6 + 签字 | ✅ **已签**（2026-06-09，scope = 行为不变结构重构；P7/P8 显式 deferred）| execution-plan/sign-off-main.md |

---

## 1b. 收尾收益结论（当前口径）

本次重构的已完成收益不是"换目录名"，而是把长期维护成本最高的几个耦合中心拆成有 owner、有 port、有守门规则的结构。可以对外表述为：

> **P0-P6 已完成行为不变结构重构**：目录分层、runtime/UI god 文件拆解、扩展包边界、入口 lazy、DIP/quality 守门已落地；public API 保持 296=296；冷启动相对旧 main 明显下降。  
> **P7/P8 未完成**：包体积/构建方式优化与 SDK 面收窄仍是后续重构任务，不能宣称已经拿到。

| 已拿到 | 证据 | 意义 |
|--------|------|------|
| god 文件拆解 | `agent-session.ts` → 7 runtime 子模块；`interactive-mode.ts` → 12 controller/state/mount 切片 | 降低单文件理解成本；形成单 owner 和 capability-context 组合根 |
| 0 循环依赖 | `verify-quality` SCC = 0 | 依赖方向从"能跑"变成可守门的结构约束 |
| public API 不变 | public symbols 296=296 | P0-P6 是行为不变结构重构，不强迫外部消费者迁移 |
| 冷启动下降 | §6 cold-start：HEAD vs main 显著下降 | P6 lazy import/provider lazy 拿到用户可感知收益 |
| DIP 同构强制 | P2/P3 + `verify-dip` | 新文件/新模块不再只靠口头约定表达架构 |
| packaging bug 暴露并修复 | D1/D2/D5 | 重构过程找出隐藏发布问题，提升 release 可验证性 |

| 未拿到 | 原因 | 后续入口 |
|--------|------|----------|
| dist 体积下降 | D2 修复把原本漏装的 browser 资产正确打入包；P7 收缩刀 deferred | O8/O3，bundle-redesign-review closure |
| 构建方式优化 | esbuild/metadata chunking 未执行，仍是 tsc 全量构建 | O8 / P7 BR03-BR04 |
| root SDK 面收窄 | 会破坏 296=296 public API 不变量，需要 major API 窗口 | O9 / P8 sdk-surface-review |

**一致性结论**：当前目录结构与 `target-architecture.md` 的 P0-P6 端态基本一致；不一致项主要集中在 P7/P8 deferred：构建/出包流仍未重构，root barrel 仍未收窄。因此本次 sign-off 的准确边界是：**结构分层与行为不变完成；构建体积线和 SDK 收口线未完成**。

---

## 1c. 评审认知更新：从一次性架构评审到日常功能 workflow

`.dev-docs/architecture-review/` 最初是一次性 Arch Agent handbook（Explore → Report → Grilling → 重构计划）。重构收尾后它不能只作历史评审目录存在——评审思路（如何顶层设计、如何评审功能质量）已**毕业成日常开发流程**：

➡️ **canonical workflow：[`.dev-docs/feature-workflow.md`](../feature-workflow.md)**（四步循环 + 专项评审触发条件 + 5 道验收门 + 模板），并从根 P1 [`AGENTS.md`](../../AGENTS.md) 链入。

**认知更新（一句话）**：架构评审不是"写代码前多写文档"，而是把每次功能开发都纳入同一套判断——**需求是否有明确 owner、改动是否符合现有分层、收益是否超过引入的新抽象、验收是否能自动或人工复现**。

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
| D6 | **陈旧 workspace symlink（clone 未同步，O10① 现实化）**：cutover 前安装的 clone 里 `node_modules/@pencil-agent/{ai,agent-core}` 仍指向旧路径 `packages/ai`（已不存在）→ `@pencil-agent/ai/types` 等子路径解析失败 → `build:deps` 编译报 TS2307 一片。属环境/clone 不同步，非代码缺陷 | 中 | ✅ 已修：`npm install` 重新 link 到 `core/lib/*`。**教训**：cutover/大搬迁后所有 clone 必须 `npm install` 重链（不只 `git pull`）| — |

---

## 4. 未解决 / 待办（按优先级）

> ✅ 已完成：O1 门组 A（sign-off Set A/C/D 跑过）· O2 P6 DoD（冷启动 −49% / dist 已接受）· O6 sign-off（2026-06-09 已签）· cutover（main=refactor，v1.0=旧）。
> ⬇️ 以下是**重构尚未完成的部分** + 收尾杂项。**P7-code / P8 是真正的"重构未完成"，不是可有可无的 backlog**——它们是当初规划进重构、但因不影响用户功能而 deferred 的硬任务。

| # | 待办 | 类型 | 性质 |
|---|------|------|------|
| **O8a** | ✅ **P7 启动+构建线已执行（2026-06-10）**：MCP 异步非阻塞（默认配置启动 ~56s→1.9s）；`build:deps` 并行+incremental（no-op 109s→41.7s）。详见 `startup-async-review.md` | 代码（已完成）| startup-async-review |
| **O8b** | **P7 体积线仍未执行（gated）**：BR03 `models.generated.ts`(14505 行/492K) per-provider chunking + BR04 esbuild + BR02 browser 1.6M 独立包 —— **包体积至今没改**。closure 已给 reopen 条件（要 metrics + 先 transpile-only）| 代码（重构遗留，gated）| bundle-redesign-review/closure.md Reopen Matrix |
| **O9** | **P8 SDK 收窄未执行（重构未完成）**：root barrel → 稳定 SDK 面（SK01-03）。会破 public API 296 不变量 → **需 maintainer 开 major 版本窗口**才能做 | **代码（重构遗留，需 major）** | sdk-surface-review |
| O3 | **EV03 browser 独立包**（Q2①，砍 1.6M 安装体积）：UX-first，要先有 install/enable UX（与 O8 同属 P7 体积线）| 代码（可选）| BR02 reopen 条件 |
| O5 | interactive 域内 post-P5 清理：resources-display(481) / slash-handlers(981) 扁平 handler | 代码（可选 backlog）| — |
| O10 | **收尾杂项**：① 所有 clone `reset --hard origin/main` 同步；② 决定 `refactor/arch-candidate-d` 分支去留；③ `migration-classification.md` draft→active（GA-6 落字）；④ npm 2.0 stable 待 beta 测试后再发 | 杂项 | — |

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
| **MCP 启动阻塞（关键路径）** | — | — | **默认配置 ~56s→1.9s；2 mock ~3.3s→0.6s** | ✅ P7 startup：MCP init 移出关键路径（`createAgentSession` 返回时间，deferMcpInit）。默认 3×npx server warm ~20s/cold 24-34s 全部转后台 warmup。print/acp/rpc 保持同步（一次性 turn 需工具）|
| **build:deps no-op 重建** | — | — | **109s→41.7s（−62%）** | ✅ P7 build：并行（agent-core 依赖 ai 串后）+ tsc incremental。改文件时只重建受影响包 |
| **public 符号（startup 改后复核）** | 296 | — | **296** | ✅ 顶层导出不变；新增 `warmupMcpTools()`/`deferMcpInit`/`sdk:mcp_ready` 均成员级 additive（GB-2 声明，非破坏）|

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
