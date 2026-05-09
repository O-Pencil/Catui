#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# token-investigation.sh — 分层排查 HTTP 调用次数异常脚本
# ═══════════════════════════════════════════════════════════════════════════════
#
# 排查思路（三层漏斗）:
#   Layer 1: 版本锚点对比 → 确认哪个版本范围引入问题
#   Layer 2: Commit 二分  → 锁定具体引入调用暴增的 commit
#   Layer 3: 配置项隔离  → 在当前版本逐项禁用功能，定位具体模块
#
# 用法:
#   ./scripts/token-investigation.sh [phase]
#
# phase:
#   anchor1    — 在 v1.13.10 上跑基准任务
#   anchor2    — 在 286bbc7 (1.13.14) 上跑同一任务
#   compare    — 查询 InsForge 对比两次结果
#   bisect     — 在指定 commit 上跑任务（需传 BISECT_REF）
#   isolate    — 在当前版本上，逐项禁用功能，对比 HTTP 调用次数
#   trace      — 开启 NANOPENCIL_TRACE_API 跑一次，输出每次调用的调用栈
#
# 前置条件:
#   1. 本地已登录 minimax-coding（nanopencil 已配置 API key）
#   2. InsForge eval 凭据已就绪（脚本内置）
#   3. 当前在 nanoPencil 项目根目录
#
# 环境变量:
#   BISECT_REF          — bisect 阶段使用的 git ref（可选）
#   NANOPENCIL_MODEL    — 指定模型 ID（默认 MiniMax-M2.5）
#   NANOPENCIL_PROVIDER — 指定 provider（默认 minimax-coding）
#   DRY_RUN             — 设为 1 则只打印命令不执行
#
# 注意: 本地已登录 minimax-coding 的 API key，无需额外指定
#
# minimax 按 HTTP 调用次数计费。一个简单任务正常预期 2-3 次调用，
# 实际观测到 40+ 次。本脚本帮助定位多出来的调用源自哪个模块。
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── 配置 ───────────────────────────────────────────────────────────────────
INSFORGE_ENDPOINT="https://intiscu5.us-east.insforge.app"
INSFORGE_API_KEY="ik_5e6a4721a3c87d0190f7e16bcfacde99"

ANCHOR1_REF="v1.13.10"
ANCHOR2_REF="286bbc7"  # 1.13.14

# 基准任务：最小确定性任务，触发一次工具调用 + 一次 LLM
BENCHMARK_PROMPT="读 README.md 然后告诉我这个项目是做什么的"

# 默认模型: minimax-coding / MiniMax-M2.5
MODEL="${NANOPENCIL_MODEL:-MiniMax-M2.5}"
PROVIDER="${NANOPENCIL_PROVIDER:-minimax-coding}"

# 项目根目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── 工具函数 ────────────────────────────────────────────────────────────────

log() { echo -e "\033[1;36m[token-inv]\033[0m $*"; }
warn() { echo -e "\033[1;33m[token-inv]\033[0m $*" >&2; }
err() { echo -e "\033[1;31m[token-inv]\033[0m $*" >&2; exit 1; }

check_prerequisites() {
    if ! command -v node &>/dev/null; then
        err "需要 Node.js >= 20"
    fi

    if ! [ -f "$PROJECT_ROOT/package.json" ]; then
        err "请在 nanoPencil 项目根目录运行此脚本"
    fi
}

# 生成唯一 run_id
make_run_id() {
    local ref="$1"
    local short_hash
    short_hash=$(git rev-parse --short "$ref" 2>/dev/null || echo "$ref")
    echo "token-inv-${short_hash}-$(date +%s)"
}

# 切换版本并构建
checkout_and_build() {
    local ref="$1"
    log "切换到 $ref ..."
    git checkout "$ref" --quiet

    log "安装依赖 ..."
    npm install --silent 2>/dev/null || npm install

    log "构建 ..."
    npm run build 2>/dev/null || {
        warn "构建失败，尝试仅编译 tsc ..."
        npx tsc -p tsconfig.build.json --noEmit false 2>/dev/null || true
    }
}

