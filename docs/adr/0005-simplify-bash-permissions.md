# ADR-0005: Simplify Bash Permission Control

在 guarded 模式下，bash 命令的权限控制从两阶段检查（`isBashReadonly()` + `isBashPathAllowed()`）简化为单阶段分类（`isBashReadonly()` 决定一切）。

**Status**: accepted

**Supersedes**: ADR-0004 (Bash Path Allowlist)

## Context

ADR-0004 引入了 `isBashPathAllowed()` 作为第二阶段的路径感知检查，允许 `mkdir`、`touch`、`rm`、`mv`、`cp` 以及 `>`/`>>` 重定向在目标路径位于路径白名单内时放行。但这带来了几个问题：

1. **复杂性**：两阶段检查的交互逻辑难以理解和维护。开发者需要同时理解命令分类和路径匹配两套规则。
2. **维护成本**：`bash-path-allowlist.ts` 包含大量命令特定的路径提取逻辑，代码量超过 130 行。
3. **安全隐患**：路径白名单的目录前缀匹配（如 `docs/` 匹配 `docs/../../../etc/`）允许路径遍历，虽然 Guard 不是安全边界，但放行写入命令增加了风险。
4. **用户体验**：用户需要理解两阶段检查的存在，才能预测一个命令是否会被拦截。

经过 `grill-with-docs` 技能会话的深入讨论，达成 5 个关键决策：
1. 保留重定向检测
2. 保留只读命令列表（方案 A）
3. 保留 git 子命令分类（方案 A）
4. 移除 bash 路径白名单（方案 A）
5. `mkdir` 放入只读命令列表（方案 A）

## Decision

### 分类策略变更

`mkdir` 从 `writeCommands` 移至 `readonlyCommands`，由 `isBashReadonly()` 直接放行。理由：
- `mkdir` 仅创建新目录，不修改已有文件，破坏性极低。
- 在 guarded 模式下，用户经常需要创建目录（如 `mkdir -p docs/adr/`）来配合 write/replace 工具写入文件。
- 无需路径白名单检查，简化了代码和心智模型。

### 模块删除

`bash-path-allowlist.ts` 及其测试文件 `bash-path-allowlist.test.ts` 整文件删除。

### 拦截流程简化

bash 工具拦截分支从三路决策（readonly → 放行 / write + 路径白名单 → 放行 / write + 路径不匹配 → 拦截）简化为两路决策：

```
bash command → isBashReadonly() → true → ALLOW
                                 → false → BLOCK
```

### 保留的检查

- **重定向检测**：`>` 和 `>>` 后跟真实文件路径（非 `/dev/null`、非 `&N`）时仍被拦截。此检测在 `isBashReadonly()` 内完成，不依赖命令名称。
- **git 子命令分类**：只读/写入 git 子命令分类保留不变。
- **sed/awk `-i` 检测**：sed 和 awk 带 `-i` 标志时视为写入，不带时视为只读。
- **未知命令保守默认**：`isBashReadonly()` 对未知命令返回 `false`（拦截）的默认策略不变。

### 未变更的部分

- **路径白名单**：`allowWritePaths` 配置项保留，继续服务于 write/replace 工具的路径白名单检查（在 `guard.ts` 的 `isPathAllowed()` 中实现）。不再影响 bash 命令。
- **Guard 状态机**：normal / skill_active / guarded 三态不变。
- **命令列表**：仅移动 `mkdir`，其他命令列表保持不变。

## Considered Options

- **方案 A — 简化分类（选择）**：`mkdir` 移至只读命令列表，删除 bash 路径白名单。清晰、简单、可维护。
- **方案 B — 保留路径白名单**：保留现有两阶段检查。优点是差异化控制更精细，缺点是复杂性和安全风险。
- **方案 C — 全盘禁止**：所有写入命令一刀切禁止。优点是简单，缺点是对用户的摩擦大（需要频繁使用 `/guard:allow`）。

## Consequences

- `mkdir -p foo` 在 guarded 模式下可直接执行，无需 `/guard:allow`。
- `touch`、`rm`、`mv`、`cp` 等写入命令在 guarded 模式下被拦截，无论目标路径是否在路径白名单内。
- `echo hello > docs/out.md` 等重定向写入被拦截（重定向检测不变）。
- 代码库减少一个模块（`bash-path-allowlist.ts` 和其测试文件），降低了维护成本。
- ADR-0004 标记为 superseded。
- 路径白名单继续对 write/replace 工具生效，确保技能对话后能正常输出 ADR、术语表和临时文件。

## Related ADRs

- ADR-0002: Bash Command Classification — 基础命令分类机制
- ADR-0003: Path Allowlist for Write/Replace Tools — 路径白名单的原始设计
- ADR-0004: Bash Path Allowlist (superseded) — 被本 ADR 取代
