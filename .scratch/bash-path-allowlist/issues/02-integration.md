# 02 — 集成到 Guard 拦截流程 + 集成测试

**What to build:** 将 `isBashPathAllowed()` 接入 Guard 的 `tool_call` 拦截流程。当 guarded 模式下 `isBashReadonly()` 返回 `false` 时，调用 `isBashPathAllowed()` 做二次检查，路径在白名单内则放行而非拦截。同时更新 `createGuard()` 以传递 `allowWritePaths` 配置。

**Blocked by:** 01 — `isBashPathAllowed()` 纯函数 + 单元测试

**Status:** ready-for-agent

- [ ] 修改 `index.ts`：`GuardExtensionOptions` 增加可选 `allowWritePaths?: readonly string[]`
- [ ] `createGuard()` 将 `allowWritePaths` 同时传递给 `createStateMachine()` 和 `isBashPathAllowed()` 引用
- [ ] 在 `tool_call` handler 的 bash 分支中，`isBashReadonly()` 返回 `false` 后调用 `isBashPathAllowed()`，返回 `true` 则 `return undefined` 放行
- [ ] 扩展现有 `index.test.ts` 集成测试：
  - `mkdir -p docs/adr` → 放行
  - `rm docs/tmp.md` → 放行
  - `mv docs/a docs/b` → 放行
  - `cp docs/guide.md ./` → 放行
  - `echo hello > docs/out.md` → 放行
  - `touch docs/new.md` → 放行
  - `mkdir /tmp/outside` → 拦截
  - `dd if=/dev/zero of=docs/out.bin` → 拦截（即使路径在白名单）
  - `mkdir -p docs/adr` 在非 guarded 模式 → 放行（不拦截）
- [ ] 更新现有测试 `"still blocks write bash even if path references allowlisted dir"`：现在 `mv .scratch/tmp.txt .scratch/final.txt` 应放行（两个路径都在白名单）