# 创建临时 agent 目录（干净的 models.json + auth.json，避免跨版本 schema 兼容问题）
setup_temp_agent_dir() {
    local dir="$1"
    local original_agent_dir="${HOME}/.nanopencil/agent"

    # 写入最小化 models.json（只有 minimax-coding，无额外字段）
    cat > "$dir/models.json" <<'MODELS_EOF'
{
  "providers": {
    "minimax-coding": {
      "baseUrl": "https://api.minimaxi.com/v1",
      "api": "openai-completions",
      "models": [
        {
          "id": "MiniMax-M2.5",
          "name": "MiniMax M2.5",
          "input": ["text"],
          "contextWindow": 204800,
          "maxTokens": 65536
        }
      ]
    }
  }
}
MODELS_EOF

    # 复制 auth.json（包含已登录的 API key）
    if [ -f "$original_agent_dir/auth.json" ]; then
        cp "$original_agent_dir/auth.json" "$dir/auth.json"
    fi

    # 写入最小 settings.json（不设 enabledModels 过滤）
    echo '{}' > "$dir/settings.json"
}

# 跑基准任务（print mode + SAL eval 上报）
run_benchmark() {
    local ref="$1"
    local run_id="$2"

    local commit_hash
    commit_hash=$(git rev-parse HEAD)
    local version
    version=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "unknown")

    log "═══ 运行基准任务 ═══"
    log "  版本:    $version"
    log "  Commit:  $commit_hash"
    log "  Run ID:  $run_id"
    log "  Provider: $PROVIDER"
    log "  模型:    $MODEL"
    log "  任务:    $BENCHMARK_PROMPT"
    log ""

    # 创建临时 agent 目录，避免 models.json schema 兼容性问题
    local tmp_agent_dir
    tmp_agent_dir=$(mktemp -d)
    setup_temp_agent_dir "$tmp_agent_dir"
    log "  临时 agent 目录: $tmp_agent_dir"

    if [ "${DRY_RUN:-}" = "1" ]; then
        log "[DRY_RUN] 将执行:"
        log "  NANOPENCIL_CODING_AGENT_DIR=$tmp_agent_dir \\"
        log "  NANOPENCIL_EVAL_ENABLED=1 \\"
        log "  NANOPENCIL_EVAL_ENDPOINT=$INSFORGE_ENDPOINT \\"
        log "  NANOPENCIL_EVAL_API_KEY=$INSFORGE_API_KEY \\"
        log "  NANOPENCIL_EVAL_RUN_ID=$run_id \\"
        log "  NANOPENCIL_EVAL_COMMIT=$commit_hash \\"
        log "  NANOPENCIL_EVAL_BRANCH=token-investigation \\"
        log "  node dist/cli.js --print --provider $PROVIDER --model $MODEL --no-session \"$BENCHMARK_PROMPT\""
        rm -rf "$tmp_agent_dir"
        return 0
    fi

    # 使用 print mode 非交互执行，SAL eval 自动上报到 InsForge
    # NANOPENCIL_CODING_AGENT_DIR 指向临时目录，绕过 models.json schema 兼容性问题
    NANOPENCIL_CODING_AGENT_DIR="$tmp_agent_dir" \
    NANOPENCIL_EVAL_ENABLED=1 \
    NANOPENCIL_EVAL_ENDPOINT="$INSFORGE_ENDPOINT" \
    NANOPENCIL_EVAL_API_KEY="$INSFORGE_API_KEY" \
    NANOPENCIL_EVAL_RUN_ID="$run_id" \
    NANOPENCIL_EVAL_COMMIT="$commit_hash" \
    NANOPENCIL_EVAL_BRANCH="token-investigation" \
    node dist/cli.js --print --provider "$PROVIDER" --model "$MODEL" --no-session "$BENCHMARK_PROMPT" \
        2>"$PROJECT_ROOT/scripts/.token-inv-${run_id}.stderr" || {
        warn "任务执行可能有错误，查看: scripts/.token-inv-${run_id}.stderr"
    }

    # 清理临时目录
    rm -rf "$tmp_agent_dir"

    log "✓ 任务完成，数据已上报 InsForge (run_id: $run_id)"
}

# 查询 InsForge 获取 run 数据
query_run() {
    local run_id="$1"
    curl -s \
        -H "Authorization: Bearer $INSFORGE_API_KEY" \
        -H "Content-Type: application/json" \
        "${INSFORGE_ENDPOINT}/api/database/records/eval_runs?run_id=eq.${run_id}&select=*"
}

