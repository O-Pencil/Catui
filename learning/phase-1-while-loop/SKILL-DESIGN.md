# caturn 未来加 Skill 层:设计与对照

> 学习笔记:对照 catui 的 skill 实现,规划 caturn 未来怎么加
> 写入时间: 2026-08-12
> caturn 当前状态: Phase 1 完成,无 skill 层

---

## 0. 一句话总结

**Skill = 一个 SKILL.md 文件 + 一段系统 prompt 元数据 + 一个能加载全文的工具**。没有别的。

catui 的 skill 不是代码,不是插件,就是 Markdown。

---

## 1. catui 是怎么做的(参考落点)

### 1.1 三个核心文件

| 文件 | 职责 |
|------|------|
| `core/skills.ts` | 扫描 skill 目录 + 解析 frontmatter(name + description) |
| `core/prompt/system-prompt.ts` | 构建系统 prompt 时,把 skill 列表注入 |
| `core/tools/skill.ts` | 实现 `skill` 工具,模型调用时返回 SKILL.md 全文 |

### 1.2 调用流程(模型视角)

```
1. 用户: "帮我修个 bug,系统启动失败"
2. 模型看到系统 prompt 里的 skill 列表
3. 看到 systematic-debugging: "Use for any bug..."
4. 决定调用 skill 工具,name="systematic-debugging"
5. 工具返回 SKILL.md 完整内容
6. 模型按 skill 指令做事
```

**整个机制没有魔法**。就是目录扫描 + frontmatter 解析 + system prompt 注入 + tool 返回全文。

---

## 2. catui skill 的关键设计原则

### 2.1 元数据要短

系统 prompt 里只塞 `name` + `description`,不塞全文。模型 context 有限,塞 50 个 skill 的完整内容会爆。

模型调用 skill 时才把全文加载。

### 2.2 描述要触发性强

description 写"Use when X"这类关键词,让模型能匹配用户意图。

**反例**:
```yaml
description: A useful skill for developers
```
等于没写。模型不知道啥时候用。

**正例**:
```yaml
description: Use for any bug, test failure, build failure, or unexpected runtime result before proposing fixes.
```
关键词触发,模型一看就能 match。

### 2.3 SKILL.md 是给模型看的,不是给人看的

- 第二人称("You should ...")
- 写指令("Do this")
- 写禁止("Don't do that")
- 人话,直接

不要写技术文档风格。模型不是人,不要用"开发者文档"的口吻。

### 2.4 Skill 内容是临时注入

模型读完执行完,skill 全文在后续轮次可能被压缩掉。

**重要决策别依赖 skill 文档本身,要让模型自己记住**。

---

## 3. caturn 当前架构回顾

```
caturn.tsx       ← TUI 入口(ink + React)
src/
├── agent.ts     ← agent loop 核心
├── tools.ts     ← 6 工具定义 + 执行器
└── prompts.ts   ← 静态 system prompt
```

**当前 system prompt**(`src/prompts.ts:11-15`):

```typescript
export const SYSTEM_PROMPT = `你是 caturn,一个简洁的代码助手。可以派 read/edit/write/grep/ls/bash 六个使者协作完成任务。
回答简短直接,不要客套。
改代码用 edit(小改动)而不用 write(整个覆盖)。
搜内容用 grep 而不是 read 整个文件。`;
```

**当前 tools 数组**(`src/tools.ts:25-94`):6 个硬编码工具定义。

---

## 4. caturn 加 Skill 层的设计方案

### 4.1 目录结构(规划)

```
learning/phase-1-while-loop/
├── caturn.tsx
├── src/
│   ├── agent.ts          ← 已有
│   ├── tools.ts          ← 已有,加第 7 个工具
│   ├── prompts.ts        ← 改为动态拼接
│   └── skills.ts         ← 新增:扫描 + 加载
├── skills/               ← 新增:用户/项目级 skill
│   ├── git-commit/
│   │   └── SKILL.md
│   ├── refactor/
│   │   └── SKILL.md
│   └── test-first/
│       └── SKILL.md
└── test/
    └── unit/
        └── skills.tsx    ← 新增测试
```

