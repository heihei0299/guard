# 01 — 无空格重定向漏检修复

**What to build:** Guard Mode 的 bash 安全检查补上对"粘连输出重定向"的检测：`echo hi>/tmp/x`、`cmd>>log` 这类重定向符号与前后文本无空格粘连的写法目前不被检测，写文件意图可绕过拦截。修复后此类命令在 Guard Mode 中被拦截，同时保持合法的输出抑制写法（`/dev/null`、`2>&1`）放行。

**Blocked by:** None — can start immediately.

**Status:** resolved

## Answer

已实现并提交：`8bdf2b1`（4 文件，+131/-5）。检测覆盖：粘连 `>`/`>>`（含数字前导 `hi2>`）、粘连 `&>`、精确 `&>`/`&>>` token、fd-dup 仅 `&\d+` 放行（`2>&/tmp/x`、`hi>&/tmp/x` 拦截）；`/dev/null` 与 `2>&1` 例外保持；README 措辞同步。28 个新测试（含 3 轮 review 迭代补的绕过形态：`hi2>/tmp/x`、`>/tmp/x`、`hi&>/tmp/x`、`&> /dev/null` 误杀修复）。最终 375 tests 全绿、tsc 零错误。

- [ ] `echo hi>/tmp/x`、`echo hi>>/tmp/x` 被判定为不安全并拦截
- [ ] 独立 token 形式（`echo hi > out.txt`）、数字形式（`2>file`、`2>>file`）、`&` 形式（`&>file`）仍被拦截（不回归）
- [ ] 合法抑制形式（`>/dev/null`、`2>&1`、`ls 2>/dev/null`）仍放行（不回归）
- [ ] `<` 输入重定向（含 `cat<file`、heredoc）仍被拦截（不回归）
- [ ] 已知只读命令与结构化命令（`git status`、`npm test` 等）不受影响（不回归）
- [ ] 新增回归测试全绿；全量测试与类型检查通过
- [ ] README 中重定向检测能力描述与实现一致（移除"非数字粘连形式不检测"免责声明）

## Context

来源：grill-with-docs 对齐会话 Q2/Q7（HIGH 级纯漏检纳入收尾）+ spec 的 Implementation Decisions 第 1 项。
