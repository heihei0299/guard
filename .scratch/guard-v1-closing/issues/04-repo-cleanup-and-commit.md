# 04 — 仓库收尾与提交

**What to build:** 仓库状态收尾：删除旧架构的死配置文件与临时审查产物；把已过时的旧版 bug 分析文档移入 `.scratch/` 存档（注明已被新架构设计取代）；将新架构文档（ADR、AGENTS、`.scratch/` 系列、CONTEXT.md 更新）与本次三处代码修复一次性提交，使 Guard Mode v1 状态可追溯。

**Blocked by:** 01 — 无空格重定向漏检修复、02 — 补过滤 guard_mode_question 的 Q&A、03 — 移除 safeSubcommands 死键

**Status:** ready-for-agent

- [ ] 旧架构死配置文件与临时审查产物被删除
- [ ] 旧版 bug 分析文档移入 `.scratch/` 存档并注明已被取代
- [ ] 新架构文档与三处代码修复提交到 git
- [ ] 嵌套独立仓库不纳入根仓库提交
- [ ] commit message 遵循 conventional commits；提交后工作树只剩预期条目

## Context

来源：grill-with-docs 对齐会话 Q13 + spec 的 Implementation Decisions 第 4 项。
