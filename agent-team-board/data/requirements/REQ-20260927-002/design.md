# 设计 — REQ-20260927-002 版本计划添加条目时自动关联该条目的全部提交

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

五步发布流程下线「一键加入依赖提交」（REQ-20260926-002）后，「选择条目和提交」步（新建版本 /
添加条目两面板共用）仍为单值 commit 选择（`commits[0]` 下拉），且候选索引排序（账本 run 升序在前、
git 历史追加在后）使 `commits[0]` 实际命中最早的收口提交——REQ-20260926-002 加入
BLD-20260923-001 时仅关联 doc 提交，feat 主提交不会随挑选合并进 main。本单取消逐个提交选择，
改为勾选条目即整组自动关联其全部应属提交。

## 方案

**开源选型（REQ-20260909-015）**：本单为既有 Node 前后面板逻辑改动，无新增第三方依赖场景，
未引入开源库（无 licenses.md）。自研理由：自动关联口径（账本核验 ∪ 主题末尾单号严格归属 /
宽口径折叠）与既有归因证据链（BUG-20260926-003 `subjectAttributionItemId`）强耦合，
复用既有内部实现零成本，无合适开源库可替代看板自身数据口径。

### 后端：提交元数据三口径（git-flow.mjs + server.mjs）

- 新增 `gitFlow.autoAssociationIndex(dataDir, projectRoot)`（纯函数，只读）：单次
  `git log --format=%H%x09%s` 扫描 + `committedItemIndex` 账本聚合，返回
  `Map<itemId, { auto, broad }>`：
  - `auto`：自动关联集 = 账本核验（source `'ledger'`，强证据，覆盖同 hash 的归属标注）∪
    主题末尾单号严格归属（`subjectAttributionItemId(subject) === itemId`，source
    `'attribution'`）；
  - `broad`：宽口径命中（主题任意位置含单号、但未进自动集）；
  - 排序：两类均按 git 历史位置旧→新；账本登记但历史缺失的 hash 稳定排在末尾（主题留空）；
  - 大杂烩提交（如 6f2ead6 主题挂两百余单号）仅归属主题末尾单号（括号外最后一个），
    其余单号只进 broad——与既有归因证据 b 口径一致。
- `/api/build/candidates`（server.mjs）：候选条目在既有 `commits` / `lastCommittedAt`
  （`itemCommitStatusIndex`，看板徽标同源，语义不变）之外附 `commitMeta`
  （`auto` 的 `{ hash, subject, source }[]`）与 `broadCommits`（`broad` 的
  `{ hash, subject }[]`），供前端整组自动关联与折叠提示。

### 后端校验：不改（既有口径已满足）

`normalizeItems` / `commitsOf`（BUG-20260921-015）已支持 `commits` 数组、逐元素 40 位 hash
校验、空数组拒绝（沿用「缺少有效的关联 commit（40 位提交号）」文案）；换选
`setItemCommit`（单提交整体替换）、`appendItemCommits`、已合入 / merging / 推送后锁定语义均不动。

### 前端：两面板整组自动关联（build.js）

- 纯函数（导出供测试）：`autoAssociationOf(it)`——自动关联集直读 `commitMeta`；为空时回退
  `broadCommits` 最新 1 个（source `'fallback'`，标注回退来源）；旧候选 payload（无元数据键）
  按 `commits` 数组末位近似回退（防御）。`broadHitsOf(it)`——宽口径命中只读数据源。
  `selectableCandidates` 升级为「自动关联集非空（含回退）」才可勾选。
- 面板状态：`commits` 单值 map 移除；新增 `broadOpen`（宽口径折叠开合 Set）。
- 渲染（`renderCandidateRows`）：勾选行内展开「关联提交（自动关联 N 个 · 旧→新 · 只读）」
  只读区块——短 hash + 提交主题 + 来源徽标（自动·账本 / 自动·归属 / 回退·宽口径，颜色 +
  文字双重区分）；无下拉、无删除控件。宽口径命中折叠行「另有 N 个宽口径命中未关联」
  可点开展开（只读、不可勾选、不计入 M）。提交下拉（`.bld-commit-sel`）与
  `setPanelCommit` 随之移除。
- 操作条计数：「已选 N 项 · M 个提交」（M = 已选条目自动关联提交数之和，回退计入；
  无提交跳过提示独立成句）。
- 保存 payload：`{ itemId, commits: [hash…] }`（整组），两面板一致。
- 徽标 / 文案新增词条同步 `scripts/web/i18n.js`（静态 EN + EN_DYNAMIC 插值，
  BUG-20260912-001 口径）。

## 风险与边界

- 候选接口新增一次 `git log` 全量扫描（`autoAssociationIndex` 独立 pass，不并入
  `itemCommitStatusIndex` 以免扰动看板徽标既有语义）；面板打开时一次性的开销可接受。
- 主题长（两百余单号）的正则扫描为既有 `subjectAttributionItemId` 口径，单提交开销线性。
- 账本 hash 不在当前仓库历史（异常数据）不报错：自动关联保留（账本核验）、主题留空、排末尾。
- 旧候选 payload（无 commitMeta / broadCommits）前端回退到 `commits` 数组末位近似最新，
  仅防御用途；正常链路两接口同发，元数据恒在。
- 不触碰版本详情换选（`setItemCommit`）、补入提交（`appendItemCommits`）、合并与锁定逻辑。
