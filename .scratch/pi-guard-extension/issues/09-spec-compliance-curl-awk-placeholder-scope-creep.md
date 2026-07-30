# 09 — Spec 合规：补全 curl/awk-i + 填充占位测试 + 修剪 scope creep

**What to build:** 补全 bash 命令分类中缺失的 spec 需求，填充空的占位测试，修剪 scope creep 引入的多余命令。

具体变更：

1. **添加 `curl` 到只读命令列表** — spec 07 明确列出 `curl`（仅 GET/HEAD）为允许的只读命令，当前代码完全未处理。
2. **添加 `awk -i` 写入检测** — 当前拦截所有 `awk` 命令（含无 `-i` 的只读用法），应改为类似 `sed` 的处理方式：无 `-i` 标志时放行。
3. **填充 `guard.test.ts` 中空的占位测试** — `"contains .scratch/, docs/, and CONTEXT.md"` 测试体仅有注释无断言。
4. **修剪 scope creep** — 从只读命令集合中移除 spec 未列出的 `read`、`fgrep`、`fffind`。

**Blocked by:** 08 — 重构：提取共享测试辅助函数（新测试需使用重构后的 `setupGuarded()` 保持一致性）

**Status:** ready-for-agent

- [ ] `index.ts`: 将 `curl` 添加到 `READONLY_COMMANDS` 集合
- [ ] `index.ts`: 在 `WRITE_COMMANDS` 的 `awk` 分支添加 `-i` 标志检测，无 `-i` 时返回 `true`（readonly）
- [ ] `index.ts`: 从 `READONLY_COMMANDS` 中移除 `read`、`fgrep`、`ffind`
- [ ] `index.test.ts`: 新增 `curl` 只读命令测试（`curl -s https://example.com`）
- [ ] `index.test.ts`: 新增 `awk` 无 `-i` 放行测试（`awk '{print $1}' file.txt`）
- [ ] `index.test.ts`: 新增 `awk -i` 写入拦截测试（`awk -i inplace '{print}' file.txt`）
- [ ] `guard.test.ts`: 填充 `"contains .scratch/, docs/, and CONTEXT.md"` 测试体，导入 `DEFAULT_ALLOW_WRITE_PATHS` 并断言其内容
- [ ] 运行 `npm test` 确认全部测试通过
