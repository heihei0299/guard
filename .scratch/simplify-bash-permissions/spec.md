Status: ready-for-agent
Slug: simplify-bash-permissions

## Problem Statement

Guard 当前对 bash 命令的权限控制有两阶段检查机制：第一阶段 `isBashReadonly()` 基于命令名称和子命令将命令分类为"只读"或"写入"；第二阶段 `isBashPathAllowed()` 对部分写入命令（`mkdir`、`touch`、`rm`、`mv`、`cp`、`>` 重定向）做路径感知检查，路径在路径白名单内则放行。这种机制过于复杂，维护成本高，且存在安全隐患——路径白名单的目录匹配（如 `docs/..` 前缀匹配）允许路径遍历。用户希望简化：一刀切禁止所有能编辑文件的 bash 命令，仅放行 `mkdir`。

## Solution

将 bash 权限控制从"两阶段检查"简化为"单阶段分类"。`mkdir` 从写入命令列表移至只读命令列表，使其直接放行。移除 `bash-path-allowlist.ts` 及其第二阶段的路径感知检查。`index.ts` 中的 bash 拦截分支简化为：`isBashReadonly()` 返回 `false` 即拦截，不再有二次机会。路径白名单继续服务于 write/replace 工具，不再影响 bash 命令。

## User Stories

1. 作为项目维护者，我希望删除 bash 路径白名单模块，以减少代码复杂度和维护成本。
2. 作为项目维护者，我希望 `mkdir` 在 guarded 模式下不被拦截，因为它不修改已有文件、仅创建新目录，破坏性极低。
3. 作为项目维护者，我希望 `touch`、`rm`、`mv`、`cp`、`sed -i`、`tee`、`dd` 等写入命令在 guarded 模式下全部被拦截，无论目标路径是否在白名单内。
4. 作为项目维护者，我希望 `>` 和 `>>` 重定向到真实文件（非 `/dev/null`、非 `&N`）仍然被拦截，因为任何命令加重定向都是写操作。
5. 作为项目维护者，我希望 `ls`、`cat`、`grep`、`echo`、`curl` 等只读命令继续放行，以便在 guarded 模式下正常进行调试和探索。
6. 作为项目维护者，我希望 `git log`、`git status`、`git diff` 等只读 git 子命令继续放行。
7. 作为项目维护者，我希望 `git commit`、`git push`、`git checkout` 等写入 git 子命令继续被拦截。
8. 作为项目维护者，我希望 `sed`/`awk` 不带 `-i` 标志时视为只读并放行，带 `-i` 时拦截。
9. 作为项目维护者，我希望路径白名单（`docs/`、`.scratch/`、`CONTEXT.md`）继续对 write/replace 工具生效，以便技能对话后能正常输出 ADR、术语表和临时文件。

## Implementation Decisions

- **分类策略变更**：`mkdir` 从 `writeCommands` 移至 `readonlyCommands`，由 `isBashReadonly()` 直接放行，不再经过第二阶段的路径检查。
- **模块删除**：`bash-path-allowlist.ts` 及其测试文件 `bash-path-allowlist.test.ts` 整文件删除。
- **拦截流程简化**：`index.ts` 中 bash 工具拦截分支从三路决策（readonly → 放行 / write+路径白名单 → 放行 / write+路径不匹配 → 拦截）简化为两路决策（只读 → 放行 / 写入 → 拦截）。
- **配置保留**：`allowWritePaths` 配置项保留，仅用于 write/replace 工具的路径白名单检查，不再影响 bash。
- **重定向检测保留**：`>` 和 `>>` 后跟真实文件路径（非 `/dev/null`、非 `&N`）时仍被拦截。此检测在 `isBashReadonly()` 内完成，不依赖命令名称。
- **git 子命令保留**：git 只读/写入子命令分类保留不变。
- **sed/awk -i 检测保留**：sed 和 awk 带 `-i` 标志时视为写入，不带时视为只读。
- **未知命令保守默认**：`isBashReadonly()` 对未知命令返回 `false`（拦截）的默认策略不变。

## Testing Decisions

- 测试原则：只测外部行为（命令放行/拦截），不测实现细节。优先使用现有测试接缝，不引入新测试模块。
- **唯一测试接缝**：`index.test.ts` 的集成测试。该文件已测试 guarded 模式下各种 bash 命令的放行/拦截行为。变更如下：
  - 添加测试：guarded 模式下 `mkdir -p foo` 应放行（覆盖 config 变更 + 路径白名单检查移除后的正确行为）
  - 移除测试：8 个依赖 `bash-path-allowlist` 的集成测试——这些测试验证了 mv/rm/cp/touch/echo+重定向 在路径白名单内的放行行为，路径白名单移除后这些命令应被拦截
  - 保留测试：`rm -rf` 拦截、`git commit` 拦截、`npm install` 拦截、只读命令放行（`ls`、`cat`、`grep`、`curl` 等）
- 已有测试先例：`index.test.ts` 中的 `"blocks write bash commands in guarded mode"` 和 `"allows readonly bash commands (ls) in guarded mode"` 为测试模式先例。

## Out of Scope

- 路径白名单的 `..` 遍历/安全加固——Guard 不是安全边界，路径遍历是已知风险。
- 添加新的只读/写入命令到配置列表——保持现有命令列表不变，仅移动 `mkdir`。
- 修改 Guard 状态机逻辑——normal/skill_active/guarded 三态不变。
- 修改 write/replace 工具的路径白名单检查——`isPathAllowed()` 在 `guard.ts` 中的行为不变。
- 修改 `CONTEXT.md` 之外的领域术语表——只更新受影响的三个术语条目（Guarded Mode、Path Allowlist、Bash Command Classification）。

## Further Notes

- 此 spec 来源于 `grill-with-docs` 技能会话。会话中达成 5 个关键决策：(1) 保留重定向检测，(2) 保留只读命令列表（方案 A），(3) 保留 git 子命令分类（方案 A），(4) 移除 bash 路径白名单（方案 A），(5) `mkdir` 放入只读命令列表（方案 A）。
- CONTEXT.md 已根据 grilling 决策更新。
- 实施前需确认测试接缝方案已获用户认可。
- 实施后将需要更新或作废 ADR-0004（Bash Path Allowlist），并可选创建 ADR-0005 记录此简化决策。
