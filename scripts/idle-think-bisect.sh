#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# idle-think-bisect.sh — IdleThink / Presence 能力对 HTTP 调用影响的排查脚本
# ═══════════════════════════════════════════════════════════════════════════════
#
# 排查目标：
#   1. 量化 idle-think 和 presence 两个扩展对 HTTP 调用次数的影响
#   2. 通过 commit 锚点对比，验证引入前后的变化
#   3. 监控挂机状态下的 HTTP 调用增长曲线
#
# 关键 Commit 锚点：
#   b485a98 (2026-04-27) — feat(idle-think): add idle exploration extension
#   7de510a (2026-04-08) — feat(presence): AI-generated idle nudges
#   4213568 (2026-04-21) — fix(presence): only send opening when idle
#   4fb34eb (2026-04-27) — idle-think 的前一个 commit（无 idle-think）
#
# 使用方法：
#   ./scripts/idle-think-bisect.sh task          # 任务态 HTTP 调用对比
#   ./scripts/idle-think-bisect.sh idle [分钟]   # 挂机态 HTTP 调用监控
#   ./scripts/idle-think-bisect.sh commit-diff   # 跨 commit 对比
#   ./scripts/idle-think-bisect.sh summary       # 汇总所有测试结果
#
# 前提：
#   - core/lib/ai 已编译（含 NANOPENCIL_TRACE_API 追踪器）
#   - 确认追踪器: grep "API-TRACE" core/lib/ai/dist/stream.js
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# ─── 配置 ───────────────────────────────────────────────────────────────────
TASK="读 README.md 然后告诉我这个项目是做什么的"
PROVIDER="${NANOPENCIL_TEST_PROVIDER:-minimax-coding}"
MODEL="${NANOPENCIL_TEST_MODEL:-MiniMax-M2.5}"
RESULT_DIR="scripts/.idle-think-audit"
IDLE_MONITOR_MINUTES="${2:-5}"  # 默认监控5分钟

# 关键 commit
COMMIT_BEFORE_IDLE_THINK="4fb34eb"  # idle-think 引入前
COMMIT_IDLE_THINK="b485a98"         # idle-think 引入
COMMIT_PRESENCE_IDLE="7de510a"      # presence idle nudge 引入
COMMIT_HEAD="HEAD"

mkdir -p "$RESULT_DIR"

# ─── 工具函数 ─────────────────────────────────────────────────────────────────

log() { echo -e "\033[36m[idle-bisect]\033[0m $*"; }
warn() { echo -e "\033[33m[idle-bisect]\033[0m $*"; }
err() { echo -e "\033[31m[idle-bisect]\033[0m $*" >&2; }

timestamp() { date "+%Y%m%d-%H%M%S"; }

# 检查追踪器是否已编译
check_tracer() {
    if ! grep -q "API-TRACE" core/lib/ai/dist/stream.js 2>/dev/null; then
        err "追踪器未编译到 dist！请先运行:"
        err "  cd core/lib/ai && npx tsc -p tsconfig.build.json"
        err "  或: ./scripts/idle-think-bisect.sh build-tracer"
        exit 1
    fi
    log "✓ 追踪器已就绪"
}

# 编译追踪器
build_tracer() {
    log "编译 core/lib/ai (含 API 追踪器)..."
    (cd core/lib/ai && npx tsc -p tsconfig.build.json 2>&1 | tail -3)
    if grep -q "API-TRACE" core/lib/ai/dist/stream.js; then
        log "✓ 编译成功，追踪器已生效"
    else
        err "✗ 编译后未找到追踪器代码"
        exit 1
    fi
}

