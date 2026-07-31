---
name: tdd-implement
description: "Implement from spec/ticket via strict TDD red-green loop, then typecheck, review, and commit."
---

# TDD Implement

整合 **implement** + **tdd** 的完整实现流程：每个 seam 一个红-绿循环，直到 commit。

## 流程速览

```
① 理解需求 → ② 确认 Seams → ③ TDD 开发循环 → ④ 完整测试套件 → ⑤ Code Review → ⑥ Commit
```

每阶段的入口条件、操作与边界规则见 [`stages.md`](stages.md)——进入任一阶段前先读取该阶段的定义。

## 路由规则

### 正常流转

| 当前阶段 | 出口条件 | 下一阶段 |
|----------|----------|----------|
| ① 理解需求 | 需求已澄清，无歧义 | → ② 确认 Seams |
| ② 确认 Seams | 用户确认 seams 清单 | → ③ TDD 开发 |
| ③ TDD 开发 | 所有 seams 红-绿完成，typecheck 通过 | → ④ 完整测试套件 |
| ④ 完整测试套件 | 全部测试通过 | → ⑤ Code Review |
| ⑤ Code Review | 审查通过 | → ⑥ Commit |
| ⑥ Commit | commit 完成 | ✅ 结束 |

### 回退路由

| 当前阶段 | 回退条件 | 回退目标 |
|----------|----------|----------|
| ③ TDD 开发 | typecheck 失败 | → ③ 修复类型错误 |
| ④ 完整测试套件 | 测试失败 | → ③ 修复失败测试 |
| ⑤ Code Review | 实现错误 | → ③ 修复实现 |
| ⑤ Code Review | seams 遗漏 | → ② 补充 seams |
| ⑤ Code Review | 需求偏差 | → ① 澄清需求 |

## 引用

- TDD 核心规则：[tdd 技能](../tdd/SKILL.md)
- 测试标准：[tdd/tests.md](../tdd/tests.md)
- Mock 指南：[tdd/mocking.md](../tdd/mocking.md)
