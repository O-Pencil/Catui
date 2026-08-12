/**
 * [WHO]: 六使者清单 + 六使者跑腿（工具定义 + 执行器）
 * [FROM]: fs（读/写文件）、child_process.exec（跑命令）
 * [TO]: agent.ts / 未来的新工具加这里
 * [HERE]: learning/phase-1-while-loop/src/tools.ts
 *
 * 三个核心导出：
 *   - tools：OpenAI function calling 格式的工具定义，告诉模型你能派啥使者
 *   - executeTool(name, args)：使者跑腿，根据 name 派对应使者
 *   - formatReport(result)：格式化执行结果，决定给模型看啥报告
 *
 * 加新工具？
 *   1. tools 数组加一项定义
 *   2. executeTool 加一个 if (name === 'xxx') 分支
 *   3. formatReport 加一个 else if 分支处理新 result 字段
 */

import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. 工具定义（六使者清单——告诉模型你能派谁）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 这是 OpenAI function calling 协议格式
// description 字段决定模型啥时候会想到派这个使者，写清楚很关键
export const tools: any[] = [
  {
    type: 'function',
    function: {
      name: 'read',
      description: '读一个文件的全部内容。传文件路径。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '要读的文件路径' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: '执行一个 shell 命令，返回 stdout 和 stderr。',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: '要执行的命令' } },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write',
      description: '把内容写入一个文件（创建或覆盖）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '要写入的内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit',
      description: '精确替换文件里某段文字。只改 oldText 第一次出现的位置，其他内容不动。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          oldText: { type: 'string', description: '要被替换的原文（必须精确匹配）' },
          newText: { type: 'string', description: '替换后的新内容' },
        },
        required: ['path', 'oldText', 'newText'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: '在文件里搜索匹配的文字。返回匹配的行号和内容。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          pattern: { type: 'string', description: '要搜索的文字' },
        },
        required: ['path', 'pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ls',
      description: '列出一个目录下的所有文件和子目录。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '目录路径，默认当前目录' } },
      },
    },
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. 工具执行器（使者跑腿——根据囚徒指令去现实世界干活）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 每个分支返回一个 result 对象，结构：
//   成功：{ ok: true, ... 该工具特有的字段 }
//   失败：{ ok: false, error: string }
// 这种结构让 formatReport 能根据字段判断是哪个使者的报告
export async function executeTool(name: string, args: any): Promise<any> {
  // ── read 使者：去文件世界拿内容 ──
  if (name === 'read') {
    try {
      const content = fs.readFileSync(args.path, 'utf8');
      return { ok: true, content };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  // ── bash 使者：去命令世界跑命令 ──
  if (name === 'bash') {
    try {
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024, // 1MB 上限
      });
      return { ok: true, stdout, stderr };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
        stdout: err.stdout || '',
        stderr: err.stderr || '',
      };
    }
  }

  // ── write 使者：把内容写进文件（创建或覆盖）──
  if (name === 'write') {
    try {
      fs.writeFileSync(args.path, args.content, 'utf8');
      return {
        ok: true,
        bytes: Buffer.byteLength(args.content, 'utf8'),
        path: args.path,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  // ── edit 使者：精确替换文件里某段文字 ──
  if (name === 'edit') {
    try {
      const content = fs.readFileSync(args.path, 'utf8');
      const occurrences = content.split(args.oldText).length - 1;
      if (occurrences === 0) return { ok: false, error: 'oldText 在文件里找不到' };
      if (occurrences > 1) return { ok: false, error: `oldText 出现 ${occurrences} 次，请提供更精确的上下文` };
      const newContent = content.replace(args.oldText, args.newText);
      fs.writeFileSync(args.path, newContent, 'utf8');
      return { ok: true, path: args.path, diff: `${args.oldText.length} chars → ${args.newText.length} chars` };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  // ── grep 使者：在文件里搜匹配的字符串 ──
  if (name === 'grep') {
    try {
      const content = fs.readFileSync(args.path, 'utf8');
      const matches: Array<{ line: number; content: string }> = [];
      content.split('\n').forEach((line, i) => {
        if (line.includes(args.pattern)) matches.push({ line: i + 1, content: line });
      });
      return { ok: true, matches, count: matches.length, path: args.path };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  // ── ls 使者：列目录 ──
  if (name === 'ls') {
    try {
      const dirPath = args.path || '.';
      const items = fs.readdirSync(dirPath, { withFileTypes: true }).map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
      }));
      return { ok: true, items, path: dirPath };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  return { ok: false, error: `未知工具: ${name}` };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. 报告格式化（把使者结果变成给模型看的字符串）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 不同使者的结果字段不一样，靠"有哪个字段"判断是哪个使者
export function formatReport(result: any): string {
  if (!result.ok) return `ERROR: ${result.error}`;
  if (result.content !== undefined) return result.content; // read
  if (result.bytes !== undefined) return `WROTE ${result.bytes} bytes to ${result.path}`; // write
  if (result.diff !== undefined) return `EDITED ${result.path}: ${result.diff}`; // edit
  if (result.matches !== undefined) {
    // grep
    if (result.count === 0) return `No matches for pattern in ${result.path}`;
    return result.matches.map((m: any) => `${m.line}:${m.content}`).join('\n');
  }
  if (result.items !== undefined) {
    // ls
    return result.items.map((i: any) => `${i.type === 'dir' ? '📁' : '📄'} ${i.name}`).join('\n');
  }
  // bash（最后兜底）
  return JSON.stringify({ stdout: result.stdout, stderr: result.stderr }, null, 2);
}