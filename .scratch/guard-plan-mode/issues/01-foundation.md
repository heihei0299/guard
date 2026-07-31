# 01 — Foundation

**What to build:** 更新依赖并创建 Guard Mode 的基础模块——状态类型（PlanModeState）、配置加载（settings）、工具函数（tool-selection、required-tools、extension-runtime）。这些模块是后续所有 ticket 的依赖基础。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] package.json 添加 `@narumitw/pi-tui-kit` 依赖，更新 description、keywords
- [ ] `src/state.ts`：PlanModeState 类型定义 + `restorePlanModeState()` 序列化/反序列化
- [ ] `src/settings.ts`：`normalizePlanModeSettings()` 配置形状验证 + `readPlanModeSettings()` 文件加载
- [ ] `src/tool-selection.ts`：`unique()`、`toolNameFromLegacyKey()`、`compareTools()`
- [ ] `src/required-tools.ts`：`withRequiredPlanModeTools()`、`withoutRequiredPlanModeTools()`
- [ ] `src/extension-runtime.ts`：`onAgentSettled()`、`setPlanThinkingLevel()`、`isStaleExtensionContextError()`
- [ ] 删除 `src/config.ts`、`src/permission-config.ts`、`src/path-normalizer.ts` 及对应测试
- [ ] `npm install` 成功
- [ ] `npx tsc --noEmit` 通过
- [ ] 新模块可正常导入