### 4.2 SKILL.md 格式

**frontmatter**(name + description,机器读):

```markdown
---
name: git-commit
description: Use when committing code changes. Generates clear commit messages following conventional commits format.
---

# Git Commit 规范

You are helping the user write a commit message. Follow these rules:

1. **Format**: `<type>(<scope>): <subject>`
2. **Types**: feat / fix / refactor / docs / perf / chore
3. **Subject**: lowercase, no period, max 50 chars
4. **Body**: explain WHY, not WHAT

## Do

- `feat(auth): add oauth2 login flow`
- `fix(api): handle null user response`

## Don't

- "fixed stuff"
- "WIP"
- Multi-line subject
```

### 4.3 src/skills.ts 实现(最小版)

```typescript
/**
 * [WHO]: Skill 加载器——扫描 SKILL.md,解析 frontmatter,提供全文加载
 * [FROM]: fs / path(目录扫描)
 * [TO]: prompts.ts(注入元数据)、tools.ts(skill 工具实现)
 * [HERE]: learning/phase-1-while-loop/src/skills.ts
 *
 * 设计原则:
 *   - 元数据(name + description)轻量,塞进 system prompt
 *   - 全文只在模型调用时才加载
 *   - 扫描顺序: 内置 skills/ → 用户 ~/.caturn/skills/ → 项目级 ./.caturn/skills/
 */

import fs from 'fs';
import path from 'path';

export interface Skill {
  name: string;
  description: string;
  content: string;
  source: 'builtin' | 'user' | 'project';
}

/**
 * 解析 SKILL.md 顶部的 YAML frontmatter
 * 极简实现: 不引 js-yaml 依赖,只解析 name/description 两个字段
 */
function parseFrontmatter(raw: string): { name: string; description: string; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('SKILL.md 缺少 frontmatter(--- 包裹的元数据)');

  const [, front, body] = match;
  const lines = front.split('\n');
  const meta: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) meta[m[1]] = m[2].trim();
  }

  if (!meta.name || !meta.description) {
    throw new Error('SKILL.md frontmatter 必须包含 name 和 description');
  }

  return { name: meta.name, description: meta.description, body };
}

/**
 * 扫描单个目录,返回所有 Skill
 * 约定: 每个子目录包含一个 SKILL.md
 */
export function loadSkillsFromDir(dir: string, source: Skill['source']): Skill[] {
  if (!fs.existsSync(dir)) return [];

  const skills: Skill[] = [];
  for (const name of fs.readdirSync(dir)) {
    const skillDir = path.join(dir, name);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    const raw = fs.readFileSync(skillFile, 'utf8');
    const { name: skillName, description, body } = parseFrontmatter(raw);
    skills.push({ name: skillName, description, content: body, source });
  }
  return skills;
}

/**
 * 加载所有 skill(按优先级:内置 → 用户 → 项目)
 * 后加载的同名 skill 覆盖前面的(项目级覆盖用户级覆盖内置)
 */
export function loadAllSkills(): Skill[] {
  const builtin = loadSkillsFromDir(path.join(process.cwd(), 'skills'), 'builtin');
  const user = loadSkillsFromDir(path.join(process.env.HOME || '', '.caturn', 'skills'), 'user');
  const project = loadSkillsFromDir(path.join(process.cwd(), '.caturn', 'skills'), 'project');

  const map = new Map<string, Skill>();
  for (const s of [...builtin, ...user, ...project]) {
    map.set(s.name, s); // 后写覆盖前写
  }
  return Array.from(map.values());
}

/**
 * 按 name 查找单个 skill
 */
export function findSkill(skills: Skill[], name: string): Skill | undefined {
  return skills.find((s) => s.name === name);
}
```

