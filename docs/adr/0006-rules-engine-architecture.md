# ADR-0006: Guard 规则引擎架构 — 用声明式规则替代一刀切拦截

将 Guard 从三态状态机（normal → skill_active → guarded）+ 一刀切拦截 改造为
**两态状态机 + 声明式规则引擎 + 透明规则注入**，实现对 AI 操作的精细分级管控。

**Status**: superseded by ADR-0007 (Plan Mode) — never accepted, design replaced by Plan Mode approach

## Context

Guard 当前的 guarded 模式对所有"写入"操作一刀切拦截，只通过路径白名单放行少数路径
（`.scratch/`、`docs/`、`CONTEXT.md`）。用户反馈此方式"太粗暴"——当 AI 的操作虽在
受限目录但意图无害时，直接拦截并中止 agent turn 的体验很差。

同时，Guard 缺乏对 AI 的"事先告知"：AI 在被拦截之前并不知道规则边界，只能通过试错
来学习。

经过 `grill-with-docs` 技能会话的深入讨论，参考了
[pi-permission-system](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system)
的设计，达成以下 13 项设计决策。

## Decision

### 1. 用规则引擎替换 guarded 模式（ADR-0001 局部替换）

状态机从三态简化为两态：

```
                    input target skill command
  ┌─────┐  ──────────────────────────────────► ┌──────┐
  │normal│                                      │skill │
  │      │◄──── /guard:allow ────────────────── │_active│
  └─────┘                                       └──────┘
```

- **normal**：无约束，所有工具调用正常放行。
- **skill_active**：技能对话进行中，所有工具调用放行（技能需要完整权限）。
- **guarded 模式被移除**，取而代之的是：skill_active 结束后（`agent_settled`）进入
  **规则评估模式**。此模式下每步工具调用都经过规则引擎评估，但不限制只读操作。

### 2. 规则引擎的三态响应

规则引擎对每个操作输出三个结果之一，而非二元的放行/拦截：

| 结果 | 行为 |
|------|------|
| `allow` | 静默放行 |
| `ask` | 通过 `ctx.ui` API 弹出确认对话框，用户同意后才执行 |
| `deny` | 拦截操作并返回错误，告知 AI 触发了哪条规则且不要重试 |

### 3. 透明规则注入 (`/guard-start`)

新增 `/guard-start` 命令，功能：
1. 将当前生效的声明式规则注入到 AI 的 system prompt 中
2. 注入内容包括：**规则摘要**（自然语言描述）、**完整配置**（JSON 格式）、**约束说明**（违规后果）
3. 同时启用规则引擎，对后续操作进行 allow/ask/deny 评估
4. 通过 `/guard:allow` 退出，移除 prompt 并回到 normal 状态

```
╔══════════════════════════════════════════════════════════════╗
║  🔒 Guard 规则已激活（/guard:allow 可退出）                ║
║                                                             ║
║  【规则摘要】                                               ║
║  • docs/ 目录：允许自由写入                                 ║
║  • .scratch/ 目录：允许自由写入                             ║
║  • src/ 目录：需要用户确认                                  ║
║  • .env 文件：禁止操作                                      ║
║                                                             ║
║  【完整配置】                                               ║
║  { "path": { "*": "allow", "*.env": "deny" }, ... }         ║
║                                                             ║
║  【约束说明】                                               ║
║  • deny 操作会被拦截，不要重试                              ║
║  • ask 操作会弹出确认对话框，需用户同意后执行               ║
╚══════════════════════════════════════════════════════════════╝
```

### 4. 配置格式兼容 pi-permission-system

采用与 pi-permission-system 相同的 JSON 配置格式和通配符匹配语义：

```jsonc
{
  "permission": {
    "*": "allow",          // 默认策略（兜底）
    "path": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    },
    "bash": {
      "*": "ask",
      "rm -rf *": "deny",
      "git status": "allow"
    },
    "external_directory": {
      "*": "ask",
      "~/.cargo/registry/*": "allow"
    },
    "read": "allow",
    "write": { "docs/**": "allow", "src/**": "ask", "*.env": "deny" }
  }
}
```

### 5. 独立实现（非 pi-permission-system 插件）

Guard 的规则引擎独立实现，不依赖 pi-permission-system 作为 gate/authorizer 插件。
但配置格式和匹配语义保持兼容，方便用户迁移。

### 6. 默认策略可配置

`"*"` 键指定未匹配任何规则时的兜底行为：

- `"*": "allow"` — 白名单模式：只阻止明确声明的操作（推荐，与当前 Guard 理念一致）
- `"*": "ask"` — 最小权限模式：未匹配规则的操作都询问用户

### 7. 支持的 surface 全集

