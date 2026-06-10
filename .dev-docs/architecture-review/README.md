# Architecture Review Handbook

> ⚠ **Audience: a dedicated Architecture Review Agent.** Not for the self-diagnosis agent, not for users.
>
> **Purpose**: this handbook is the operations manual for a separate Claude Code agent (henceforth "the **Arch Agent**") that performs a one-time, systematic architectural review of the nanoPencil codebase. The Arch Agent runs in **a different session** from the self-diagnosis agent. Context separation is the point — daily diagnosis carries one set of priors (issue triage, fingerprint clusters), architectural review carries another (module depth, deletion tests, refactor backlogs). Mixing them would pollute both.
>
> **Source methodology**: this handbook synthesizes the mattpocock "Improve Codebase Architecture" skill (SKILL.md) with nanoPencil's own DIP protocol (P1 / P2 / P3 doctrine). The merger is documented in `methodology.md`.

---

## Why a separate handbook

The maintainer noticed in 2026-05 that nanoPencil's organic growth had outpaced its structural plan: the directory layout, packaging boundaries, and build pipeline had each accreted suboptimally over ~20 release cycles. Symptoms reported:

- Directory structure no longer maps to mental model
- Bundle size growing
- Build process is layered, fragile, and slow
- Hard to onboard onto changes that should be small

Self-diagnosis (the `daily-pencil-review` cron) catches **defects** — fingerprinted issues with explicit error signals. Architectural drift is a **non-defect** signal: nothing throws an error, the tests pass, the user sees no warning, but the *change cost per feature* has climbed. The Arch Agent's job is to surface this drift, prioritize it, and propose deepening refactors.

This is a one-shot exercise. After the maintainer has acted on the Arch Agent's findings, the codebase shape changes, and **future** architectural concerns should be folded back into self-diagnosis (with updated method) — not perpetuated as a separate program.

---

## Directory map

```
.dev-docs/architecture-review/
├── README.md                ← this file: entry point + intent
├── methodology.md           ← depth/seam/leverage/deletion-test, fused with DIP P1/P2/P3
├── inputs.md                ← what the Arch Agent reads before forming opinions
├── workflow.md              ← three phases: Explore → Report → Grilling
├── output-format.md         ← finding-card schema, refactor-plan schema
├── project-context.md       ← nanoPencil-specific anchors (key files, modules, history)
├── machine-constraints.md   ← hard limits (no build, no dev, RAM/disk guardrails)
└── handoff.md               ← boundary contract between the Arch Agent and the self-diagnosis agent
```

### Outputs map（重构已结案 · cutover 2026-06-09 · 文档分类索引）

> 重构 **P0–P6 已合 main + sign-off**（P7/P8 deferred，见 REFACTOR-LEDGER §1/§4）。本目录大部分是**历史决策记录**——日常开发只看 **✅ 活文档**即可。
> **图例**：✅ 活文档（持续维护，日常入口）· 📦 已结案专项评审（WHY 归档，改对应代码时回查）· 🗄️ 重构期操作手册（历史留存，不再维护）· 🌱 演进组（net-new，按需）

**✅ 活文档（日常入口）**
- `../feature-workflow.md` — ★ **开发前必读**：层级归属决策 + 四步循环 + 验收门（从根 `AGENTS.md` 链入）
- `REFACTOR-LEDGER.md` — ★ 收益结论 / 已发现问题(D1-D5) / 未完成项(P7/P8) / 已接受 trade-off
- `target-architecture.md` — 端态目录 + 功能域映射（结构权威，层级归属判据）
- `beta-smoke-checklist.md` — beta/发版前人工冒烟清单
- `baseline/public-api-symbols-main.txt` — P0 符号快照，**仍是 S-1 符号 diff 基准（留）**

**📦 已结案专项评审（WHY 归档 — 改对应代码前回查决策依据）**
- `runtime-session-review/` — P4 AgentSession 拆（AS01–12，closed）
- `interactive-ui-review/` — P5 InteractiveMode 拆（UI01–08，structurally-complete）
- `entry-volume-review/` — P6 入口/lazy/包表面（EV01–05，closed）
- `startup-async-review.md` — P7 启动线（MCP 异步非阻塞 + build:deps 并行/incremental，**已实现 2026-06-10**；启动默认 ~56s→1.9s）
- `bundle-redesign-review/` — P7 体积线（BR01–04，closed-as-gated；BR02-04 体积代码未执行）
- `sdk-surface-review/` — P8 SDK 收窄（SK01–03，**review-open = 未实现，deferred 到 major 窗口**）
- `findings/` F01–F08 — 微观判断（决策起点）
- `top-level-structure-review.md` — 为什么选候选 D
- `refactor-plan.md` / `refactor-validation.md` — 计划 + 验收结论
- `execution-plan/` — P0–P8 runbook + `sign-off-main.md`（签字记录）+ `sign-off-readiness.md`

**🗄️ 重构期 Arch-Agent 操作手册（历史留存，不再维护）**
- `methodology.md` · `handoff.md` · `inputs.md` · `machine-constraints.md` · `output-format.md` · `project-context.md` · `workflow.md` · `execution-plan.md`
- 这些是"如何执行那次一次性重构评审"的操作说明；重构已结案，仅作历史参考。**日常开发不看这些，看 `../feature-workflow.md`。**

**🌱 演进组（net-new，重构后按需）**
- `evolution/` — PARP / industry-protocol-survey / product-roadmap / dev-conventions

> 注：本 handbook 原定位是 one-shot 重构评审。评审思路已毕业为日常开发流程 `../feature-workflow.md`。

**Read order for the Arch Agent** (this is also `inputs.md` §1):

1. `README.md` (you are here)
2. `methodology.md` — internalize the vocabulary
3. `machine-constraints.md` — know what you cannot do
4. `handoff.md` — know what you must not touch
5. `inputs.md` — know what to read from the codebase
6. `project-context.md` — nanoPencil-specific orientation
7. `workflow.md` — the procedure
8. `output-format.md` — how to deliver

Skipping any step risks producing findings that miss the methodology, violate the boundary, or duplicate self-diagnosis's territory.

---

## Status

| Aspect | State |
|--------|-------|
| Handbook drafted | 2026-05-26 |
| Arch Agent first run | not yet — handbook ships before execution so the maintainer can review the methodology in isolation |
| Self-diagnosis cron alive in same session? | The Arch Agent runs in a **different session**; the daily diagnosis cron does not fire in the Arch Agent's session |
| Findings produced? | None yet |

---

## What this handbook is NOT

- **Not architectural findings.** No conclusions about the codebase live here. Findings go under `findings/` (a directory the Arch Agent creates the first time it runs).
- **Not a roadmap.** The roadmap is a Phase 3 output of the Arch Agent, lives at `refactor-plan.md` (created by Arch Agent).
- **Not the self-diagnosis SOP.** That lives at `.dev-docs/diagnosis/sop.md` and operates independently — see `handoff.md`.
- **Not modifiable by the self-diagnosis agent.** SOP §7 has been updated to enforce this.

---

## Provenance

- 2026-05-17: self-diagnosis Leg 1 (data audit) bootstrapped; maintainer noted architectural drift as a parallel concern but deferred.
- 2026-05-26: maintainer decided the two programs must be **parallel**, executed by **different agents**, in **different sessions**. This handbook is the first artifact for the architectural side.
- Source methodology: https://github.com/mattpocock/skills/blob/main/skills/engineering/improve-codebase-architecture/SKILL.md — depth/seam/leverage/deletion-test vocabulary.
- DIP protocol: see root `CLAUDE.md` §"DIP Dual-phase Isomorphic Documentation Protocol".
