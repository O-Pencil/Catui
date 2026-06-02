# P4 Sign-off Checklist — runtime god 拆出口门（单文件 · 换机即跑）

```yaml
phase: P4
purpose: 在能跑 npm 的机器上一把验完 P4 出口门；逐条勾选 + 粘贴证据
branch: refactor/arch-candidate-d
status_source: ../runtime-session-review/README.md#closeout--p4-sign-off-handoff
```

> **范围声明**：本表只验 **P4(runtime god 拆)这一个 phase 的出口门**。
> **不在这里跑 `wiki:all`** —— llm-wiki 是**全仓库合 main 的一次性证据**，见末尾 §3 与
> [refactor-validation.md §5](../refactor-validation.md)。P5–P8 还会改代码，现在跑 wiki 立即作废。

---

## 0. 前置（已在分支上完成，无需重跑）

结构门 RS-1/RS-2/RS-3 已用 grep 在分支上客观验证（[Closeout 证据表](../runtime-session-review/README.md#closeout--p4-sign-off-handoff)）：

- [x] RS-1 无控制器 `import` `agent-session.ts`（0 命中）
- [x] RS-2 4 个窄 `*ControllerContext`；`session-context.ts` 不反依赖组合根
- [x] RS-3 `agent-session.ts` 持 0 个 abort slot（3 slot 各归 compaction/tree 控制器）

> 想自查可复跑：
> ```bash
> cd core/runtime
> grep -nE '^\s*import.*agent-session' *-controller.ts bash-runner.ts prompt-assembly.ts export-bridge.ts event-bridge.ts   # 期望: 无输出
> grep -c 'ControllerContext' session-context.ts                                                                          # 期望: 4
> ```

---

## 1. P4 出口重型门（capable machine · 逐条勾选）

全部在 `refactor/arch-candidate-d` 分支根目录执行。先确保依赖与内部库 dist 就绪：

```bash
npm install
npm run build:deps      # 关键：core/lib/{ai,agent-core,tui} 先出 dist，否则 tsc 报 Cannot find module '@pencil-agent/*'
```

| # | 门 | 命令 | 通过标准 | 状态 | 证据 |
|---|----|------|---------|------|------|
| C1 | 编译 | `npx tsc --noEmit` | 无输出（exit 0） | ⬜ | |
| C2 | 构建 | `npm run build` | 成功（含 ai 包自身 tsconfig.build.json）| ⬜ | |
| C3 | 符号不变（V4-2）| 见下方 **§2** | diff 为空，或仅"已声明的有意变更" | ⬜ | |
| C4 | 行为基线（V4-3）| `npx vitest run tests/characterization` | 全过（cassette/golden 零回归）| ⬜ | |
| C5 | 无新环（V4-6）| `npx tsx scripts/verify-quality.ts` | exit 0（或白名单带 deadline）| ⬜ | |
| C6 | DIP 同构（RS-6）| `npx tsx scripts/verify-dip.ts` | exit 0（含 `core/runtime/CLAUDE.md` Capability Ownership 表与成员表一致）| ⬜ | |

> 注：`npm test` 脚本本仓库不存在；characterization 用 `vitest run tests/characterization` 直跑。

---

## 2. C3 符号 diff 操作（wiki 无关）

P0 已冻结 `main` 的公共符号快照（296 个导出）。在分支上重产并比对：

```bash
# 1) 在重构分支产出当前符号表
npx tsx scripts/collect-baseline.ts          # 写 .baseline-out/public-api-symbols.txt

# 2) 与 P0 main 基线 diff
diff .dev-docs/architecture-review/baseline/public-api-symbols-main.txt \
     .baseline-out/public-api-symbols.txt
```

- **期望**：无差异（god 拆是内部重构，公共面应不变 → 功能不变硬指标）。
- 若有差异：必须每一行对应一个**已在 review 卡/Phase 文档声明的有意变更**（GB-2）；否则视为回归，C3 不通过。
- 这一步**不需要 llm-wiki** —— 是独立纯文本快照，专为 per-phase 出口设计。

---

## 3. 不在本表内：合 main 才跑的一次性证据

以下属 [sign-off-main.md](./sign-off-main.md)，**所有 phase（P2–P8）landed 之后跑一次**，不要在 P4 跑：

- `npm run wiki:all` → 重生成 llm-wiki，与 main 基线 diff（S-1 富证据 / 结构版功能清单刷新）
- 冷启动时间 / dist 体积 vs P0 Baseline（S-4 性能）
- `~/.pencils/agents/` 向后兼容 smoke（S-6 用户态）

> **为什么 wiki 不放 per-phase**：它是全图扫描产物，P5(UI 拆)/P6/P7/P8 任一改代码即作废。
> per-phase 的"功能不变"由 §2 纯符号 diff + §1 characterization 担保，已足够且便宜。

---

## 4. 通过后

- [ ] C1–C6 全绿 → 在 [P4-runtime-split.md](./P4-runtime-split.md) V4 表把 V4-2/3/6 标 ✅
- [ ] 回填本表"证据"列（粘贴关键输出）
- [ ] P4 status `structure_landed → completed`
- [ ] 继续 P5（UI 拆，串行于 P4 之后）

---

## 关联

- WHY（每个边界为何这么拆）：[runtime-session-review/findings/AS*.md §Resolution](../runtime-session-review/)
- WHO-OWNS-WHAT：[core/runtime/CLAUDE.md §Capability Ownership](../../../core/runtime/CLAUDE.md)
- 出口门定义：[gates.md 门组 B](./gates.md)、[P4 runbook V4 表](./P4-runtime-split.md#验证门控dod)
- 合 main 终验：[sign-off-main.md](./sign-off-main.md)、[refactor-validation.md](../refactor-validation.md)
