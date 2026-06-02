# P4 — runtime god 拆（B2）

```yaml
phase: P4
macro_stage: B        # 功能级
batch: B2
status: structure_landed  # 拆分已落地 + 专项评审已结案；重型门(tsc/build/quality/wiki/characterization)待 sign-off 机器
risk: medium
depends_on: [P2, P0]
blocks: [P5]
findings: [F01, F05-partial]
seams: [S1, S2]        # ★ 补 S1：tool-dispatch.ts 在此建，须守"ToolOrchestrator 唯一分发点"
parallel_with: []      # ★ 改串行：P5 在 P4 后（避免双 god 拆并行的归因/merge 地狱）
gate: gates.md#门组-b
```

## 目标

拆分 `agent-session.ts`（~3550 行）为 7 个子模块 + Composition Root 壳；完成 **S2 接缝**；解 U2（theme-contract）。

## 进入条件

- [ ] [P2 DoD](./P2-cycles-gate.md#验证门控dod) 全过
- [ ] [P0](./P0-prepare.md) 来自冻结 `main` 的 characterization cassette/golden + 公共 API 符号表 snapshot 就绪

## 现状摸底（2026-05-31）

`agent-session.ts` 3550 行 / ~90 方法 / 共享 `this._xxx` 私有状态深度交织。**不能一次性盲拆**（受限环境无法编译);按下方检查点**单簇抽取、逐个 tsc 验证**。方法已聚类到目标模块:

| 目标模块 | 现有方法簇(行号) | 自带状态 |
|---------|----------------|---------|
| **theme-contract**(U2,先做) | `exportToHtml` 用的 UI `theme` 值/类型泄漏(L34 import, L3488);并波及 `export-html/tool-renderer.ts`、`extensions-host/types.ts` 的 `Theme` 类型 | — |
| **bash-runner** | executeBash/recordBashResult/abortBash/isBashRunning/hasPendingBashMessages/_flushPendingBashMessages(L2484-2596) | _bashAbortController/_pendingBashMessages |
| **compaction-pipeline** | compact/abortCompaction/abortBranchSummary/setAutoCompactionEnabled/autoCompactionEnabled(L1616-2096) | 3 个 abortController |
| **model-cycle** | setModel/cycleModel/setThinking*/cycle*/clamp/supportsXhigh/supportsThinking/scopedModels(L1287-1612) | _scopedModels |
| **session-lifecycle** | newSession/switchSession/fork/navigateTree/abort/dispose/reload(L1197-2415,2598-2976) | event-subscription state |
| **prompt-assembly** | _rebuildSystemPrompt/_getActiveBaseToolNames/systemPrompt(L683-758) | — |
| **tool-dispatch**(S1) | getActiveToolNames/getAllTools/setActiveToolsByName/toolOrchestrator/_buildRuntime(L587-625,2238) | _baseToolRegistry/_customTools |
| **export-bridge** | exportToHtml/getLastAssistantText(L3114-3174) | — |
| **ui-bridge** | _emit/subscribe/事件注入(L260-528) | _eventListeners |
| **组合根(壳)** | constructor/_initializeCoordinators + 委托(S2 单 config 装配) | 协调器引用 |

> **抽取策略**:多数簇用 **collaborator 类**(持自己那片状态,组合根装配),少数纯函数簇用 helper。每簇一个检查点 commit + 你 tsc。

## 检查点(逐个 tsc 验证)

- [x] **P4.0 theme-contract**(U2,最孤立)→ 选 A 契约 seam 的变体:class 改名 `ThemeImpl implements ThemeContract`,`export type Theme = contract` re-export,`instanceof` 收窄改 `typeof !== "string"`
- [x] **P4.1 bash-runner**(最内聚、状态独立,先试水)
- [x] **P4.2 compaction-pipeline** / **P4.3 model-cycle**(纯函数 `model-cycle.ts`/`thinking-levels.ts` + 有状态 `compaction-controller.ts`)
- [x] **P4.4 tool-dispatch**(含 **S1**:ToolOrchestrator 唯一分发点 → `tool-runtime-controller.ts`)
- [x] **P4.5 prompt-assembly** / **P4.6 export-bridge** / **P4.7 ui-bridge**(→ `event-bridge.ts`)
- [x] **P4.8 组合根退壳**(**S2:单一显式 config 装配**)+ F05 步骤 1-3
- [ ] 每步:符号表 == P0 snapshot(`baseline/public-api-symbols-main.txt`)、tsc 绿 — **待 sign-off 机器**(本机不跑 tsc/符号 diff)

