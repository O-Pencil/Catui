# Sign-off — 合入 main（重构完成验收）

```yaml
phase: sign-off
status: pending
depends_on: [P1, P2, P3, P4, P5, P6]
optional: [P7, P8]
merge_target: main
merge_policy: maintainer_sign_off_required
```

## 目标

证明重构分支相对 `main` **功能不变 + 分层清晰 + 无冗余 + 性能不劣化**，maintainer 签字后 **PR 合 main**。

> **硬约束**：在此之前 **禁止** 将 `refactor/arch-candidate-d` 合入 `main`。

## 进入条件

- [ ] [P1](./P1-skeleton-move.md) – [P6](./P6-entry-volume.md) 各自 DoD 全过
- [ ] [P3](./P3-extension-sdk.md) DoD 全过（可与 P2 并行完成）
- [ ] [P7](./P7-bundle-redesign.md) / [P8](./P8-sdk-narrow.md) 若跳过，须在下方 Record 显式记 `skipped`

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
