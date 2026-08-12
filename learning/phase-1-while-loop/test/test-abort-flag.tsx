/**
 * 真正测试 abort：流开始 + abort 中断
 */
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
});

async function main() {
  console.log('[main] 启动');
  const controller = new AbortController();

  console.log('[main] 调用 API...');
  const stream = await client.chat.completions.create({
    model: 'qwen3.7-plus',
    messages: [
      { role: 'system', content: '你是助手。' },
      { role: 'user', content: '说一句话。' },
    ],
    stream: true,
  });
  console.log('[main] API 返回 stream');

  let totalContent = '';
  let chunkCount = 0;
  let aborted = false;

  let isAborted = false;

  setTimeout(() => {
    console.log('\n[超时] 10秒兜底，强制退出');
    process.exit(0);
  }, 10000);

  try {
    for await (const chunk of stream) {
      // 关键：每个 chunk 开头检查 isAborted，break 退出循环
      if (isAborted) {
        console.log('[循环] isAborted=true，break');
        break;
      }
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        totalContent += delta.content;
        chunkCount++;
        if (chunkCount === 1) {
          console.log('[循环] 收到第一个 chunk，标记 isAborted=true');
          isAborted = true;
          // 顺便调 controller.abort() 让 HTTP 连接关掉（保险）
          const streamController = (stream as any).controller as AbortController | undefined;
          streamController?.abort();
        }
      }
    }
  } catch (err: any) {
    console.log('[循环] 异常:', err.message);
  }
  console.log(`\n=== 收到 ${chunkCount} chunks, ${totalContent.length} 字符 ===`);

  console.log(`\n=== 收到 ${chunkCount} chunks, ${totalContent.length} 字符 ===`);
  console.log(`预览: ${totalContent.slice(0, 200)}`);
}

main();