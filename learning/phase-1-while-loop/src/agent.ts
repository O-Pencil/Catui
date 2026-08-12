/**
 * [WHO]: Agent Loop 核心循环（跨平台共享）
 * [FROM]: openai SDK（API 调用）、./tools.ts（使者清单）
 * [TO]: caturn.tsx（TUI）、未来的 CLI 入口
 * [HERE]: learning/phase-1-while-loop/src/agent.ts
 *
 * 这是 caturn 最核心的一段——agent loop 跨 TUI / CLI 不变。
 * 任何"长相"（TUI、纯打印、RPC）都用同一个 agentLoop。
 */

import OpenAI from 'openai';
import { tools, executeTool, formatReport } from './tools.ts';

export const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
});

/**
 * 自定义错误：用户中断（Esc）
 * 让调用方能区分"用户主动中断"和"真的出错"
 */
export class AbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

/**
 * Agent Loop：把日记本递给囚徒，根据他的反应决定下一步
 *
 * @param messages - 日记本（含 system + 所有历史消息）
 * @param onChunk - 每收到一个文本 chunk 时调用（用于打字机效果）
 * @param onToolCall - 模型决定调工具时调用（用于 UI 显示）
 * @param signal - AbortSignal，传 AbortController.signal，按 Esc 时 abort
 * @returns 最终答案
 */
export async function agentLoop(
  messages: any[],
  onChunk: (chunk: string) => void,
  onToolCall: (call: any) => void,
  signal: AbortSignal,
): Promise<string> {
  while (true) {
    if (signal.aborted) throw new AbortError();

    const stream: any = await client.chat.completions.create({
      model: 'qwen3.7-plus',
      messages,
      tools,
      stream: true,
    });

    const msg: any = { role: 'assistant', content: '', tool_calls: [] };
    const toolCallChunks: Record<number, any> = {};
    let finishReason: string | null = null;
    let abortedDuringStream = false;

    for await (const chunk of stream) {
      // 每个 chunk 开头检查：是否被用户中断
      if (signal.aborted) {
        abortedDuringStream = true;
        stream.controller?.abort(); // 关底层 HTTP 连接（保险）
        break;
      }

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        msg.content += delta.content;
        onChunk(delta.content);
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallChunks[idx]) {
            toolCallChunks[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
          }
          if (tc.id) toolCallChunks[idx].id = tc.id;
          if (tc.function?.name) toolCallChunks[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCallChunks[idx].function.arguments += tc.function.arguments;
        }
      }
      if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
    }

    msg.tool_calls = Object.values(toolCallChunks);

    // 中断时保留已收内容到历史
    if (abortedDuringStream) {
      if (msg.content) messages.push(msg);
      throw new AbortError();
    }

    messages.push(msg);

    if (finishReason === 'tool_calls' && msg.tool_calls.length > 0) {
      for (const call of msg.tool_calls) {
        if (signal.aborted) throw new AbortError();

        const args = JSON.parse(call.function.arguments);
        onToolCall({ name: call.function.name, args });
        const result = await executeTool(call.function.name, args);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: formatReport(result),
        });
      }
      continue;
    }

    return msg.content;
  }
}