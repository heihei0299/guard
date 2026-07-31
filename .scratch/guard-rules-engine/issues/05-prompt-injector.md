# 05 — 规则 Prompt 注入器（prompt-injector.ts）

**What to build:** 实现将当前生效规则注入 AI system prompt 的功能。
当规则引擎激活时（通过 `/guard-start` 或 `autoActivateAfterSkill`），
将规则以三段式格式注入 AI 的 system prompt，让 AI 在执行操作前就能看到规则边界。

**Blocked by:** 03（需要经 `normalizeFlatConfig` 输出的 `Ruleset`）

**Status:** ready-for-agent

**Acceptance criteria:**

- [ ] **`buildGuardPrompt(rules: Ruleset, state: GuardState)`** 生成三段式 prompt：

  ```
  🔒 Guard 规则已激活（/guard:allow 可退出）
  
  【规则摘要】
  • docs/ 目录：允许自由写入
  • .scratch/ 目录：允许自由写入
  • src/ 目录：需要用户确认
  • .env 文件：禁止操作
  • rm -rf：禁止操作
  • 外部目录访问（CWD 外）：需要用户确认
  • 未匹配规则：默认允许
  
  【完整配置】
  {
    "path": { "*": "allow", "*.env": "deny" },
    "bash": { "*": "ask", "rm -rf *": "deny" }
  }
  
  【约束说明】
  • deny 的操作会被直接拦截，不要重试
  • ask 的操作会弹出确认对话框，需用户同意后执行
  • 如果不确定是否会违规，先自查规则再操作
  ```

- [ ] **规则摘要生成**：
  - 遍历 ruleset，按 surface 分组
  - 对每个 surface 的每条规则，生成自然语言描述：
    - `allow` → "允许..."
    - `ask` → "需要用户确认"
    - `deny` → "禁止..."
  - 默认策略（`"*": "allow"` 或 `"*": "ask"`）单独列出

- [ ] **注入时机**：
  - `/guard-start` 命令执行后
  - `autoActivateAfterSkill` 自动激活后
  - 注入方式：通过 pi extension API 将 prompt 内容注入到 agent 的 system message

- [ ] **移除时机**：
  - `/guard:allow` 关闭规则引擎时移除已注入的 prompt

- [ ] **测试**：
  - 给定 ruleset → 输出格式化的 prompt
  - 空规则集 → 合理默认提示
  - 混合 allow/ask/deny → 摘要正确分类
