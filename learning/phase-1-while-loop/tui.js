#!/usr/bin/env node
/**
 * tui.js — npm run tui 的入口
 * 先检查 API key，再启动 TUI
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';

if (!process.env.DASHSCOPE_API_KEY) {
  console.error('❌ 没设 DASHSCOPE_API_KEY 环境变量');
  console.error('');
  console.error('设置方法（任选一种）：');
  console.error('  export DASHSCOPE_API_KEY="sk-sp-你的key"');
  console.error('  echo \'export DASHSCOPE_API_KEY="..."\' >> ~/.zshrc && source ~/.zshrc');
  console.error('');
  process.exit(1);
}

if (!existsSync('./caturn.tsx')) {
  console.error('❌ caturn.tsx 不存在，当前目录:', process.cwd());
  process.exit(1);
}

// 启动真正的 TUI
const child = spawn('npx', ['tsx', 'caturn.tsx'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));