query_turns() {
    local run_id="$1"
    curl -s \
        -H "Authorization: Bearer $INSFORGE_API_KEY" \
        -H "Content-Type: application/json" \
        "${INSFORGE_ENDPOINT}/api/database/records/eval_turns?run_id=eq.${run_id}&select=*&order=turn_id.asc"
}

query_tool_traces() {
    local run_id="$1"
    curl -s \
        -H "Authorization: Bearer $INSFORGE_API_KEY" \
        -H "Content-Type: application/json" \
        "${INSFORGE_ENDPOINT}/api/database/records/eval_tool_traces?run_id=eq.${run_id}&select=*&order=turn_id.asc"
}

# ─── Phase 实现 ──────────────────────────────────────────────────────────────

phase_anchor1() {
    log "═══ Phase: Anchor 1 (v1.13.10 基准) ═══"
    check_prerequisites

    local run_id
    run_id=$(make_run_id "$ANCHOR1_REF")

    # 保存当前位置
    local original_ref
    original_ref=$(git rev-parse HEAD)

    checkout_and_build "$ANCHOR1_REF"
    run_benchmark "$ANCHOR1_REF" "$run_id"

    # 记录 run_id 供后续 compare 使用
    echo "$run_id" > "$PROJECT_ROOT/scripts/.anchor1-run-id"
    log "Anchor 1 run_id 已保存: scripts/.anchor1-run-id"

    # 恢复
    git checkout "$original_ref" --quiet 2>/dev/null || true
}

phase_anchor2() {
    log "═══ Phase: Anchor 2 (1.13.14 当前版本) ═══"
    check_prerequisites

    local run_id
    run_id=$(make_run_id "$ANCHOR2_REF")

    local original_ref
    original_ref=$(git rev-parse HEAD)

    checkout_and_build "$ANCHOR2_REF"
    run_benchmark "$ANCHOR2_REF" "$run_id"

    echo "$run_id" > "$PROJECT_ROOT/scripts/.anchor2-run-id"
    log "Anchor 2 run_id 已保存: scripts/.anchor2-run-id"

    git checkout "$original_ref" --quiet 2>/dev/null || true
}

phase_compare() {
    log "═══ Phase: Compare (对比两锚点) ═══"

    local anchor1_id anchor2_id
    if [ -f "$PROJECT_ROOT/scripts/.anchor1-run-id" ]; then
        anchor1_id=$(cat "$PROJECT_ROOT/scripts/.anchor1-run-id")
    else
        err "未找到 anchor1 run_id。请先运行: $0 anchor1"
    fi

    if [ -f "$PROJECT_ROOT/scripts/.anchor2-run-id" ]; then
        anchor2_id=$(cat "$PROJECT_ROOT/scripts/.anchor2-run-id")
    else
        err "未找到 anchor2 run_id。请先运行: $0 anchor2"
    fi

    log "查询 Anchor 1: $anchor1_id"
    local run1 turns1 traces1
    run1=$(query_run "$anchor1_id")
    turns1=$(query_turns "$anchor1_id")
    traces1=$(query_tool_traces "$anchor1_id")

    log "查询 Anchor 2: $anchor2_id"
    local run2 turns2 traces2
    run2=$(query_run "$anchor2_id")
    turns2=$(query_turns "$anchor2_id")
    traces2=$(query_tool_traces "$anchor2_id")

    log ""
    log "═══════════════════════════════════════════════════"
    log "  对比结果"
    log "═══════════════════════════════════════════════════"
    log ""

    # 输出原始 JSON 供分析
    echo "--- Anchor 1 (v1.13.10) ---"
    echo "Run: $run1"
    echo "Turns: $turns1"
    echo "Tool Traces: $traces1"
    echo ""
    echo "--- Anchor 2 (1.13.14) ---"
    echo "Run: $run2"
    echo "Turns: $turns2"
    echo "Tool Traces: $traces2"
    echo ""

    # 简单对比 turn_count 和 total_duration_ms
    local tc1 tc2 dur1 dur2
    tc1=$(echo "$run1" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d[0]?.turn_count??'?')" 2>/dev/null || echo "?")
    tc2=$(echo "$run2" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d[0]?.turn_count??'?')" 2>/dev/null || echo "?")
    dur1=$(echo "$run1" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d[0]?.total_duration_ms??'?')" 2>/dev/null || echo "?")
    dur2=$(echo "$run2" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d[0]?.total_duration_ms??'?')" 2>/dev/null || echo "?")

    log "  v1.13.10:  turns=$tc1  duration=${dur1}ms"
    log "  1.13.14:   turns=$tc2  duration=${dur2}ms"
    log ""
    log "  ⚠️  token 精确数据请查看厂商面板（专用 API key 的 today 用量差值）"
    log "  ⚠️  tool_traces 中的 prompt_length 字段可辅助判断 input 是否膨胀"
    log ""
    log "═══ 判断 R 值 ═══"
    log "  R < 1.5   → 收工，不是回归"
    log "  R ∈ [1.5, 3] → 读 commit diff，挑最可疑的跑中间版本"
    log "  R > 3     → 严重回归，优先查:"
    log "    38263d9 (turn/tool上限)"
    log "    5c8d12e + d7223a7 (mem-core JSON重试)"
    log "    7abcc4d (memory governance)"
}