### 4.4 prompts.ts 改为动态

```typescript
/**
 * [WHO]: 动态构建 system prompt(基础人格 + skill 列表)
 * [FROM]: ./skills.ts(skill 元数据)
 * [TO]: agent.ts(传给模型)
 * [HERE]: learning/phase-1-while-loop/src/prompts.ts
 */

import { Skill } from './skills.ts';

const BASE_PROMPT = `你是 caturn,一个简洁的代码助手。可以派 read/edit/write/grep/ls/bash 六个使者协作完成任务。
回答简短直接,不要客套。
改代码用 edit(小改动)而不用 write(整个覆盖)。
搜内容用 grep 而不是 read 整个文件。`;

const SKILL_HEADER = `
你还有以下 skill 可用。当用户意图匹配某个 skill 的描述时,使用 skill 工具加载它:

`;

export function buildSystemPrompt(skills: Skill[]): string {
  if (skills.length === 0) return BASE_PROMPT;

  const skillList = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  return BASE_PROMPT + SKILL_HEADER + skillList;
}
```

### 4.5 tools.ts 加第 7 个工具

在 `src/tools.ts:25` 的 `tools` 数组追加:

```typescript
{
  type: 'function',
  function: {
    name: 'skill',
    description: '加载一个 skill 的完整指令。传 skill 名称。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '要加载的 skill 名称' },
      },
      required: ['name'],
    },
  },
},
```

在 `src/tools.ts:115` 的 `executeTool` 末尾追加:

```typescript
// ── skill 使者:把 skill 全文加载给模型 ──
if (name === 'skill') {
  const skill = findSkill(skillsRef, args.name);
  if (!skill) return { ok: false, error: `未知 skill: ${args.name}` };
  return { ok: true, content: skill.content, skillName: skill.name };
}
```

在 `src/tools.ts:200` 的 `formatReport` 追加 skill 分支(放到 read 分支后面):

```typescript
if (result.skillName !== undefined) {
  return `[Loaded skill: ${result.skillName}]\n\n${result.content}`;
}
```

**注意**: `skillsRef` 需要从外部传入,因为 `executeTool` 当前签名是 `(name, args)`,没有 skills 参数。

### 4.6 caturn.tsx 串联

在 `caturn.tsx` 顶部:

```typescript
import { loadAllSkills } from './src/skills.ts';
import { buildSystemPrompt } from './src/prompts.ts';

const skills = loadAllSkills();
const SYSTEM_PROMPT = buildSystemPrompt(skills);
```

替换原来的 `import { SYSTEM_PROMPT } from './src/prompts.ts'`。

---

## 5. 完整数据流

```
启动
  ↓
loadAllSkills() → 扫描 skills/ + ~/.caturn/skills/ + ./.caturn/skills/
  ↓
buildSystemPrompt(skills) → 基础人格 + skill 列表(仅 name + description)
  ↓
用户输入
  ↓
agentLoop 调用模型
  ↓
模型看到 system prompt 里的 skill 列表,决定调用 skill 工具
  ↓
executeTool('skill', { name: 'git-commit' })
  ↓
findSkill(skills, 'git-commit') → 返回完整 content
  ↓
formatReport → "[Loaded skill: git-commit]\n\n<全文>"
  ↓
作为 tool result 推回 messages
  ↓
模型按 skill 指令执行
```

---

## 6. 关键决策记录

### 6.1 为什么 skill 是工具,不是新维度

考虑过两种设计:
- **A. Skill 作为新维度**(跟 tool 并列,独立的系统)
- **B. Skill 作为特殊 tool**(放进 tools 数组)

**选 B**。理由:
- 模型调用方式统一(都是 function calling)
- 复用现有 agent loop(`if (finishReason === 'tool_calls')` 已经处理了)
- 工具 vs skill 的区别只是"内容是固定的还是动态的"
- catui 本身就是这么做的(`core/tools/skill.ts`)