# 执行单次 print 模式任务，返回 HTTP 调用次数
run_task() {
    local label="$1"
    shift
    local extra_env=("${@+$@}")
    local logfile="$RESULT_DIR/${label}-$(timestamp).log"

    log "  运行: $label"
    
    # 构建环境变量
    local env_str="NANOPENCIL_TRACE_API=1"
    for e in "${extra_env[@]+${extra_env[@]}}"; do
        env_str="$env_str $e"
    done

    eval "$env_str npx tsx cli.ts --print --no-session --provider $PROVIDER --model $MODEL \"$TASK\" 2>\"$logfile\" 1>/dev/null" || true

    local count
    count=$(grep -c "API-TRACE" "$logfile" 2>/dev/null || echo "0")
    
    # 提取调用来源分类
    local stream_count simple_count
    stream_count=$(grep "API-TRACE" "$logfile" 2>/dev/null | grep -c "stream |stream$" || echo "0")
    simple_count=$(grep "API-TRACE" "$logfile" 2>/dev/null | grep -c "streamSimple" || echo "0")
    
    echo "$label|$count|$stream_count|$simple_count|$logfile" >> "$RESULT_DIR/results.csv"
    log "    → $count 次 HTTP 调用 (stream=$stream_count, streamSimple=$simple_count)"
    log "    → 日志: $logfile"
}

# ─── Phase 1: 任务态对比 ─────────────────────────────────────────────────────

phase_task() {
    log "═══ Phase 1: 任务态 HTTP 调用对比 ═══"
    log ""
    log "任务: $TASK"
    log "Provider: $PROVIDER / $MODEL"
    log ""
    
    check_tracer

    # 清空旧结果
    echo "label|http_calls|stream|streamSimple|logfile" > "$RESULT_DIR/results.csv"

    log "── 1.1 全功能（当前 HEAD，所有扩展+MCP）──"
    run_task "full-default" 

    log ""
    log "── 1.2 禁用 idle-think ──"
    run_task "no-idle-think" "NANOPENCIL_SKIP_EXT_IDLETHINK=1"

    log ""
    log "── 1.3 禁用 presence ──"
    run_task "no-presence" "NANOPENCIL_SKIP_EXT_PRESENCE=1"

    log ""
    log "── 1.4 禁用 idle-think + presence ──"
    run_task "no-idle-no-presence" "NANOPENCIL_SKIP_EXT_IDLETHINK=1" "NANOPENCIL_SKIP_EXT_PRESENCE=1"

    log ""
    log "── 1.5 禁用 nanomem ──"
    run_task "no-nanomem" "NANOPENCIL_SKIP_EXT_NANOMEM=1"

    log ""
    log "── 1.6 全部禁用（裸核心）──"
    run_task "bare-core" "NANOPENCIL_SKIP_EXT_IDLETHINK=1" "NANOPENCIL_SKIP_EXT_PRESENCE=1" "NANOPENCIL_SKIP_EXT_NANOMEM=1" "NANOPENCIL_SKIP_EXT_SOUL=1"

    log ""
    log "── 1.7 --no-extensions（完全无扩展）──"
    # 这里需要改命令行参数
    local logfile="$RESULT_DIR/no-extensions-$(timestamp).log"
    NANOPENCIL_TRACE_API=1 npx tsx cli.ts --print --no-session --no-extensions --no-mcp --provider "$PROVIDER" --model "$MODEL" "$TASK" 2>"$logfile" 1>/dev/null || true
    local count
    count=$(grep -c "API-TRACE" "$logfile" 2>/dev/null || echo "0")
    echo "no-extensions|$count|0|0|$logfile" >> "$RESULT_DIR/results.csv"
    log "    → $count 次 HTTP 调用"

    log ""
    log "═══ Phase 1 结果汇总 ═══"
    log ""
    printf "  %-25s %s\n" "配置" "HTTP调用次数"
    printf "  %-25s %s\n" "─────────────────────────" "──────────"
    while IFS='|' read -r label calls stream simple _; do
        [[ "$label" == "label" ]] && continue
        printf "  %-25s %s (stream=%s, simple=%s)\n" "$label" "$calls" "$stream" "$simple"
    done < "$RESULT_DIR/results.csv"

    log ""
    log "详细日志目录: $RESULT_DIR/"
    log ""
    log "▶ 下一步: 对比厂商面板的实际调用数据"
    log "  在执行每组测试前，记录 minimax 面板的当前累计调用次数"
    log "  测试后再次记录，差值即为厂商侧实际 HTTP 调用次数"
}

# ─── Phase 2: 挂机态监控 ─────────────────────────────────────────────────────

