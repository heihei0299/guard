# 01 — Simplify bash permission control: remove bash path allowlist, allow mkdir

**What to build:** guarded 模式下 bash 命令的权限控制从两阶段检查（`isBashReadonly()` + `isBashPathAllowed()`）简化为单阶段分类（`isBashReadonly()` 决定一切）。`mkdir` 加入只读命令列表直接放行；删除 `bash-path-allowlist.ts` 及其测试；`index.ts` 的 bash 拦截分支去掉 `isBashPathAllowed()` 调用；`index.test.ts` 新增 `mkdir` 放行测试、移除依赖路径白名单的集成测试；创建 ADR-0005 记录此决策并标记 ADR-0004 为 superseded。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `config.ts`：`mkdir` 从 `writeCommands` 移至 `readonlyCommands`
- [ ] `bash-path-allowlist.ts` 删除
- [ ] `bash-path-allowlist.test.ts` 删除
- [ ] `index.ts`：移除 `isBashPathAllowed` 导入和调用
- [ ] `index.test.ts`：新增 `mkdir` 放行测试，移除 8 个依赖路径白名单的集成测试
- [ ] `docs/adr/0004-bash-path-allowlist.md` 标记为 superseded
- [ ] `docs/adr/0005-simplify-bash-permissions.md` 创建
- [ ] 运行测试确认全部通过