> **实际落地与计划的偏差(2026-06-02)**:计划写"7 子模块",实际在[专项评审 runtime-session-review](../runtime-session-review/README.md)指导下抽出 **10 个 owner**,统一采用**能力上下文(capability-context)模式** —— 每个控制器收一组命名能力闭包(`*ControllerContext`),绝不接收整个 `AgentSession`(避免服务定位器)。`agent-session.ts` 3550→**2375** 行,退为组合根(状态+facade+loop 续接+teardown),**不再持有任何 abort slot**。session-lifecycle 进一步细分:`session-lifecycle-controller.ts`(new/switch/fork 身份变更)与 `session-tree-controller.ts`(navigateTree 分支导航)分属两个 owner;reload([AS09](../runtime-session-review/findings/AS09-reload-runtime-boundary.md))**deferred**、teardown([AS12](../runtime-session-review/findings/AS12-teardown-abort-boundary.md))**rejected**,均留在组合根。ownership 全表见 [`core/runtime/CLAUDE.md` §Capability Ownership](../../../core/runtime/CLAUDE.md)。

## 验证门控（DoD）

> 出口以 [gates.md 门组 B](./gates.md#门组-b--功能级出口大阶段二逐域草案--待你定稿) 为准。**边界守恒(GB-1)是硬门，行数是信号不是判决(GB-4)**。本域补充：

| # | 检查项 | 通过标准 | 门组 B | 状态(2026-06-02) |
|---|--------|---------|--------|-----------------|
| V4-1 | 边界守恒（硬）| runtime 子模块 import 服从白名单：禁反向依赖组合根 / 禁碰 UI（经 ui-bridge）| **GB-1** | ✅ 已验(RS-1 grep：0 控制器 import agent-session) |
| V4-2 | 公共 API | 符号表 == P0 snapshot；如有意改须声明 | GB-2 | ⬜ 待 sign-off 机器(符号 diff) |
| V4-3 | 行为基线 | characterization tests 全过 | GB-2 | ⬜ 待 sign-off 机器(回放) |
| V4-4 | S2/S1 形状 | 组合根单 config 装配；ToolOrchestrator 唯一分发点，code review 确认 | GB-6 | ✅ 已验(RS-2：4 窄 context;S1 唯一分发点经 `tool-runtime-controller`) |
| V4-5 | 单一职责 | 子模块职责单一（行数仅作复审信号，非 pass/fail）| GB-4 | ✅ 已验(RS-3：单 owner;facade 0 abort slot) |
| V4-6 | 无环 | madge 仍零循环 | GB-5 | ⬜ 待 sign-off 机器(verify-quality) |

> **结构门(V4-1/4/5 ↔ RS-1/2/3)已在分支上以 grep 客观验证**(见 [runtime-session-review §Closeout](../runtime-session-review/README.md#closeout--p4-sign-off-handoff))。**重型门(V4-2/3/6)交 sign-off 机器**:符号 diff、characterization 回放、verify-quality/verify-dip、`wiki:all`。

## 提交建议

- 可按子模块拆多个 commit，末 commit 标记 `refactor(p4): agent-session composition root`

## 决策门控

### ✦P4-theme — U2 修法(P4.0 前必须定)

`Theme`（UI 着色原语,~13 方法,modes/interactive/theme/theme.ts 的 class）泄漏进 6 个 core 文件 + 3 扩展;且 `agent-session.exportToHtml` 还 import 了 **value 单例** `theme`(L3488)。两种修法:

| 方案 | 做法 | 优 | 劣 |
|------|------|----|----|
| **A 契约 seam**(计划原意)| 新建 `core/theme-contract.ts` 定 `Theme` 接口;core/扩展改 import 契约;modes 的 class `implements` 它;**value 单例经组合根注入**(exportToHtml 不再自 import) | 纯类型 seam,贴合 S2 | value 注入要碰 exportToHtml 签名(API 变更需 GB-2 声明);手写契约要覆盖全 public 面 |
| **B 下沉**(更彻底)| 把 `Theme` class + 单例**移到 `core/lib/tui`**(它本是 TUI 呈现原语);modes re-export 兼容 | 同时解类型+值反向依赖,无 API 变更,架构更正 | 移 1131 行文件(含 JSON 加载),移动量大 |

**待 maintainer 选 A 或 B。** 推荐 **B**:Theme 本质是 TUI 原语、属 `core/lib/tui`,下沉同时消除类型与 value 两处反向依赖且**不改 exportToHtml API**;A 的 value 注入反而引入 API 变更。

### S1/S2

无新增 ✦（S1=ToolOrchestrator 唯一分发点 / S2=组合根单 config,均已在 gates.md 各域质量项)。

## 参考

- Finding：`../findings/F01-agent-session-god-module.md`
- 建议 [P5](./P5-ui-split.md) 在本 phase **之后**串行启动（runtime 契约稳定后，UI 拆才有稳定依赖面；避免双 god 拆并行的归因/merge 冲突）
