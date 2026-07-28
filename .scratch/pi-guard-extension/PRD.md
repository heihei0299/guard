# Pi Guard Extension — PRD

## Problem Statement

项目中 AGENTS.md 明确规定了"对话后不自动操作"的纪律：

> 使用 `grill-with-docs`、`wayfinder`、`grill-me`、`to-spec`、`to-tickets` 技能与用户完成讨论后，不得对工作目录下的任何文件执行写操作（创建、修改、删除），不得执行任何命令。如需执行上述操作，必须先获得用户明确确认。

然而这一纪律纯靠 AI 自觉遵守，没有机制层面的保障。AI 可能在技能对话结束后擅自开始写文件或执行命令，违反项目规定。

## Solution

开发一个 pi 扩展（npm package），在工具（tool）调用层面强制执行上述纪律。扩展实现一个**三态守卫**：

- **`normal`** — 正常模式，不拦截任何操作
- **`skill_active`** — 目标技能正在执行中，允许所有操作（技能自身工作需要）
- **`guarded`** — 技能对话已结束，拦截所有写/编辑/bash 操作，并强制终止 agent 回合

用户通过 `/guard:allow` 命令暂时关闭守卫模式（回到 `normal`），后续再触发目标技能时守卫可重新激活。

## User Stories

1. 作为一名项目维护者，当我在 `/skill:to-spec` 对话结束后 AI 擅自写代码时，我希望它被强制阻止，以免产生未授权的变更。
2. 作为一名项目维护者，当我在 `/skill:to-tickets` 对话结束后 AI 擅自执行命令时，我希望工具调用被拦截且 agent 回合被终止，并看到明确的拦截原因。
3. 作为一名项目维护者，当我在 `/skill:grill-me` 对话结束后 AI 尝试再次写文件时，我希望守卫模式能持续生效，直到我通过 `/guard:allow` 明确授权。
4. 作为一名项目维护者，当我使用 `/guard:allow` 暂时关闭守卫后再次调用目标技能时，我希望守卫能自动重新激活。
5. 作为一名项目维护者，当我 `/resume` 一个旧 session 时，我希望守卫状态能从会话历史中正确重建。
6. 作为一名项目维护者，我希望能够通过配置文件自定义哪些技能触发守卫，以适应不同项目的需求。
7. 作为一名项目维护者，当守卫拦截了操作时，我希望看到中文的拦截提示和 `ctx.abort()` 终止信号，确保 AI 立即停止。

## Implementation Decisions

### 技术方案

- **语言 / 运行时**：TypeScript，pi extension API
- **包类型**：npm package（pi package），支持 `pi install npm:@scope/name`
- **入口**：`src/index.ts`，导出默认的 ExtensionAPI 工厂函数
- **无外部运行时依赖**（仅 `peerDependencies`：`@earendil-works/pi-coding-agent`、`typebox`）

### 包结构

```
pi-no-unauthorized-actions/
├── package.json          # name + pi manifest
├── src/
│   └── index.ts          # 扩展主逻辑
└── README.md
```

### 三态守卫状态机

```
                   输入目标技能命令
  ┌─────┐  ──────────────────────► ┌──────┐
  │normal│                          │skill │
  │      │◄──── /guard:allow ────── │_active│
  └─────┘                          └──┬───┘
       ▲                              │
       │                   agent_settled
       │                              ▼
       │                          ┌────────┐
       └──── /guard:allow ─────── │guarded │
                                  └────────┘
```

- **`normal`** → **`skill_active`**：用户输入 `/skill:target-name`
- **`skill_active`** → **`guarded`**：`agent_settled` 事件触发（技能处理完成）
- **`guarded`** → **`normal`**：用户执行 `/guard:allow` 命令
- **`guarded`** → **`skill_active`**：用户再次输入 `/skill:target-name`
- **`normal`** → **`normal`**：非目标技能命令不触发状态变化

### 守卫拦截行为

守卫模式下拦截以下工具调用：

| 工具 | 行为 |
|------|------|
| `write` | 拦截 + `ctx.abort()` |
| `edit` | 拦截 + `ctx.abort()` |
| `bash` | **全部拦截**（包括 ls/cat 等只读命令），+ `ctx.abort()` |
| `read`/`grep`/`find`/`ls` | 放行（只读，但 `bash` 已全部拦截） |

**拦截理由内容（中英文双语）**：

```
🔒 技能讨论已完成，禁止擅自操作。
Guard mode: skill conversation completed, unauthorized actions blocked.
请使用 /guard:allow 临时关闭守卫。
Use /guard:allow to temporarily disable guard mode.
```

### `/guard:allow` 命令

- 注册为 pi 命令 `/guard:allow`
- 功能：从 `guarded` 或 `skill_active` 状态切换到 `normal`
- 效果：**暂时关闭**守卫，后续目标技能调用仍可重新激活守卫
- 调用时通过 `ctx.ui.notify` 显示提示

### Session 恢复

- 在 `session_start` 事件中扫描会话历史
- 如果历史中包含目标技能调用，直接进入 `guarded` 状态
- 通过 `ctx.sessionManager.getEntries()` 遍历条目，检查自定义条目或消息内容
- 用户可通过 `/guard:allow` 解除

### 可配置的目标技能列表

默认值（AGENTS.md 中规定的 5 个技能）：

```typescript
const DEFAULT_TARGET_SKILLS = [
  "to-spec",
  "to-tickets",
  "grill-me",
  "grill-with-docs",
  "wayfinder",
];
```

可通过扩展初始化时传入配置覆盖，或通过 `pi.appendEntry` 持久化配置。

### 使用的 pi 事件

| 事件 | 用途 |
|------|------|
| `session_start` | 重置/重建状态 |
| `input` | 检测目标技能命令 |
| `agent_settled` | 技能完成 → 进入守卫模式 |
| `tool_call` | 拦截 write/edit/bash |

## Testing Decisions

- 单元测试覆盖状态机状态转换逻辑（normal → skill_active → guarded → normal）
- 边界情况：多个技能连续调用、session 恢复、/reload 后状态重建
- 验证 `tool_call` 拦截是否正确区分目标工具
- 验证 `/guard:allow` 命令能正确切换状态

## Out of Scope

- 不支持非 pi 平台的类似守卫功能
- 不拦截通过 `pi.exec` 在扩展内部发起的命令（扩展自身操作假定是可信的）
- 不提供图形化配置界面（通过 package.json / settings.json 配置）
- 不覆盖非标准工具名称（如 `my_custom_writer`），除非显式配置

## Further Notes

- 扩展仅在本项目（chajian）环境下经过验证，后续可推广到其他 pi 项目
- `ctx.abort()` 的行为需要在实际使用中验证效果，必要时可降级为仅拦截不终止
- 拦截反馈使用中文为主、英文为辅的双语提示，符合项目语言环境
