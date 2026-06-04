# Interactive UI Review

```yaml
review_id: interactive-ui-review
parent_finding: ../findings/F02-interactive-mode-god-file.md
scope: modes/interactive/interactive-mode.ts and direct UI collaborators
status: active
created_at: 2026-06-02
sibling: ./../runtime-session-review/   # P4 的同型评审，门组与模式沿用
```

## Purpose

聚焦 `InteractiveMode` 拆分的专项架构评审，是 [F02](../findings/F02-interactive-mode-god-file.md) 的子评审，对应 [P5 UI god 拆](../execution-plan/P5-ui-split.md)。与 [runtime-session-review](../runtime-session-review/README.md)（P4）同型：P5 runbook 是执行手册，本目录解释**每个 UI 切片为什么有效、如何判定**。

> **为什么需要专项评审**：`interactive-mode.ts` 是仓库最大非生成文件（7960 行 / 182 方法 / ~80 状态字段 / import 头横跨 18 个 core 内部）。盲拆会制造新耦合、新 service-locator、不清的归属，且 TUI 是产品核心（`.PENCIL.md`），任何键位/overlay 回归直接伤体验。
>
> **顶层校准**：继续拆代码前，先以 [mode-architecture-calibration.md](./mode-architecture-calibration.md) 约束方向：`InteractiveMode` 的终态是 **TUI adapter + composition root**，不是业务能力 owner，也不是所有 mode 的基类。

## When To Use This Pattern

与 runtime-session-review 同条件：composition root / lifecycle / 公共门面 被拆，且拆动行为而非仅挪文件、有外部调用者要稳、新 seam 会被多 mode/扩展/测试复用时，先评审再实施。

## Workflow

1. **Calibrate**：先读 [mode-architecture-calibration.md](./mode-architecture-calibration.md)，判断切片是 shared capability / interactive controller / surface host / composition wiring / render layer。
2. **Map**：方法簇 + 状态归属（见 [P5 §现状摸底](../execution-plan/P5-ui-split.md#现状摸底2026-06-02)）。
3. **Card**：每个耦合/归属风险一张 `findings/UIxx-*.md`。
4. **Gate**：切片对照 [gates.md](./gates.md)（UI-G0…UI-G11）。
5. **Grill**：maintainer 选 selected / rejected / deferred / blocker。
6. **Implement**：卡接受后再写代码（沿用 P4 capability-context + 逐 tsc + V5-1 功能验收）。
7. **Record**：把实际顺序与验证状态回填 `refactor-plan.md` 及各卡 `## Resolution`。

## Current Finding Set

| Finding | Status | Purpose |
|---------|--------|---------|
| [UI01](./findings/UI01-tui-characterization-baseline.md) | selected | P5 验收用[**功能特性清单 + 验收矩阵**](./feature-inventory.md)（接受重写），**非** characterization；初版 blocker 已废 |
| [UI02](./findings/UI02-controller-plan-underscope.md) | selected | F02 的 5-controller 欠拆 2 个：extension-ui-controller(~32) + self-update-controller(~12)；extension-ui 重写见 [extension-ui-analysis](./extension-ui-analysis.md) |
| [UI03](./findings/UI03-core-import-leakage-seam.md) | selected | 18 个 core 内部 import 是 seam 清单 → 抽取时收敛到 facade/窄 context，不平移 |
| [UI04](./findings/UI04-handle-event-render-god.md) | deferred | `handleEvent`(336 行) 是二级渲染 god → 先随 mount 保留，后续独立 render 层切片 |
| [UI05](./findings/UI05-session-tree-name-collision.md) | selected | UI 侧 `session-tree-controller` 与 P4 runtime 侧同名不同层 → 消歧（`tree-overlay-controller`）|
| [UI06](./findings/UI06-input-submit-pipeline.md) | selected | `setupEditorSubmitHandler`(~246 行) 提交管线独立成 `input-submit-controller`；与 slash-dispatcher 边界清晰 |
| [UI07](./findings/UI07-settings-overlay-boundary.md) | selected | `/settings` 不属于 model-overlay；作为 `settings-overlay-controller` 或留 mount 待抽，避免 model-overlay 膨胀 |
| [UI08](./findings/UI08-model-overlay-reuse-boundary.md) | selected | model-overlay 只拥有 interactive TUI 选择流程；可复用 model/thinking/API-key/default-model 规则继续归 runtime `model-controller` / `AgentSession` |

> **验收路线（关键决策）**：P5 **接受重写**（Stage B 本意），故验收用[功能特性清单](./feature-inventory.md)确认"功能正确"，**不**用 characterization 钉死实现。具体执行顺序是：P0 必测主路径 → P0 非功能约束（token neutrality / compatibility / data fallback / performance neutrality）→ touched owner 重点验收 → A-F 功能表相关行回填。P5 的默认语义是**职责切分 + 后续编码约束**，不是产品行为变化；任何行为/兼容性变化都必须按 GB-2 显式声明并被接受。代价：安全网 = 清单完整度（UI01 风险点）。开拆前置 = **把 [feature-inventory.md](./feature-inventory.md) 从 v0 校全到 v1**（漏列即无保护），而非录基线。

> **评审/验收层**：结构评审（本目录 UI 卡，"边界对不对"）· 功能验收（[feature-inventory](./feature-inventory.md)，"功能还在吗"）· 行为评审（[behavior-review-log](./behavior-review-log.md)，"功能本身对不对"，主动挖 main 老 bug）· **重写验收（[rewrite-acceptance](./rewrite-acceptance.md)，"重写更不更好"）**。最后一层用 review **检测 finding 的同一套尺子**（接口/依赖复杂度、依赖循环数、去重、分支）重写前后各量一遍 + 该刀 close 的 finding-card 作离散锚点 —— 只对"重写"刀，纯搬刀走 preserve-check。

## Top-Level Calibration

- [mode-architecture-calibration.md](./mode-architecture-calibration.md)：P5 顶层边界校准。结论：`InteractiveMode = TUI adapter + composition root`；shared logic 通过 ports/services 组合，不走 `BaseMode` 继承；每个切片实施前必须先分类。

## Non-Goals

- 不引入未声明的用户可见行为；TUI 键位/overlay 的功能语义保持，内部实现/符号/渲染细节可按 finding 显式重写。
- 不改 mode 层对外 API（除非某卡显式批准）。
- controllers 是 mode 内部协作者，不对外暴露 API。
- 行数不作 pass/fail，仅作复审触发器。

## Relationship To P5

本评审是 [P5](../execution-plan/P5-ui-split.md) 的详细决策面。P5 是执行 runbook（含 V5-1…V5-5 出口门）；本目录解释 why。门组与"低性能机器策略"沿用 [runtime-session-review/gates.md](./gates.md) 的同型规则。
