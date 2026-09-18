# 设计 — BUG-20260914-021 commit 消息对条目标题有截断，请修复

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260911-009（已 `atb list` 核验存在，状态 done）——「开发完成到待测试自动提交」
  引入 `autoCommitForRun` / `supplementCommitForRun` 两处拼装提交消息时的
  `[...String(title)].slice(0, DESC_MAX_CHARS)` 截断，以及配套 `DESC_MAX_CHARS = 20` 核验口径。

## 根因分析

- `scripts/lib/commit-store.mjs:19` 定义 `DESC_MAX_CHARS = 20`，`validateCommitSubject`
  据此要求描述（不含单号）≤20 字。
- `scripts/lib/git-flow.mjs` 两处为预先通过上述核验，把条目标题静默截断到前 20 字：
  - `autoCommitForRun`（约 :279）——「开发完成到待测试」自动提交与 `atb run autocommit` 重试共用；
  - `supplementCommitForRun`（约 :534）——人工确认补交 doc 组。
- 条目标题本身允许 ≤120 字（`core.mjs` createItem 校验），超过 20 字的标题后半段被静默丢弃，
  提交消息只剩半句，且全程无告警。看板「分支浏览」提交列表与 `atb commit log` 直接展示被截断消息。

## 方案

**开源选型（REQ-20260909-015）**：不引入开源库。自研理由：改动是本项目自身提交规范口径
（常量上限 + 两处字符串拼装）的一致性修正，无第三方库可复用；纯标准库即可完成。

修复口径（README「期望行为」三选一中的组合：放宽上限 + 超限显式报错，不再静默截断）：

1. `commit-store.mjs`：`DESC_MAX_CHARS` 由 20 放宽为 **120**，与 `core.mjs` 条目标题上限
  （≤120 字）对齐——自动提交描述即条目标题，标题合规则消息必然过核验，拼装与核验口径一致。
   常量注释同步改写（引用 BUG-20260914-021）。
2. `git-flow.mjs` 两处去掉 `.slice(0, DESC_MAX_CHARS)`，描述完整保留标题（`String(title)`）；
   `DESC_MAX_CHARS` 不再被本模块引用，从 import 中移除。
3. 极端兜底为显式策略：若历史遗留标题超 120 字（现行创建入口已拦截），完整保留后
   `validateCommitSubject` 会明确报错（failed、原因可查、可重试），不再回到静默截断。

**存量历史提交不回改**（README「待确认」默认口径：不动历史，仅修复增量行为）。

测试（TDD，先红后绿）：

- `scripts/tests/dev-flow-20260911-009.test.mjs` 新增长标题用例：>20 字标题走完
  预留→实施→上报→回执，doc/test/feat|fix 三组提交消息均含**完整标题**且过
  `validateCommitSubject`；同时覆盖 `atb commit log` 输出与核验边界
  （≤120 字通过、>120 字显式报错）。
- `scripts/tests/auto-commit-pre-dirty-20260913-006.test.mjs` 新增长标题用例：
  待人工挂起 → 人工确认补交（`supplementCommitForRun`）路径的 doc 组消息含完整标题。

## 风险与边界

- 提交主题行变长（最长约「前缀 + 120 字 + 单号」）：git 对主题行无硬性长度限制，
  看板 Web 与 CLI 均按整串渲染（无依赖 20 字的截断逻辑，已核验 scripts/web 无相关 slice）。
- `mgt-commit.mjs` 的管理提交描述为固定短文案（「人工确认完成」等），不受上限放宽影响，
  核验继续通过。
- ≤20 字标题的条目提交消息格式不变（回归保护，纳入新用例断言既有行为不回归）。
- 历史已截断的提交消息保持原样（不改写历史，避免 rebase 风险）。
- 上限常量仍保留（120），防未来手工路径出现离谱超长主题时无核验兜底。
