# 设计 — REQ-20260901-005 认领者统一显示会话名（不再缺省 terminal）

> 由 Agent 在 /dev 开发前补充，人可随时批注。**状态：待对齐（方案初稿，未经人工确认不得实施）。**

## 背景

认领者显示三种来源混杂：ZCode 会话缺省 `terminal`（已验证 Bash 环境不注入 ZCODE_SESSION_ID，`core.actor()` 兜底）、手动传的 `loop-session`、Codex 侧自觉传的 `codex-dev-loop-20260901`。用户期望统一为可读会话名。README 给出 A（强制显式命名）/ B（可读缺省名兜底）/ C（客户端注入，远期）三个方向，推荐 A+B。

## 方案（初稿，待对齐——采纳 A+B 组合）

### 1. 会话名解析（`core.mjs` 的 `actor()` 改为 `resolveActor(explicit)`）

优先级：**显式传入（--by / API 参数）→ 环境变量（ZCODE_SESSION_ID / CLAUDE_SESSION_ID，有则直接用）→ 可读缺省名**。

可读缺省名生成（替代裸 `terminal`）：
```
<工具前缀>-<MMDD>-<4位随机>
```
- 工具前缀：`ATB_AGENT_NAME` 环境变量优先（如 `zcode` / `codex`，skill 里教 Agent 设置），否则 `atb`；
- 随机后缀：crypto 随机 4 位 base36 小写；
- 例：`zcode-0901-k3xf`、`codex-0901-q7m2`。同一进程内生成后缓存复用（一次 CLI 调用只产生一个名字）。
- 保留 `terminal` 字面？不——所有路径都不再产生裸 terminal；历史已有值不动（验收 3）。

### 2. claim / report 传入链

- `atb.mjs`：`claim`/`report` 的 `--by` 已存在，行为不变；未传时用新缺省名。CLI 帮助与输出提示补一句「建议用 --by 起语义名（如 zcode-login-view）」。
- `server.mjs`：网页端操作固定 `by: 'board'` 不变（人工动作不涉及认领者）。

### 3. 认领锁 owner 语义

`claim` 写锁的 `{ owner }` 与 status.owner 同源（现有代码已如此），随新解析结果自然统一；无需额外改锁逻辑。

### 4. 文档约定（SKILL.md + dev.md）

会话名格式约定：`<工具/会话语义名>-<可选日期>`，全小写连字符（如 `zcode-login-view`、`codex-dev-loop`）；Agent 在 /dev 阶段一 claim 时**应**主动起语义名（`--by zcode-xxx`），多会话并行时用不同名字便于看板区分。环境变量方案写进 SKILL 的「常见错误」旁注（ZCode Bash 拿不到会话 ID 是已知限制）。

### 5. 测试

新增 `scripts/tests/actor-name.test.mjs`：
- N1 显式 `--by` 优先（claim 后 owner == 传入值）；
- N2 缺省名格式匹配 `/^[a-z][a-z0-9-]*-\d{4}-[a-z0-9]{4}$/` 且不等于 `terminal`；
- N3 同进程两次调用返回同名（缓存）；
- N4 `ATB_AGENT_NAME` 生效（前缀注入）；
- N5 锁文件 owner 与 status.owner 一致；
- N6 SKILL/dev.md 含会话名约定条款。

## 影响面

`core.mjs`（actor→resolveActor + 缺省名生成）、`atb.mjs`（提示语）、`SKILL.md`/`dev.md`（约定条款）、新增测试文件。前端展示零改动（owner 原样显示）。旧数据不迁移。

## 风险与边界

- 环境变量注入（方案 C）短期不可行，已按 README 结论仅作远期；
- 随机名碰撞概率可忽略（36⁴≈168 万/日）；历史 owner=terminal 的旧条目保留原值，看板上新旧混排属预期（验收 3）。
