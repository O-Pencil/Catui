/**
 * 纯流式测试（不 abort）
 */
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
});

async function main() {
  console.log('[main] 启动流式...');
  const stream = await client.chat.completions.create({
    model: 'qwen3.7-plus',
    messages: [
      { role: 'system', content: '你是一个简洁的助手。' },
      { role: 'user', content: '说一句话。' },
    ],
    stream: true,
  });

  let chunkCount = 0;
  let totalLength = 0;
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) {
      chunkCount++;
      totalLength += delta.content.length;
      if (chunkCount === 1) console.log('[main] 收到第一个 chunk');
    }
  }
  console.log(`[main] 流式完成，${chunkCount} chunks, ${totalLength} chars`);
}

main();