phase_idle() {
    local minutes="${1:-$IDLE_MONITOR_MINUTES}"
    local seconds=$((minutes * 60))
    
    log "═══ Phase 2: 挂机态 HTTP 调用监控 ═══"
    log ""
    log "监控时长: ${minutes} 分钟"
    log "采样间隔: 30 秒"
    log ""
    log "说明:"
    log "  - Presence idle nudge: 4分钟无活动后触发 (每次1次HTTP)"
    log "  - IdleThink exploration: 10分钟无活动后触发 (每次多次HTTP，SubAgent)"
    log ""
    
    check_tracer

    local idle_dir="$RESULT_DIR/idle-$(timestamp)"
    mkdir -p "$idle_dir"
    local logfile="$idle_dir/stderr.log"
    local report="$idle_dir/timeline.csv"
    echo "elapsed_sec|cumulative_http_calls|delta" > "$report"

    log "启动交互模式（后台）..."
    log "  日志: $logfile"
    
    # 启动交互模式，不发送任何输入（模拟挂机）
    NANOPENCIL_TRACE_API=1 npx tsx cli.ts --no-session --provider "$PROVIDER" --model "$MODEL" 2>"$logfile" </dev/null &
    local pid=$!
    
    log "  PID: $pid"
    log ""
    log "开始采样（每30秒）..."
    
    local prev_count=0
    for ((i=30; i<=seconds; i+=30)); do
        sleep 30
        local count
        count=$(grep -c "API-TRACE" "$logfile" 2>/dev/null || echo "0")
        local delta=$((count - prev_count))
        echo "$i|$count|$delta" >> "$report"
        
        local elapsed_min=$((i / 60))
        local elapsed_sec=$((i % 60))
        log "  [${elapsed_min}m${elapsed_sec}s] 累计: ${count} 次 HTTP, 本周期增量: +${delta}"
        prev_count=$count
    done

    log ""
    log "监控结束，终止进程..."
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true

    # 最终统计
    local final_count
    final_count=$(grep -c "API-TRACE" "$logfile" 2>/dev/null || echo "0")
    
    log ""
    log "═══ 挂机监控结果 ═══"
    log ""
    log "  总时长: ${minutes} 分钟"
    log "  总 HTTP 调用: ${final_count} 次"
    log "  平均: $(echo "scale=2; $final_count / $minutes" | bc 2>/dev/null || echo "?") 次/分钟"
    log ""
    log "  时间线: $report"
    log "  完整日志: $logfile"
    log ""
    
    # 显示调用来源分析
    log "── 调用来源分析 ──"
    grep "API-TRACE" "$logfile" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | head -30
    
    log ""
    log "▶ 对比建议:"
    log "  1. 禁用 idle-think 重跑:  NANOPENCIL_SKIP_EXT_IDLETHINK=1 ./scripts/idle-think-bisect.sh idle $minutes"
    log "  2. 禁用 presence 重跑:    NANOPENCIL_SKIP_EXT_PRESENCE=1 ./scripts/idle-think-bisect.sh idle $minutes"
    log "  3. 两者都禁用重跑:        NANOPENCIL_SKIP_EXT_IDLETHINK=1 NANOPENCIL_SKIP_EXT_PRESENCE=1 ./scripts/idle-think-bisect.sh idle $minutes"
}

# ─── Phase 3: Commit 对比 ────────────────────────────────────────────────────

