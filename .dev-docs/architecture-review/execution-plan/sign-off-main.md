# Sign-off — 合入 main（重构完成验收）

```yaml
phase: sign-off
status: pending
depends_on:
  stage_A: [门组A]              # P0–P1 目录级全过
  stage_B: [P2, P3, P4, P5, P6] # 功能级逐域过门组B
optional: [P7, P8]
merge_target: main
merge_policy: maintainer_sign_off_required
```

## 目标

证明重构分支相对 `main` **功能不变 + 分层清晰 + 无冗余 + 性能不劣化**，maintainer 签字后 **PR 合 main**。

> **硬约束**：在此之前 **禁止** 将 `refactor/arch-candidate-d` 合入 `main`。

## 进入条件

- [ ] **大阶段一**：P0–P1 过 [门组 A](./gates.md#门组-a--目录级出口大阶段一收尾定稿)
- [ ] **阶段间**：maintainer 功能维度评审已定稿 [门组 B](./gates.md)
- [ ] **大阶段二**：P2–P6 各域过门组 B（含 P3 的 S3 依赖反转）
- [ ] [P7](./P7-bundle-redesign.md) / [P8](./P8-sdk-narrow.md) 若跳过，须在下方 Record 显式记 `skipped`

> **P4 专项评审已结案**（[runtime-session-review](../runtime-session-review/README.md)，2026-06-02）：12 卡全部终态，结构门 RS-1/2/3 已在分支上 grep 验证。本表 S-1/S-2/S-3 的 runtime 部分由该评审 [§Closeout 重型门交接表](../runtime-session-review/README.md#closeout--p4-sign-off-handoff)供给 WHY（卡片）与 owner（Capability Ownership 表）。

## 验收清单（两分支对比）

| # | 维度 | 方法 | 通过 | 记录 |
|---|------|------|------|------|
| S-1 | **功能不变** | `main` vs `refactor/arch-candidate-d` 的 llm-wiki `symbols` diff + characterization tests | ⬜ | |
| S-2 | **分层清晰** | madge 零环 + verify-quality 全绿 + platform 不依赖业务 | ⬜ | |
| S-3 | **无冗余** | god 文件已拆；verify-quality 行数/目录规则 PASS（或白名单带 deadline）| ⬜ | |
| S-4 | **性能** | 冷启动 / dist 体积 vs [P0 Baseline](./P0-prepare.md#baseline-recordp0-填写) | ⬜ | |
| S-5 | **接缝** | S1/S2/S3 code review（`../evolution/PARP.md` §5）| ⬜ | |
| S-6 | **用户态** | `~/.pencils/agents/` 结构向后兼容 smoke | ⬜ | |

详细方法见 `../refactor-validation.md`。

## 合 main 流程

1. 在 `refactor/arch-candidate-d` 重生成 `llm-wiki/`，与 main 基线 diff
2. 填完上表 S-1 – S-6
3. maintainer 签字（下方 Sign-off Record）
4. 开 PR：`refactor/arch-candidate-d` → `main`
5. PR 通过 + merge（**仅此一次**允许重构进 main）

## Sign-off Record

```yaml
signed_by: _待填_
signed_at: _待填_
p7_status: skipped | completed
p8_status: skipped | completed
llm_wiki_diff_summary: _待填_
notes: _待填_
```

## 签字后

- [ ] 更新 `../refactor-validation.md` §2 结论列
- [ ] 更新本目录 [README.md](./README.md) §3 总进度
- [ ] 关闭 execution-plan 各 Phase status → `completed`
