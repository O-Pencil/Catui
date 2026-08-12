/**
 * 直接测 agentLoop 的 abort 逻辑
 */
import OpenAI from 'openai';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);
const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
});

const tools: any[] = [];

class AbortError extends Error {
  constructor() { super('aborted'); this.name = 'AbortError'; }
}

async function agentLoop(messages: any[], signal: AbortSignal): Promise<string> {
  while (true) {
    if (signal.aborted) throw new AbortError();

    console.log('[agentLoop] 启动流式...');
    const stream = await client.chat.completions.create({
      model: 'qwen3.7-plus',
      messages,
      tools,
      stream: true,
    });

    const msg: any = { role: 'assistant', content: '', tool_calls: [] };
    let finishReason = null;
    let chunkCount = 0;

    try {
      for await (const chunk of stream) {
        if (signal.aborted) {
          console.log('[agentLoop] 收到 abort 信号，停止');
          stream.controller?.abort();
          throw new AbortError();
        }

        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          msg.content += delta.content;
          chunkCount++;
          if (chunkCount % 20 === 0) {
            console.log(`[chunk ${chunkCount}] content length: ${msg.content.length}`);
          }
        }
        if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
      }
    } catch (err: any) {
      if (signal.aborted) throw new AbortError();
      throw err;
    }

    console.log(`[agentLoop] 流式完成，共 ${chunkCount} chunks`);
    msg.tool_calls = [];
    if (signal.aborted && msg.content) {
      messages.push(msg);
      throw new AbortError();
    }
    messages.push(msg);
    return msg.content;
  }
}

async function main() {
  const messages = [
    { role: 'system', content: '你是一个简洁的代码助手。' },
    { role: 'user', content: '详细解释 agent loop 的工作原理，分成 10 段。' },
  ];

  const controller = new AbortController();
  // 等到收到第一个 chunk 后再 abort
  let aborted = false;
  // 30 秒后兜底 abort
  setTimeout(() => {
    if (!aborted) {
      console.log('\n[主线程] 30秒兜底 abort');
      aborted = true;
      controller.abort();
    }
  }, 30000);

  try {
    const result = await agentLoop(messages, controller.signal);
    console.log('\n=== 完整结果（不 abort）===');
    console.log(result);
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log('\n=== ✅ 成功中断 ===');
      console.log(`已收到的内容长度: ${messages[messages.length - 1]?.content?.length || 0}`);
      console.log(`预览: ${messages[messages.length - 1]?.content?.slice(0, 200)}...`);
    } else {
      console.error('错误:', err);
    }
  }
}

main();