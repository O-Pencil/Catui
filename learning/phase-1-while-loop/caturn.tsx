/**
 * [WHO]: caturn TUI 入口（ink + React）
 * [FROM]: src/agent.ts（agent loop）、src/prompts.ts（system prompt）
 * [TO]: 用户（在终端跟 AI 对话）
 * [HERE]: learning/phase-1-while-loop/caturn.tsx
 *
 * ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
 * ┃  囚徒与使者：本文件是"狱卒前台"                                ┃
 * ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
 *
 *  整个 caturn 拆成 3 层，本文件只管"显示"：
 *
 *    1. 业务逻辑：src/agent.ts（跟囚徒对话）
 *    2. 工具实现：src/tools.ts（使者跑腿）
 *    3. UI 渲染：本文件（怎么画、怎么响应键盘）
 *
 *  UI 层只关心：
 *    - 怎么画（Box、Text、颜色）
 *    - 怎么响应键盘（Esc、Ctrl+C、回车）
 *    - 怎么把 agent loop 的状态映射到界面（流式、工具、错误）
 *
 *  目录结构：
 *    caturn.tsx           ← 本文件（你正在看）
 *    src/
 *      ├── agent.ts       ← 跨平台共享的 agent loop
 *      ├── tools.ts       ← 6 工具定义 + 执行器
 *      └── prompts.ts     ← system prompt
 *    test/                ← 测试脚本
 */

