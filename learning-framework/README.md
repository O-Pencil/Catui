<!--
便携学习框架 + catui 课程目录。
- 通用「学一个代码库 → 个人知识库」框架,多人复用、与 catui 运行代码解耦。
- 拟随 O-Pencil/skills 与 oh-my-wiki 同住,后续可整体迁出。
- 本目录【不含任何学习者个人结果】。学习结果只在各人自己的 oh-my-wiki / Obsidian vault(用户空间,out-of-repo)。
-->

# learning-framework — 「学一个代码库」通用学习框架

一套**可复用、与具体仓库解耦**的方法,把「读代码」变成「学会 + 长期记住」。
教学引擎复用 catui 的 `teach` 扩展(渐进式教学),知识库底座复用 `@cunyu666/oh-my-wiki`(个人 Obsidian 兼容知识库)。本框架是把两者粘起来的「上面一层」+ 一个具体的 **catui 课程目录**。

## 三方分工

| 角色 | 谁 | 负责 |
|------|----|------|
| 教学引擎(pedagogy) | catui `teach` 扩展 | 渐进式 Hook→L1→L2→L3→Bridge→Takeaways、按程度适配、来源校验、查理解 |
| 知识库底座(storage) | `@cunyu666/oh-my-wiki` | 个人 vault 的目录/双链/frontmatter/图谱、`/wiki:*` 命令 |
| 粘合 + 拆解(本框架) | `learning-framework/` | 怎么把代码库拆成可学的概念、怎么教、怎么把理解沉淀进个人 vault |

> **关键边界**:框架只读被学习的仓库当对象;**学习结果(你的理解/卡点/笔记)只写进你自己的个人 vault,绝不进 catui 仓库**。多人各自一份 vault,互不污染。

## 目录

| 文件 | 给谁看 | 内容 |
|------|--------|------|
| `framework.md` | 想了解全貌 | 方法论 + 三方分工 + 运行时流程 |
| `wizard.md` | 教学 Agent | 目标采访向导(问目标/已知/成功标准 → 裁剪个性化路径) |
| `teaching-method.md` | 教学 Agent | 怎么开一课(teach 渐进式 + file:line 来源 + 完成判据) |
| `kb-integration.md` | 教学 Agent | 怎么把每课理解写进学习者 oh-my-wiki 个人 vault |
| `catui-course-pack.md` | 学习者 / 教学 Agent | **catui 基础分类 C0–C10**(课程目录:概念/为什么/file:line/DIP 节点/排查入口/边) |
| `ecosystem-map.md` | 学习者 / 教学 Agent | 核心↔O-Pencil↔Gateway 集成 + `@pencil-agent` 漂移(课程 C9 配套) |

## 三类读者的入口

- **学习者**:装 `npm i -g @cunyu666/oh-my-wiki`;读 `catui-course-pack.md` 选感兴趣的概念;让任一支持 `teach` 的 Agent 按 `wizard.md` 给你裁路径、按 `teaching-method.md` 开课。
- **教学 Agent**:按序读 `wizard.md` → `teaching-method.md` → `kb-integration.md`,用 `catui-course-pack.md` 当大纲。
- **想把框架用到别的仓库**:`framework.md` + `teaching-method.md` + `kb-integration.md` 是通用的;只需为新仓库另写一份「course-pack」(基础分类)。

## 前置

- `@cunyu666/oh-my-wiki`(知识库底座)。
- 一个能用 `teach` 方法教学的 Agent(catui 自带 `teach` 扩展;其它 Claude 也可照 `teaching-method.md` 教)。
- (可选)Obsidian,用来可视化个人 vault 的知识图谱。oh-my-wiki 产物 Obsidian 兼容,但不依赖 Obsidian app。
