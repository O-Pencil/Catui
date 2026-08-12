/**
 * [WHO]: 统一测试 runner——按层跑所有测试，输出汇总
 * [FROM]: ./unit/tools.tsx
 * [TO]: npm run test
 * [HERE]: learning/phase-1-while-loop/test/run-all.tsx
 *
 * 三层测试：
 *   1. 工具层 —— 6 工具单独调用（不调 API）
 *   2. Agent 层 —— agentLoop 行为（要 API）
 *   3. TUI 层 —— 组件渲染（要 API）
 *   4. E2E —— 真实场景（要 API）
 */

import { runToolTests } from './unit/tools.tsx';
import { runAgentTests } from './unit/agent.tsx';
import { runTuiTests } from './unit/tui.tsx';
import { runE2ETests } from './unit/e2e.tsx';

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  caturn 测试套件                                    ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  const results: Record<string, { pass: number; fail: number; errors: string[] }> = {};

  // 1. 工具层（纯本地，不调 API）
  console.log('━━━ 1️⃣  工具层（不调 API）━━━');
  results.tools = await runToolTests();

  // 2. agent 层（要 API）
  if (process.env.DASHSCOPE_API_KEY) {
    console.log('\n━━━ 2️⃣  Agent 层（要 API）━━━');
    results.agent = await runAgentTests();

    console.log('\n━━━ 3️⃣  TUI 层（要 API）━━━');
    results.tui = await runTuiTests();

    console.log('\n━━━ 4️⃣  E2E（要 API）━━━');
    results.e2e = await runE2ETests();
  } else {
    console.log('\n⚠️  没设 DASHSCOPE_API_KEY，跳过 2/3/4 层测试');
  }

  // 汇总
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  汇总                                                ║');
  console.log('╚════════════════════════════════════════════════════╝');
  let totalPass = 0, totalFail = 0;
  for (const [name, r] of Object.entries(results)) {
    const status = r.fail === 0 ? '✅' : '❌';
    console.log(`  ${status} ${name}: ${r.pass} pass, ${r.fail} fail`);
    totalPass += r.pass;
    totalFail += r.fail;
    if (r.errors.length > 0) {
      r.errors.forEach((e) => console.log(`     - ${e}`));
    }
  }
  console.log(`\n  TOTAL: ${totalPass} pass, ${totalFail} fail`);

  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Runner crashed:', err);
  process.exit(1);
});