import React, { useState, useEffect, useRef } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { agentLoop, AbortError } from './src/agent.ts';
import { SYSTEM_PROMPT } from './src/prompts.ts';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 消息类型定义（UI 自己用的，跟 OpenAI 协议无关）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 一次完整对话会产生多条消息：
//   user（用户说的）
//   + 多个 assistant + tool（agent loop 内部调工具的过程）
//   + 最终 assistant（最终答案）
//
// toolName/toolArgs 是工具调用时给 UI 看的标识
type ChatMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolArgs?: any;
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// App 组件：整个 TUI 的根组件
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function App() {
  // useApp() 拿到 ink 的"退出程序"函数
  const { exit } = useApp();

  // ── 状态 1：所有历史消息（已经完成的对话）──
  // 渲染时遍历这个数组，决定屏幕上画啥
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // ── 状态 2：当前输入框里的文字 ──
  const [input, setInput] = useState('');

  // ── 状态 3：是否在"等待 AI 回复"中 ──
  // true 时输入框禁用 placeholder 变成"等待中..."
  const [busy, setBusy] = useState(false);

  // ── 状态 4：当前正在流式输出的内容（没存进 messages）──
  // 为什么要单独？等流式结束后才统一存进 messages
  // 这样可以避免"半截话"被记进历史
  const [streamedContent, setStreamedContent] = useState('');

  // ── ref 1：拿到最新的 messages（在异步 callback 里用）──
  // 难题：setMessages 之后，submit 函数里读还是旧值
  // 解法：useRef 同步存一份，setMessages 时同步更新
  const messagesRef = useRef<ChatMessage[]>([]);

  // ── ref 2：当前 agent loop 的 abort controller ──
  // 按 Esc 时调 controller.abort()，让 agentLoop 停下来
  const abortControllerRef = useRef<AbortController | null>(null);

  // 同步 messagesRef 和 messages（每次 messages 变就更新 ref）
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 键盘绑定
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // useInput 是 ink 的"全局键盘监听"——任何按键都会触发
  //   key.escape: Esc 键
  //   key.ctrl:  是否是 Ctrl 组合键
  //   input:     按键对应的字符（a、c、x 等）
  useInput((_input, key) => {
    // ── Esc：打断当前流式（保留历史，不退出程序）──
    if (key.escape) {
      if (abortControllerRef.current) {
        // 告诉 agentLoop："停！"
        abortControllerRef.current.abort();
        // 清空引用，避免后续误调
        abortControllerRef.current = null;
      }
    }
    // ── Ctrl+C：退出整个程序 ──
    else if (key.ctrl && _input === 'c') {
      // 先打断流式，再退出
      if (abortControllerRef.current) abortControllerRef.current.abort();
      exit();
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // submit：用户按回车时调用
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const submit = async () => {
    // 1. 拿输入文本，做基础检查
    const text = input.trim();
    if (!text || busy) return; // 空输入或还在忙 → 忽略

    // 2. 退出指令特殊处理
    if (text === 'quit' || text === 'exit') {
      exit();
      return;
    }

    // 3. 锁定状态：清空输入、标记 busy、清空流式缓冲
    setBusy(true);
    setInput('');
    setStreamedContent('');

    // 4. 用户消息先加进显示列表（让用户能看到自己的话）
    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);

    // 5. 准备"日记本"（system + 历史 + 这次用户的问题）
    // 注意：必须用 messagesRef 拿最新值（React state 在 async 函数里是旧值）
    const apiMessages: any[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messagesRef.current.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ];

    // 6. 创建 abort controller（这次对话的"中断开关"）
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // 7. 跑 agent loop
    try {
      await agentLoop(
        apiMessages,
        // onChunk：每收到一个文本片段
        (chunk) => {
          // 累加到 streamedContent（一个字一个字蹦）
          setStreamedContent((prev) => prev + chunk);
        },
        // onToolCall：囚徒决定调工具
        ({ name, args }) => {
          // 立刻把工具调用加进显示列表（让用户看到"AI 在用 XX 工具"）
          setMessages((prev) => [
            ...prev,
            { role: 'tool', content: '', toolName: name, toolArgs: args },
          ]);
        },
        // signal：esc 按下时这个变 true
        controller.signal,
      );

      // 8. 流式正常结束：把最终答案正式存进 messages
      setStreamedContent((cur) => {
        if (cur) {
          setMessages((prev) => [...prev, { role: 'assistant', content: cur }]);
        }
        return ''; // 清空流式缓冲
      });
    } catch (err: any) {
      // ── AbortError：用户按了 Esc ──
      if (err.name === 'AbortError') {
        // 把已经流出来的内容保存为 assistant 消息，加 [⏹ 已中断] 标记
        setStreamedContent((cur) => {
          if (cur) {
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: cur + ' [⏹ 已中断]' },
            ]);
          } else {
            // 流式还没出东西就按了 Esc
            setMessages((prev) => [...prev, { role: 'assistant', content: '⏹ 已中断' }]);
          }
          return '';
        });
      } else {
        // ── 其他错误：网络挂了、API 报错等 ──
        setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${err.message}` }]);
      }
    } finally {
      // 无论成功失败：清空 controller、解除 busy
      abortControllerRef.current = null;
      setBusy(false);
    }
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 渲染（React 把这些 Box/Text 画到终端）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return (
    <Box flexDirection="column">
      {/* 顶部 banner——圆角边框 + 提示快捷键 */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan">🐱 caturn</Text>
        <Text dimColor> — TUI version. quit/Ctrl+C 退出，Esc 中断当前回答。</Text>
      </Box>

      {/* 消息历史区 */}
      <Box flexDirection="column" marginY={1}>
        {/* 遍历所有历史消息，每条根据 role 画不同样式 */}
        {messages.map((msg, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            {/* user 消息：绿色"你 ➜"前缀 */}
            {msg.role === 'user' && (
              <Box>
                <Text color="green">你 ➜ </Text>
                <Text>{msg.content}</Text>
              </Box>
            )}

            {/* assistant 消息：青色"caturn ➜"前缀 + 缩进 */}
            {msg.role === 'assistant' && (
              <Box flexDirection="column">
                <Text color="cyan">caturn ➜</Text>
                <Box marginLeft={2}>
                  <Text>{msg.content}</Text>
                </Box>
              </Box>
            )}

            {/* tool 消息：黄色"🔧 工具名" + 参数 + 报告预览 */}
            {msg.role === 'tool' && (
              <Box>
                <Text color="yellow">🔧 {msg.toolName}</Text>
                <Text dimColor>({JSON.stringify(msg.toolArgs)})</Text>
                {msg.content && (
                  <Box marginLeft={2}>
                    {/* 报告太长就截断：前 200 字符 + "..." */}
                    <Text dimColor>↳ {msg.content.slice(0, 200)}{msg.content.length > 200 ? '...' : ''}</Text>
                  </Box>
                )}
              </Box>
            )}
          </Box>
        ))}

        {/* 正在流式输出的内容（实时） */}
        {streamedContent && (
          <Box flexDirection="column">
            <Text color="cyan">caturn ➜</Text>
            <Box marginLeft={2}>
              <Text>{streamedContent}</Text>
            </Box>
          </Box>
        )}

        {/* 思考中提示（busy 但还没出第一个 chunk） */}
        {busy && !streamedContent && (
          <Text color="yellow">💭 囚徒思考中...（按 Esc 中断）</Text>
        )}
      </Box>

      {/* 输入框——TextInput 是 ink 的输入组件 */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="green">{'> '}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={submit}
          placeholder={busy ? '等待中...' : '问我点啥...'}
        />
      </Box>
    </Box>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 启动入口
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// import.meta.url 是当前文件的 URL
// process.argv[1] 是被运行的文件路径
// 相等 = "用户直接跑了这个文件" → 启动 TUI
// 不等 = "被 import 进来当模块"（如测试）→ 不启动
export { App };

import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // 检查 API key（没设直接退出，别让用户看到一堆报错）
  if (!process.env.DASHSCOPE_API_KEY) {
    console.error('❌ 没设 DASHSCOPE_API_KEY 环境变量');
    process.exit(1);
  }
  // 启动 TUI：把 <App /> 画到终端
  render(<App />);
}