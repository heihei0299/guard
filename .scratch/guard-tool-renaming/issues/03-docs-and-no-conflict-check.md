# 03 — 文档同步与无冲突回归脚本

**What to build:** 两份 README 与 guard-plan-mode 的 spec 中的工具名同步为新名 `guard_mode_question` / `guard_mode_complete`；`conflict-repro.sh` 从"检测冲突"反转为"验证无冲突"——断言 guard 用 `guard_mode_*`、pi-plan-mode 用 `plan_mode_*`、两者工具名集合互不相同。完成后文档与实现一致（无旧工具名残留），回归脚本输出 NO-CONFLICT，可用于未来验证共存不回归。

**Blocked by:** 01 — Guard 工具改名（文档描述的是 01 之后的状态）

**Status:** ready-for-agent

- [ ] 两份 README 中的工具名、工作流描述、文件结构注释全部为新名
- [ ] guard-plan-mode 的 spec 中的工具名同步为新名
- [ ] 冲突检查脚本断言 guard 与 pi-plan-mode 的工具名集合互不相同，运行输出 NO-CONFLICT
- [ ] 文档中无 `plan_mode_question` / `plan_mode_complete` 残留（持久化兼容处除外，见 02）
