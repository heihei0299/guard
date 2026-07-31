# 03 — 路径规范化 + 配置加载器（path-normalizer.ts + permission-config.ts）

**What to build:** 实现路径规范化工具函数和分层配置加载器。路径规范化负责将输入路径转换为规则匹配可用的
等效形式（绝对路径、CWD 相对路径、原始路径）。配置加载器从全局和项目两级 JSON 配置文件中读取规则，
合并输出为 `FlatPermissionConfig`。

**Blocked by:** 02（需要 `FlatPermissionConfig`、`normalizeFlatConfig`、`Rule` 类型）

**Status:** ready-for-agent

**Acceptance criteria:**

- [ ] **路径规范化**（`path-normalizer.ts`）：
  - `expandHomePath(path)` — 展开 `~` → `$HOME`，`$HOME` → `$HOME`
  - `normalizePathPolicyLiteral(path)` — trim → 剥简单包裹引号（`"..."`, `'...'`）→ 剥开头的 `@` → `expandHomePath`
  - `getPathPolicyValues(path, options)` → `string[]`
    - 返回去重的等效路径列表：`[absolutePath, cwdRelativePath, literalPath]`
    - `options.cwd`：当前工作目录，用于计算 CWD 相对路径
    - `options.resolveBase`：解析基准目录（默认 = cwd），bash 中可用于 `cd` 后的目录
  - 不做 symlink 解析（Guard 不是安全边界）

- [ ] **配置加载器**（`permission-config.ts`，替代现有 `config.ts`）：
  - `loadPermissionConfig(projectRoot?)` → `{ global: FlatPermissionConfig, project: FlatPermissionConfig }`
  - 读取路径：
    - 全局：`~/.pi/agent/extensions/pi-guard/config.json`
    - 项目：`<projectRoot>/.pi/pi-guard.json`
  - 文件不存在时返回空对象，不报错
  - JSON parse 失败时记录 warning 并返回空对象（fail open，不阻塞启动）
  - 输出未经合并的原始配置（merge 在调用侧做）

- [ ] 新的 `GuardConfig` 类型适配：
  - 废弃旧的 `targetSkills`, `allowWritePaths`, readonlyCommands/writeCommands 等字段
  - 新增 `permission: FlatPermissionConfig` 和 `autoActivateAfterSkill: boolean`

- [ ] **测试**：
  - 路径规范化：给定各种输入 → 正确的等效路径列表
  - 配置加载：mock 文件系统测试分层读取、缺失文件、JSON 解析失败
  - 向后兼容：旧格式配置能加载（无 `permission` 字段时不报错）
