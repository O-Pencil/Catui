# SAL 实验评估方式（代码对比 / 多 worktree）

> Type: Experiment SOP  
> Status: Active  
> Scope: 会改代码任务下的 SAL A/B 评估  
> Purpose: 在同一源码基线下完成 `control(--nosal)` 与 `sal` 的可比实验，避免代码与记忆污染

## 1. 适用场景

当实验任务会改代码时，不能只靠对话结果判断 SAL 效果。

必须同时隔离：

1. 代码工作区（workspace）
2. memory 目录
3. run 标识（run-id）

推荐方案是：**同一基线提交 + 双 worktree + 双 memory 目录**。

---

## 2. 核心原则

### 2.1 Same Commit

control 与 sal 必须从同一个 `BASE_COMMIT` 启动。

### 2.2 Same Task / Same Model

两组必须使用相同任务文本、相同模型、相同关键参数（thinking、tools、扩展集）。

### 2.3 Isolated State

control 与 sal 不能共享：

1. 代码目录
2. memory 目录
3. eval run-id

### 2.4 Artifact-first

结论基于 artifacts，不基于聊天“印象”：

1. 代码 diff（patch）
2. memory 快照
3. eval 表数据（`eval_runs` / `eval_turns` / `eval_sal_anchors` / `eval_memory_recalls`）

---

## 3. 标准流程（多 worktree）

以下流程默认在主仓库根目录执行。

### Step 1: 固定基线

```bash
BASE_COMMIT=$(git rev-parse HEAD)
RUN_ID=image-flow-001
ROOT=$PWD/.memory-experiments/runs/$RUN_ID
CTRL_WS=/tmp/np-exp-$RUN_ID-control
SAL_WS=/tmp/np-exp-$RUN_ID-sal
```

### Step 2: 创建双 worktree 与目录

```bash
git worktree add --detach "$CTRL_WS" "$BASE_COMMIT"
git worktree add --detach "$SAL_WS" "$BASE_COMMIT"

mkdir -p "$ROOT/control/memory" "$ROOT/sal/memory"
mkdir -p "$ROOT/control" "$ROOT/sal" "$ROOT/compare"
```

### Step 3: 运行 control（`--nosal`）

```bash
cd "$CTRL_WS"
NANOMEM_MEMORY_DIR="$ROOT/control/memory" \
NANOPENCIL_EVAL_RUN_ID="$RUN_ID-control" \
NANOPENCIL_EVAL_VARIANT=control \
pencil --nosal "你的任务提示"
```

### Step 4: 运行 sal（默认开启 + A/B sidecar）

```bash
cd "$SAL_WS"
NANOMEM_MEMORY_DIR="$ROOT/sal/memory" \
NANOPENCIL_EVAL_RUN_ID="$RUN_ID-sal" \
NANOPENCIL_EVAL_VARIANT=sal \
NANOPENCIL_EXPERIMENT_ID="$RUN_ID" \
pencil --sal-ab "同一条任务提示"
```

### Step 5: 导出代码差异

```bash
git -C "$CTRL_WS" diff > "$ROOT/control.patch"
git -C "$SAL_WS" diff > "$ROOT/sal.patch"
```

### Step 6: 结束后清理 worktree

```bash
git worktree remove "$CTRL_WS"
git worktree remove "$SAL_WS"
```

---

## 4. 两轮任务建议

建议至少两轮：

1. Round 1（seed task）：首次修复
2. Round 2（follow-up）：同区域后续任务

Round 2 的价值是验证“第一轮经验是否被正确复用”，而不是再做一次同样任务。

---

## 5. 评估指标（最小集）

优先看这 5 项：

1. Task Anchor 命中：task anchor 是否命中实际改动模块
2. Recall 相关性：同区域 recall 是否更集中
3. Recall 噪音：结构无关 recall 是否减少
4. 注入有效性：高 `inject_rank` 的记忆是否与最终改动区域一致
5. Follow-up 效率：Round 2 是否更快进入正确文件并减少无关探索

---

## 6. 常见错误与规避

1. 只切参数不隔离代码目录  
结果：第二组吃到第一组改动，结论失真。

2. 共用 memory 目录  
结果：记忆污染，无法区分 SAL 增益。

3. control 与 sal 不同模型  
结果：模型方差盖过 SAL 信号。

4. 只看对话，不看 diff 和 eval 数据  
结果：结论不可审计、不可复现。

---

## 7. 判定建议

当以下信号至少命中一项且稳定复现，可判定 SAL 有正向价值：

1. 锚点命中率显著高于 control
2. follow-up 轮次 recall 相关性提升并伴随噪音下降
3. 同复杂度任务中，返工和无关探索减少

若未出现上述信号，应优先复查实验口径（same-commit / same-task / same-model / state isolation）再做结论。
