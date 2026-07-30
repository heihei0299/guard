# 01 — `isBashPathAllowed()` 纯函数 + 单元测试

**What to build:** 创建一个新的模块 `bash-path-allowlist.ts`，导出 `isBashPathAllowed(command: string, allowWritePaths: string[]): boolean` 函数。该函数在 guarded 模式下作为 bash 拦截的第二阶段检查：当 `isBashReadonly()` 返回 `false`（命令被分类为写入）时调用，提取命令中的字面量路径参数，与路径白名单比对，路径在白名单内则返回 `true` 放行。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 新建 `bash-path-allowlist.ts`，实现 `isBashPathAllowed()`
- [ ] `mkdir`、`touch`、`rm`：提取所有非 `-` 开头的参数，所有路径在白名单则放行
- [ ] `mv`：提取所有非 `-` 开头的参数，所有路径（源+目标）在白名单则放行
- [ ] `cp`：提取所有非 `-` 开头的参数，所有**源**路径在白名单则放行（目标可在外）
- [ ] `>`/`>>`：从重定向符后提取路径，路径在白名单则放行
- [ ] 路径字面量检测：含 `$`、`` ` ``、`*`、`?`、`[`、`]`、`{`、`}` 的 token 拒绝（前导 `~` 例外）
- [ ] 路径归一化：前导 `./` 去掉，前导 `~` 展开为 `$HOME`
- [ ] 永远拦截的命令：`sed -i`、`awk -i`、`tee`、`ln`、`chmod`、`chown`、`dd`、`fallocate`、`sudo`、`doas`
- [ ] Git 命令、只读命令、未知命令不进入此函数
- [ ] 新建 `bash-path-allowlist.test.ts`，覆盖：
  - 各命令路径提取与放行（`mkdir -p docs/a`、`touch docs/f.md`、`rm docs/f.md`、`mv docs/a docs/b`、`cp docs/a ./`）
  - 重定向放行（`echo hi > docs/out.md`、`cat > docs/list.txt`）
  - 路径不在白名单拦截（`mkdir /tmp/foo`、`rm ../outside.md`）
  - `mv` 源/目标任一在外拦截
  - `cp` 源在外拦截但目标在外放行
  - 非字面量路径拒绝（`rm $FILE`、`rm docs/*.md`、`rm docs/{a,b}`）
  - 永远拦截的命令（`dd`、`chmod`、`ln` 等）
  - 路径归一化（`./docs/file.md`、`~/project/docs/file.md`）
  - 路径遍历因前缀匹配放行（`docs/../../etc/passwd`）
  - 空命令/纯空格/未知命令拦截
