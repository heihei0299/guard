# Guard 规则引擎架构 — 用声明式规则替代一刀切拦截
Status: ready-for-agent


## Problem Statement

Guard 当前的 guarded 模式对技能对话后的所有"写入"操作（write/replace/bash 写入命令）
一刀切拦截，只通过硬编码的路径白名单（`.scratch/`、`docs/`、`CONTEXT.md`）放行少数路径。
当 AI 的操作虽在受限目录但意图无害时，直接拦截并中止 agent turn 的体验很差：

- AI 不知道规则边界，只能通过试错学习
- 没有分级机制：要么全放行（normal），要么全拦截（guarded），没有"询问用户"/"警告"的中间态
- 路径白名单的维护成本高，每加一个允许路径就要改配置

用户反馈："直接阻止太粗暴，有没有好的方法？"

## Solution

将 Guard 从**三态状态机 + 一刀切拦截**改造为**两态状态机 + 声明式规则引擎 + 透明规则注入**，
实现对 AI 操作的精细分级管控（allow / ask / deny）。参考了
[pi-permission-system](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system)
的分级权限模型。

核心变化：
1. 移除 guarded 状态，状态机简化为 normal ↔ skill_active
2. skill_active 结束后进入**规则评估模式**，每步操作走规则引擎评估
3. 新增 `/guard-start` 命令，将规则透明注入 AI system prompt
4. 配置格式兼容 pi-permission-system 的 JSON schema
5. 支持 `allow` / `ask` / `deny` 三级响应

## User Stories

1. As a Guard 用户, I want 规则声明式定义（JSON 配置支持通配符模式匹配）, so that 不需要修改代码就能改变 AI 的约束边界

2. As a Guard 用户, I want 规则引擎支持 allow/ask/deny 三级响应, so that 拦截不再是一刀切，用户可以弹窗确认后再放行

3. As a Guard 用户, I want 输入 `/guard-start` 后规则注入 AI system prompt, so that AI 在执行操作前就能看到规则边界，自我审查

4. As a Guard 用户, I want 规则在技能对话结束后自动激活（可配置开关）, so that 不需要手动输入 `/guard-start` 就能获得保护

5. As a Guard 用户, I want `/guard:allow` 退出规则保护并移除 prompt, so that 需要自由操作时可以一键关闭

6. As a Guard 用户, I want 规则支持 `path` surface（跨工具路径匹配）, so that 一条 `"*.env": "deny"` 能同时保护 read/write/bash 中的所有 .env 文件操作

7. As a Guard 用户, I want 规则支持 `bash` surface（命令模式匹配）, so that 可以定义像 `"rm -rf *": "deny"` 这样的高危命令规则

8. As a Guard 用户, I want 规则支持 `external_directory` surface（CWD 边界控制）, so that 可以允许特定外部目录（如 `~/.cargo/registry/`）而无需完全开放

9. As a Guard 用户, I want 未匹配规则的操作用 `"*": "allow"` 或 `"*": "ask"` 兜底, so that 可以根据安全需求选择白名单模式或最小权限模式

10. As a Guard 用户, I want 项目初始化时自动创建 `.pi/pi-guard.json` 推荐模板, so that 开箱即用，不硬编码默认规则

11. As a Guard 用户, I want 配置从全局和项目两级加载合并（全局垫底、项目覆盖）, so that 团队可以统一安全基线，个人项目按需放宽

12. As a Guard 用户, I want `ask` 状态在 TUI 环境中弹出确认对话框, so that 可以在当前对话流中直接确认/拒绝操作，不用切换到外部工具

13. As a AI coding agent, I want 在当前有效规则的约束下行动前就知道什么能做什么不能做, so that 我可以在执行前自我审查，避免触发拦截

## Implementation Decisions

### 实现要求：严格按照 pi-permission-system 实现

本实现应严格按照 [pi-permission-system](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system) 的实现模式和 API 设计，而非仅兼容其配置格式。以下逐模块列出参照点。

#### Rule 数据结构

