# 02 — 补过滤 guard_mode_question 的 Q&A

**What to build:** Guard Mode 关闭后，`guard_mode_question` 的提问与用户答案仍残留在 AI 上下文中，与 ADR-0009 的上下文过滤设计不符（关键决策应写入 plan，Q&A 退出后即 stale）。修复后 Guard Mode 关闭时 question 的工具结果与调用记录从上下文剥离，激活时保持可见。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Guard Mode 关闭时，`guard_mode_question` 的工具结果消息被过滤
- [ ] Guard Mode 关闭时，assistant 内容中的 `guard_mode_question` 工具调用块被剥离
- [ ] Guard Mode 激活时，question 的提问与答案保持可见（不回归）
- [ ] 过滤实现与 `guard_mode_complete` 的既有过滤对称、复用同一工具名常量
- [ ] 新增单元测试与 context 管道集成断言全绿；全量测试与类型检查通过

## Context

来源：grill-with-docs 对齐会话 Q9（对齐 ADR-0009 设计）+ spec 的 Implementation Decisions 第 2 项。