phase_bisect() {
    local ref="${BISECT_REF:-}"
    if [ -z "$ref" ]; then
        err "bisect 阶段需要设置 BISECT_REF 环境变量。例: BISECT_REF=38263d9 $0 bisect"
    fi

    log "═══ Phase: Bisect (commit: $ref) ═══"
    check_prerequisites

    local run_id
    run_id=$(make_run_id "$ref")

    local original_ref
    original_ref=$(git rev-parse HEAD)

    checkout_and_build "$ref"
    run_benchmark "$ref" "$run_id"

    echo "$run_id" >> "$PROJECT_ROOT/scripts/.bisect-run-ids"
    log "Bisect run_id 已追加: scripts/.bisect-run-ids"

    git checkout "$original_ref" --quiet 2>/dev/null || true

    # 查询结果
    log "查询结果 ..."
    sleep 3  # 等待 InsForge 写入
    local run_data
    run_data=$(query_run "$run_id")
    local traces
    traces=$(query_tool_traces "$run_id")

    echo ""
    echo "--- Bisect ($ref) ---"
    echo "Run: $run_data"
    echo "Tool Traces: $traces"
}

# ═══════════════════════════════════════════════════════════════════════════════
# Layer 3: 配置项隔离法 (isolate)
# ═══════════════════════════════════════════════════════════════════════════════
# 逐步禁用功能模块，用厂商面板观测 HTTP 调用次数变化
#
# 每组配置跑同一个任务，记录时间戳。用户对照 minimax 面板的
# “当日调用量”确认各配置的实际 HTTP 调用次数。
# ═══════════════════════════════════════════════════════════════════════════════

# 隔离测试配置定义：名称 + CLI 参数
# 从最少功能到最多功能，逐步增加，观察哪一步 HTTP 调用量跳变
ISOLATE_CONFIGS=(
    # 名称|CLI参数
    "bare-minimum|--no-extensions --no-mcp"
    "with-mcp-only|--no-extensions"
    "with-ext-no-mcp|--no-mcp"
    "full-default|"
)

# 按扩展类型细分的配置（当确认是扩展导致后使用）
# 用法: ./scripts/token-investigation.sh isolate-ext
# 使用 NANOPENCIL_SKIP_EXT_<NAME>=1 环境变量跳过单个扩展
ISOLATE_EXT_CONFIGS=(
    # 名称|环境变量
    "skip-nanomem|NANOPENCIL_SKIP_EXT_NANOMEM=1"
    "skip-presence|NANOPENCIL_SKIP_EXT_PRESENCE=1"
    "skip-interview|NANOPENCIL_SKIP_EXT_INTERVIEW=1"
    "skip-soul|NANOPENCIL_SKIP_EXT_SOUL=1"
    "skip-sal|NANOPENCIL_SKIP_EXT_SAL=1"
    "skip-mem+presence|NANOPENCIL_SKIP_EXT_NANOMEM=1 NANOPENCIL_SKIP_EXT_PRESENCE=1"
    "skip-mem+pres+interview|NANOPENCIL_SKIP_EXT_NANOMEM=1 NANOPENCIL_SKIP_EXT_PRESENCE=1 NANOPENCIL_SKIP_EXT_INTERVIEW=1"
)

