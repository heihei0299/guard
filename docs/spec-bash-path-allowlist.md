# Bash 路径白名单 — Guard 守卫模式下的路径感知命令放行

## Problem Statement

Guard 在 guarded 模式下通过 `isBashReadonly()` 对 bash 命令做静态分类：只读命令放行，写入命令拦截。但当前实现**不感知路径**——`mkdir -p docs/adr/`、`rm docs/tmp.md`、`cp docs/guide.md ./` 等合法操作因命令名（`mkdir`、`rm`、`cp`）被一刀切拦截，即使目标路径已在路径白名单（`.scratch/`、`docs/`、`CONTEXT.md`）内。

用户必须频繁输入 `/guard:allow` 才能执行这些操作，破坏了 Guard 的自动化预期。

## Solution

为 guarded 模式下的 bash 拦截增加**第二阶段路径感知检查**（`isBashPathAllowed`）。当 `isBashReadonly()` 返回 false（命令被分类为写入）时，不立即拦截，而是提取命令中的字面量路径参数，与路径白名单比对。路径在白名单内的合法操作放行，其余继续拦截。

Guard 的定位是防止 AI 多写操作，不是安全边界。路径遍历（如 `mkdir docs/../../../etc/evil`）不解析，接受风险。

## User Stories

1. As a 使用 domain-modeling 技能的用户, I want `mkdir -p docs/adr/` 在 guarded 模式下放行, so that 我不需要手动 `/guard:allow` 就能创建 ADR 目录
2. As a 清理文档的用户, I want `rm docs/old-draft.md` 在 guarded 模式下放行, so that 我能直接删除白名单内的过期文件
3. As a 整理文档的用户, I want `mv docs/a docs/b` 在 guarded 模式下放行, so that 我能在白名单路径间移动文件
4. As a 复制文档出来的用户, I want `cp docs/guide.md ./` 在 guarded 模式下放行, so that 我能将白名单文件复制到项目根目录
5. As a 写入文档片段的用户, I want `echo "note" > docs/note.md` 在 guarded 模式下放行, so that 我可以用重定向快速写入白名单路径
6. As a 编辑文档的用户, I want `touch docs/new-file.md` 在 guarded 模式下放行, so that 我能在白名单路径创建空文件
7. As a 安全管理员, I want `dd if=/dev/zero of=docs/out.bin` 即使在白名单路径也被拦截, so that 原始块级写入不会绕过 Guard
8. As a 安全管理员, I want `chmod +x docs/script.sh` 即使在白名单路径也被拦截, so that 权限变更不通过 bash 绕过
9. As a 安全管理员, I want `ln -s /etc/passwd docs/link` 即使在白名单路径也被拦截, so that 符号链接攻击不通过 bash 绕过
10. As a 安全管理员, I want `sudo rm -rf docs/` 被拦截, so that 提权命令不被 Guard 放行
11. As a 开发者, I want `rm docs/$FILE` 被拦截（含变量），但 `rm docs/file.md` 放行, so that 只有字面量路径通过检查
12. As a 开发者, I want `mkdir -p docs/a && touch docs/b` 这种多命令形式也做路径检查放行, so that 我不必拆分复合命令
13. As a 开发者, I want `mv /tmp/outside docs/inside` 被拦截, so that 外部路径不能通过 mv 混入白名单
14. As a 开发者, I want `cp /tmp/secrets.txt docs/` 被拦截而 `cp docs/file ./` 放行, so that cp 的资源在目标可在外但要防止外部文件写入白名单

## Implementation Decisions

### 新增模块

- **`bash-path-allowlist.ts`** — 新文件，导出 `isBashPathAllowed(command: string, allowWritePaths: string[]): boolean`
- **修改 `index.ts`** — 在 bash 拦截分支中，`isBashReadonly()` 返回 false 后调用 `isBashPathAllowed()`，返回 true 则放行

### 拦截流程

```
bash command → isBashReadonly() → true → ALLOW
                                 → false → isBashPathAllowed() → true → ALLOW
                                                                 → false → BLOCK
```

### 路径感知放行的命令

| 命令 | 路径提取方式 | 放行条件 |
|------|------------|---------|
| `mkdir` | 所有非 `-` 开头的参数 | 所有路径在白名单 |
| `touch` | 所有非 `-` 开头的参数 | 所有路径在白名单 |
| `rm` | 所有非 `-` 开头的参数 | 所有路径在白名单 |
| `mv` | 所有非 `-` 开头的参数 | **所有**路径（源+目标）在白名单 |
| `cp` | 所有非 `-` 开头的参数 | 所有**源**路径在白名单；目标可在外 |
| `>` / `>>` 重定向 | 从 `>`/`>>` 后提取的路径 | 路径在白名单 |

### 永远拦截的命令（不检查路径）

`sed -i`、`awk -i`、`tee`、`ln`、`chmod`、`chown`、`dd`、`fallocate`、`sudo`、`doas`

### 路径提取规则

