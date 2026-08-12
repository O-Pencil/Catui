/**
 * [WHO]: 端到端场景测试——真实场景跑完整链路
 * [FROM]: src/agent.ts、fs
 * [TO]: test/run-all.tsx
 * [HERE]: learning/phase-1-while-loop/test/unit/e2e.tsx
 */

import { agentLoop } from '../../src/agent.ts';
import * as fs from 'fs';
import * as path from 'path';

type TestResult = { pass: number; fail: number; errors: string[] };

const TEST_DIR = '/tmp/caturn-e2e';

function ensureTestDir() {
  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.readdirSync(TEST_DIR).forEach((f) => fs.unlinkSync(path.join(TEST_DIR, f)));
  }
}

async function test(name: string, fn: () => Promise<void>): Promise<{ ok: boolean; error?: string }> {
  try {
    await fn();
    process.stderr.write(`  · ${name}\n    ✅ 通过\n`);
    return { ok: true };
  } catch (err: any) {
    process.stderr.write(`  · ${name}\n    ❌ 失败: ${err.message?.slice(0, 200) || err}\n`);
    return { ok: false, error: `${name}: ${err.message?.slice(0, 200)}` };
  }
}

function assert(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}

export async function runE2ETests(): Promise<TestResult> {
  const result: TestResult = { pass: 0, fail: 0, errors: [] };
  ensureTestDir();
  cleanup();

  // 场景 1: 写文件 → 验证
  const r1 = await test('场景 1：让 AI 写 hello.txt 并验证内容', async () => {
    const filePath = path.join(TEST_DIR, 'hello.txt');
    const messages: any[] = [{
      role: 'user',
      content: `用 write 工具在 '${TEST_DIR}/hello.txt' 写一个文件，内容是 "hello caturn"。只写这个文件。`,
    }];

    await agentLoop(
      messages,
      () => {},
      () => {},
      new AbortController().signal,
    );

    assert(fs.existsSync(filePath), `文件 ${filePath} 应存在`);
    const content = fs.readFileSync(filePath, 'utf8');
    assert(content.includes('hello caturn'), `文件内容应含 "hello caturn"，实际: ${content}`);
  });
  r1.ok ? result.pass++ : (result.fail++, result.errors.push(r1.error!));
  cleanup();

  // 场景 2: 读文件 → 修改 → 验证
  const r2 = await test('场景 2：让 AI 读文件后用 edit 改一个词', async () => {
    const filePath = path.join(TEST_DIR, 'greet.txt');
    fs.writeFileSync(filePath, 'hello world\n', 'utf8');

    const messages: any[] = [{
      role: 'user',
      content: `读取 '${filePath}'，然后用 edit 工具把 "world" 改成 "caturn"。只做这一个修改。`,
    }];

    await agentLoop(
      messages,
      () => {},
      () => {},
      new AbortController().signal,
    );

    const content = fs.readFileSync(filePath, 'utf8');
    assert(content.includes('caturn'), `文件应包含 caturn，实际: ${content}`);
    assert(!content.includes('world'), `文件不应再包含 world，实际: ${content}`);
  });
  r2.ok ? result.pass++ : (result.fail++, result.errors.push(r2.error!));
  cleanup();

  // 场景 3: 多工具协作（read + grep）
  const r3 = await test('场景 3：让 AI 搜文件里的字符串', async () => {
    const filePath = path.join(TEST_DIR, 'multi.txt');
    fs.writeFileSync(filePath, 'apple\nbanana\ncherry\napple pie\n', 'utf8');

    const messages: any[] = [{
      role: 'user',
      content: `用 grep 工具在 '${filePath}' 搜 "apple"，告诉我哪些行有。`,
    }];

    let toolCalls: any[] = [];
    await agentLoop(
      messages,
      () => {},
      (call) => toolCalls.push(call),
      new AbortController().signal,
    );

    assert(toolCalls.length >= 1, `应调工具，实际 ${toolCalls.length} 次`);
    assert(toolCalls.some((c) => c.name === 'grep'), `应调 grep 工具，实际: ${toolCalls.map((c) => c.name).join(', ')}`);
  });
  r3.ok ? result.pass++ : (result.fail++, result.errors.push(r3.error!));
  cleanup();

  // 场景 4: 错误恢复（读不存在的文件）
  const r4 = await test('场景 4：让 AI 读不存在的文件，应优雅处理', async () => {
    const messages: any[] = [{
      role: 'user',
      content: `用 read 工具读 '${TEST_DIR}/nonexistent.txt'，告诉我结果。`,
    }];

    let errorReported = false;
    await agentLoop(
      messages,
      (chunk) => {
        // 检测回复中提到错误
        if (chunk.includes('不存在') || chunk.includes('ENOENT') || chunk.includes('找不到')) {
          errorReported = true;
        }
      },
      () => {},
      new AbortController().signal,
    );

    // 模型应该把错误信息告诉用户
    assert(errorReported, '模型应在回复中提到文件不存在/找不到');
  });
  r4.ok ? result.pass++ : (result.fail++, result.errors.push(r4.error!));
  cleanup();

  process.stderr.write(`  TOTAL: ${result.pass} pass, ${result.fail} fail\n`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runE2ETests().then((r) => {
    cleanup();
    process.exit(r.fail === 0 ? 0 : 1);
  });
}