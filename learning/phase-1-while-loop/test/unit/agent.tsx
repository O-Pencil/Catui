/**
 * [WHO]: runAgentTests() —— Agent Loop 层真实 API 集成测试
 * [FROM]: src/agent.ts（agentLoop + AbortError）、AbortController
 * [TO]: test/run-all.tsx（被统一 runner 调用）
 * [HERE]: learning/phase-1-while-loop/test/unit/agent.tsx
 */

import { AbortError, agentLoop } from '../../src/agent.ts';

interface TestCase {
  name: string;
  fn: () => Promise<void>;
}

const tests: TestCase[] = [
  {
    name: '直接答',
    fn: async () => {
      // 明确不调工具的简单问题——纯闲聊
      const messages: any[] = [{ role: 'user', content: '你好，请只回一个词：OK' }];
      let toolCalls = 0;
      const result = await withTimeout(agentLoop(
        messages,
        () => {},
        () => { toolCalls++; },
        new AbortController().signal,
      ));
      assert(toolCalls === 0, `不应调工具，实际调用 ${toolCalls} 次`);
      assert(result.length > 0, `答案不应为空`);
    },
  },
  {
    name: '调一次工具',
    fn: async () => {
      const messages: any[] = [{ role: 'user', content: '用 bash 跑 echo 42 告诉我结果' }];
      const calls: any[] = [];
      await withTimeout(agentLoop(
        messages,
        () => {},
        (call) => calls.push(call),
        new AbortController().signal,
      ));
      assert(calls.length >= 1, 'onToolCall 至少应触发一次');
      const toolMessages = messages.filter((message) => message.role === 'tool');
      assert(toolMessages.length >= 1, 'messages 应包含工具结果');
      for (const message of toolMessages) {
        assert(
          calls.some((call) => call.name === 'bash' && message.tool_call_id),
          `tool_call_id 未正确关联: ${JSON.stringify(message)}`,
        );
      }
    },
  },
  {
    name: '多次工具调度',
    fn: async () => {
      const messages: any[] = [{ role: 'user', content: 'ls 当前目录，然后 cat 第一个 js 文件' }];
      let toolCalls = 0;
      await withTimeout(agentLoop(
        messages,
        () => {},
        () => { toolCalls++; },
        new AbortController().signal,
      ));
      assert(toolCalls >= 2, `onToolCall 应触发至少 2 次，实际 ${toolCalls} 次`);
    },
  },
  {
    name: 'abort 保留已收内容',
    fn: async () => {
      const messages: any[] = [{ role: 'user', content: '详细解释 agent loop 分 10 段' }];
      const controller = new AbortController();
      let chunkCount = 0;
      let chunkReceived = false;
      const pending = agentLoop(
        messages,
        () => {
          chunkCount++;
          chunkReceived = true;
        },
        () => {},
        controller.signal,
      );
      // 收到第一个 chunk 后 100ms 才 abort
      const checkAbort = () => {
        if (chunkReceived) {
          setTimeout(() => controller.abort(), 100);
        } else {
          setTimeout(checkAbort, 200);
        }
      };
      checkAbort();
      let error: unknown;
      try {
        await withTimeout(pending);
      } catch (err) {
        error = err;
      }
      assert(error instanceof AbortError, `应抛 AbortError，实际: ${error instanceof Error ? error.name : String(error)}`);
      assert(chunkCount > 0, `应收到至少一个 chunk，实际 ${chunkCount}`);
      const lastMessage = messages[messages.length - 1];
      assert(lastMessage?.role === 'assistant', 'messages 最后一条应是 assistant 消息');
      assert(typeof lastMessage.content === 'string' && lastMessage.content.length > 0, '最后一条应保留已收到内容');
    },
  },
  {
    name: 'abort 立即触发',
    fn: async () => {
      const messages: any[] = [{ role: 'user', content: 'hello' }];
      const controller = new AbortController();
      controller.abort();
      let called = false;
      let error: unknown;
      try {
        await withTimeout(agentLoop(messages, () => {}, () => { called = true; }, controller.signal));
      } catch (err) {
        error = err;
      }
      assert(error instanceof AbortError, `应立刻抛 AbortError，实际: ${error instanceof Error ? error.name : String(error)}`);
      assert(!called, '立即 abort 不应调用工具');
      assert(messages.length === 1, '立即 abort 不应修改 messages');
    },
  },
];

function assert(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('测试超时（60 秒）')), 60_000);
    }),
  ]);
}

export async function runAgentTests(): Promise<{ pass: number; fail: number; errors: string[] }> {
  let pass = 0;
  let fail = 0;
  const errors: string[] = [];

  for (const test of tests) {
    process.stdout.write(`  · ${test.name}\n`);
    try {
      await test.fn();
      pass++;
      process.stdout.write('    ✅ 通过\n');
    } catch (error) {
      fail++;
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${test.name}: ${reason}`);
      process.stdout.write(`    ❌ 失败: ${reason}\n`);
    }
  }

  return { pass, fail, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAgentTests().then((result) => {
    console.log(`\n  TOTAL: ${result.pass} pass, ${result.fail} fail`);
    if (result.errors.length > 0) {
      console.log('\n  errors:');
      result.errors.forEach((error) => console.log(`    - ${error}`));
    }
    process.exit(result.fail === 0 ? 0 : 1);
  });
}
