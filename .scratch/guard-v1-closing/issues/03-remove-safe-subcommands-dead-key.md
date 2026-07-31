# 03 — 移除 safeSubcommands 死键

**What to build:** 配置面存在一个"解析了但不生效"的 `safeSubcommands` 配置键：它被配置加载与安全检查函数接受并透传，但从未真正参与判定。修复后该键不再出现在有效配置面（写了该键的配置文件视为无效并给出警告），安全检查函数签名不再携带未使用参数。

**Blocked by:** 01 — 无空格重定向漏检修复（两票改动同一安全检查模块，串行化避免并行编辑冲突）

**Status:** ready-for-agent

- [ ] 配置文件中含 `safeSubcommands` 键时被判定为无效并警告（按既有配置归一化行为）
- [ ] 安全检查函数的公开签名不再携带该参数
- [ ] 相关类型与解析函数从配置面移除，无残留引用
- [ ] 对应配置测试更新全绿；全量测试与类型检查通过

## Context

来源：grill-with-docs 对齐会话 Q11（移除死键）+ spec 的 Implementation Decisions 第 3 项。
