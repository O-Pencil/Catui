#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# http-call-audit.sh — HTTP 调用次数系统性审计脚本
# ═══════════════════════════════════════════════════════════════════════════════
#
# 目的：量化 nanoPencil 在不同场景下的 HTTP 调用次数，定位异常来源。
# 与 minimax-billing-calibration.sh 配合使用来交叉验证厂商面板数据。
#
# 工作原理：
#   通过 NANOPENCIL_TRACE_API=1 环境变量启用 packages/ai/src/stream.ts 中的
#   调用追踪器，统计每次 streamSimple() 被调用的次数和调用栈。
#   ⚠️ 前提：packages/ai 需要已编译（追踪代码在 dist/ 中才生效）
#
# 用法:
#   ./scripts/http-call-audit.sh <phase>
#
# Phase:
#   build-tracer  — 编译 ai 包，确保追踪器代码在 dist 中
#   baseline      — 单次任务基准测试（真实环境 + 临时空环境）
#   isolate       — 配置项隔离对比（bare → full，逐步增加功能）
#   isolate-ext   — 扩展细分隔离（逐个禁用扩展）
#   idle          — 挂机监控（启动交互模式，定时采样调用次数）
#   patch-test    — 验证修复方案的效果（需先手动 apply patch）
#   report        — 汇总所有已收集数据生成报告
#
# 关键区别于 token-investigation.sh：
#   1. 不使用临时 agent 目录（除非显式指定），用真实记忆库测试
#   2. 同时记录 trace 计数 + 厂商面板差值（手动输入）
#   3. 包含挂机（idle）监控能力
#   4. 支持 patch 前后的 A/B 对比
#
# ═══════════════════════════════════════════════════════════════════════════════

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$SCRIPT_DIR/.http-audit-data"
mkdir -p "$DATA_DIR"

# ─── 配置 ───────────────────────────────────────────────────────────────────

MODEL="${NANOPENCIL_MODEL:-MiniMax-M2.5}"
PROVIDER="${NANOPENCIL_PROVIDER:-minimax-coding}"
BENCHMARK_PROMPT="读 README.md 然后告诉我这个项目是做什么的"

# ─── 工具函数 ────────────────────────────────────────────────────────────────

log() { echo -e "\033[1;36m[audit]\033[0m $*"; }
warn() { echo -e "\033[1;33m[audit]\033[0m $*" >&2; }
err() { echo -e "\033[1;31m[audit]\033[0m $*" >&2; exit 1; }
sep() { echo "──────────────────────────────────────────────────────────────"; }

# 获取 minimax API key 用于查询用量
get_api_key() {
    node -e "
const d = JSON.parse(require('fs').readFileSync(require('path').join(require('os').homedir(), '.nanopencil/agent/auth.json'), 'utf8'));
const p = d['minimax-coding'];
console.log(p?.key || p?.apiKey || '');
" | tr -d '\n'
}

# 查询 minimax 当前用量计数
query_minimax_usage() {
    local api_key
    api_key=$(get_api_key)
    [ -z "$api_key" ] && { echo "?"; return; }
    curl -s --max-time 10 "https://api.minimaxi.com/v1/users/model_remains" \
        -H "Authorization: Bearer $api_key" \
        -H "Content-Type: application/json" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const m=(d.model_remains||[]).find(r=>(r.model_name||'').includes('MiniMax'));
console.log(m?.current_interval_usage_count ?? '?');
" 2>/dev/null || echo "?"
}

# 检查 tracer 是否编译
check_tracer() {
    if ! grep -q "API-TRACE" "$PROJECT_ROOT/packages/ai/dist/stream.js" 2>/dev/null; then
        warn "⚠️  packages/ai/dist/stream.js 中没有 API-TRACE 代码"
        warn "   请先运行: $0 build-tracer"
        return 1
    fi
    return 0
}