phase_commit_diff() {
    log "═══ Phase 3: Commit 对比排查 ═══"
    log ""
    log "关键锚点:"
    log "  A: $COMMIT_BEFORE_IDLE_THINK (idle-think 引入前 — 2026-04-27 00:24)"
    log "  B: $COMMIT_IDLE_THINK         (idle-think 引入后 — 2026-04-27 01:00)"
    log "  C: $COMMIT_PRESENCE_IDLE      (presence idle nudge — 2026-04-08)"
    log "  D: HEAD                        (当前)"
    log ""
    log "⚠️  Commit 对比需要切换分支，请确保工作区干净:"
    log "    git status  # 确认无未提交修改"
    log ""
    log "══════════════════════════════════════════════════════════════════"
    log ""
    log "请按以下步骤手动执行（切换 commit 需要重新编译追踪器）:"
    log ""
    log "─── 步骤 1: 在 idle-think 引入前的 commit 测试 ───"
    log ""
    log "  git stash  # 保存当前修改"
    log "  git checkout $COMMIT_BEFORE_IDLE_THINK"
    log ""
    log "  # 注入追踪器到 core/lib/ai/src/stream.ts（如果该commit没有）"
    log "  # 检查是否有追踪代码:"
    log "  grep 'API-TRACE' core/lib/ai/src/stream.ts"
    log ""
    log "  # 如果没有，手动在 stream() 和 streamSimple() 入口加:"
    log "  #   if (process.env.NANOPENCIL_TRACE_API === '1') {"
    log "  #     console.error('[API-TRACE #' + (++globalThis.__apiCount || (globalThis.__apiCount=1)) + ']', new Error().stack?.split('\\n').slice(1,6).join('\\n'));"
    log "  #   }"
    log ""
    log "  cd core/lib/ai && npx tsc -p tsconfig.build.json && cd ../.."
    log "  NANOPENCIL_TRACE_API=1 npx tsx cli.ts --print --no-session --provider $PROVIDER --model $MODEL \"$TASK\" 2>/tmp/trace-before-idle-think.log 1>/dev/null"
    log "  echo \"Before idle-think:\"; grep -c 'API-TRACE' /tmp/trace-before-idle-think.log"
    log ""
    log "─── 步骤 2: 在 idle-think 引入后的 commit 测试 ───"
    log ""
    log "  git checkout $COMMIT_IDLE_THINK"
    log "  cd core/lib/ai && npx tsc -p tsconfig.build.json && cd ../.."
    log "  NANOPENCIL_TRACE_API=1 npx tsx cli.ts --print --no-session --provider $PROVIDER --model $MODEL \"$TASK\" 2>/tmp/trace-after-idle-think.log 1>/dev/null"
    log "  echo \"After idle-think:\"; grep -c 'API-TRACE' /tmp/trace-after-idle-think.log"
    log ""
    log "─── 步骤 3: 回到 HEAD ───"
    log ""
    log "  git checkout -"
    log "  git stash pop  # 恢复修改"
    log ""
    log "─── 步骤 4: 快速对比（不切换 commit，用环境变量隔离）───"
    log ""
    log "  这是更推荐的方式——不需要切换 commit，直接用 skipExt 隔离:"
    log ""
    log "  # 模拟「无 idle-think」的效果:"
    log "  NANOPENCIL_TRACE_API=1 NANOPENCIL_SKIP_EXT_IDLETHINK=1 npx tsx cli.ts --print --no-session --provider $PROVIDER --model $MODEL \"$TASK\" 2>/tmp/trace-skip-idle.log 1>/dev/null"
    log "  echo \"Skip idle-think:\"; grep -c 'API-TRACE' /tmp/trace-skip-idle.log"
    log ""
    log "  # 模拟「无 idle-think + 无 presence」:"
    log "  NANOPENCIL_TRACE_API=1 NANOPENCIL_SKIP_EXT_IDLETHINK=1 NANOPENCIL_SKIP_EXT_PRESENCE=1 npx tsx cli.ts --print --no-session --provider $PROVIDER --model $MODEL \"$TASK\" 2>/tmp/trace-skip-both.log 1>/dev/null"
    log "  echo \"Skip both:\"; grep -c 'API-TRACE' /tmp/trace-skip-both.log"
    log ""
    log "═══════════════════════════════════════════════════════════════════"
    log ""
    log "⚡ 推荐: 先跑步骤 4（不需要切 commit），确认影响后再决定是否需要步骤 1-3"
}

# ─── Phase 4: 汇总报告 ───────────────────────────────────────────────────────

