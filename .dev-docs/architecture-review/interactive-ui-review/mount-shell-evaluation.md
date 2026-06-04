# mount 退壳 评估（#8，UI04 后）

```yaml
doc: mount-shell-evaluation
phase: P5
finding: #8（interactive-mode.ts → mount，post-UI04 目标 <500 行）
status: review
source: modes/interactive/interactive-mode.ts（UI04 后 4510 行 / ~100 方法）
decision: SELECTED C（宣告 P5 结构完成；#8 目标修正为组合根+port 面地板 ~1500-1700；resources/slash → interactive 域内可选清理，非 phase P6=入口体积）— 2026-06-04
```

## 0. 前提

UI04（stream-render-controller）落地后，render god 已出 mount。本评估摸底 mount 还剩什么、`<500` 是否可达、以及退壳应推进到哪。结构评估，不写代码。

## 1. 现状：4510 行按关切分桶（精确行数）

| 关切 | 行数 | 方法数 | 性质 |
|------|------|--------|------|
| **composition-root**（constructor/init/run/stop/getters/setup\*/subscribe/createExtensionUIContext/remount/getUserInput/prewarm/handleEvent…）| **1282** | 20 | 组合根，**必留**；constructor 单体 ~513（12 controller + editor + UI 接线）|
| **thin UI port-primitives**（showStatus/Error/Warning、clearEditor、updateEditorBorderColor、showSelector、promptAfterRender、isExtensionCommand、shutdown/suspend/checkShutdown、toggle\*、showExtension\*…）| **358** | 24 | controllers 经 port 回调的 mount 能力面，**多数必留** |
| slash command handlers（export/share/copy/status/usage/name/session/changelog/hotkeys/clear/renderDebug/mcp/language/agentLoop + key 显示 helper）| **981** | 20 | **可抽**：扁平、低耦合命令体；slash-dispatcher 已分派、体留 mount |
| resources/diagnostics display（formatDisplayPath/getShortPath/scopeGroups/findMetadata/formatDiagnostics/showLoadedResources…）| **481** | 12 | **可抽**：纯格式化，零耦合，最干净 |
| render session context（renderSessionContext/renderInitialMessages/rebuildChatFromMessages/addMessageToChat/banner）| **398** | 5 | 半可抽：与 chatContainer/组件强耦合 |
| compaction/queue（handleCompact/executeCompaction/flushCompactionQueue/queue\*/restoreQueued/clearAllQueues/updatePending）| **257** | 8 | 半可抽：与 state queue + AgentSession 耦合 |
| persona/soul/memory（applyPersonaFromSessionIfAny/handlePersona/Soul/Memory）| **176** | 4 | 可抽：命令体 |
| bash（handleBashCommand/flushPendingBashComponents）| **122** | 2 | 可抽：gates 早列 bash owner |
| working-status/buddy/timers（updateWorkingMessage/start/stopTimer/setBuddyPetState/syncBuddyPet…）| **113** | 9 | 半可抽：被 streamRender port 回调 |
| external editor（openExternal/openExistingFileInExternal）| **76** | 2 | 可抽 |
| 其它（setExpanded 等）| 109 | 1 | — |

## 2. 本质层：`<500` 不可达，且这是个**信号失真**

- 即便把所有"可抽/半可抽"全部抽走（resources 481 + slash 981 + render-context 398 + compaction 257 + persona 176 + bash 122 + working 113 + external 76 ≈ **2624 行**，约 7-8 刀），剩下的 **composition-root 1282 + port-primitives 358 ≈ 1640 行**仍 **>500**。
- `<500` 当初是"god-file 是否解耦"的**代理指标**。但 mount 作为 ~12 个 controller 的**组合根 + port 能力面**，地板就在 ~1500-1700。继续逼近 500 只能靠把组合根/port 面也拆散，那会制造新的间接层与 service-locator，违背 calibration。

## 3. 哲学层：真正的赢已经拿到

P5 的架构目标是**消除 god-file 的危险耦合**，让其可分解、可单测。这些**已全部完成**：

- render loop（UI04）、submit pipeline（UI06）、overlay swap（interrupt/stream-render escape seam）、model/auth/tree/settings/slash dispatch、extension-ui、image、self-update、state 合一——**危险耦合全部出 mount**。

残留 ~2600 行是**扁平、低耦合**的命令体 + 纯格式化 + 半 UI helper。它们不是 god（无分支爆炸、无跨 concern 牵连），是"长"不是"乱"。把 18 个独立 slash handler 机械搬进 controller 文件，**降耦合收益≈0，回归风险>0**——典型的指标驱动 busywork。