# 单次执行任务并统计
# 参数: $1=测试名, $2=CLI追加参数, $3=环境变量追加, $4=是否用临时目录(0/1)
run_single_test() {
    local name="$1"
    local cli_flags="${2:-}"
    local env_extra="${3:-}"
    local use_temp_dir="${4:-0}"

    local timestamp
    timestamp=$(date +"%Y-%m-%d %H:%M:%S")

    log "  ┌─ [$name]"
    log "  │  时间: $timestamp"
    log "  │  CLI:  --print --no-session --provider $PROVIDER --model $MODEL $cli_flags"
    [ -n "$env_extra" ] && log "  │  ENV:  $env_extra"

    # 查询厂商面板起始值
    local usage_before
    usage_before=$(query_minimax_usage)
    log "  │  厂商面板起始: $usage_before"

    # 准备目录
    local agent_dir_env=""
    local tmp_dir=""
    if [ "$use_temp_dir" = "1" ]; then
        tmp_dir=$(mktemp -d)
        mkdir -p "$tmp_dir/memory/v2" "$tmp_dir/memory/episodes"
        echo '{}' > "$tmp_dir/settings.json"
        cp ~/.nanopencil/agent/auth.json "$tmp_dir/auth.json" 2>/dev/null || true
        agent_dir_env="NANOPENCIL_CODING_AGENT_DIR=$tmp_dir"
        log "  │  ⚠️ 使用临时空目录（无记忆）"
    fi

    local stderr_file="$DATA_DIR/${name}.stderr"
    local start_epoch
    start_epoch=$(date +%s)

    # 构建并执行命令
    local cmd="$agent_dir_env NANOPENCIL_TRACE_API=1"
    [ -n "$env_extra" ] && cmd="$cmd $env_extra"
    cmd="$cmd npx tsx cli.ts --print --no-session --provider $PROVIDER --model $MODEL $cli_flags \"$BENCHMARK_PROMPT\""

    cd "$PROJECT_ROOT"
    eval "$cmd" 2>"$stderr_file" 1>/dev/null || {
        warn "  │  ⚠️ 命令可能有错误"
    }

    local end_epoch
    end_epoch=$(date +%s)
    local duration=$((end_epoch - start_epoch))

    # 等一秒让厂商面板更新
    sleep 2

    # 查询厂商面板结束值
    local usage_after
    usage_after=$(query_minimax_usage)

    # 统计 trace 输出
    local trace_total=0
    local trace_agent_loop=0
    local trace_reconsolidate=0
    local trace_extract=0
    local trace_other=0
    if [ -f "$stderr_file" ]; then
        trace_total=$(grep -c "\[API-TRACE" "$stderr_file" 2>/dev/null || echo "0")
        trace_agent_loop=$(grep "\[API-TRACE" "$stderr_file" | grep -c "agent-loop" 2>/dev/null || echo "0")
        trace_reconsolidate=$(grep "\[API-TRACE" "$stderr_file" | grep -c "reconsolidateIfNeeded\|reconsolidate" 2>/dev/null || echo "0")
        trace_extract=$(grep "\[API-TRACE" "$stderr_file" | grep -c "extraction\|callJsonLlm" 2>/dev/null || echo "0")
        trace_other=$((trace_total - trace_agent_loop - trace_reconsolidate - trace_extract))
    fi

    # 计算厂商面板差值
    local panel_delta="?"
    if [ "$usage_before" != "?" ] && [ "$usage_after" != "?" ]; then
        panel_delta=$((usage_after - usage_before))
    fi

    log "  │"
    log "  │  结果:"
    log "  │    耗时: ${duration}s"
    log "  │    Trace 总计: $trace_total"
    log "  │      agent-loop:     $trace_agent_loop"
    log "  │      reconsolidate:  $trace_reconsolidate"
    log "  │      extraction:     $trace_extract"
    log "  │      其他:           $trace_other"
    log "  │    厂商面板: $usage_before → $usage_after (Δ=$panel_delta)"
    log "  └─ 完成"
    echo ""

    # 写入CSV记录
    echo "$name,$timestamp,$duration,$trace_total,$trace_agent_loop,$trace_reconsolidate,$trace_extract,$trace_other,$usage_before,$usage_after,$panel_delta,$cli_flags,$env_extra" >> "$DATA_DIR/results.csv"

    # 清理
    [ -n "$tmp_dir" ] && rm -rf "$tmp_dir"
}

