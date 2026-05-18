# SAL 总体路线与实验大纲

> Type: Unified Outline  
> Status: Active  
> Scope: SAL 当前实验与后续机制化路线  
> Purpose: 用一份文档统一 SAL 目标、当前实验方向、代码改造原则与评估方法，避免多文档口径漂移

## 1. 整体目标

SAL（Structural Anchor Localization）的目标不是替代记忆系统，而是给记忆系统提供稳定的结构地址能力。

核心目标分三层：

1. 让任务、动作、记忆在仓库结构中有可定位地址（module/file 级）。
2. 让记忆召回从“语义相似优先”升级为“结构相关优先 + 语义相关辅助”。
3. 在可控实验下验证 SAL 是否带来可测收益，再决定机制化投入规模。

一句话定义：  
**DIP 提供地形坐标，NanoMem 提供经验沉淀，SAL 负责把两者桥接成可评估的结构化记忆链路。**

---

## 2. 当前实验方向

当前阶段不是做“完整实验平台”，而是做“可运行、可对比、可回溯”的最小闭环。

当前实验方向：

1. 单分支运行（不依赖长期实验分支）。
2. control / sal 两组 A/B 对比（`--nosal` vs 默认 SAL + `--sal-ab` sidecar）。
3. 隔离 memory 目录，避免污染。
4. 生成 run-local 的 anchors 与离线 report，支持事后对比。
5. 不改变主功能行为，实验能力必须可拔插。

当前结论口径：  
**可以做实验性验证，不宣称完整机制化闭环已完成。**

---

## 3. 当前代码层改造（已落地）

本节只记录“已在代码中落地”的改造，不展开实现细节。

### 3.1 SAL 扩展接线

位置：`extensions/defaults/sal/index.ts`

已实现：

1. 生命周期采集：`run_start` / `turn_anchor` / `memory_recalls` / `run_end`。
2. 默认开启，`--nosal` 可关闭；`--sal-rebuild-terrain` 支持地形重建。
3. `--sal-ab` / `NANOPENCIL_SAL_AB=1` 支持 run-local anchors 导出，普通 SAL 使用不写 `.memory-experiments` sidecar。
4. 在 `before_agent_start` 发布结构锚上下文，供 `mem-core` 使用。
5. 在每轮开始清理 turn context，避免上一轮 recall snapshot 串轮污染。

### 3.2 Turn Context 与 mem-core 桥接

位置：`core/runtime/turn-context.ts`, `packages/mem-core/src/engine.ts`

已实现：

1. 通过 turn-context 传递 `structuralAnchor` 与 `memoryRecallSnapshot`。
2. recall snapshot 支持逐条记录评分字段与注入信息，用于实验上报。
3. legacy memory 的分解评分标记为 `unavailable`，避免伪造分项。
4. `injectRank` 改为真实注入顺序语义，避免“按分数排序”误读。

### 3.3 Eval Sink 与 InsForge 上报

位置：`extensions/defaults/sal/eval/insforge-sink.ts`

已实现：

1. 新增 `memory_recalls -> eval_memory_recalls` 上报路径。
2. `run_end` 状态归一：`success -> completed`, `error -> failed`，兼容远端约束。
3. flush 改为串行执行，并加入 `flushInFlight` 保护，避免批次并发导致时序错乱。
4. 解决了 `eval_turns` 先于 `eval_runs` 的外键竞态风险（对应历史 409/23503）。

### 3.4 Print 模式生命周期补齐

位置：`modes/print-mode.ts`

已实现：

1. print-mode 结束前显式触发 `session_shutdown`。
2. 确保扩展端 `run_end` 与剩余批次能 flush，不再只落 `run_start`。

### 3.5 实验辅助与测试

位置：`scripts/generate-sal-experiment-report.js`, `test/*.test.ts`

已实现：

1. run-local 报告生成（variant report / compare report / scorecard）。
2. 关键回归测试覆盖：
   - turn context reset
   - print-mode shutdown flush
   - insforge sink 顺序性（`run_start` 先于 `turn_anchor`）

---

## 4. 改造原则

### 4.1 可拔插优先

SAL 必须是扩展层能力，不得反向耦合 core 主链路。  
关闭 SAL 后主流程应保持可用。

### 4.2 实验只增不侵入

实验采集是附加输出，不应改变任务执行语义。  
默认用户路径不应被实验逻辑绑架。

### 4.3 口径一致与可追溯

每个 run 必须有唯一 run-id，数据按 run 归档。  
同一结论必须可回溯到具体事件与 artifacts。

### 4.4 同条件对比

A/B 对比必须满足 same-commit、same-task、same-model、same-thinking。  
否则结论无效。

### 4.5 先保真再自动化

先确保数据正确、可解释，再推进一键 runner。  
避免“自动化了错误口径”。

---

## 5. 评估方案（当前可执行版本）

### 5.1 实验前置条件

1. 固定源码提交（同一 commit）。
2. 准备同一任务定义（建议两轮任务：seed + follow-up）。
3. 隔离 memory 目录：
   - control: `--nosal`
   - sal: 默认开启

### 5.2 采集清单

每轮至少保留：

1. `eval_runs`（run 级元信息）
2. `eval_turns`（turn 级行为）
3. `eval_sal_anchors`（task/action 锚点）
4. `eval_memory_recalls`（记忆召回明细）
5. run-local anchors 与 memory 快照（用于离线复核）

### 5.3 评估指标

优先指标：

1. Task Anchor 命中率：task anchor 是否落到实际改动模块。
2. Recall 结构相关性：同区域记忆召回占比是否提升。
3. 噪音控制：结构无关召回是否下降。
4. 注入有效性：高 rank 注入记忆是否更贴近后续修改区域。
5. Follow-up 收益：第二轮是否更快进入正确模块、减少无关探索。

### 5.4 判定建议

满足以下任一，可视为 SAL 有正向信号：

1. 锚点命中率显著高于 control。
2. follow-up 轮次结构相关 recall 明显提升且噪音下降。
3. 同复杂度任务下，SAL 组返工与无关探索减少。

---

## 6. 当前边界与已知限制

1. 当前机制仍以“实验可跑通”优先，不是完整实验平台。
2. 自动 orchestration（完整 runner）尚未全量落地。
3. 某些任务（单文件、低结构复杂度）不适合作为 SAL 基准。
4. 指标解释仍需结合人工复核，不宜只看单一分数。

---

## 7. 未来计划（机制化路线）

### Phase A（当前）

目标：稳定采集与可信对比。  
重点：数据正确性、事件顺序、口径一致性。

### Phase B（近期）

目标：半自动化实验执行。  
重点：

1. 统一 run manifest。
2. 规范化 report schema。
3. 减少手工步骤与路径配置错误。

### Phase C（后续）

目标：可复现、可审计的一键实验机制。  
重点：

1. 标准化实验命令入口。
2. 全量 artifacts 自动归档。
3. 评分与诊断流程产品化。

---

## 8. 审阅重点（供本轮评审）

请重点确认以下四项是否符合预期：

1. 目标边界是否准确：当前“可跑通”与未来“机制化”是否分层清晰。
2. 代码改造清单是否完整：是否覆盖你关心的关键改造点。
3. 原则是否可执行：是否能指导后续增量实现。
4. 评估指标是否可落地：是否能支持你现在的实验判定。
