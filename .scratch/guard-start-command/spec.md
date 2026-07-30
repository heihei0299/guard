# `/guard:start` 命令 + 持久状态显示

Status: ready-for-agent

## Problem Statement

当前守卫状态机只有两条路径进入 guarded 模式：
1. `normal → skill_active → agent_settled → guarded`（通过目标技能间接进入）
2. `session_start` 时从历史记录重建 guarded 状态

用户缺少一条**直接从 normal 进入 guarded** 的快捷命令。此外，进入 guarded 后没有任何持续的视觉反馈告知用户当前守卫状态，用户只有等到 write/replace 被拦截时才知道自己处于 guarded 模式。

## Solution

1. 新增 pi 命令 `/guard:start`，输入后直接从 normal 跳转到 guarded 模式
2. 在 footer 区域通过 `ctx.ui.setStatus()` 持久显示当前守卫状态，并在每次状态变化时更新

## User Stories

1. 作为用户，我想输入 `/guard:start` 后立即进入守卫模式，以便在开始编写代码前主动锁定写入权限
2. 作为用户，我想在 footer 区域始终看到当前守卫状态（normal/skill_active/guarded），以便随时了解自己是否处于保护之下
3. 作为用户，我在 session 恢复后也能看到当前守卫状态，以便确认恢复后的保护级别
4. 作为用户，我在执行 `/guard:allow` 后能看到状态变回 normal，以便确认守卫已关闭
5. 作为用户，我在技能对话开始/结束时能看到状态自动变化（skill_active → guarded），以便确认守卫正确响应了技能生命周期

## Implementation Decisions

### 状态机层 (`guard.ts`)

- 新增 `handleGuardStart(): void` 方法
- 仅在 state === "normal" 时执行 `state = "guarded"` 转移
- 在 skill_active 或 guarded 状态下调用时无操作（no-op）
- 这是纯函数式变更，无需引入新状态或修改现有转移逻辑

### 扩展层 (`index.ts`)

- 注册 `/guard:start` 命令，通过 `pi.registerCommand("guard:start", ...)`
- 添加 `updateGuardStatus(ctx, guard)` 辅助函数，调用 `ctx.ui.setStatus("pi-guard", statusText)` 在 footer 显示状态
- 在以下所有状态变更点调用 `updateGuardStatus`：
  - `session_start` handler（reset/rebuild 后）
  - `input` handler（handleInput 后）
  - `agent_settled` handler（handleAgentSettled 后）
  - `/guard:allow` handler（handleAllow 后）
  - `/guard:start` handler（handleGuardStart 后）
- 使用 `ctx.hasUI` 保护，仅在 UI 模式下设置状态显示
- 状态显示文案中英双语：
  - normal: 不显示状态（或显示 "Guard: off"）
  - skill_active: "🔒 Skill active"
  - guarded: "🔒 Guarded"

### 状态转换表（更新后）

```
                    ┌─────────────────────┐
                    │      normal          │
                    └──┬────────┬─────────┘
                       │        │
                /skill:xxx   /guard:start
                       │        │
                       ▼        ▼
                ┌──────────┐  ┌─────────┐
                │skill_    │  │         │
                │active    │  │ guarded │
                └────┬─────┘  └──┬──────┘
                     │           │
              agent_settled  /guard:allow
                     │           │
                     └─────┬─────┘
                           ▼
                     ┌─────────┐
                     │ normal   │
                     └─────────┘
```

## Testing Decisions

### 好的测试原则
- 只测外部行为，不测实现细节
- 状态机测试是纯函数测试，不需要 mock
- 扩展集成测试使用 mock Pi API 模拟事件

### 测试模块

#### `guard.test.ts` — 状态机单元测试
- `handleGuardStart()` 从 normal 转移到 guarded
- `handleGuardStart()` 后 `isBlocking()` 返回 true
- `handleGuardStart()` 在 skill_active 状态不改变状态
- `handleGuardStart()` 在 guarded 状态不改变状态
- 完整流程：normal → /guard:start → guarded (blocking) → /guard:allow → normal (not blocking)

#### `index.test.ts` — 扩展集成测试
- `/guard:start` 命令已注册
- `/guard:start` 从 normal 进入 guarded，write 被拦截
- `/guard:start` 在 guarded 状态下显示 "already guarded" 通知
- 状态变更时 `setStatus` 被正确调用

### 先例参考
- `handleAllow` 的测试模式（包括命令注册和状态验证）完全适用于 `handleGuardStart`
- `tool_call` 的 block 测试可直接复用

## Out of Scope

- 不修改现有 `skill_active → guarded` 的流转逻辑
- 不新增其他守卫相关命令（如 `/guard:stop`）
- 不修改 bash 命令分类或路径白名单逻辑
- 不处理 CI/CD 或 GitHub 集成
- 不新增 ADR（该决策可逆、不意外、无非此即彼的 trade-off）

## Further Notes

- 命令名 `/guard:start` 已在 grill-with-docs 会话中与用户敲定
- "一直显示当前状态" 的实现方式是通过 `ctx.ui.setStatus()` 在 footer 显示，非 notify 弹出
- 状态显示文案待定，可在实现阶段微调
