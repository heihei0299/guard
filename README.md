# Pi Guard

[pi](https://pi.dev) 扩展，为计划流程提供工具级限制。Guard Mode 下，Agent 可以探索和制定计划；文件写入及命令执行受策略约束。

## 安装与使用

从仓库根目录运行：

~~~sh
pi install -l ./pi-guard-extension
~~~

启动时使用 `/guard` 或 `pi --guard`。提交计划后，用 `/guard implement` 开始实施；用 `/guard exit` 退出并丢弃计划。计划和模式状态会在恢复会话时保留。

其他命令：`/guard show` 查看计划，`/guard finalize` 请求提交计划，`/guard tools` 选择计划阶段可用工具。

## 计划阶段的工具策略

- 只读工具可用；`write` / `replace` 仅允许写入 `.scratch/`、`docs/` 和 `CONTEXT.md`。
- `bash` 仅允许安全命令；`edit` 和 `update_plan` 被拦截。
- 自定义工具默认禁用，可在设置中明确启用。

扩展提供 `guard_mode_question` 用于澄清需求，`guard_mode_complete` 用于提交计划。

## 配置与开发

可选配置文件：`~/.pi/agent/pi-guard.json`。支持 `thinkingLevel`、`defaultPlanTools` 和 `allowedPlanSubagents`；缺失时使用默认值，无效配置会提示并忽略。

~~~sh
cd pi-guard-extension
npm test
~~~

许可证：MIT。