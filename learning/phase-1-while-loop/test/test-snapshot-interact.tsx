import { render } from 'ink-testing-library';
import React from 'react';
import { App } from '../caturn.tsx';

const { lastFrame, stdin, unmount, waitUntilRender } = render(React.createElement(App));

// 等初始渲染
await new Promise((r) => setTimeout(r, 100));
console.log('=== 初始 ===');
console.log(lastFrame());

// 模拟输入问题
stdin.write('列出当前目录的文件\n');

// 等模型回复
console.log('\n=== 等待回复（20秒）===');
await new Promise((r) => setTimeout(r, 20000));
console.log(lastFrame());

unmount();