| Surface | 说明 | 示例 |
|---------|------|------|
| `path` | 跨工具路径规则，适用于所有文件操作 | `"*.env": "deny"` |
| `bash` | bash 命令模式匹配 | `"rm -rf *": "deny"` |
| `external_directory` | CWD 边界访问控制 | `"~/.cargo/registry/*": "allow"` |
| `read` | read 工具路径规则 | `"*.md": "allow"` |
| `write` | write 工具路径规则 | `"src/**": "ask"` |
| `edit` | replace 工具路径规则 | `"src/**": "ask"` |
| `grep` / `find` / `ls` | 其他内置工具路径规则 | — |
| 扩展工具名 | 通过 `input.path` 或注册的 access extractor | — |

### 8. 路径匹配策略

使用通配符模式匹配（`*` 匹配任意字符包括 `/`，`?` 匹配单个字符）。
**不做 symlink 解析**——Guard 不是安全边界，接受路径遍历等绕过风险。

路径规范化：
- 前导 `./` 解析
- `~` 展开为用户 home 目录
- 相对路径根据当前 CWD 解析为绝对路径

### 9. 配置来源和合并策略

分层加载，最后匹配获胜（与 pi-permission-system 对齐）：

| 层级 | 路径 | 优先级 |
|------|------|--------|
| 全局 | `~/.pi/agent/extensions/pi-guard/config.json` | 低（基垫） |
| 项目 | `<project>/.pi/pi-guard.json` | 高（覆盖） |

项目初始化时自动创建 `.pi/pi-guard.json`，预填推荐规则模板。
Guard 自身不硬编码默认规则——推荐模板作为文件内容写入，用户按需修改。

### 10. Ask 交互方式

通过 pi 的 `ctx.ui` API 显示确认对话框：
- TUI 环境：弹出内联对话框，用户按键确认/拒绝
- headless/CI 环境（无 UI）：返回错误消息说明"此操作需要用户确认"

### 11. 触发方式可配置

```jsonc
{
  "permission": { ... },
  "autoActivateAfterSkill": true   // 可选，默认 true
}
```

- `true`（默认）：检测到目标技能命令后自动进入 skill_active，技能结束后自动激活规则引擎 + 注入规则 prompt
- `false`：仅通过 `/guard-start` 手动激活

### 12. 退出方式

- `/guard:allow`：移除规则 prompt，关闭规则引擎，回到 normal 状态
- 复用现有命令名称，行为从"关闭守卫"变为"关闭规则引擎"

### 13. 与现存机制的关系

| 现存机制 | 变化 |
|---------|------|
| 三态状态机 | 简化为两态（移除 guarded） |
| `isBlocking()` | 不再使用（无 blocking 语义） |
| `isPathAllowed()` | 被规则引擎的 path surface 取代 |
| `isBashReadonly()` | 被规则引擎的 bash surface 取代 |
| 路径白名单 `allowWritePaths` | 被 path surface 的规则取代 |
| `/guard:allow` | 保留，行为适配 |
| session resume | 仍需重建规则引擎状态 |
| 目标技能检测 `isTargetSkill()` | 保留 |

## Considered Options

- **保留三态 + 路径白名单（现状）**：一刀切拦截体验差，AI 无法预知规则边界。
- **全盘采用 pi-permission-system**：需要将其作为外部依赖引入，增加耦合。独立实现
  更灵活且与当前代码结构一致。
- **纯 prompt 注入无 enforcement**：告知规则但不强制执行，依赖 AI 自律。不可靠。
- **纯 enforcement 无 prompt 注入**：AI 只能通过试错学习规则。体验差。

## Consequences

- Guard 的核心机制从"在工具调用层暴力拦截"变为"在 AI 行为层通过规则+提示引导"。
- 用户体验从"突然被阻止"变为"事先知道规则，操作有分级反馈"。
- 配置格式与 pi-permission-system 兼容，用户可跨系统复用规则。
- 实现工作量较大：需实现规则引擎（通配符匹配、多 surface 评估、ask 对话框）、prompt
  注入、配置加载与合并、`/guard-start` 命令。
- 向后兼容性：现有的 `targetSkills`、`allowWritePaths` 等配置项不再使用，需迁移。
  ADR-0001（三态状态机）和 ADR-0002（bash 命令分类）、ADR-0003（路径白名单）标记为
  superseded。
- 单元测试需重写：不再测试"是否拦截"，改为测试"规则匹配结果是否与预期一致"。

## Related ADRs

- ADR-0001: Three-State Guard State Machine（将被 superseded）
- ADR-0002: Bash Command Classification（将被 superseded）
- ADR-0003: Path Allowlist for Write/Replace Tools（将被 superseded）
- ADR-0004: Bash Path Allowlist（已 superseded by ADR-0005）
- ADR-0005: Simplify Bash Permission Control（将被 superseded）