phase_summary() {
    log "═══ 汇总报告 ═══"
    log ""
    
    if [[ ! -f "$RESULT_DIR/results.csv" ]]; then
        warn "未找到测试结果，请先运行: ./scripts/idle-think-bisect.sh task"
        return
    fi

    log "── 任务态对比 ──"
    log ""
    printf "  %-30s %-12s %-10s %-12s\n" "配置" "HTTP调用" "stream" "streamSimple"
    printf "  %-30s %-12s %-10s %-12s\n" "──────────────────────────────" "────────" "────────" "──────────"
    while IFS='|' read -r label calls stream simple _; do
        [[ "$label" == "label" ]] && continue
        printf "  %-30s %-12s %-10s %-12s\n" "$label" "$calls" "$stream" "$simple"
    done < "$RESULT_DIR/results.csv"

    log ""
    
    # 显示挂机监控结果（如果有）
    local idle_dirs
    idle_dirs=$(find "$RESULT_DIR" -maxdepth 1 -type d -name "idle-*" 2>/dev/null | sort | tail -3)
    if [[ -n "$idle_dirs" ]]; then
        log "── 挂机监控结果 ──"
        log ""
        for dir in $idle_dirs; do
            local dirname
            dirname=$(basename "$dir")
            if [[ -f "$dir/timeline.csv" ]]; then
                local total
                total=$(tail -1 "$dir/timeline.csv" | cut -d'|' -f2)
                local duration
                duration=$(tail -1 "$dir/timeline.csv" | cut -d'|' -f1)
                log "  $dirname: 总计 ${total} 次 HTTP, 持续 ${duration}s"
            fi
        done
        log ""
    fi

    log "── 分析指引 ──"
    log ""
    log "  如果 full-default ≈ no-idle-think → idle-think 在任务态无影响（预期）"
    log "  如果 full-default > no-idle-think → idle-think 有意外的任务态调用"
    log "  如果 full-default > no-presence → presence 在任务态有额外调用（opening）"
    log "  如果 full-default ≫ bare-core → 扩展总体贡献显著"
    log ""
    log "  挂机态:"
    log "  - 0~4分钟: 应该 0 次额外调用"
    log "  - 4~10分钟: presence idle nudge 可能触发 1 次"
    log "  - 10+分钟: idle-think exploration 每次可能 3-10+ 次（SubAgent多轮）"
    log ""
    log "── 结果文件 ──"
    log ""
    log "  $RESULT_DIR/results.csv"
    find "$RESULT_DIR" -name "*.log" -newer "$RESULT_DIR/results.csv" 2>/dev/null | head -10 | while read -r f; do
        log "  $f"
    done
}

# ─── 入口 ─────────────────────────────────────────────────────────────────────

case "${1:-help}" in
    build-tracer)
        build_tracer
        ;;
    task)
        phase_task
        ;;
    idle)
        phase_idle "${2:-$IDLE_MONITOR_MINUTES}"
        ;;
    commit-diff)
        phase_commit_diff
        ;;
    summary)
        phase_summary
        ;;
    help|--help|-h)
        echo "用法: $0 <command> [args]"
        echo ""
        echo "Commands:"
        echo "  build-tracer     编译 core/lib/ai 追踪器"
        echo "  task             任务态对比（7组配置）"
        echo "  idle [分钟]     挂机态监控（默认5分钟）"
        echo "  commit-diff      输出 commit 对比步骤"
        echo "  summary          汇总所有结果"
        echo ""
        echo "推荐流程:"
        echo "  1. ./scripts/idle-think-bisect.sh build-tracer"
        echo "  2. ./scripts/idle-think-bisect.sh task"
        echo "  3. ./scripts/idle-think-bisect.sh idle 15"
        echo "  4. ./scripts/idle-think-bisect.sh summary"
        echo ""
        echo "环境变量:"
        echo "  NANOPENCIL_SKIP_EXT_IDLETHINK=1  跳过 idle-think 扩展"
        echo "  NANOPENCIL_SKIP_EXT_PRESENCE=1   跳过 presence 扩展"
        echo "  NANOPENCIL_SKIP_EXT_NANOMEM=1    跳过 nanomem 扩展"
        echo "  NANOPENCIL_SKIP_EXT_SOUL=1       跳过 soul 扩展"
        echo "  NANOPENCIL_TEST_PROVIDER=...     覆盖测试 provider"
        echo "  NANOPENCIL_TEST_MODEL=...        覆盖测试 model"
        ;;
    *)
        err "未知命令: $1"
        echo "用法: $0 {build-tracer|task|idle|commit-diff|summary|help}"
        exit 1
        ;;
esac