## 4. 待决：退壳 ambition（请 maintainer 选）

| 选项 | 做什么 | mount 行数 | 评估 |
|------|--------|-----------|------|
| **C 宣告 P5 结构完成（建议）** | 不再机械搬扁平 handler；把 #8 目标从 `<500` 修正为诚实的"composition-root + port 面"地板（~1500-1700）；resources-display / slash-handlers 标为 **interactive 域内 post-P5 可选清理**（注意：**不是** 正式 phase P6——P6 是入口体积 lazy 化，另一条线）；P5 结构封口后正式主线接 **phase P6（入口体积）** | ~4510（不变）| 解耦目标已达；停在收益递减点；最低风险 |
| **B 定向抽 2 个最干净大簇** | 抽 resources/diagnostics display（481，零耦合）+ slash-command-handlers（981，扁平）→ 各成 helper/controller；其余留组合根 | ~3050 | 2-3 刀，可观瘦身且风险低（纯格式化 + 独立 handler）；完成 slash-dispatcher"分派/体分离"的意图 |
| **A 逼近低地板** | 再抽 resources + slash + render-context + compaction + persona + bash + working（~2624，7-8 刀）| ~1700 | 工作量最大；多为低耦合搬运，回归面广，架构边际价值低 |

## 5. 若选 B/A 的抽取顺序与边界

1. **resources-display**（最先，零风险）：纯格式化 + showLoadedResources/handleShowResourcesCommand → `resources-display-controller`（或 util 模块）。无状态、无 AgentSession 耦合。
2. **slash-command-handlers**：按子簇分（export/share/copy 一组；status/usage 一组；session/name/changelog 一组；mcp/language/agentLoop 一组；hotkeys/key-display 一组）→ 经各自窄 port 回 mount 能力。slash-dispatcher 已分派，只搬体。
3. （A 续）compaction/queue → `compaction-controller`；bash → `bash-controller`（gates 早列）；persona/soul/memory → `persona-controller`；working-status → 并入 presence 或 streamRender loaders。

每刀仍走 capability-context + preserve-check（纯搬）+ verify-quality/dip。

## 6. 验收

- 选 C：更新 refactor-plan #8 行与目标；P5 切片清单封口；列 P6 可选清理；准备 S-1..S-6。
- 选 B/A：按 §5 顺序逐刀，沿用既有门组。

## 7. 下一步

~~maintainer 在 §4 选 ambition~~ → **已选 C**。

## 8. Resolution（C，2026-06-04）

**P5 interactive god 拆 = 结构完成。** #8 退壳不再机械搬扁平 handler。

- **目标修正**：`<500` 作废（不可达且失真）；mount 终态 = 组合根 + ~12 controller 的 port 能力面，地板 ~1500-1700。当前 4510 行不阻塞 sign-off——S-3"无冗余"的判据是**god 文件已拆 + verify-quality 行数/目录规则 PASS（或白名单带 deadline）**，而非单文件 <500。
- **解耦已达**：render loop / submit / overlay escape seam / model / auth / tree / settings / slash dispatch / extension-ui / image / self-update / state 合一 + interrupt + stream-render——危险耦合全部出 mount，mount 不再含跨 concern 牵连的 god 逻辑。
- **interactive 域内 post-P5 可选清理**（非阻塞，收益递减；**与正式 phase P6=入口体积 无关**）：
  1. `resources-display`（481，零耦合纯格式化）→ controller/util。
  2. `slash-command-handlers`（981，扁平独立体）→ 按子簇 controller，完成 slash-dispatcher 分派/体分离。
  3. （更次）compaction/queue、bash、persona、working-status、external-editor。
  - 触发条件：任一簇再被改动、或第二 mode 复用、或 verify-quality 行数白名单到期。

**正式主线（Stage B 剩余）**：P5 结构封口 → **phase P6（入口体积：lazy 入口 / browser→optional / ai lazy provider，见 [execution-plan/P6-entry-volume.md](../../execution-plan/P6-entry-volume.md) + [entry-volume-review](../../entry-volume-review/README.md)，依赖 P5，现已解锁）** → （可选 P7/P8）→ 全 phase landed 后才进 [sign-off-main.md](../../execution-plan/sign-off-main.md) S-1..S-6（跨分支 llm-wiki 重生成 + characterization + 性能基线 + maintainer 签字，有算力机器执行）。P5 侧已为 S-2（verify-quality 零环全绿）、S-3（god 已拆）就绪。
