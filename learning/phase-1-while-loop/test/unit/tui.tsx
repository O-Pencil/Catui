/**
 * [WHO]: TUI 组件渲染测试
 * [FROM]: caturn.tsx（App 组件）、ink-testing-library
 * [TO]: test/run-all.tsx
 * [HERE]: learning/phase-1-while-loop/test/unit/tui.tsx
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { App } from '../../caturn.tsx';

type TestResult = { pass: number; fail: number; errors: string[] };

async function test(name: string, fn: () => Promise<void> | void): Promise<{ ok: boolean; error?: string }> {
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

export async function runTuiTests(): Promise<TestResult> {
  const result: TestResult = { pass: 0, fail: 0, errors: [] };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  process.stderr.write('TUI 测试开始...\n');

  // 1. 初始渲染：包含 banner + 输入框
  const r1 = await test('初始渲染：包含 banner 和输入框', async () => {
    const { lastFrame, unmount } = render(React.createElement(App));
    await sleep(100);
    const frame = lastFrame();
    assert(frame.includes('caturn'), 'frame 应包含 caturn');
    assert(frame.includes('问我点啥') || frame.includes('TUI'), 'frame 应包含输入框 placeholder 或 TUI 标识');
    assert(frame.includes('╭') || frame.includes('┌'), 'frame 应有边框');
    unmount();
    await sleep(100);
  });
  r1.ok ? result.pass++ : (result.fail++, result.errors.push(r1.error!));

  // 2. 输入框可以接收输入
  const r2 = await test('输入框可接收文本', async () => {
    const { lastFrame, stdin, unmount } = render(React.createElement(App));
    await sleep(100);
    stdin.write('hello test');
    await sleep(200);
    const frame = lastFrame();
    assert(frame.includes('hello test') || frame.includes('hello'), '输入框应显示输入的文本');
    unmount();
    await sleep(100);
  });
  r2.ok ? result.pass++ : (result.fail++, result.errors.push(r2.error!));

  // 3. 横幅文案
  const r3 = await test('横幅包含快捷键提示', async () => {
    const { lastFrame, unmount } = render(React.createElement(App));
    await sleep(100);
    const frame = lastFrame();
    assert(frame.includes('quit') || frame.includes('Ctrl+C'), '横幅应提示退出方式');
    assert(frame.includes('Esc'), '横幅应提示 Esc 中断');
    unmount();
    await sleep(100);
  });
  r3.ok ? result.pass++ : (result.fail++, result.errors.push(r3.error!));

  // 4. 渲染稳定性：连续渲染多次不崩溃
  const r4 = await test('渲染稳定性：多次 mount/unmount 不崩溃', async () => {
    for (let i = 0; i < 3; i++) {
      const { lastFrame, unmount } = render(React.createElement(App));
      await sleep(50);
      lastFrame();
      unmount();
      await sleep(50);
    }
  });
  r4.ok ? result.pass++ : (result.fail++, result.errors.push(r4.error!));

  process.stderr.write(`  TOTAL: ${result.pass} pass, ${result.fail} fail\n`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTuiTests().then((r) => process.exit(r.fail === 0 ? 0 : 1));
}