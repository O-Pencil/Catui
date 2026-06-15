<!--
课程 C9 配套:核心↔O-Pencil↔Gateway 集成映射 + SDK 漂移 finding。
只映射、只记录,不在本次迁移下游代码。锚点为撰写时事实(catui-agent 1.1.10)。
-->

# ecosystem-map — 核心 ↔ O-Pencil ↔ Gateway 集成

「核心引擎 → GUI 展现 → Gateway 触手」。三仓都在 `/root/workspace/`。

```
                       catui-agent(本仓,核心引擎)
                       publish: catui-agent 1.1.10 / SDK 符号 AgentSession, AgentSessionEvent
                              ▲                       ▲
        consume SDK          │                       │         consume SDK
        ┌─────────────────────┘                       └─────────────────────┐
   O-Pencil(GUI)                                                   Pencil-Agent-Gateway(触手)
   catgo-desktop · Electron                                        pencil-agent-gateway
   src/main/lib/nanopencil/                                        src/engine/nano-adapter.ts
```

## 各仓定位

| 仓库 | 包名 | 角色 | 怎么消费核心 |
|------|------|------|------|
| catui-agent | `catui-agent`(SDK 符号挂 `@catui/agent`) | 核心引擎 | 自身 |
| O-Pencil | `catgo-desktop` | GUI 客户端(Electron) | 主进程封装层 `src/main/lib/nanopencil/{session,types}.ts` 引 `AgentSession`、`AgentSessionEvent` |
| Pencil-Agent-Gateway | `pencil-agent-gateway` | 对外集成网关 | 适配器 `src/engine/nano-adapter.ts:43-44` 引 `AgentSession`、`AgentSessionEvent` |

## 集成契约(两个下游消费的核心 SDK 面)

下游主要消费**同一组**公共符号(经 `@catui/agent` 根导出 / `packages/protocol` 契约):
- `AgentSession` —— 会话句柄(prompt/事件/工具)。
- `AgentSessionEvent`(O-Pencil 里 alias 成 `AgentEvent`)—— 会话事件流,GUI/网关据此渲染/转发。

对应核心侧:C1(Agent Loop)、C2(会话/事件)、C3(模型)。学到 C9 时,看下游如何把这组符号接成 GUI 事件 / 网关中继即可。

## ⚠ 漂移 finding(只记录,本次不迁移)

**核心已改名,下游仍绑旧包**:

| | 下游当前 import | 核心现况 |
|---|---|---|
| O-Pencil `src/main/lib/nanopencil/{session,types}.ts` | `@pencil-agent/nano-pencil` | 已发布为 `catui-agent` 1.1.10 |
| Gateway `src/engine/nano-adapter.ts` | `@pencil-agent/nano-pencil` | 同上 |

- **影响**:下游 `npm install` 仍拉旧包 `@pencil-agent/nano-pencil`,与改名后的核心脱节;新核心的修复/能力进不到 GUI 与网关。
- **后续迁移入口**(单独立项,不在本次):
  1. 下游 `package.json` 依赖 `@pencil-agent/nano-pencil` → 核心新包名(确认核心发布 `name`:`catui-agent`,或如恢复 scoped 则 `@catui/agent`)。
  2. 下游 import specifier 全量替换(O-Pencil `src/main/lib/nanopencil/`、Gateway `src/engine/nano-adapter.ts` 等,见各仓 `rg "@pencil-agent/nano-pencil"`)。
  3. 校验 SDK 符号面未破(`AgentSession`/`AgentSessionEvent` 仍在新包根导出)。
  4. 各仓自测(O-Pencil 起 Electron 跑一轮;Gateway 适配器 e2e)。
- **本框架不改下游代码**——此处仅作为 C9 的学习材料 + 迁移待办登记。

## 给学习者的提示

学 C9 时这是最好的"真实排查练习":一个改名导致的跨仓断点,顺着 import specifier → package.json 依赖 → 发布包名,正好把"核心 SDK 面、下游怎么消费、版本/品牌如何漂移"一次走通。