每一条规则是一个原子单元：
```typescript
interface Rule {
  surface: string;
  pattern: string;
  action: "allow" | "ask" | "deny";
  reason?: string;
  layer?: "default" | "baseline" | "config" | "session";
  origin: "global" | "project" | "agent" | "builtin" | "session";
}
```

Ruleset 是 `Rule[]`，`evaluate()` 使用 `findLast` 从尾部向前扫描（最后匹配获胜）。

#### 通配符匹配 wildcardMatch

实现与 pi-permission-system 的 `wildcardMatch()` 完全一致：
1. 调用 `expandHomePath()` 展开 `~` 和 `$HOME`
2. 按 `*` 拆分 pattern，对每部分调用 `escapeRegExp()`，将 `?` 替换为 `.`
3. 用 `.*` 重新 join
4. 如果 pattern 以 ` *` 结尾（空格+通配符），将尾部 ` .*` 替换为 `( .*)?` 使参数可选
5. 包装为 `^...$` 正则，使用 `s` flag（dotAll）
6. 编译为 `CompiledWildcardPattern` 缓存

#### 规则评估函数

**`evaluate(surface, value, rules, defaultAction?)`** — 单值评估：
- 从 ruleset 末尾向前 `findLast`，找到 surface 和 pattern 都通配符匹配的规则
- 无匹配时返回合成默认（`{ surface, pattern: "*", action: defaultAction ?? "ask", origin: "builtin" }`）

**`evaluateFirst(surface, values, rules)`** — 多候选首匹配：
- 对 values 依次执行 evaluate，返回第一个非默认层的匹配结果
- 全部匹配默认则返回第一个 value 的结果

**`evaluateAnyValue(surface, values, rules)`** — 多候选跨别名匹配：
- 保留规则排序跨别名：任一 value 上匹配到的最后一条规则获胜
- 用于 path surface 的多别名路径匹配

**`evaluateMostRestrictive(surface, values, rules)`** — 多值最严格：
- deny > ask > allow，首次遇到 deny 短路返回

#### 规则组合与变换

**`composeRuleset(defaults, baseline, config)`** → `[...defaults, ...baseline, ...config]`
**`synthesizeDefaults(universalDefault, origin)`** → 单条 `{ surface: "*", pattern: "*", action, layer: "default" }`
**`synthesizeBaseline(configRules)`** → 条件合成基线规则（MCP 元操作自动放行，Guard 中可能不需要）
**`rewriteAsksToYolo(rules)`** → 所有 ask → allow（yolo 模式）
**`floorAllowsToAsk(rules)`** → 所有 allow → ask（fail-closed clamp）

#### 配置标准化 normalizeFlatConfig

将 JSON 配置转换为扁平的 Ruleset：
- `"surface": "string"` → `{ surface, pattern: "*", action }`
- `"surface": { "pattern": "action" }` → 逐条展开
- 支持 `DenyWithReason`：`{ action: "deny", reason: "..." }`
- 无效值静默跳过

#### 路径规范化 path-normalizer

**`expandHomePath(path)`** — 展开 `~` 和 `$HOME`
**`normalizePathPolicyLiteral(path)`** — trim → 剥包裹引号 → 剥 `@` 前缀 → 展开 `~`/`$HOME`
**`getPathPolicyValues(path, options)`** — 返回等效路径别名列表：
- `[absolutePath, cwdRelativePath, literalPath]`（去重）
- 支持 `cwd` 和 `resolveBase` 选项

#### PermissionManager.check() 流程

1. 接收 `ResolvedAccessIntent`（surface, values, agentName）
2. resolvePermissions(agentName) → 组合 config rules + session rules
3. yolo 模式检查：若开启则 `rewriteAsksToYolo`
4. 根据 surface 类型选择评估策略：
   - path surface → evaluateAnyValue（多别名）或 evaluateMostRestrictive（跨工具）
   - 其他 surface → evaluateFirst
5. 返回 `PermissionCheckResult`（state, reason, matchedPattern, source, origin）
6. `applyPermissionGate()` 根据 state 执行后续动作（弹窗/拦截/放行）

### 模块划分