### 6.2 为什么不用现成 YAML 库

js-yaml 会引入额外依赖。frontmatter 只解析两个字段(`name` / `description`),正则够用。

如果未来 skill 数量上 50+,或者元数据变复杂(多语言、版本号、依赖),再换 js-yaml。

### 6.3 扫描顺序的优先级

```
项目级 > 用户级 > 内置级
```

理由: 项目级覆盖用户级覆盖内置,符合"局部覆盖全局"的预期。

### 6.4 skill 工具要不要返回值

返回 skill 全文,格式:

```
[Loaded skill: <name>]

<content>
```

前缀让模型知道"这是 skill 加载结果",便于后续对话区分"我在执行 skill 指令"和"我在回答问题"。

---

## 7. 测试要点

未来加 skill 层时的测试覆盖:

| 测试 | 验证 |
|------|------|
| `parseFrontmatter` | 正确解析 name/description/body |
| `parseFrontmatter` 异常 | 缺 frontmatter / 缺 name / 缺 description 报错 |
| `loadSkillsFromDir` | 扫描目录、跳过无 SKILL.md 的子目录 |
| `loadAllSkills` | 优先级覆盖(项目 > 用户 > 内置) |
| `buildSystemPrompt` | 无 skill 时返回基础 prompt |
| `buildSystemPrompt` | 有 skill 时正确拼接列表 |
| `executeTool('skill')` | 返回全文 |
| `executeTool('skill')` 异常 | 未知 skill 报错 |
| **集成测试** | mock 模型 → 调用 skill → 验证全文进 messages |

---

## 8. 跟现有 6 工具的关系

| 维度 | 6 工具 | skill |
|------|--------|-------|
| 内容来源 | 运行时执行(读文件、跑命令) | 静态文本(读 SKILL.md) |
| 模型输入 | 执行结果(stdout / content / matches) | skill 全文 |
| 调用目的 | 干活 | 学习做事的方法 |
| 数量 | 固定 6 个 | 动态,N 个 skill |

**类比**: 工具是"用手做",skill 是"看说明书"。

---

## 9. 参考文件路径

### catui 实现(对照参考)

| 主题 | 路径 |
|------|------|
| Skill 加载 | `core/skills.ts` |
| Skill 工具实现 | `core/tools/skill.ts` |
| System prompt 构建 | `core/prompt/system-prompt.ts` |
| Skill 调用示例 | `extensions/builtin/discipline/skills/systematic-debugging/SKILL.md` |
| Skill 调用示例 | `extensions/builtin/discipline/skills/test-driven-development/SKILL.md` |

### caturn 现状(本目录)

| 主题 | 路径 |
|------|------|
| 静态 prompt | `learning/phase-1-while-loop/src/prompts.ts` |
| 6 工具定义 | `learning/phase-1-while-loop/src/tools.ts:25-94` |
| 6 工具执行 | `learning/phase-1-while-loop/src/tools.ts:113-198` |
| Report 格式化 | `learning/phase-1-while-loop/src/tools.ts:200-216` |
| agent loop | `learning/phase-1-while-loop/src/agent.ts` |
| TUI 入口 | `learning/phase-1-while-loop/caturn.tsx` |

### 未来要新建的文件

| 文件 | 用途 |
|------|------|
| `src/skills.ts` | skill 扫描 + 加载 + 解析 |
| `skills/git-commit/SKILL.md` | 示例 skill |
| `skills/refactor/SKILL.md` | 示例 skill |
| `test/unit/skills.tsx` | skill 层测试 |

---

## 10. 下一步

Phase 1 完成,可选路径:

- **A. 修 P0**(grep 递归 / bash timeout / 测试结构)— REVIEW.md 里列了
- **B. 实现 skill 层** — 按本文档 §4 落地
- **C. 进 Phase 2**(会话持久化 + slash command)

**推荐顺序**: A → B → C。先把基础打牢,再加扩展,再做产品功能。

但你自己定。