/**
 * [WHO]: Agent Loop 核心循环（跨平台共享）
 * [FROM]: openai SDK（API 调用）、./tools.ts（使者清单）
 * [TO]: caturn.tsx（TUI）、未来的 CLI 入口
 * [HERE]: learning/phase-1-while-loop/src/agent.ts
 *
 * ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
 * ┃  囚徒与使者：本文件是整个比喻的核心                             ┃
 * ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
 *
 *  想象 AI 模型是一个被关在监狱里的囚徒：
 *    ✦ 囚徒很聪明，能读懂你的问题，能想清楚怎么回答
 *    ✦ 但囚徒出不去监狱——他自己读不了文件、跑不了命令
 *    ✦ 囚徒的"手脚"是使者（tools），活跃在监狱外面
 *    ✦ 每次对话都得把"日记本"整本给他——他没记忆
 *
 *  这个文件的 agentLoop 就是"跟囚徒来回对话"的流程：
 *    1. 把日记本递给囚徒
 *    2. 看他说啥：
 *       a. "我要派使者" → 派使者 → 报告塞回日记本 → 回到 1
 *       b. "我想完了，答案给你" → 跳出循环
 *
 *  关键：
 *    - 工具实现不在这里（看 src/tools.ts）
 *    - UI 怎么显示不在这里（看 caturn.tsx）
 *    - 这里只关心"跟模型对话的业务流程"
 */

import OpenAI from 'openai';
import { tools, executeTool, formatReport } from './tools.ts';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 客户端连接（狱卒：负责把纸条递给囚徒，把回复读出来）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// baseURL 指向阿里百炼 coding plan 的"牢房"
// apiKey 是"通行证"，没它狱卒不放行
export const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 自定义错误：用户中断（按了 Esc）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 为什么不用普通 Error？
//   因为 Esc 中断和"网络挂了"是两回事——调用方要能区分
//   比如 UI：Esc 中断要显示"⏹ 已中断"，网络挂了要显示"❌ 报错"
export class AbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

/**
 * Agent Loop：跟囚徒来回对话直到他给最终答案
 *
 * @param messages - 日记本（包含 system + 所有历史 user/assistant/tool 消息）
 *                   注意：传进去后会被修改（每轮结束会 push 消息进去）
 * @param onChunk - 每收到一个文本片段时调用（用于"打字机"效果）
 *                 收到一个字符就调一次
 * @param onToolCall - 囚徒决定调工具时调用（用于 UI 显示"AI 在用 XX 工具"）
 * @param signal - AbortController 的信号，传 .signal 进来
 *                按 Esc 时调 controller.abort()，这个 signal 会变 true
 * @returns 最终答案（字符串）
 *
 * @throws AbortError - 用户按了 Esc，中断当前循环
 * @throws 其他 Error - 网络错误、API 错误等
 *
 * 流程一图流：
 *
 *   while (true) {
 *     if (信号说要停) throw AbortError;       ← 用户按 Esc 了
 *
 *     问囚徒："你下一步想干啥？"
 *     reply = await client.chat.completions.create({ stream: true })
 *
 *     一边生成一边把字吐出来（流式）：
 *     for await (chunk of reply) {
 *       if (信号说要停) break;               ← 立刻打断
 *       if (chunk 是文字) {
 *         拼到 msg.content
 *         onChunk(chunk.content)              ← 告诉 UI "我生成一个字"
 *       }
 *       if (chunk 是工具调用) {
 *         拼到 msg.tool_calls
 *       }
 *     }
 *
 *     把模型这一轮的发言记进日记本
 *     messages.push(msg)
 *
 *     if (msg 含工具调用) {
 *       for (每个工具调用) {
 *         让使者去现实世界跑（executeTool）
 *         把结果塞回日记本
 *       }
 *       continue;                              ← 回到循环开头，让囚徒重新看日记本
 *     } else {
 *       return msg.content;                    ← 囚徒给最终答案了，结束
 *     }
 *   }
 */
