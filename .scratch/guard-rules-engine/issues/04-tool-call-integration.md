# 04 — Tool Call 集成 + `/guard-start` 命令

**What to build:** 将规则引擎与 Pi 的工具调用生命周期集成，替换当前基于 `isBlocking()` 的拦截逻辑。
实现 `/guard-start` 命令（手动激活）、`/guard:allow`（关闭）、以及 `autoActivateAfterSkill`（技能对话后自动激活）。

**Blocked by:** 01（简化状态机）+ 03（配置加载器，提供已合并的 Ruleset）

**Status:** ready-for-agent

**Acceptance criteria:**

- [ ] **`/guard-start` 命令**：
  - 注册 `guard-start` 命令（与现有 `guard:allow` 并列）
  - 功能：激活规则引擎（`guard.activateRuleEngine()`）
  - 通过 `ctx.ui.notify` 显示"Guard 规则已激活"提示
  - 如果已激活，提示"已激活"，不做重复激活

- [ ] **`/guard:allow` 命令适配**：
  - 现有行为保留：调用 `guard.deactivateRuleEngine()` + 移除 prompt
  - 状态机切换回 normal
  - 显示"Guard 已关闭"提示

- [ ] **Tool call handler 改造**：
  - 替换 `isBlocking()` 为规则引擎评估流程：
    1. 如果规则引擎未激活 → 放行（与 normal 状态一致）
    2. 已激活 → 解析 intent（toolName + input）→ 获取 paths → 执行 `evaluate()`
    3. 根据结果：
       - `allow` → 放行
       - `ask` → 调用 `ctx.ui` 弹确认对话框，用户同意后放行，拒绝则拦截
       - `deny` → 拦截，返回 `{ block: true, reason: "触犯规则：<规则描述>" }`
  - 当前只对 write/replace/bash 做规则评估（渐进式，后续扩展到其他 tool）
  - 路径类 tool 需调用 `getPathPolicyValues()` 获取等效路径列表再去匹配

- [ ] **自动激活（autoActivateAfterSkill）**：
  - `agent_settled` handler 改为：如果 `state === "skill_active"` 且 `autoActivateAfterSkill === true`，
    则激活规则引擎并注入 prompt

- [ ] **Session resume 适配**：
  - `session_start` + `rebuildFromHistory()` 改为重建规则引擎激活状态而非 guarded 状态
  - 扫描历史发现目标技能命令 → 标记规则引擎需激活（但不在 resume 时注入 prompt）

- [ ] **测试**：
  - `/guard-start` 激活后 tool_call 按规则响应
  - `ask` 弹窗确认/拒绝
  - `deny` 拦截并返回规则信息
  - `autoActivateAfterSkill` 自动激活
  - `/guard:allow` 关闭
  - session resume 重建状态
