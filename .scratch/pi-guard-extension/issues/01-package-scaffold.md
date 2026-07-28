# 01 — Package scaffold

**What to build:** 创建 pi 扩展的 npm package 骨架，确保 `pi -e .` 能正常加载扩展而不报错。这是后续所有功能的基础设施。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 在项目根目录创建 `package.json`，包含 name、version、type: "module"、pi manifest
- [ ] 声明 peerDependencies：`@earendil-works/pi-coding-agent`、`typebox`
- [ ] 创建 `src/index.ts`，导出空 ExtensionAPI 工厂函数
- [ ] 验证 `pi -e .` 或 `pi -e ./src/index.ts` 加载无报错
