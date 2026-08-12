/**
 * [WHO]: 六使者清单 + 六使者跑腿（工具定义 + 执行器）
 * [FROM]: fs（读/写文件）、child_process.exec（跑命令）
 * [TO]: src/agent.ts
 * [HERE]: learning/phase-1-while-loop/src/tools.ts
 *
 * ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
 * ┃  囚徒与使者：本文件是"使者"的所有定义                         ┃
 * ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
 *
 *  三个核心导出：
 *    1. tools：工具清单（告诉模型你能派啥使者，叫啥名，能干啥）
 *    2. executeTool(name, args)：使者跑腿（实际去现实世界干活）
 *    3. formatReport(result)：报告格式化（把结果变成给模型看的字符串）
 *
 *  加新工具的 3 步（看下面 addNewTool() 注释）：
 *    1. tools 数组加一项定义
 *    2. executeTool 加一个 if (name === '新名') 分支
 *    3. formatReport 加一个 else if 分支处理新 result 字段
 *
 *  注意：工具实现都不读模型、不管 UI——纯干活
 *  这样 agent loop 和 UI 都可以复用这套工具
 */

import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

// exec 是回调风格的（旧 API）
// promisify 把它包装一下，就能用 async/await 写（现代写法）
// 类似"翻译器"：把老式接口翻译成现代接口
const execAsync = promisify(exec);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. 工具定义（六使者清单——告诉模型你能派谁）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 这是 OpenAI 的 function calling 协议格式
// 简单说：每个工具是一个 JSON 对象，包含：
//   - name: 工具名（执行器靠这个 dispatch）
//   - description: 描述（模型靠这个决定啥时候用）
//   - parameters: 参数（按 JSON Schema 格式写）
//
// 描述（description）特别重要——它是模型的"提示词"
// 决定模型啥时候会想到派这个使者
// 写得越清楚，模型用得越准；写得太模糊，模型会瞎用

