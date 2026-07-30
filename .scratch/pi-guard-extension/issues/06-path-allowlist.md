# 06 — 路径白名单：GuardMachine + 工具调用集成

**What to build:** 为守卫模式添加路径白名单机制，使 `write`/`replace` 工具在 `guarded` 状态下仍可写入 `.scratch/`、`docs/`、`CONTEXT.md` 这三个白名单路径，写入其他路径时仍然被拦截。

**Blocked by:** None — 可立即开始

**Status:** ready-for-agent

- [ ] `guard.ts`: 添加 `DEFAULT_ALLOW_WRITE_PATHS` 常量（`.scratch/`、`docs/`、`CONTEXT.md`）
- [ ] `guard.ts`: `GuardMachineOptions` 中加入 `allowWritePaths` 可选字段
- [ ] `guard.ts`: `GuardMachine` 接口新增 `isPathAllowed(filePath: string): boolean` 方法
- [ ] `guard.ts`: 实现 `isPathAllowed`——路径归一化（去 `./` 前缀）后，目录型白名单路径前缀匹配，文件型白名单路径精确匹配
- [ ] `index.ts`: `tool_call` handler 中，在 blocked tools 检查之后、拦截之前，对 `write`/`replace` 工具调用 `guard.isPathAllowed(event.input.path)`，命中则放行
- [ ] `index.ts`: 更新拦截逻辑——`bash` 仍按原逻辑全部拦截（此 ticket 不变更 bash 行为）
- [ ] 测试：`guard.test.ts` 新增 `isPathAllowed` 单元测试
- [ ] 测试：`index.test.ts` 新增 integration 测试——guarded + write/replace 到白名单路径放行、到非白名单路径拦截
