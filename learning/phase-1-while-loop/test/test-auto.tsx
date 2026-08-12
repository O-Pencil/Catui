/**
 * 自动测试：渲染 App 并预设初始问题，让组件自动提交
 */
import { render } from 'ink-testing-library';
import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import OpenAI from 'openai';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
});

const tools: any[] = [
  {
    type: 'function', function: { name: 'ls', description: '列目录', parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径' } } } },
  },
];

async function executeTool(name: string, args: any): Promise<any> {
  if (name === 'ls') {
    try {
      const dirPath = args.path || '.';
      const items = fs.readdirSync(dirPath, { withFileTypes: true }).map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
      return { ok: true, items, path: dirPath };
    } catch (err: any) { return { ok: false, error: err.message }; }
  }
  return { ok: false, error: `未知工具: ${name}` };
}

async function agentLoop(messages: any[], onChunk: (s: string) => void, onTool: (c: any) => void): Promise<string> {
  while (true) {
    const stream = await client.chat.completions.create({ model: 'qwen3.7-plus', messages, tools, stream: true });
    const msg: any = { role: 'assistant', content: '', tool_calls: [] };
    const toolChunks: any = {};
    let finishReason = null;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) { msg.content += delta.content; onChunk(delta.content); }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolChunks[idx]) toolChunks[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) toolChunks[idx].id = tc.id;
          if (tc.function?.name) toolChunks[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolChunks[idx].function.arguments += tc.function.arguments;
        }
      }
      if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
    }
    msg.tool_calls = Object.values(toolChunks);
    messages.push(msg);
    if (finishReason === 'tool_calls' && msg.tool_calls.length > 0) {
      for (const call of msg.tool_calls) {
        const args = JSON.parse(call.function.arguments);
        onTool({ name: call.function.name, args });
        const result = await executeTool(call.function.name, args);
        let report: string;
        if (!result.ok) report = `ERROR: ${result.error}`;
        else report = result.items.map((i: any) => `${i.type === 'dir' ? '📁' : '📄'} ${i.name}`).join('\n');
        messages.push({ role: 'tool', tool_call_id: call.id, content: report });
      }
      continue;
    }
    return msg.content;
  }
}

function App() {
  const [messages, setMessages] = useState<any[]>([]);
  const [streamed, setStreamed] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const apiMessages: any[] = [
          { role: 'system', content: '你是 caturn。简短回答。' },
          { role: 'user', content: '列出当前目录' },
        ];
        const result = await agentLoop(
          apiMessages,
          (chunk) => setStreamed((p) => p + chunk),
          ({ name, args }) => setMessages((p) => [...p, { type: 'tool', name, args }]),
        );
        setMessages((p) => [...p, { type: 'assistant', content: streamed + result }]);
      } catch (err: any) {
        setMessages((p) => [...p, { type: 'assistant', content: `❌ ${err.message}` }]);
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan">🐱 caturn — TUI</Text>
      </Box>
      <Box flexDirection="column" marginY={1}>
        {messages.map((m, i) => (
          <Box key={i} flexDirection="column">
            {m.type === 'tool' && <Text color="yellow">🔧 {m.name}({JSON.stringify(m.args)})</Text>}
            {m.type === 'assistant' && <Text color="cyan">caturn ➜ {m.content}</Text>}
          </Box>
        ))}
        {streamed && <Text color="cyan">caturn ➜ {streamed}</Text>}
        {busy && !streamed && <Text color="yellow">💭 思考中...</Text>}
      </Box>
    </Box>
  );
}

const { lastFrame, unmount } = render(React.createElement(App));
await new Promise((r) => setTimeout(r, 15000));
console.log('=== TUI 渲染 ===');
console.log(lastFrame());
unmount();