export const tools: any[] = [
  {
    type: 'function',
    function: {
      // ── read 使者：去文件世界拿内容 ──
      name: 'read',
      description: '读一个文件的全部内容。传文件路径。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要读的文件路径（相对当前目录）' },
        },
        required: ['path'], // 不传 path，使者不出发
      },
    },
  },
  {
    type: 'function',
    function: {
      // ── bash 使者：去命令世界跑命令 ──
      name: 'bash',
      description: '执行一个 shell 命令，返回 stdout 和 stderr。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令，例如 "ls -la" 或 "git status"' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      // ── write 使者：把内容写进文件（创建或覆盖）──
      // ⚠️ 破坏性：一旦写错，原文件内容就没了
      // 以后会加"先备份"或"二次确认"
      name: 'write',
      description: '把内容写入一个文件。如果文件已存在就覆盖，不存在就创建。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '要写入的完整内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      // ── edit 使者：精确替换文件里某段文字 ──
      // 这是"动手术"式的修改——只改指定位置，其他完全不动
      // 比 write 高效：你改一行，AI 不用传整个文件
      name: 'edit',
      description: '精确替换文件里某段文字。只改 oldText 第一次出现的位置，其他内容不动。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          oldText: { type: 'string', description: '要被替换的原文（必须精确匹配，包括空格和换行）' },
          newText: { type: 'string', description: '替换后的新内容' },
        },
        required: ['path', 'oldText', 'newText'],
      },
    },
  },
  {
    type: 'function',
    function: {
      // ── grep 使者：在文件里查找匹配的行 ──
      // 类似 IDE 的"在文件里查找"功能
      name: 'grep',
      description: '在一个文件里搜索包含某段文字的行。返回匹配的行号和内容。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          pattern: { type: 'string', description: '要搜索的文字（普通字符串，不是正则）' },
        },
        required: ['path', 'pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      // ── ls 使者：列目录下的文件 ──
      name: 'ls',
      description: '列出一个目录下的所有文件和子目录。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径，默认当前目录' },
        },
        // 没有 required——path 不传就当当前目录
      },
    },
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. 工具执行器（使者跑腿——根据 name 派对应使者）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 每个分支返回一个 result 对象，结构：
//   成功：{ ok: true, ...该工具特有的字段 }
//   失败：{ ok: false, error: string }
//
// 这种结构让 formatReport 能根据"有哪个字段"判断是哪个使者的报告
// 比如：result.content 是 read/write 的，result.matches 是 grep 的
//
// 为什么不抛异常？
//   异常会让 try-catch 满天飞
//   而且"工具执行失败"对 AI 来说是正常情况（文件不存在是常态）
//   返回 ok:false 让 AI 自己决定怎么处理（重试？改方案？告诉用户？）
export async function executeTool(name: string, args: any): Promise<any> {
  // ── read 使者：去文件世界拿内容 ──
  if (name === 'read') {
    try {
      // fs.readFileSync = "同步读文件"——等文件读完才往下走
      // 'utf8' = 用 UTF-8 编码读（不然中文会乱码）
      const content = fs.readFileSync(args.path, 'utf8');
      return { ok: true, content };
    } catch (err: any) {
      // 文件不存在、没权限、路径错等都走这里
      // 不抛异常——返回 ok:false 让 AI 决定怎么办
      return { ok: false, error: err.message };
    }
  }

  // ── bash 使者：去命令世界跑命令 ──
  if (name === 'bash') {
    try {
      // execAsync = "异步执行命令"——不等命令跑完就继续
      // 拿到 { stdout, stderr }：
      //   stdout = 正常输出（命令结果）
      //   stderr = 错误输出（错误信息通常在这）
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: process.cwd(),          // 在当前目录跑命令
        maxBuffer: 1024 * 1024,      // 1MB 上限。防 cat 1GB 文件爆内存
      });
      return { ok: true, stdout, stderr };
    } catch (err: any) {
      // 命令执行失败——可能是命令不存在、退出码非0、权限不够
      // 即使失败也要拿 stdout 和 stderr（命令失败时可能也有部分输出）
      return {
        ok: false,
        error: err.message,                    // Node.js 的错误描述
        stdout: err.stdout || '',
        stderr: err.stderr || '',
      };
    }
  }

  // ── write 使者：把内容写进文件（创建或覆盖）──
  if (name === 'write') {
    try {
      // fs.writeFileSync = 同步写文件——等写完才往下走
      // 不存在就创建，存在就覆盖（默认行为，没有"追加"模式）
      fs.writeFileSync(args.path, args.content, 'utf8');
      return {
        ok: true,
        bytes: Buffer.byteLength(args.content, 'utf8'),  // 写入了多少字节
        path: args.path,
      };
    } catch (err: any) {
      // 路径错、没权限、磁盘满等都走这里
      return { ok: false, error: err.message };
    }
  }

  // ── edit 使者：精确替换文件里某段文字 ──
  if (name === 'edit') {
    try {
      const content = fs.readFileSync(args.path, 'utf8');

      // 计算 oldText 在文件里出现几次
      // split(oldText) 会把字符串切成 N+1 段，所以长度-1 就是出现次数
      const occurrences = content.split(args.oldText).length - 1;

      // 0 次：找不到——可能 AI 记错了文件内容
      if (occurrences === 0) {
        return { ok: false, error: 'oldText 在文件里找不到，请检查内容是否精确匹配' };
      }

      // 多次：太模糊——AI 给的 oldText 在文件里有不止一处
      // 这种情况如果不阻止，AI 不知道我们会改哪一处，会很危险
      // 所以让 AI 提供更精确的上下文来唯一定位
      if (occurrences > 1) {
        return { ok: false, error: `oldText 在文件里出现了 ${occurrences} 次，请提供更精确的上下文来唯一定位` };
      }

      // 1 次：正好——replace 第一次出现（split 已经保证唯一）
      const newContent = content.replace(args.oldText, args.newText);
      fs.writeFileSync(args.path, newContent, 'utf8');

      return {
        ok: true,
        path: args.path,
        diff: `${args.oldText.length} chars → ${args.newText.length} chars`, // 改了啥尺寸
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  // ── grep 使者：在文件里搜匹配的行 ──
  if (name === 'grep') {
    try {
      const content = fs.readFileSync(args.path, 'utf8');
      const matches: Array<{ line: number; content: string }> = [];

      // 逐行扫描，记录匹配的行号 + 内容
      content.split('\n').forEach((line, i) => {
        if (line.includes(args.pattern)) {
          matches.push({ line: i + 1, content: line }); // 行号从 1 开始（人类习惯）
        }
      });

      return {
        ok: true,
        matches,
        count: matches.length,  // 找到了多少行
        path: args.path,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  // ── ls 使者：列目录 ──
  if (name === 'ls') {
    try {
      const dirPath = args.path || '.'; // 不传 path 就当当前目录
      // withFileTypes: true 表示返回的不只是名字，还有是不是目录
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      // 简化成 { name, type } 格式给 AI 看
      const items = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
      }));

      return { ok: true, items, path: dirPath };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  // 模型说要派一个我们没注册过的使者——这是不该发生的
  // 防御性代码：万一 model 幻觉了，我们知道是哪个工具找不到
  return { ok: false, error: `未知工具: ${name}` };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. 报告格式化（把 result 对象变成给模型看的字符串）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 不同使者的 result 字段不同，靠"有哪个字段"判断是哪个使者
// （这种"鸭子类型"判断比 if (name === 'read') 更灵活）
//
// ⚠️ 顺序很重要：从最具体到最不具体
//   比如 match 字段必须在 bytes 之前检查，因为 edit 也有可能不含 bytes
//   （如果有冲突，要加 name 字段来判断）
export function formatReport(result: any): string {
  // 失败：所有工具统一格式
  if (!result.ok) return `ERROR: ${result.error}`;

  // 成功——按 result 字段分发：
  if (result.content !== undefined) return result.content; // read
  if (result.bytes !== undefined) return `WROTE ${result.bytes} bytes to ${result.path}`; // write
  if (result.diff !== undefined) return `EDITED ${result.path}: ${result.diff}`; // edit
  if (result.matches !== undefined) {
    // grep
    if (result.count === 0) return `No matches for pattern in ${result.path}`;
    // 把匹配行格式化输出：每行带"行号:内容"，方便 AI 知道在哪
    return result.matches.map((m: any) => `${m.line}:${m.content}`).join('\n');
  }
  if (result.items !== undefined) {
    // ls：📁 标记目录，📄 标记文件
    return result.items.map((i: any) => `${i.type === 'dir' ? '📁' : '📄'} ${i.name}`).join('\n');
  }
  // bash（最后兜底）
  return JSON.stringify({ stdout: result.stdout, stderr: result.stderr }, null, 2);
}