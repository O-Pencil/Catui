# Interactive UI Gates

```yaml
gate_set: interactive-ui
inherits:
  - ../execution-plan/gates.md#门组-b
  - ../runtime-session-review/gates.md   # 同型，沿用 RS 精神
applies_to:
  - modes/interactive/interactive-mode.ts
  - modes/interactive/controllers/*.ts
  - modes/interactive/state/*.ts
  - modes/_shell/*.ts
```

## Hard Gates

| Gate | Rule | Validation |
|------|------|------------|
| UI-G0 Mode architecture calibration | 每个切片必须先按 [mode-architecture-calibration.md](./mode-architecture-calibration.md) 归类为 shared capability / interactive controller / interactive surface host / composition wiring / render layer；不得用 `BaseMode` 继承替代 ports/services 组合 | review doc / PR description |
| UI-G1 No reverse mount import | controllers/state 不得 import `./interactive-mode.ts`（mount 是组合根，单向）| `rg 'from "\.\./interactive-mode\|from "\./interactive-mode' modes/interactive/controllers modes/interactive/state` 必须为空 |
| UI-G2 No service-locator context | controller context 暴露**命名能力**（闭包），不得整体接收 `InteractiveMode` 或 `AgentSession` | code review |
| UI-G3 Single owner | 每个 UI 副作用/overlay（attachments、extension widget、model overlay、auth 流…）只有一个 owning controller | finding 卡 + code review |
| UI-G4 功能正确（命门，接受重写）| [feature-inventory.md](./feature-inventory.md) 的 **P0 必测主路径 + touched owner 重点验收 + A-F 相关行**通过；有意符号/行为变更显式声明(GB-2)，**不**要求字节级/符号 diff 为空 | 功能清单回填（UI01；非 characterization）|
| UI-G5 No fake extraction | 新 controller 必须**持自己那片状态或藏真复杂度**；纯转发占位不算完成 | deletion test |
| UI-G6 DIP isomorphism | 新 UI 文件有 P3 头，并登记进 `modes/AGENT.md` / `modes/CLAUDE.md`（及 `modes/interactive` 子目录索引）| P2/P3 review |
| UI-G7 No deepened core leakage | 抽 controller 时对 core 内部的直接 import 必须**优先收敛到该 controller 的窄 context**（仅会话生命周期能力才走 AgentSession facade，UI03）；禁止平移泄漏 import，且**不得借收敛之名给 AgentSession facade 加肥**（`agent-session.ts` 公共面不应因 UI 重构显著变大）| import diff + grep + AgentSession 公共符号 diff |
| UI-G8 Token neutrality | P5 只拆 UI 职责，不得新增默认 prompt/context/system message/tool result 内容；不得改变提交给 AgentSession/Agent 的 user message、attachments、follow-up、compaction 指令语义；用户实际 token 消耗不得因 UI controller 拆分增加 | input-submit/model/render diff review；功能验收关注发送内容与附件数量 |
| UI-G9 Compatibility preservation | 保持既有 TUI 入口、slash/keybinding 可达性、extension UI API 语义、public exports 与配置文件格式；任何兼容性破坏必须作为 GB-2 有意变更记录并经 maintainer 接受 | feature-inventory + extension-ui owner 验收 + public API diff |
| UI-G10 Data fallback preservation | 配置、会话、provider auth、settings、extension surface 状态的缺省值/缺失文件/取消路径/读取失败兜底不得弱化；拆分后不能把原有 fallback 变成 throw、空写、半写或静默丢状态 | provider/settings/session paths review + cancel/error-path manual check |
| UI-G11 Performance neutrality | P5 是结构重构，不做性能优化；不得因 controller 拆分导致明显冷启动、首屏、overlay 打开、输入提交、streaming render 变慢；新 controller 应保持可 lazy-load 形态，为 P6 铺路 | 轻量 import/constructor review；有条件机器再做 cold-start/build/smoke |

## Single-Owner Table（草案，随卡定稿）

