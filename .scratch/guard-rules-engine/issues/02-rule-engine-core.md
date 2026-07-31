# 02 — 规则引擎核心（rule-engine.ts）

**What to build:** 实现规则引擎的纯函数核心，严格参照 pi-permission-system 的 `rule.ts` + `synthesize.ts` + `normalize.ts`。
包含通配符匹配、规则评估、规则组合与变换、配置标准化四大模块。

**Blocked by:** 无 — 可以立即开始

**Status:** ready-for-agent

**Acceptance criteria:**
- [ ] `Rule`, `Ruleset`, `PermissionState`, `RuleOrigin`, `DenyWithReason` 类型定义

- [ ] **通配符匹配**：
  - `compileWildcardPattern(pattern, state)` → `CompiledWildcardPattern`
    - `expandHomePath()` 展开 `~` / `$HOME`
    - 按 `*` 拆分 → `escapeRegExp()` → `?` 替换为 `.` → `.*` join
    - 尾部 ` *` 特殊处理：` .*` → `( .*)?`
    - 包装为 `^...$` 正则，`s` flag
    - 返回带 `matches(value)` 方法的编译对象
  - `wildcardMatch(pattern, value)` → boolean（便捷包装）

- [ ] **规则评估**：
  - `evaluate(surface, value, rules, defaultAction?)` → `Rule`
    - 从 ruleset 尾部 `findLast`，surface + pattern 通配符匹配
    - 无匹配返回 `{ action: defaultAction ?? "ask", origin: "builtin" }`
  - `evaluateFirst(surface, values, rules)` → `{ rule, value }`
    - 多候选，第一个非默认层匹配
  - `evaluateAnyValue(surface, values, rules)` → `{ rule, value }`
    - 跨别名最后匹配获胜
  - `evaluateMostRestrictive(surface, values, rules)` → `{ rule, value } | null`
    - deny > ask > allow，deny 短路

- [ ] **规则组合与变换**：
  - `composeRuleset(defaults, baseline, config)` → `[...defaults, ...baseline, ...config]`
  - `synthesizeDefaults(universalDefault, origin)` → `[{ surface: "*", pattern: "*", action, layer: "default" }]`
  - `rewriteAsksToYolo(rules)` → 所有 ask → allow
  - `floorAllowsToAsk(rules)` → 所有 allow → ask

- [ ] **配置标准化**：
  - `normalizeFlatConfig(permission)` → `Rule[]`
    - `"surface": "string"` → `{ surface, pattern: "*", action }`
    - `"surface": { "pattern": "action" }` → 逐条展开
    - 支持 `DenyWithReason`：`{ action: "deny", reason: "..." }`
    - 无效值静默跳过

- [ ] **测试**：全部纯函数，无需 mock，覆盖所有边界情况（空规则、通配符变体、多 surface 优先级、默认兜底）