run_isolate_single() {
    local name="$1"
    local cli_flags="$2"
    local env_vars="$3"
    local output_dir="$4"

    local timestamp
    timestamp=$(date +"%H:%M:%S")

    log "  [$timestamp] 运行配置: $name"
    log "    CLI:  --print --no-session --provider $PROVIDER --model $MODEL $cli_flags"
    [ -n "$env_vars" ] && log "    ENV:  $env_vars"

    local tmp_agent_dir
    tmp_agent_dir=$(mktemp -d)
    setup_temp_agent_dir "$tmp_agent_dir"

    local stderr_file="$output_dir/${name}.stderr"
    local meta_file="$output_dir/${name}.meta"

    if [ "${DRY_RUN:-}" = "1" ]; then
        log "    [DRY_RUN] 跳过"
        rm -rf "$tmp_agent_dir"
        return 0
    fi

    # 记录开始时间
    local start_epoch
    start_epoch=$(date +%s)

    # 构建执行命令
    local cmd="NANOPENCIL_CODING_AGENT_DIR=$tmp_agent_dir NANOPENCIL_TRACE_API=1"
    [ -n "$env_vars" ] && cmd="$cmd $env_vars"
    cmd="$cmd npx tsx cli.ts --print --no-session --provider $PROVIDER --model $MODEL $cli_flags \"$BENCHMARK_PROMPT\""

    # 执行
    eval "$cmd" 2>"$stderr_file" || {
        warn "    配置 $name 执行可能有错误，查看: $stderr_file"
    }

    local end_epoch
    end_epoch=$(date +%s)
    local duration=$((end_epoch - start_epoch))

    # 统计 API-TRACE 调用次数
    local trace_count=0
    local stream_count=0
    local simple_count=0
    if [ -f "$stderr_file" ]; then
        trace_count=$(grep -c "\[API-TRACE" "$stderr_file" 2>/dev/null || echo "0")
        stream_count=$(grep -c "\[API-TRACE.*stream |" "$stderr_file" 2>/dev/null || echo "0")
        simple_count=$(grep -c "\[API-TRACE.*streamSimple |" "$stderr_file" 2>/dev/null || echo "0")
    fi

    # 写入 meta
    cat > "$meta_file" <<EOF
name=$name
start_time=$timestamp
start_epoch=$start_epoch
end_epoch=$end_epoch
duration_s=$duration
trace_total=$trace_count
trace_stream=$stream_count
trace_simple=$simple_count
cli_flags=$cli_flags
env_vars=$env_vars
EOF

    log "    → 完成: ${duration}s | API调用=${trace_count}次 (stream=${stream_count}, simple=${simple_count})"

    rm -rf "$tmp_agent_dir"
}