```
pi-guard-extension/src/
├── guard.ts                    # 两态状态机（修改现有文件）
│   - 移除 guarded 状态和 isBlocking()/isPathAllowed()
│   - 保留 normal ↔ skill_active 转换
│   - 新增 activateRuleEngine() / deactivateRuleEngine()
├── rule-engine.ts              # 规则引擎（新文件）
│   - 参照 pi-permission-system 的 rule.ts + synthesize.ts + normalize.ts
│   - Rule, Ruleset, RuleOrigin 类型
│   - wildcardMatch / compileWildcardPattern
│   - evaluate / evaluateFirst / evaluateAnyValue / evaluateMostRestrictive
│   - composeRuleset / synthesizeDefaults
│   - rewriteAsksToYolo / floorAllowsToAsk
│   - normalizeFlatConfig
├── path-normalizer.ts          # 路径规范化（新文件）
│   - 参照 pi-permission-system 的 path-normalization.ts
│   - normalizePathPolicyLiteral / getPathPolicyValues / expandHomePath
├── permission-config.ts        # 配置加载与合并（新文件）
│   - loadPermissionConfig(projectRoot?) → merged FlatPermissionConfig
│   - 分层：全局 ~/.pi/agent/extensions/pi-guard/config.json
│           项目 <project>/.pi/pi-guard.json
├── prompt-injector.ts          # 规则 prompt 生成（新文件）
│   - buildGuardPrompt(rules, state) → 格式化的 system prompt
│   - 包含规则摘要（自然语言）+ 完整配置（JSON）+ 约束说明
├── bash-command-classifier.ts  # 保留（不再被 Guard 直接调用）
└── index.ts                    # 扩展入口（修改）
    - 注册 /guard-start 命令
    - 改造 tool_call handler：规则引擎评估替代 isBlocking()
    - ask 状态调用 ctx.ui 弹窗确认
    - deny 状态拦截并返回规则信息
```

## Testing Decisions

### 测试原则

- 规则引擎核心函数（evaluate、wildcardMatch、normalizePath、buildGuardPrompt）是纯函数，
  适合大量单元测试
- 测试不应 mock 规则引擎内部实现，而是给定 ruleset + input → 断言 output
- 配置加载涉及文件系统，使用临时文件或 mock 文件读取

### 测试模块

| 模块 | 测试内容 | 测试类型 |
|------|---------|----------|
| `rule-engine.ts` | wildcardMatch 各种模式、evaluate 多 surface、多规则优先级、默认兜底 | 纯函数单元测试 |
| `permission-config.ts` | 全局 + 项目配置合并、JSON schema 校验、缺失文件处理 | 集成测试 |
| `prompt-injector.ts` | 规则为空/单条/多条时的 prompt 格式、allow/ask/deny 混合 | 纯函数单元测试 |
| `guard.ts` | 两态状态机转换、规则引擎激活/关闭、session resume | 单元测试 |
| `index.ts` | /guard-start 注入 prompt、tool_call 三态响应、ask 弹窗、deny 拦截 | 集成测试 |

### Prior art

现有测试在 `guard.test.ts` 和 `index.test.ts` 中，使用 vitest + mock ExtensionAPI。
新测试沿用同样的 mock 模式和目录结构。

## Out of Scope

- **与 pi-permission-system 的互操作**：独立实现，不依赖对方。如果两个扩展同时启用，
  各自独立评估，行为可能叠加。这属于未来考虑的多扩展协调问题。
- **运行时规则热重载**：规则在 Guard 启动时加载，修改配置需要重新激活。不做文件 watch。
- **细粒度 agent 级别覆盖**：暂不支持 per-agent YAML frontmatter 覆盖（pi-permission-system
  的 agent-level 覆盖）。未来可按需扩展。
- **授权链（authorizer chain）**：暂不支持除人以外的自动审批者（如模型 judge）。
- **symlink 解析**：Guard 不是安全边界，不做 symlink 路径解析。
- **Windows 路径支持**：当前聚焦 Unix 路径，Windows 路径规范化暂不支持。

## Further Notes

本 ADR 的完整设计背景和决策过程记录在 `docs/adr/0006-rules-engine-architecture.md`。
术语表在 `CONTEXT.md` 中更新。
