# ADR-0008: Plan Mode Tool Policy and Bash Safety

Plan Mode 激活时，通过工具策略（Tool Policy）和 Bash 安全策略（Bash Safety Policy）
管控 AI 的操作范围，而非 Guard 时代的规则引擎 + 命令列表 + 路径白名单。

**Status**: accepted

## Context

原 Guard 使用两套独立机制管控 AI 行为：
1. **isBashReadonly()** — 静态命令名称分类，维护 readonly/write 两个命令列表
2. **规则引擎** — 声明式规则匹配，支持 allow/ask/deny 三态结果

这两套机制有大量重叠（bash 命令同时在命令列表和规则引擎中被分类），维护成本高，
且用户需要同时理解两种模型才能预测行为。

Plan Mode 的场景更简单：规划模式下，AI 不应该写文件、不该执行破坏性命令，
但需要能读文件、运行只读检查和结构化命令（如 `npx tsc --noEmit`）。

参考 `@narumitw/pi-plan-mode` 的设计，用一个统一的工具策略 + 安全策略替代两套机制。

## Decision

### 工具策略（Tool Policy）

将工具分为四类：

| 分类 | 策略 | 内置工具 |
|------|------|----------|
| `read-only` | 直接放行 | `read`、`grep`、`find`、`ls` |
| `limited` | 受安全策略约束放行 | `bash` |
| `blocked` | 直接拦截 | `edit`、`update_plan` |
| **`allowlisted`** | **路径白名单内放行，其余拦截** | **`write`、`replace`** |
| `user-opt-in` | 默认禁用，用户选择后启用 | 所有扩展工具和自定义工具 |
分类逻辑：
```typescript
function classifyPlanModeTool(tool: ToolInfo): PlanModeToolPolicy {
  if (!isBuiltinTool(tool)) return "user-opt-in";
  if (BLOCKED_BUILTIN_TOOLS.has(tool.name)) return "blocked";
  if (tool.name === "bash") return "limited";
  return SAFE_BUILTIN_PLAN_TOOLS.has(tool.name) ? "read-only" : "blocked";
}
```

### 路径白名单（Path Allowlist）

`write` 和 `replace` 工具并非完全被拦截，而是受 **路径白名单** 约束：

```typescript
const ALLOWLIST_PATHS = [".scratch/", "docs/", "CONTEXT.md"];

function isPathAllowed(path: string): boolean {
  // 目录（.scratch/、docs/）→ 前缀匹配
  // 文件（CONTEXT.md）→ 后缀匹配
  // 前导 ./ 归一化，~ 展开
}
```

白名单路径：

| 路径 | 匹配规则 | 用途 |
|------|---------|------|
| `.scratch/` | 前缀（目录） | wayfinder 创建 tickets 和 map |
| `docs/` | 前缀（目录） | domain-modeling 创建 ADRs |
| `CONTEXT.md` | 后缀（文件） | domain-modeling 更新 glossary |

其他路径一律拦截。

### Bash 安全策略
取代原 `isBashReadonly()` + 规则引擎 bash surface 两套机制，改为单一 `isSafeCommand()`：

```
bash command → isSafeCommand() → true  → ALLOW
                                → false → BLOCK
```

检查流程：

1. **段分割（splitShellSegments）**:
   - 按 `;`、`|`、`||`、`&&` 分割为多个命令段
   - 存在 `` ` `` 或换行 → 不安全
   - 存在 `>`、`<`、`(`、`)` → 不安全
   - 存在单独的 `&`（非 `&&`）→ 不安全

2. **每段安全检查（isSafeSegment）**:
   - shell 展开（`$`、`` ` ``、`*`、`?`、`[`、`{`）→ 不安全
   - 环境变量赋值（`KEY=value`）→ 不安全
   - 第一个 token 为已知危险命令（`rm`、`mv`、`cp`、`touch`、`chmod` 等）→ 不安全
   - 参数含危险标志（`-i`、`--in-place`、`--delete`）→ 不安全

3. **结构化命令白名单**:
   - `git` 子命令 → 检查子命令是否在白名单内（`status`、`log`、`diff`、`show`、`branch` 等），同时验证参数安全性
   - `gh` 子命令 → 只放行 `pr view`、`pr list`、`issue view`、`issue list`
   - `npm` → 只放行 `list`、`view`、`info`、`search`、`outdated`、`audit`、`test`、`run test|check|typecheck|lint`
   - `tsc --noEmit` → 放行（但不放行 `--incremental`、`--generateTrace` 等写入标志）
   - `node`、`python`、`python3` → 仅 `--version` 放行
   - `cargo`、`go` → 仅 `test`、`check` 子命令放行
   - `pytest`、`vitest`、`jest` → 放行
   - `sed` → 仅 `-n` + `p` 脚本（只读打印）放行

4. **已知只读命令**:
   `cat`、`head`、`tail`、`grep`、`find`、`ls`、`pwd`、`echo`、`printf`、
   `wc`、`sort`、`uniq`、`diff`、`file`、`stat`、`du`、`df`、`tree`、
   `which`、`whereis`、`type`、`printenv`、`uname`、`whoami`、`id`、
   `date`、`uptime`、`ps`、`jq`、`rg`、`fd`、`bat`、`eza` → 直接放行

### 与旧机制的对比

| 能力 | 旧 Guard | 新 Plan Mode |
|------|---------|-------------|
| 写文件工具 | 路径白名单例外 | **路径白名单放行，其余拦截** |
| bash 危险命令 | 命令名称列表 | 静态分析 + 结构化白名单 |
| bash 只读命令 | 只读命令列表 | 已知只读命令 + `!shellExpansion` |
| git 子命令 | readonly/write 列表 | 安全检查 + 参数验证 |
| 重定向 | 文件级别检测 | 整段不安全 |
| shell 展开 | 不检查 | 全面拦截 |
| 管道/复合命令 | 不检查第一段 | 每段独立检查 |
| 扩展工具 | 默认放行 | 默认禁用（user-opt-in） |

## Consequences

- 移除了 `bash-command-classifier.ts` —— 不再有命令列表维护负担。
- 移除了 `rule-engine.ts` —— 不再需要通配符模式匹配、surface 评估、规则合并。
- Bash 安全检查更严格：shell 展开、环境变量赋值、子 shell 均被拦截。
- 结构化命令支持更全面：`git`、`npm`、`tsc`、`cargo`、`go`、`pytest` 等均有针对性规则。
- 扩展工具默认禁用 —— 用户必须通过 `/guard tools` 显式启用。
- **路径白名单保留**：`.scratch/`、`docs/`、`CONTEXT.md` 在 Guard Mode 中可写，
  确保 wayfinder（创建 tickets）和 domain-modeling（创建 ADRs）正常工作。
- `edit`和`update_plan`仍完全拦截，不走白名单。

## Related ADRs

- ADR-0002: Bash Command Classification (superseded)
- ADR-0005: Simplify Bash Permission Control (superseded)
- ADR-0006: Rules Engine Architecture (superseded)
- ADR-0007: Replace Guard with Plan Mode (supersedes)