phase_isolate() {
    log "═══ Phase: Isolate (配置项隔离法) ═══"
    log ""
    log "思路: 从 bare-minimum 到 full-default 逐步增加功能，"
    log "观察哪一步 HTTP 调用次数跳变。"
    log ""
    log "ℹ️  同时请打开 minimax 厂商面板观察实时调用量。"
    log "ℹ️  每组测试之间有 5s 间隔，方便在面板上区分每次运行。"
    log ""
    check_prerequisites

    local output_dir="$PROJECT_ROOT/scripts/.measure-tmp/isolate-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$output_dir"
    log "输出目录: $output_dir"
    log ""

    for config_line in "${ISOLATE_CONFIGS[@]}"; do
        local name flags
        name=$(echo "$config_line" | cut -d'|' -f1)
        flags=$(echo "$config_line" | cut -d'|' -f2)

        run_isolate_single "$name" "$flags" "" "$output_dir"

        # 间隔，方便在厂商面板区分
        log "    ⏸️  等待 5s ..."
        sleep 5
    done

    log ""
    log "═══ 隔离测试汇总 ═══"
    log ""
    printf "  %-20s %6s %8s %8s %8s\n" "CONFIG" "TIME" "TOTAL" "STREAM" "SIMPLE"
    printf "  %-20s %6s %8s %8s %8s\n" "------" "----" "-----" "------" "------"
    for meta_file in "$output_dir"/*.meta; do
        [ -f "$meta_file" ] || continue
        local n d tt ts tsi
        n=$(grep '^name=' "$meta_file" | cut -d= -f2)
        d=$(grep '^duration_s=' "$meta_file" | cut -d= -f2)
        tt=$(grep '^trace_total=' "$meta_file" | cut -d= -f2)
        ts=$(grep '^trace_stream=' "$meta_file" | cut -d= -f2)
        tsi=$(grep '^trace_simple=' "$meta_file" | cut -d= -f2)
        printf "  %-20s %5ss %8s %8s %8s\n" "$n" "$d" "$tt" "$ts" "$tsi"
    done
    log ""
    log "═══ 分析指南 ═══"
    log "  bare-minimum 应该是 2-3 次（一次tool_call + 一次回复）"
    log "  如果 bare 已经很高 → 问题在核心层（retry/compaction/soul）"
    log "  如果 with-ext-no-mcp 跳变 → 问题在扩展，运行 isolate-ext 细分"
    log "  如果 with-mcp-only 跳变 → 问题在 MCP server"
    log ""
    log "详细 trace 日志在: $output_dir/"
}

phase_isolate_ext() {
    log "═══ Phase: Isolate-Ext (扩展细分隔离) ═══"
    log ""
    log "思路: 逐个禁用扩展，看哪个扩展导致调用量下降。"
    log "先跑一次全扩展基线，然后逐个关闭。"
    log ""
    check_prerequisites

    local output_dir="$PROJECT_ROOT/scripts/.measure-tmp/isolate-ext-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$output_dir"
    log "输出目录: $output_dir"
    log ""

    # 基线：全扩展
    run_isolate_single "baseline-all-ext" "--no-mcp" "" "$output_dir"
    sleep 5

    # 逐个禁用
    for config_line in "${ISOLATE_EXT_CONFIGS[@]}"; do
        local name env_setting
        name=$(echo "$config_line" | cut -d'|' -f1)
        env_setting=$(echo "$config_line" | cut -d'|' -f2)

        run_isolate_single "$name" "--no-mcp" "$env_setting" "$output_dir"
        sleep 5
    done

    log ""
    log "═══ 扩展隔离汇总 ═══"
    log ""
    printf "  %-20s %6s %8s %8s %8s\n" "CONFIG" "TIME" "TOTAL" "STREAM" "SIMPLE"
    printf "  %-20s %6s %8s %8s %8s\n" "------" "----" "-----" "------" "------"
    for meta_file in "$output_dir"/*.meta; do
        [ -f "$meta_file" ] || continue
        local n d tt ts tsi
        n=$(grep '^name=' "$meta_file" | cut -d= -f2)
        d=$(grep '^duration_s=' "$meta_file" | cut -d= -f2)
        tt=$(grep '^trace_total=' "$meta_file" | cut -d= -f2)
        ts=$(grep '^trace_stream=' "$meta_file" | cut -d= -f2)
        tsi=$(grep '^trace_simple=' "$meta_file" | cut -d= -f2)
        printf "  %-20s %5ss %8s %8s %8s\n" "$n" "$d" "$tt" "$ts" "$tsi"
    done
    log ""
    log "═══ 分析指南 ═══"
    log "  哪个 disabled 后调用量明显下降，就是元凶"
    log "  常见元凶: nanomem(extractAndStore+dream), presence(每次打招呼)"
    log ""
}

# ═══════════════════════════════════════════════════════════════════════════════
# Trace: 单次运行带完整调用栈
# ═══════════════════════════════════════════════════════════════════════════════

phase_trace() {
    local extra_flags="${1:-}"
    log "═══ Phase: Trace (带调用栈的单次运行) ═══"
    log ""
    log "设置 NANOPENCIL_TRACE_API=1 运行，输出每次 HTTP 调用的:"
    log "  - 调用序号"
    log "  - 调用类型 (stream / streamSimple)"
    log "  - 消息数量、工具数量、系统提示长度"
    log "  - 调用栈 (定位是谁触发的)"
    log ""
    check_prerequisites

    local trace_file="$PROJECT_ROOT/scripts/.measure-tmp/trace-$(date +%Y%m%d-%H%M%S).log"
    mkdir -p "$(dirname "$trace_file")"

    local tmp_agent_dir
    tmp_agent_dir=$(mktemp -d)
    setup_temp_agent_dir "$tmp_agent_dir"

    log "执行任务: $BENCHMARK_PROMPT"
    log "额外参数: $extra_flags"
    log "Trace 输出: $trace_file"
    log ""

    if [ "${DRY_RUN:-}" = "1" ]; then
        log "[DRY_RUN] NANOPENCIL_CODING_AGENT_DIR=$tmp_agent_dir NANOPENCIL_TRACE_API=1 npx tsx cli.ts --print --no-session --provider $PROVIDER --model $MODEL $extra_flags \"$BENCHMARK_PROMPT\""
        rm -rf "$tmp_agent_dir"
        return 0
    fi

    NANOPENCIL_CODING_AGENT_DIR="$tmp_agent_dir" \
    NANOPENCIL_TRACE_API=1 \
    npx tsx cli.ts --print --no-session --provider "$PROVIDER" --model "$MODEL" $extra_flags "$BENCHMARK_PROMPT" \
        2>"$trace_file" || {
        warn "执行可能有错误，但 trace 已写入"
    }

    rm -rf "$tmp_agent_dir"

    # 汇总
    local total stream_c simple_c
    total=$(grep -c "\[API-TRACE" "$trace_file" 2>/dev/null || echo "0")
    stream_c=$(grep -c "\[API-TRACE.*stream |" "$trace_file" 2>/dev/null || echo "0")
    simple_c=$(grep -c "\[API-TRACE.*streamSimple |" "$trace_file" 2>/dev/null || echo "0")

    log ""
    log "═══ Trace 结果 ═══"
    log "  总 HTTP 调用次数: $total"
    log "  其中 stream (agent主循环): $stream_c"
    log "  其中 streamSimple (扩展/记忆): $simple_c"
    log ""
    log "调用栈详情:"
    grep "\[API-TRACE" "$trace_file" | head -60
    log ""
    log "完整日志: $trace_file"
    log ""
    log "═══ 分析指南 ═══"
    log "  stream 次数 = agent 主循环轮数（工具调用 + LLM回复）"
    log "  streamSimple 次数 = 扩展、记忆、interview 等触发的辅助调用"
    log "  查看调用栈中的文件名确定具体是谁触发的"
    log "  常见来源: extension.ts(nanomem), presence/index.ts, interview/index.ts"
}

# ─── 入口 ────────────────────────────────────────────────────────────────────

phase="${1:-}"

case "$phase" in
    anchor1)
        phase_anchor1
        ;;
    anchor2)
        phase_anchor2
        ;;
    compare)
        phase_compare
        ;;
    bisect)
        phase_bisect
        ;;
    isolate)
        phase_isolate
        ;;
    isolate-ext)
        phase_isolate_ext
        ;;
    trace)
        shift 2>/dev/null || true
        phase_trace "$*"
        ;;
    all)
        phase_anchor1
        echo ""
        phase_anchor2
        echo ""
        phase_compare
        ;;
    *)
        echo "用法: $0 <phase>"
        echo ""
        echo "═══ Layer 1: 版本锚点对比 ═══"
        echo "  anchor1      在 v1.13.10 上跑基准任务"
        echo "  anchor2      在 1.13.14 上跑同一任务"
        echo "  compare      查询 InsForge 对比两次结果，判断 R 值"
        echo "  all          依次执行 anchor1 → anchor2 → compare"
        echo ""
        echo "═══ Layer 2: Commit 二分 ═══"
        echo "  bisect       在指定 commit 上跑任务 (需设 BISECT_REF=<hash>)"
        echo ""
        echo "═══ Layer 3: 配置项隔离 ═══"
        echo "  isolate      在当前版本上，逐项禁用功能，对比 HTTP 调用次数"
        echo "  isolate-ext  确认是扩展问题后，逐个扩展细分排查"
        echo "  trace [flags] 带调用栈的单次运行（可加额外 CLI 参数）"
        echo ""
        echo "环境变量:"
        echo "  BISECT_REF           bisect 阶段的 git ref"
        echo "  NANOPENCIL_MODEL     指定模型 ID（默认 MiniMax-M2.5）"
        echo "  NANOPENCIL_PROVIDER  指定 provider（默认 minimax-coding）"
        echo "  DRY_RUN=1            只打印命令不执行"
        echo ""
        echo "推荐流程:"
        echo "  1. $0 trace                     # 先看一次完整调用栈，确认异常"
        echo "  2. $0 isolate                   # 配置隔离，定位大方向"
        echo "  3. $0 isolate-ext               # 细分到具体扩展"
        echo "  4. $0 anchor1 && $0 anchor2     # 版本对比"
        echo "  5. $0 compare                   # 判断 R 值"
        echo "  6. BISECT_REF=xxx $0 bisect     # 锁定 commit"
        echo ""
        echo "示例:"
        echo "  $0 trace --no-extensions        # 追踪无扩展模式"
        echo "  $0 trace --no-mcp               # 追踪无 MCP 模式"
        exit 1
        ;;
esac
