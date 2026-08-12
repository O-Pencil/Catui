/**
 * [WHO]: caturn TUI 入口（ink + React）
 * [FROM]: src/agent.ts（agent loop）、src/prompts.ts（system prompt）
 * [TO]: 用户（在终端跟 AI 对话）
 * [HERE]: learning/phase-1-while-loop/caturn.tsx
 *
 * 这个文件只关心"显示"——怎么画界面、怎么响应键盘。
 * 业务逻辑（agent loop、工具实现）都在 src/ 下。
 *
 * ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
 * ┃  目录结构                                                  ┃
 * ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
 *
 *   caturn.tsx           ← 你在这里（TUI 入口，~150 行）
 *   src/
 *     ├── agent.ts       ← agent loop 核心（跨平台共享）
 *     ├── tools.ts       ← 六工具定义 + 执行器
 *     └── prompts.ts     ← system prompt
 *   test/                ← 测试脚本
 */

import React, { useState, useEffect, useRef } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { agentLoop, AbortError } from './src/agent.ts';
import { SYSTEM_PROMPT } from './src/prompts.ts';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TUI 组件
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type ChatMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolArgs?: any;
};

function App() {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streamedContent, setStreamedContent] = useState('');
  const messagesRef = useRef<ChatMessage[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // 键盘绑定：
  //   Esc → 打断当前流式（保留历史）
  //   Ctrl+C → 退出整个程序
  useInput((_input, key) => {
    if (key.escape) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    } else if (key.ctrl && _input === 'c') {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      exit();
    }
  });

  const submit = async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (text === 'quit' || text === 'exit') { exit(); return; }

    setBusy(true);
    setInput('');
    setStreamedContent('');

    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);

    const apiMessages: any[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messagesRef.current.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ];

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await agentLoop(
        apiMessages,
        (chunk) => setStreamedContent((prev) => prev + chunk),
        ({ name, args }) => {
          setMessages((prev) => [...prev, { role: 'tool', content: '', toolName: name, toolArgs: args }]);
        },
        controller.signal,
      );

      setStreamedContent((cur) => {
        if (cur) setMessages((prev) => [...prev, { role: 'assistant', content: cur }]);
        return '';
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setStreamedContent((cur) => {
          if (cur) {
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: cur + ' [⏹ 已中断]' },
            ]);
          } else {
            setMessages((prev) => [...prev, { role: 'assistant', content: '⏹ 已中断' }]);
          }
          return '';
        });
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${err.message}` }]);
      }
    } finally {
      abortControllerRef.current = null;
      setBusy(false);
    }
  };

  return (
    <Box flexDirection="column">
      {/* 顶部 banner */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan">🐱 caturn</Text>
        <Text dimColor> — TUI version. quit/Ctrl+C 退出，Esc 中断当前回答。</Text>
      </Box>

      {/* 消息历史 */}
      <Box flexDirection="column" marginY={1}>
        {messages.map((msg, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            {msg.role === 'user' && (
              <Box>
                <Text color="green">你 ➜ </Text>
                <Text>{msg.content}</Text>
              </Box>
            )}
            {msg.role === 'assistant' && (
              <Box flexDirection="column">
                <Text color="cyan">caturn ➜</Text>
                <Box marginLeft={2}>
                  <Text>{msg.content}</Text>
                </Box>
              </Box>
            )}
            {msg.role === 'tool' && (
              <Box>
                <Text color="yellow">🔧 {msg.toolName}</Text>
                <Text dimColor>({JSON.stringify(msg.toolArgs)})</Text>
                {msg.content && (
                  <Box marginLeft={2}>
                    <Text dimColor>↳ {msg.content.slice(0, 200)}{msg.content.length > 200 ? '...' : ''}</Text>
                  </Box>
                )}
              </Box>
            )}
          </Box>
        ))}

        {streamedContent && (
          <Box flexDirection="column">
            <Text color="cyan">caturn ➜</Text>
            <Box marginLeft={2}>
              <Text>{streamedContent}</Text>
            </Box>
          </Box>
        )}

        {busy && !streamedContent && (
          <Text color="yellow">💭 囚徒思考中...（按 Esc 中断）</Text>
        )}
      </Box>

      {/* 输入框 */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="green">{'> '}</Text>
        <TextInput value={input} onChange={setInput} onSubmit={submit} placeholder={busy ? '等待中...' : '问我点啥...'} />
      </Box>
    </Box>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 启动
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export { App };

import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.DASHSCOPE_API_KEY) {
    console.error('❌ 没设 DASHSCOPE_API_KEY 环境变量');
    process.exit(1);
  }
  render(<App />);
}