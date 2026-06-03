# 重写验收 Rubric（rewrite-acceptance）

```yaml
doc: rewrite-acceptance
parent: ./README.md
purpose: |
  回答"凭什么说重写'更好'"。核心原则:**检测 finding 用的方法论 = 验收仪器**。
  发现问题用的尺子(接口复杂度/依赖复杂度/依赖循环数/去重/分支)→ 重写前后各量一次 →
  delta 就是"更好"的客观证据;而该重写 close 掉的 finding-card = 离散锚点。
applies_to: 所有"重写"刀(纯搬刀只走 preserve-check,不需要本 rubric)
```

> **对称性**:review 能用某套尺子**发现** finding-card,就能用**同一套尺子**度量修复。所以验收不是临时拍脑袋的指标,而是把 finding-检测方法论**前后各跑一遍**。

---

## 三段式验收

### ① 地板(强制,先过)— 行为不变
- 对外契约形状/语义不变(如 `ExtensionUIContext`)。
- behavior-review 通过(feature-inventory + A 契约 + C 内置扩展)。

> 地板不过,后面免谈。这是"功能正确",非"更好"。

### ② finding-card 解决(离散锚点)— 你 close 了什么
重写**必须指名它 close 的 finding**(F/UI/AS 卡 或 analysis 里的具名坏味)。无具名 finding 可 close 的"重写"= 没有重写理由,应退回纯搬。
- 列出 close 的卡/坏味 + 一句"为什么这个结构消除了它"。

### ③ 检测尺子 before/after(客观 delta)— 量"更好"
用 review 检测 finding 的**同一套可测尺子**,重写前后各量:

| 尺子 | 测什么 | 怎么算 | 对应 smell/lens |
|------|--------|--------|----------------|
| **依赖循环数** | 模块/仓库 SCC 环数 | `npx tsx scripts/verify-quality.ts`（F08，权威）| Circular Dependencies |
| **依赖复杂度** | god 文件总 import 数；**core 内部泄漏 import 数**(UI03);fan-out(distinct 模块) | grep import 头；UI-G7 已要求"只减不增" | Rigidity |
| **接口复杂度** | 单元 public 方法数；**窄 context 能力数**(耦合面);方法平均参数数 | grep `^  (public\|async)` + context interface 成员数 | （耦合面）|
| **去重** | 重复结构块数(逐字相同的骨架) | 人工点数(可测) | Redundancy |
| **分支** | 单方法 if/case 分支数、圈复杂度 | 点数 | "能删的分支胜过写对的分支" |
| **改动局部性** | "改某行为要动几处" | 具体场景 before/after | Fragility |

**验收判据**:
- **瞄准的尺子必须改善**(声明的那个 smell 对应的指标下降)。
- **其它尺子不得回归**(尤其依赖循环数、core 泄漏 import 数;UI-G7 守 import 只减不增)。
- **不引新 finding**:对重写后的代码**重跑检测**(lens + 脚本),不得用一个 smell 换另一个(如 Redundancy→Premature Abstraction)。

> 主观项(可读性)也走"场景化"而非"感觉":写出**具体前后对比**("改 X 以前动 3 处、现在 1 处"),即可审计。

---

## 自动化映射

| 尺子 | 工具 |
|------|------|
| 依赖循环数 | `scripts/verify-quality.ts`（已有）|
| core 泄漏 import / import 数 | grep（UI-G7 已纳入）|
| DIP 同构 | `scripts/verify-dip.ts`（已有）|
| public 方法数 / context 能力数 / 分支数 / 去重 | grep + 人工点数（可考虑后续做 `scripts/measure-complexity.ts` 把接口/依赖复杂度脚本化）|

---

## 工作示例：PromptHost（host 2/4）

**② close 的 finding**：[extension-ui-analysis §3](./extension-ui-analysis.md)（三套并行 prompt 生命周期 = Redundancy）+ UI02 的"重复 prompt lifecycle"。

**③ 尺子 before/after（实测，commit `<prompt-host>`）**：

| 尺子 | before | after(实测) |
|------|--------|------------|
| 重复 show/hide/dismiss 骨架 | **3 套逐字相同** | **0**（1 个 generic `show`）|
| 删除的 InteractiveMode prompt 方法 | **13**（show×3+hide×3+confirm+hasActive+restoreFocus+dismissActive+dismiss×3）| → PromptHost **10**（4 prompt + 3 lifecycle public + 3 private show/mount/clear）|
| prompt 状态字段 | **3**（extensionSelector/Input/Editor）| **1**（`active` 单槽）|
| 改"挂载/焦点/abort"逻辑要动 | **3 处**（每个 show 各一份骨架）| **1 处**（generic `show`）|
| 加一个 prompt 类型成本 | **~47 行 show 方法** | **~12 行 wrapper** |
| **总行数（同等行为）** | — | **mount −264 / host +215 = 净 −49**（去重使总 LOC 反降）|
| `ExtensionUIContext` 契约 | — | **不变**（select/confirm/input/editor 形状语义同）|
| 依赖循环数 / DIP | 基线 | **不回归**（verify-quality / verify-dip）|
| 新 finding | — | **无**（单槽，非泛型 overlay stack → 不引 Premature Abstraction）|

**判决**：瞄准的 Redundancy 全降（3→0 骨架、3→1 字段、改动 3→1 处），**总 LOC 反降 49 行**（同等行为），契约/环数不回归,无新坏味 → **重写成立**。

---

## 与其它评审层的关系

- [behavior-review-log](./behavior-review-log.md) = 行为对不对（地板②①）。
- 本 rubric = 重写更不更好（②finding-close + ③尺子 delta）。
- 纯搬刀**不走本 rubric**（无"更好"主张,只需 preserve-check）。
- 沿用 review 的检测方法论 → 自洽:**同一套尺子发现问题、度量修复**。