| Concern | Owner | Non-owner rule |
|---------|-------|----------------|
| `/command` 路由 + 各 handle*Command | `slash-dispatcher` | mount 只委托 |
| model/thinking/provider overlay | `model-overlay-controller` | mount 只委托；provider credential/config 不归 model-overlay |
| reusable model capability | `core/runtime/model-controller` + `AgentSession` facade | `model-overlay-controller` 只能编排 interactive TUI 选择流程；任何有第二 mode/runtime consumer 的 model/thinking/API-key/default-model 规则不得下沉到 model-overlay（UI08） |
| API key / OAuth / provider 配置 | `auth-controller` / `provider-config-controller` | provider 凭据、base URL、custom model config 不散落到 model overlay |
| settings selector (`/settings`) | `settings-overlay-controller`（UI07）或暂留 mount | 不归 model-overlay；不得把 theme/image/buddy/presence/editor settings 混进 model owner |
| fork/switch/tree 选择器（UI 侧）| `tree-overlay-controller`（UI05 改名）| 与 P4 runtime `session-tree-controller` 不同层 |
| 剪贴板/附件/图像管线 | `image-pipeline-controller` | 附件状态归此 |
| 扩展 prompt/overlay/widget surfaces | `extension-ui-controller`（UI02 新增）| mount 不直接 set/clear extension widget；persistent surfaces 不进 overlay stack |
| 自更新/版本检查/重装 | `self-update-controller`（UI02 新增）| P5 先 interactive 内拆；非 `core/platform` owner |
| Ctrl-C/D/Z + shutdown 信号 | `_shell/cancellation`（跨 mode）| mount 只接线 |
| 输入提交分派（`onSubmit`）| `input-submit-controller`（UI06）| 总分派归此；slash-dispatcher 只执行内置命令，不吞管线 |
| ~80 响应式状态字段 | `state/interactive-state` | 散落的 `this._` 收敛 |
| 流式渲染事件路由（`handleEvent`）| 暂留 mount（UI04 deferred）| 不强行抽空壳 |
| **esc 键分派**（`onEscape`，单键多目标）| **mount 接线**，分支委托各 owner | abort→cancellation；空闲双击→tree-overlay(选择器)；queue 恢复→queue；mount 只判状态转发，不拥有动作 |

## Review Questions

每个切片回答：

1. 哪些 UI 状态/overlay 句柄移动了？
2. 这个切片属于 shared capability / interactive controller / surface host / composition wiring / render layer 哪一类？
3. 哪些 `InteractiveMode` 公共方法仍作 mount 门面保留？
4. 哪段代码变得可不 boot 整个 7960 行就单测？
5. `interactive-mode.ts` 少了哪些 import？是否减少了对 core 内部的泄漏（UI-G7）？
6. 新引入哪些 import，是否服从 GB-1 / UI-G7？
7. 行为是否仍经同一公共路径 + 同一键序 可达，且 V5-1 功能验收通过？
8. 是否新增或改变了发送给模型的文本、附件、context、tool result 或 compaction 指令（UI-G8）？
9. 是否改变 public API、extension UI API、配置文件格式、slash/keybinding 可达性（UI-G9）？
10. 缺省值、读取失败、取消、半写入、老数据迁移等 fallback 是否仍在原 owner 内可读且可测试（UI-G10）？
11. controller 构造是否引入 eager heavy work；是否保持 P6 可 lazy-load 的形态（UI-G11）？
12. 对 model-overlay：该方法是否有第二 mode/runtime consumer？若有，是否仍归 runtime/shared helper，只由 model-overlay 经 port 编排（UI08）？

## Low-Performance Machine Policy

同 [runtime-session-review](../runtime-session-review/gates.md#low-performance-machine-policy)：

允许：`git diff --check`、`rg`/`sed`/`git diff`、`npx tsx scripts/verify-quality.ts`。

需 maintainer 批准机器算力：`npm install`、`npm run build`、完整 vitest、CLI smoke。
