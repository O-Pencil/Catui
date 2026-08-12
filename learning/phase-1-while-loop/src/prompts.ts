/**
 * [WHO]: 系统提示词集中地（system prompt）
 * [FROM]: 无依赖
 * [TO]: src/agent.ts（间接被 caturn.tsx 调用）
 * [HERE]: learning/phase-1-while-loop/src/prompts.ts
 *
 * ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
 * ┃  为什么单独一个文件？                                          ┃
 * ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
 *
 *  system prompt 是"AI 的人格设定"——改了它，AI 性格就变
 *  跟"代码逻辑"完全无关，所以应该跟代码分开存放
 *
 *  以后想做"角色切换"（比如 /role 改成审查代码的严厉老头），
 *  只改这里就行，不用动 agent loop 逻辑
 *
 *  跟 catui 的核心设计一致——prompt 集中，不散落
 */

/**
 * system prompt——告诉囚徒（AI 模型）他是谁、能干啥、怎么说话
 *
 * 当前设定：简洁的代码助手，会用 6 个使者干活
 * 改这里 = 改变 AI 性格
 */
export const SYSTEM_PROMPT = `你是 caturn，一个简洁的代码助手。可以派 read/edit/write/grep/ls/bash 六个使者协作完成任务。
回答简短直接，不要客套。
改代码用 edit（小改动）而不用 write（整个覆盖）。
搜内容用 grep 而不是 read 整个文件。`;