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

### Outputs map（产物分两组 · 2026-05-29）

评审产物分为**重构组**（behavior-preserving，目标"功能不变"）与**演进组**（net-new，重构后按需 gate）：

```
architecture-review/
│  ── 重构组 ──
├── REFACTOR-LEDGER.md              ★ 活文档总清单：设计/已解决/已发现/未解决（持续更新，sign-off 已知问题索引）
├── beta-smoke-checklist.md         beta 发布前人工冒烟清单 + 每轮 beta 结果记录（S-1/EV-G6 人工证据）
├── top-level-structure-review.md   决策依据（为什么候选 D）
├── target-architecture.md          架构改造结论（端态目录 + 功能域映射）
├── refactor-plan.md                架构改造计划（批次 + 单一 ADR 状态表 + S1/S2/S3 接缝验收）
├── execution-plan/                 可执行 runbook（README + P0–P8 分 Phase + sign-off）
│   ├── README.md                   分支策略 + Phase 索引 + 总进度
│   ├── P0-prepare.md … P8-sdk-narrow.md
│   └── sign-off-main.md            两分支对比 + 合 main 签字
├── execution-plan.md               → 指向 execution-plan/ 的入口
├── refactor-validation.md          重构验收（功能不变，溯源 llm-wiki；重构后填充）
├── findings/F01–F08                微观判断
├── runtime-session-review/         F01 子评审：AgentSession 等核心复杂拆分的专项评审模板
├── interactive-ui-review/          F02/P5 子评审：InteractiveMode UI 拆分边界、验收与执行顺序
├── entry-volume-review/            F06/F07/P6 子评审：入口形态、可选能力、provider lazy、包表面
│
└── evolution/                      ── 演进组 ──
    ├── PARP.md                      PARP 协议定义（原 target-arch §3.5 迁入）
    ├── industry-protocol-survey.md  协议对位证据
    ├── product-roadmap.md           产品演进规划
    └── dev-conventions.md           重构后未来开发约规
```

> 注：本 handbook 原定位是 one-shot 重构评审（见 §"What this handbook is NOT"）。演进组（PARP/路线/约规）是 grilling 期间衍生的产品方向，独立成册以免污染重构组的"功能不变"验收。

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
