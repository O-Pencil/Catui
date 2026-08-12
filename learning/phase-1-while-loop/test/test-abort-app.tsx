/**
 * 直接测 caturn agentLoop 的 abort 逻辑
 */
import { agentLoop } from '../src/agent.ts';

const messages: any[] = [
  { role: 'system', content: '你是助手。' },
  { role: 'user', content: '详细解释 agent loop 的工作原理，分成 10 段。' },
];

const controller = new AbortController();

// 30 秒后 abort（足够长问题出第一个 chunk）
setTimeout(() => {
  console.log('\n[主线程] 30 秒后 abort');
  controller.abort();
}, 30000);

let chunkCount = 0;
let totalContent = '';

try {
  const result = await agentLoop(
    messages,
    (chunk) => {
      chunkCount++;
      totalContent += chunk;
      if (chunkCount === 1) console.log('[onChunk] 收到第一个 chunk');
      if (chunkCount % 20 === 0) console.log(`[chunk ${chunkCount}] total: ${totalContent.length}`);
    },
    (tool) => console.log('[onTool]', tool),
    controller.signal,
  );
  console.log('\n=== 完成 ===');
  console.log(result);
} catch (err: any) {
  if (err.name === 'AbortError') {
    console.log('\n=== ✅ 成功中断 ===');
    console.log(`收到 ${chunkCount} chunks, ${totalContent.length} 字符`);
    console.log(`预览: ${totalContent.slice(0, 150)}...`);
  } else {
    console.error('错误:', err.message);
  }
}