# ═══════════════════════════════════════════════════════════════════════════════
# Phase: build-tracer
# ═══════════════════════════════════════════════════════════════════════════════

phase_build_tracer() {
    log "═══ Phase: Build Tracer ═══"
    log ""
    log "编译 packages/ai，确保 API-TRACE 代码在 dist 中生效..."
    log ""

    cd "$PROJECT_ROOT/packages/ai"
    npx tsc -p tsconfig.build.json 2>&1 | tail -3

    if grep -q "API-TRACE" "$PROJECT_ROOT/packages/ai/dist/stream.js" 2>/dev/null; then
        log "✓ 追踪器已就绪"
    else
        err "✗ 编译后仍未找到 API-TRACE，请检查 packages/ai/src/stream.ts"
    fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# Phase: baseline — 基准测试
# ═══════════════════════════════════════════════════════════════════════════════

phase_baseline() {
    log "═══ Phase: Baseline（基准测试）═══"
    log ""
    log "目标: 确定当前代码、当前记忆库状态下，一个简单任务需要多少 HTTP 调用"
    log "任务: $BENCHMARK_PROMPT"
    log ""
    sep

    check_tracer || return 1

    # 初始化 CSV
    if [ ! -f "$DATA_DIR/results.csv" ]; then
        echo "name,timestamp,duration_s,trace_total,trace_agent_loop,trace_reconsolidate,trace_extract,trace_other,usage_before,usage_after,panel_delta,cli_flags,env_extra" > "$DATA_DIR/results.csv"
    fi

    log ""
    log "Test 1/4: 真实环境（完整记忆库 + 全扩展 + MCP）"
    sep
    run_single_test "baseline-real-full" "" "" "0"
    sleep 3

    log "Test 2/4: 真实环境（完整记忆库 + 全扩展，无 MCP）"
    sep
    run_single_test "baseline-real-no-mcp" "--no-mcp" "" "0"
    sleep 3

    log "Test 3/4: 真实环境（无扩展、无 MCP = 裸核心）"
    sep
    run_single_test "baseline-real-bare" "--no-extensions --no-mcp" "" "0"
    sleep 3

    log "Test 4/4: 空记忆库（临时目录，全扩展，无 MCP）"
    sep
    run_single_test "baseline-empty-mem" "--no-mcp" "" "1"

    log ""
    sep
    log "═══ Baseline 完成 ═══"
    log ""
    log "请对比以上结果，关键判断点:"
    log "  • bare(无扩展) 应该是 2 次（1次read + 1次回复）"
    log "  • real-full vs bare 的差值 = 扩展+MCP 贡献的额外调用"
    log "  • empty-mem vs real-no-mcp = 记忆库状态的影响"
    log "  • 如果 panel_delta > trace_total → 有调用没被追踪到"
    log ""
    log "数据已保存: $DATA_DIR/results.csv"
}

# ═══════════════════════════════════════════════════════════════════════════════
# Phase: isolate-ext — 扩展细分隔离
# ═══════════════════════════════════════════════════════════════════════════════

phase_isolate_ext() {
    log "═══ Phase: Isolate-Ext（扩展细分隔离）═══"
    log ""
    log "目标: 逐个禁用扩展，对比哪个扩展贡献了额外的 HTTP 调用"
    log ""
    sep

    check_tracer || return 1

    if [ ! -f "$DATA_DIR/results.csv" ]; then
        echo "name,timestamp,duration_s,trace_total,trace_agent_loop,trace_reconsolidate,trace_extract,trace_other,usage_before,usage_after,panel_delta,cli_flags,env_extra" > "$DATA_DIR/results.csv"
    fi

    # 基线：全扩展（无MCP，排除MCP干扰）
    log "Test 1/6: 基线（全扩展，无 MCP）"
    sep
    run_single_test "ext-baseline" "--no-mcp" "" "0"
    sleep 3

    log "Test 2/6: 禁用 NanoMem"
    sep
    run_single_test "ext-skip-nanomem" "--no-mcp" "NANOPENCIL_SKIP_EXT_NANOMEM=1" "0"
    sleep 3

    log "Test 3/6: 禁用 Presence"
    sep
    run_single_test "ext-skip-presence" "--no-mcp" "NANOPENCIL_SKIP_EXT_PRESENCE=1" "0"
    sleep 3

    log "Test 4/6: 禁用 Soul"
    sep
    run_single_test "ext-skip-soul" "--no-mcp" "NANOPENCIL_SKIP_EXT_SOUL=1" "0"
    sleep 3

    log "Test 5/6: 禁用 Interview"
    sep
    run_single_test "ext-skip-interview" "--no-mcp" "NANOPENCIL_SKIP_EXT_INTERVIEW=1" "0"
    sleep 3

    log "Test 6/6: 禁用 NanoMem + Presence + Soul + Interview（只留核心）"
    sep
    run_single_test "ext-skip-all-llm" "--no-mcp" "NANOPENCIL_SKIP_EXT_NANOMEM=1 NANOPENCIL_SKIP_EXT_PRESENCE=1 NANOPENCIL_SKIP_EXT_SOUL=1 NANOPENCIL_SKIP_EXT_INTERVIEW=1" "0"

    log ""
    sep
    log "═══ Isolate-Ext 完成 ═══"
    log ""
    log "分析指南:"
    log "  • baseline - skip-X = X 扩展贡献的额外调用"
    log "  • 预期最大贡献者: NanoMem (reconsolidate + extract)"
    log "  • skip-all-llm 应该 ≈ bare (只有 agent-loop)"
    log ""
}

# ═══════════════════════════════════════════════════════════════════════════════
# Phase: idle — 挂机监控
# ═══════════════════════════════════════════════════════════════════════════════

phase_idle() {
    local duration_min="${1:-5}"

    log "═══ Phase: Idle（挂机监控）═══"
    log ""
    log "目标: 启动交互模式，不执行任何操作，监控 ${duration_min} 分钟内的 HTTP 调用"
    log ""
    log "原理:"
    log "  1. 先记录厂商面板起始值"
    log "  2. 启动交互模式（后台），让它挂机"
    log "  3. 到时间后杀进程，记录面板结束值"
    log "  4. Δ = 挂机期间的 HTTP 调用次数"
    log ""
    log "可能的挂机调用来源:"
    log "  • Presence idle timer（每4分钟无操作触发1次 LLM 问候）"
    log "  • NanoMem autoDream（turn_end 后检查是否需要巩固记忆）"
    log "  • Loop cron 定时任务"
    log ""
    sep

    local usage_before
    usage_before=$(query_minimax_usage)
    log "厂商面板起始: $usage_before"
    log ""
    log "启动交互模式（挂机 ${duration_min} 分钟）..."

    local stderr_file="$DATA_DIR/idle-${duration_min}min.stderr"
    local pid_file="$DATA_DIR/idle.pid"

    # 启动交互模式后台
    NANOPENCIL_TRACE_API=1 \
    npx tsx "$PROJECT_ROOT/cli.ts" --provider "$PROVIDER" --model "$MODEL" --no-mcp \
        2>"$stderr_file" &
    local bg_pid=$!
    echo "$bg_pid" > "$pid_file"

    log "PID: $bg_pid"
    log "等待 ${duration_min} 分钟..."
    log ""

    # 每分钟打印一次状态
    local elapsed=0
    while [ $elapsed -lt "$duration_min" ]; do
        sleep 60
        elapsed=$((elapsed + 1))
        local current_traces
        current_traces=$(grep -c "\[API-TRACE" "$stderr_file" 2>/dev/null || echo "0")
        local current_usage
        current_usage=$(query_minimax_usage)
        log "  [${elapsed}/${duration_min} min] trace=$current_traces, 面板=$current_usage"
    done

    # 杀进程
    log ""
    log "时间到，停止进程..."
    kill "$bg_pid" 2>/dev/null || true
    wait "$bg_pid" 2>/dev/null || true
    sleep 2

    # 最终统计
    local usage_after
    usage_after=$(query_minimax_usage)
    local trace_total
    trace_total=$(grep -c "\[API-TRACE" "$stderr_file" 2>/dev/null || echo "0")

    local panel_delta="?"
    if [ "$usage_before" != "?" ] && [ "$usage_after" != "?" ]; then
        panel_delta=$((usage_after - usage_before))
    fi

    log ""
    sep
    log "═══ Idle 结果 ═══"
    log ""
    log "  挂机时长:     ${duration_min} 分钟"
    log "  Trace 总计:   $trace_total"
    log "  厂商面板:     $usage_before → $usage_after (Δ=$panel_delta)"
    log ""

    if [ "$trace_total" -gt 0 ]; then
        log "调用来源:"
        grep "API-TRACE" "$stderr_file" | sed 's/\x1b\[[0-9;]*m//g' | head -20
    fi

    log ""
    log "完整日志: $stderr_file"
    log ""
    log "结论:"
    log "  Δ=0  → 挂机无额外调用"
    log "  Δ=1  → 可能是 Presence idle greeting（4分钟超时触发）"
    log "  Δ>2  → 有额外后台活动（dream/cron/retry）"

    # 记录
    echo "idle-${duration_min}min,$(date +'%Y-%m-%d %H:%M:%S'),${duration_min}m,$trace_total,0,0,0,$trace_total,$usage_before,$usage_after,$panel_delta,--no-mcp,IDLE" >> "$DATA_DIR/results.csv"
}

# ═══════════════════════════════════════════════════════════════════════════════
# Phase: patch-test — 修复方案 A/B 对比
# ═══════════════════════════════════════════════════════════════════════════════

phase_patch_test() {
    local patch_name="${1:-unnamed-patch}"

    log "═══ Phase: Patch-Test（修复方案验证：$patch_name）═══"
    log ""
    log "目标: 验证当前代码修改对 HTTP 调用次数的影响"
    log ""
    log "⚠️  请确认你已经 apply 了要测试的 patch"
    log "⚠️  如果修改了 packages/ai/src/，请先运行: $0 build-tracer"
    log ""
    sep

    check_tracer || return 1

    if [ ! -f "$DATA_DIR/results.csv" ]; then
        echo "name,timestamp,duration_s,trace_total,trace_agent_loop,trace_reconsolidate,trace_extract,trace_other,usage_before,usage_after,panel_delta,cli_flags,env_extra" > "$DATA_DIR/results.csv"
    fi

    log "Test 1/2: 真实环境（全扩展，无 MCP）"
    sep
    run_single_test "patch-${patch_name}-real" "--no-mcp" "" "0"
    sleep 3

    log "Test 2/2: 空记忆库（测试 reconsolidate 路径）"
    sep
    run_single_test "patch-${patch_name}-empty" "--no-mcp" "" "1"

    log ""
    sep
    log "═══ Patch-Test 完成 ═══"
    log ""
    log "对比 baseline 数据确认改善幅度:"
    log "  grep 'baseline\\|patch-${patch_name}' $DATA_DIR/results.csv | column -t -s,"
}

# ═══════════════════════════════════════════════════════════════════════════════
# Phase: report — 汇总报告
# ═══════════════════════════════════════════════════════════════════════════════

phase_report() {
    log "═══ HTTP Call Audit Report ═══"
    log ""

    if [ ! -f "$DATA_DIR/results.csv" ]; then
        err "没有数据。请先运行 baseline / isolate-ext / idle 等阶段。"
    fi

    local tmpjs="$DATA_DIR/report.cjs"
    cat > "$tmpjs" << 'ENDJS'
const fs = require('fs');
const path = require('path');
const dataDir = process.argv[2];
const csvPath = path.join(dataDir, 'results.csv');
const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
const headers = lines[0].split(',');
const rows = lines.slice(1).map(l => {
    const v = l.split(',');
    return {
        name: v[0], timestamp: v[1], duration: v[2],
        total: +v[3], agentLoop: +v[4], reconsolidate: +v[5],
        extract: +v[6], other: +v[7],
        usageBefore: v[8], usageAfter: v[9], panelDelta: v[10],
        cliFlags: v[11], envExtra: v[12]
    };
});

console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║             HTTP Call Audit — 数据汇总报告                           ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

console.log('┌──────────────────────────┬──────┬──────┬──────┬──────┬──────┬───────┐');
console.log('│ 测试名                   │ Total│ Loop │Recons│Extrac│Other │ Panel │');
console.log('├──────────────────────────┼──────┼──────┼──────┼──────┼──────┼───────┤');
rows.forEach(r => {
    const n = r.name.padEnd(24).slice(0, 24);
    const t = String(r.total).padStart(4);
    const l = String(r.agentLoop).padStart(4);
    const rc = String(r.reconsolidate).padStart(4);
    const ex = String(r.extract).padStart(4);
    const ot = String(r.other).padStart(4);
    const pd = String(r.panelDelta).padStart(5);
    console.log(`│ ${n} │ ${t} │ ${l} │ ${rc} │ ${ex} │ ${ot} │ ${pd} │`);
});
console.log('└──────────────────────────┴──────┴──────┴──────┴──────┴──────┴───────┘');

// 分析
console.log('\n── 分析 ──\n');

const baseline = rows.filter(r => r.name.startsWith('baseline-'));
const extTests = rows.filter(r => r.name.startsWith('ext-'));
const patchTests = rows.filter(r => r.name.startsWith('patch-'));
const idleTests = rows.filter(r => r.name.startsWith('idle-'));

if (baseline.length > 0) {
    const bare = baseline.find(r => r.name.includes('bare'));
    const full = baseline.find(r => r.name.includes('full'));
    const empty = baseline.find(r => r.name.includes('empty'));
    if (bare && full) {
        console.log(`  裸核心 (bare): ${bare.total} 次 HTTP`);
        console.log(`  全功能 (full): ${full.total} 次 HTTP`);
        console.log(`  扩展贡献:      +${full.total - bare.total} 次`);
    }
    if (empty) {
        const realNoMcp = baseline.find(r => r.name.includes('no-mcp'));
        if (realNoMcp) {
            console.log(`  真实记忆库:    ${realNoMcp.total} 次`);
            console.log(`  空记忆库:      ${empty.total} 次`);
            console.log(`  记忆库影响:    +${empty.total - realNoMcp.total} 次 (空库可能触发 reconsolidate)`);
        }
    }
}

if (extTests.length > 0) {
    console.log('\n  扩展影响分析:');
    const extBaseline = extTests.find(r => r.name === 'ext-baseline');
    if (extBaseline) {
        extTests.filter(r => r.name !== 'ext-baseline').forEach(r => {
            const delta = extBaseline.total - r.total;
            const label = delta > 0 ? `↓${delta}` : delta < 0 ? `↑${Math.abs(delta)}` : '=';
            console.log(`    ${r.name.padEnd(22)} ${r.total} 次 (${label} vs baseline)`);
        });
    }
}

if (patchTests.length > 0) {
    console.log('\n  修复方案对比:');
    patchTests.forEach(r => {
        console.log(`    ${r.name.padEnd(30)} ${r.total} 次 (panel: ${r.panelDelta})`);
    });
}

if (idleTests.length > 0) {
    console.log('\n  挂机测试:');
    idleTests.forEach(r => {
        console.log(`    ${r.name.padEnd(22)} trace=${r.total}, panel_delta=${r.panelDelta}`);
    });
}

console.log('\n── 结论 ──\n');
const hasReconsolidate = rows.some(r => r.reconsolidate > 0);
const hasIdleExtra = idleTests.some(r => +r.panelDelta > 0);

if (hasReconsolidate) {
    console.log('  ⚠️  检测到 reconsolidateIfNeeded 调用');
    console.log('     建议: 加 MAX_RECONSOLIDATE 上限 或 改为 fire-and-forget');
}
if (hasIdleExtra) {
    console.log('  ⚠️  挂机状态有额外 HTTP 调用');
    console.log('     来源: Presence idle timer (4min) 或 NanoMem autoDream');
}
if (!hasReconsolidate && !hasIdleExtra) {
    console.log('  ✓ 当前环境调用次数正常（2-3次/简单任务）');
    console.log('  如果厂商面板仍显示异常，可能需要:');
    console.log('    1. 用交互模式测试（而非 print 模式）');
    console.log('    2. 检查是否有 MCP server 持续发请求');
    console.log('    3. 用 idle phase 监控后台活动');
}

console.log('');
ENDJS

    node "$tmpjs" "$DATA_DIR"
}

# ═══════════════════════════════════════════════════════════════════════════════
# Phase: clean — 清除历史数据
# ═══════════════════════════════════════════════════════════════════════════════

phase_clean() {
    log "清除历史审计数据: $DATA_DIR"
    rm -f "$DATA_DIR/results.csv" "$DATA_DIR"/*.stderr "$DATA_DIR"/*.meta "$DATA_DIR/report.cjs"
    log "✓ 已清除"
}

# ═══════════════════════════════════════════════════════════════════════════════
# 入口
# ═══════════════════════════════════════════════════════════════════════════════

phase="${1:-}"
shift 2>/dev/null || true

case "$phase" in
    build-tracer)
        phase_build_tracer
        ;;
    baseline)
        phase_baseline
        ;;
    isolate-ext)
        phase_isolate_ext
        ;;
    idle)
        phase_idle "${1:-5}"
        ;;
    patch-test)
        phase_patch_test "${1:-unnamed}"
        ;;
    report)
        phase_report
        ;;
    clean)
        phase_clean
        ;;
    *)
        echo "╔══════════════════════════════════════════════════════════════╗"
        echo "║  http-call-audit.sh — HTTP 调用次数系统性审计               ║"
        echo "╚══════════════════════════════════════════════════════════════╝"
        echo ""
        echo "用法: $0 <phase> [args]"
        echo ""
        echo "Phase:"
        echo "  build-tracer     编译 ai 包，确保追踪器就绪"
        echo "  baseline         基准测试（真实环境 vs 裸核心 vs 空记忆库）"
        echo "  isolate-ext      逐个扩展隔离对比"
        echo "  idle [minutes]   挂机监控（默认 5 分钟）"
        echo "  patch-test [name] 修复方案 A/B 验证"
        echo "  report           汇总报告"
        echo "  clean            清除历史数据"
        echo ""
        echo "推荐执行流程:"
        echo "  1. $0 build-tracer              # 确保追踪器编译"
        echo "  2. $0 baseline                  # 基准数据（4组对比）"
        echo "  3. $0 isolate-ext               # 定位是哪个扩展"
        echo "  4. $0 idle 10                   # 挂机 10 分钟监控"
        echo "  5. $0 report                    # 查看汇总报告"
        echo ""
        echo "修复验证流程:"
        echo "  6. (手动修改代码，如加 MAX_RECONSOLIDATE)"
        echo "  7. $0 build-tracer              # 重新编译"
        echo "  8. $0 patch-test max-reconsolidate  # 验证修复效果"
        echo "  9. $0 report                    # 对比前后数据"
        echo ""
        echo "环境变量:"
        echo "  NANOPENCIL_MODEL     模型 ID（默认 MiniMax-M2.5）"
        echo "  NANOPENCIL_PROVIDER  Provider（默认 minimax-coding）"
        echo ""
        echo "数据目录: $DATA_DIR"
        exit 1
        ;;
esac
