# Characterization Harness — 行为基线（"功能不变"的行为半边证明）

> 录在重构**前**的主干（`main`）上；重构分支回放比对。与公共符号表（结构半边，见 `scripts/collect-baseline.ts`）合起来构成"功能不变"的双面证据。

## 目的

重构（候选 D / 两大阶段）的核心承诺是"功能不变"。符号表能证明**对外形状没变**，但函数内部重构后**行为可能悄悄改变**而符号不变。本 harness 用 **characterization（行为固化）测试**钉住"当前行为"：

- **固定输入 → Agent 实际产出**逐字节录为黄金文件（golden）。
- 重构后回放同一输入，与黄金 diff；**任何差异 = 回归**（或大阶段二**显式声明**的有意变更，GB-2）。
- 它会连**当前的 bug 一起钉住**——这正是行为保持重构所要：阶段一连 bug 都不许动，阶段二要改得显式声明。

**为什么走 print 模式**：print 是"同一核心引擎、去掉 TUI 非确定性"。它直接覆盖 P4（runtime 拆），也覆盖 P5 调用核心的大部分风险。UI 专属流（controller/overlay/keybinding）print 看不到 → 那部分在 P5 时补局部快照。

## 确定性怎么解决（关键）

Agent 产出依赖 LLM（非确定、要钱、要网）。本 harness **绝不在 CI 调真模型**，复用仓库已验证的机制——**override `global.fetch`**（见 `packages/ai/test/openai-codex-stream.test.ts` 等），并做成 **record-once / replay（VCR）**：

| 模式 | 行为 |
|------|------|
| **record**（`RECORD=1`，你在 main 上跑一次）| 包住真实 `fetch`，把每次模型调用的 **SSE 原始字节**按顺序存进 `cases/<name>/cassette.json`，同时写黄金 |
| **replay**（默认，CI / 重构分支）| `fetch` 被替换：模型 host 的第 N 次调用原样吐回 cassette 第 N 条；其他 host 一律 404（遥测在沙箱无凭据自动 noop）| 

字节级录制 → 回放确定，**无需手写 SSE**，provider 协议细节变了也不影响（录的是真实响应）。

## 目录

```
tests/characterization/
├── harness/
│   ├── fetch-cassette.ts   # record/replay global.fetch（按顺序、原始字节）
│   ├── normalize.ts        # diff 前洗掉易变量（时间戳/耗时/绝对路径/ANSI/uuid）
│   └── run-case.ts         # 构 session(假模型) + runPrintMode + 捕获 stdout
├── cases/<name>/
│   ├── case.json           # { provider, model, input, workspace? }
│   ├── cassette.json       # 录制产物（RECORD 生成）
│   └── workspace/          # 沙箱种子文件（让 read/edit/bash 输出稳定）
├── __golden__/<name>.txt   # 归一化后的黄金 stdout
├── characterization.test.ts# vitest：逐 case 回放 + 比对黄金
└── vitest.config.ts
```

## 工作流

```bash
# ① 在 main（重构前）录黄金 + cassette —— 需你机器上有对应 provider 的真实可用模型
RECORD=1 OPENAI_API_KEY=sk-... npx vitest run --config tests/characterization/vitest.config.ts
git add tests/characterization/cases/*/cassette.json tests/characterization/__golden__
git commit -m "test(characterization): record pre-refactor golden baseline"

# ② 把 harness + golden + cassette 带到重构分支，回放比对（零网络）
npx vitest run --config tests/characterization/vitest.config.ts
#   全绿 = 行为不变；红 = 回归（或大阶段二有意变更，--update 黄金 + 留理由）
```

Replay 前置条件：

- 每个 `cases/<name>/` 必须已经有 `cassette.json`。
- `tests/characterization/__golden__/<name>.txt` 必须已经存在。
- 如果缺 cassette，测试会快速失败并提示先在 `main` 上执行 `RECORD=1`，不会继续进入模型循环。

## 接到哪些门

| 门 | 用法 |
|----|------|
| **GA-2 / GA-3**（阶段一行为不变）| P1 搬迁后回放必须全绿（机械搬迁不改行为）|
| **GB-2**（阶段二逐域）| 该域回放全绿，除非评审显式声明有意变更（`--update` + 理由）|
| **V5-1**（P5 零回归）| print 黄金覆盖核心；UI 专属流补局部快照 |

## ⚠️ 状态

本 harness 在受限沙箱**无法运行验证**（tsx/vitest 冷启动数分钟，性能不足）。代码按已读的真实接口（`createAgentSession` / `runPrintMode` / fetch-override）写成，**需你在开发机跑一次 `RECORD=1` 锁定**。`run-case.ts` 顶部列了 2 个需你确认的假设（apiKey env 注入、createAgentSession 选项名）。
