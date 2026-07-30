# 10 — Extract bash command classifier into its own module

**Status:** ready-for-agent

**Blocked by:** None — can start immediately

**Based on spec:** `.scratch/pi-guard-extension/spec-bash-command-classifier.md`

## What to build

将 `index.ts` 中的 bash 命令分类逻辑（`isBashReadonly`、`isGitReadonly` 及四个命令集合）提取到独立的 `src/bash-command-classifier.ts` 模块。

## What to do

- [ ] 创建 `src/bash-command-classifier.ts`，包含所有命令集合和 `isBashReadonly`/`isGitReadonly` 函数，仅导出 `isBashReadonly(command: string): boolean`
- [ ] 在 `index.ts` 中将局部定义替换为 `import { isBashReadonly } from "./bash-command-classifier.ts"`
- [ ] 创建 `src/bash-command-classifier.test.ts`，覆盖所有边界情况（只读命令、写入命令、重定向、git 子命令、sed/awk -i、空字符串、未知命令）
- [ ] 确认 `index.test.ts` 中已有的集成测试仍全部通过（端到端安全网）
- [ ] 运行 `npx tsc --noEmit --strict` 确保类型无错误
- [ ] 运行 `npm test` 确保所有 78+ 测试通过
- [ ] 删除 `index.ts` 中不再需要的 `isBashReadonly` 导出声明（如果有）
