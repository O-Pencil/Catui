/**
 * 测试 Esc 中断
 */
import { render } from 'ink-testing-library';
import React from 'react';
import { App } from '../caturn.tsx';

const { lastFrame, stdin, unmount } = render(React.createElement(App));

await new Promise((r) => setTimeout(r, 100));

// 输入一个会触发长回答的问题
stdin.write('详细解释 agent loop 的工作原理，每一步展开讲，分成 10 段\n');

// 等 5 秒，让模型开始流式输出
console.log('=== 等 5 秒让流式开始 ===');
await new Promise((r) => setTimeout(r, 5000));
const frame1 = lastFrame();
console.log('frame length:', frame1.length);
console.log('=== 5 秒后（最后 500 字符）===');
console.log(frame1.slice(-500));

// 模拟按 Esc
console.log('\n=== 模拟按 Esc ===');
stdin.write('\x1b'); // Esc 的 ANSI 转义

// 等中断处理
await new Promise((r) => setTimeout(r, 2000));
const frame2 = lastFrame();
console.log('\n=== 中断后（最后 800 字符）===');
console.log(frame2.slice(-800));

unmount();