export async function agentLoop(
  messages: any[],
  onChunk: (chunk: string) => void,
  onToolCall: (call: any) => void,
  signal: AbortSignal,
): Promise<string> {
  while (true) {
    // ── 进循环第一件事：检查用户有没有按 Esc ──
    // 如果信号说要停，立刻抛 AbortError 退出
    // 注意：检查必须放在"调 API 之前"，避免浪费一次 API 调用
    if (signal.aborted) throw new AbortError();

    // ── 问囚徒：把日记本递给他，让他决定下一步 ──
    // stream: true 表示"边生成边推"，不要等全部生成完一次性返回
    // 这样我们才能一边打字一边判断用户是否按了 Esc
    const stream: any = await client.chat.completions.create({
      model: 'qwen3.7-plus',
      messages,  // 日记本
      tools,     // 可用使者清单
      stream: true,
    });

    // ── 准备一个空 msg 对象，把流式 chunk 一点点拼进来 ──
    // 流式返回的是"增量"（delta），不是完整消息
    // 我们把所有 delta 拼起来，模拟出跟非流式一样的 msg 对象
    const msg: any = { role: 'assistant', content: '', tool_calls: [] };

    // 工具调用是按 chunk 分片发的，需要按 index 聚合
    // 譬如模型决定调 2 个工具，第 1 块 chunk 可能只有 tool_call #0 的开头
    // 第 2 块才是 #0 的完整参数 + #1 的开头
    // 所以用 Record<index, chunk> 聚合
    const toolCallChunks: Record<number, any> = {};

    // finishReason 告诉我们这一轮是"调工具"还是"给答案"
    // 'tool_calls' = 调工具；'stop' = 给答案
    let finishReason: string | null = null;

    // 标记：流式过程中是否被中断
    // 跟后面的"工具调用阶段的中断"区分开
    let abortedDuringStream = false;

    // ── 流式消费：边收字边交给 UI 显示 ──
    for await (const chunk of stream) {
      // 每个 chunk 开头检查：用户有没有按 Esc？
      // OpenAI SDK 的 stream 不会响应 controller.abort()，
      // 所以必须靠我们手动检查 + break
      if (signal.aborted) {
        abortedDuringStream = true;
        // 顺便调 controller.abort() 让底层 HTTP 连接关掉（保险）
        stream.controller?.abort();
        break; // 跳出循环，不再处理后续 chunk
      }

      // chunk.choices[0]?.delta 是这一块的增量
      // 注意：可能 chunk 没内容（譬如只是 finish_reason），要跳过
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // ── 文本增量：拼到 msg.content，同时调 onChunk ──
      if (delta.content) {
        msg.content += delta.content;
        onChunk(delta.content); // 告诉 UI："我生成了一个字"
      }

      // ── 工具调用增量：按 index 聚合 ──
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index; // 哪个工具调用
          if (!toolCallChunks[idx]) {
            // 第一次见到这个 idx，初始化空槽
            toolCallChunks[idx] = {
              id: tc.id || '',
              type: 'function',
              function: { name: '', arguments: '' },
            };
          }
          // 累加字段（流的同一字段可能分多次发）
          if (tc.id) toolCallChunks[idx].id = tc.id;
          if (tc.function?.name) toolCallChunks[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCallChunks[idx].function.arguments += tc.function.arguments;
        }
      }

      // 这一块的结束原因
      if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
    }

    // 把聚合后的工具调用列表挂到 msg 上
    msg.tool_calls = Object.values(toolCallChunks);

    // ── 中断时，保留已收内容到日记本 ──
    // 为什么保留？
    //   用户已经看到的内容，扔掉就浪费了
    //   下次接着聊（如果是新会话就忽略），也起码知道"上一轮咱聊到哪了"
    if (abortedDuringStream) {
      if (msg.content) messages.push(msg);
      throw new AbortError();
    }

    // ── 正常结束：把囚徒这一轮的发言记进日记本 ──
    // 不管是"调工具"还是"给最终答案"，都要记
    // 不记的话，下次问之前囚徒翻日记本会看到空白，他会困惑
    messages.push(msg);

    // ── 判断：囚徒是要调工具，还是给最终答案？──
    if (finishReason === 'tool_calls' && msg.tool_calls.length > 0) {
      // ── 囚徒要派使者！一个一个派 ──
      for (const call of msg.tool_calls) {
        // 用户新按 Esc 也要立刻响应
        if (signal.aborted) throw new AbortError();

        // call.function.arguments 是 JSON 字符串，要 parse 才能用
        const args = JSON.parse(call.function.arguments);

        // 告诉 UI："AI 决定调 XX 工具"
        onToolCall({ name: call.function.name, args });

        // 让使者去现实世界干活
        const result = await executeTool(call.function.name, args);

        // 把结果格式化（成功/失败不同格式）后塞回日记本
        // role: 'tool' 是 OpenAI 协议，意思是"这是一条工具结果"
        // tool_call_id 对应到囚徒刚才说要调的那个工具（一一对应）
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: formatReport(result),
        });
      }

      // ── 继续循环：让囚徒重新看日记本（含刚塞进去的报告）──
      // 囚徒可能：
      //   - 再派使者（譬如 read 完后说"我还要 grep"）
      //   - 给最终答案（"我想完了，告诉你答案"）
      //   - 报告看不懂，再派一次
      continue;
    }

    // ── 囚徒给最终答案了 ──
    // finishReason 不是 'tool_calls'，说明这一轮囚徒直接给了答案
    // 内容已经在流式时通过 onChunk 传给 UI 了
    // 这里只返回内容（UI 那边自己保存）
    return msg.content;
  }
}