# Beta 冒烟清单（Beta Smoke Checklist）

> 发布 `@pencil-agent/nano-pencil@beta` 前的人工功能冒烟，以及每轮 beta 的结果记录。
> 这是 sign-off S-1（功能不变）/ S-3 / EV-G6 的人工证据补充——characterization 没钉死实现，靠这里证"行为还对"。

```yaml
doc: beta-smoke-checklist
parent: ./REFACTOR-LEDGER.md
updated_at: 2026-06-05
```

---

## 0. 顺序原则

按风险排：**provider smoke（EV04 命门，唯一硬卡点）→ 四 mode 起得来 → interactive TUI 矩阵（P5 拆的 12 controller）**。
低性能机不跑；在算力机（maintainer Mac）上跑。

---

## 1. Provider smoke（必做，EV04 lazy）

EV04 的 lazy import **按 `model.api` 分**——每个 provider api 一个独立 `await import()`。所以**每个能 auth 的 provider api 各测 1 个模型**即覆盖（不是每个模型）。

```bash
node dist/cli.js --list-models                                          # 看可用模型（也是冷启动指标）
node dist/cli.js --print "Reply with exactly: ok" --model <provider/model>
```

| api | 代表 provider | 命令样例 | 判定 |
|-----|---------------|----------|------|
| openai-completions | OpenAI-compatible（小米 MiMo 等）| `--model mimo-v2.5-pro` | 出真实回复 `ok` = ✅ |
| anthropic-messages | Claude | `--model anthropic/claude-...` | 同上 |
| google-generative-ai | Gemini | `--model google/gemini-...` | 同上 |
| openai-responses / azure / codex / google-vertex / gemini-cli / bedrock | 其余 | 按 auth 情况 | 同上 |

**判定细则：**
- ✅ 过：打印真实模型回复 + exit 0 → 该 api 的 lazy import 路径正确。
- ❌ 挂：`No API provider registered for api: …` / dynamic import 报错 / 进程崩 → `register-builtins.ts` 该 api 的动态 import 写错。
- 🔎 错误路径（可选）：拿一个**没配 key** 的 provider 跑 → 应看到**干净错误消息**（`stopReason:error`），**不崩进程** → 验证 EV04 加载失败被正确转成流内错误。

> 覆盖原则：**beta 测试者会用到的 provider api 都过一遍**。一个 api 过了，它下面所有模型的 lazy 路径就都通。其余未 smoke 的 api 在 CHANGELOG known-limitations 声明 pending。

---

## 2. 四 mode 起得来

```bash
node dist/cli.js --print "say ok" --model <m>      # print：打印 + exit 0（=§1 已覆盖）
node dist/cli.js                                    # interactive：进 TUI（详见 §3）
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node dist/cli.js --rpc   # rpc：起得来不崩
node dist/cli.js --acp                              # acp：起得来不崩（Ctrl-C 退）
```

rpc/acp 是服务模式，真正消费者是 IDE/编辑器；冒烟只需"启动不报错"。

---

## 3. Interactive TUI 矩阵（P5 拆分的核心人工测试）

进 `node dist/cli.js` 后逐项点。这是补 characterization 没做的"行为还对不对"。

| 切片 | 测什么 | ✅/❌ |
|------|--------|------|
| **stream-render**（UI04，最敏感）| 发消息→流式增量；工具调用→工具卡 start/update/end；流式中 **Esc 中断**；结束 "Completed in X" | |
| **input-submit**（UI06）| `/model` 等内置 slash **不**当 prompt 发；`hello /persona use X` 先切 persona 再发 hello；`!pwd` 跑 bash；`!!cmd` 不入上下文 | |
| **interrupt**（cancellation）| Esc 各态（流式/bash/空编辑器双击→tree/fork）；Ctrl-C 单清双退；Ctrl-D 空时退；Ctrl-Z 挂起 `fg` 恢复 | |
| **model-overlay**| `/model`、`/thinking`、`/scoped-models`、Ctrl+P cycle 模型 | |
| **tree/settings/auth**| `/tree` `/fork` `/resume`、`/settings`、`/login` | |
| **压缩/重试**（stream-render overlay）| 长对话触发 auto-compaction（Esc 可取消）；网络错触发 auto-retry（Esc 可取消） | |
| **browser opt-in**（本 beta GB-2 行为变更）| 默认启动 `/browser` 显示轻量 fallback；`--extension extensions/builtin/browser` 启动后完整 browser 工具可用 | |

**任一项与 1.x 行为不一致 = 回归** → 记入 REFACTOR-LEDGER §3，作为 beta 产出。

---

## 4. 轮次记录

### 2.0.0-beta.0 — 2026-06-05（refactor/arch-candidate-d @ 5ad87db）

| 项 | 结果 |
|----|------|
| 冷启动 `--list-models` | ✅ main 4.136s → HEAD 1.028s（mean −75% / min −82%）|
| provider smoke: openai-completions（MiMo）| ✅ 真流式 `ok` |
| provider smoke: anthropic / google / 其余 | ⬜ 未逐一（CHANGELOG 已标 pending）|
| 四 mode 起得来 | ⬜ 待补（print ✅；interactive/rpc/acp 待勾）|
| TUI 矩阵 §3 | ⬜ 待补 |
| 已知非回归噪声 | MCP `fetch`/`sqlite`/`git` 404 = 本地 MCP 配置指向未发布包，**与重构无关**；print smoke 仍成功 |

**发布判定**：硬卡点（EV04 lazy 真流式）已解除 + 冷启动强收益 → 以 `npm publish --tag beta` 发布（opt-in，notes 已声明 parity/matrix pending）。interactive TUI 矩阵建议发后随测试反馈回填。

---

## 5. 发布步骤（maintainer 手动）

```bash
npm run build                          # 必须：dist 反映新版本号
npm publish --tag beta --dry-run       # 看 files/version/tag
npm publish --tag beta                 # scoped 包已存在，不需 --access
npm view @pencil-agent/nano-pencil dist-tags   # 确认 latest 不变、beta=2.0.0-beta.0
```

不违反"签字前不合 main"：publish 是发 tarball，与 git merge 无关。