- 只接受**字面量**路径 token：含 `$`、`` ` ``、`*`、`?`、`[`、`]`、`{`、`}` 的 token 拒绝（例外：前导 `~` 展开为 `$HOME`）
- 不检查复合命令结构（`&&`、`|`、`;`、`||`）——只检查路径 token 本身是否字面量
- 路径归一化：前导 `./` 去掉，前导 `~` 展开为 `$HOME`。不解析 `..` 或符号链接
- Token 化：简单空格分割，引号字符串（`"..."`、`'...'`）视为单 token

### 配置

- `isBashPathAllowed` 从调用方接收 `allowWritePaths: string[]`，不自加载配置
- 路径匹配逻辑复用 `isPathAllowed` 的目录前缀/子路径和文件后缀规则，但作为独立函数调用，不与 `write`/`replace` 的检查共享代码

### 约束

- Guard 不是安全边界——路径遍历接受风险
- 保守默认：任何歧义或未处理的情况均拦截
- 只读命令（`isBashReadonly` 返回 true）跳过路径检查直接放行
- `git` 命令保持现有子命令分类，不做路径感知

## Testing Decisions

### 测试原则

- 只测外部行为：`isBashPathAllowed` 的输入/输出契约，不测内部实现细节
- 对所有边界情况做参数化测试

### 测试模块

1. **`bash-path-allowlist.test.ts`**（新增）— `isBashPathAllowed()` 的单元测试
2. **`index.test.ts`** 扩展 — `tool_call` 集成测试中增加 bash 路径感知用例

### 单元测试覆盖范围（`bash-path-allowlist.test.ts`）

- 各放行命令的路径提取与放行：`mkdir -p docs/a`、`touch docs/f.md`、`rm docs/f.md`、`mv docs/a docs/b`、`cp docs/a docs/b`、`cp docs/a ./`
- 重定向路径提取与放行：`echo hi > docs/out.md`、`cat > docs/list.txt`
- 路径不在白名单拦截：`mkdir /tmp/foo`、`rm ../outside.md`
- `mv` 源/目标任一在外拦截：`mv /tmp/foo docs/bar`、`mv docs/foo /tmp/bar`
- `cp` 源在外拦截但目标在外放行：`cp /tmp/foo docs/bar`（拦截）、`cp docs/foo /tmp/bar`（放行）
- 非字面量路径 token 拒绝：`rm $FILE`、`rm docs/*.md`、`rm docs/{a,b}`、`` rm `echo file` ``
- 永远拦截的命令：`dd if=/dev/zero of=docs/out.bin`、`chmod +x docs/s.sh`、`ln -s docs/a docs/b`、`sed -i 's/foo/bar/' docs/f.md`、`sudo rm docs/f.md`
- 路径归一化：`./docs/file.md` 匹配、`~/project/docs/file.md` 匹配
- 路径遍历：`docs/../../etc/passwd` 因前缀匹配 `docs/` 放行
- 空命令、纯空格、未知命令均拦截

### 集成测试覆盖范围（`index.test.ts`）

- 在 guarded 模式下，`mkdir -p docs/adr` → 放行
- 在 guarded 模式下，`rm docs/tmp.md` → 放行
- 在 guarded 模式下，`mv docs/a docs/b` → 放行
- 在 guarded 模式下，`cp docs/guide.md ./` → 放行
- 在 guarded 模式下，`echo hello > docs/out.md` → 放行
- 在 guarded 模式下，`mkdir /tmp/outside` → 拦截
- 在 guarded 模式下，`dd if=/dev/zero of=docs/out.bin` → 拦截（即使路径在白名单）
- 更新现有测试：`"still blocks write bash even if path references allowlisted dir"` 应将断言改为放行
- 在 guarded 模式下，`touch docs/new.md` → 放行

### 已有测试先例

- `bash-command-classifier.test.ts` — 同级别纯函数单元测试模式（vitest + describe/it/expect）
- `index.test.ts` — 集成测试模式，通过 `setupGuarded()` 建立 guarded 状态后验证 `tool_call` handler 行为

## Out of Scope

- **安全边界加固**：路径遍历检测、符号链接解析、`..` 归一化不在范围内
- **Git 命令路径感知**：`git -C docs commit` 等仍走现有子命令分类
- **管道/重定向写入的完整覆盖**：`echo hi > docs/out.md` 放行，但 `cat file | grep foo > docs/out.md` 也放行（因为路径 token 字面量且在白名单内），反之含管道但路径分散的复杂场景不做特殊处理
- **`write`/`replace` 工具的 bash 等效逻辑**：路径检查各自独立，不共享代码
- **交互式命令**：`read`、`select` 等不做特殊处理
- **非 Linux/macOS 路径格式**：不考虑 Windows 路径

## Further Notes

- 此 spec 来源于 `grill-with-docs` 技能会话，详见 ADR-0004（`docs/adr/0004-bash-path-allowlist.md`）。
- CONTEXT.md 已更新三个条目：Guarded Mode、Path Allowlist、Bash Command Classification。
- 实现完成后，需将 `.pi/pi-guard.json` 中的 `targetSkills` 列表与 `DEFAULT_CONFIG.targetSkills` 对齐。
