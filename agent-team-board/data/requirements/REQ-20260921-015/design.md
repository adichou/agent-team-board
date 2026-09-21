# 设计 — REQ-20260921-015 版本计划详细内容页签的合并入 main 页面去掉隔离分析下方的一大堆红色字体的文字，并提供一键加入所有依赖提交的按钮

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

见 README「背景与现状」：`renderMergePane`（scripts/web/build.js）以大段红色告警长文
（`rel-form-err`）呈现隔离分析（混合提交拼接长段 + 灰色长句 + 逐条目重复的未选祖先长句与
提交清单）与前置问题（不在 dev / 门禁锁定「暂不可合并：…」/ 合并失败），且化解依赖只能回
第 2 步手工逐个查找勾选。

## 方案

### 1. 合并页简洁化（需求 1）——renderMergePane 重构

信息收敛原则：**数据不变、守卫不变，只改呈现**。服务端 `analyzePublishIsolation`
（scripts/lib/build-git.mjs）与合并前置（assertOnDev / 文档门禁 / blocked 阻止）一律不动。

「隔离分析」节新形态：

- **有依赖**（`perItem` 任一 `intermediates` 非空）：一行汇总
  `发现 N 个未选祖先（依赖）提交 · 影响 M 个所选条目`（N = 跨条目去重提交数、
  M = 有依赖的所选条目数）＋「一键加入所有依赖提交」按钮（需求 2）；明细用原生
  `<details class="bld-iso-deps"><summary>查看依赖明细</summary>` 折叠展开（零 JS 状态、
  可访问），每条 `<code>短hash</code> 主题（为 {所选条目} 的依赖）`，上限 50 条防超长
  （超出注明「其余 N 个略」）。现状的 `notes` 灰色长句不再渲染（汇总行替代）。
- **混合提交**（`blocked` 非空）：单行 `⚠ {n} 处混合提交无法安全拆分，合并将被阻止`，
  `title` 携带完整 blocked 原文（可发现性不降）；服务端合并仍 409 确定性阻止。
- **无依赖**：保持 `所选提交无未选祖先：变更可独立进入主分支。` 简洁空态（不变）。

节下方红色长句改单行状态条 `p.bld-iso-note`（小字号 + `border-left: 3px solid var(--warn)`
沿用 CSS 变量，不新引入配色，深浅色同源）：

- 不在 dev：文案不变（与 `mergeBlockReason` 同源），样式从 `rel-form-err` 红色长段改单行。
- 门禁锁定：`⚠ 暂不可合并：{gate.reason}`（文本保留，BUG-20260921-014 测试 M2 契约不破）。
- 合并失败：`⚠ 合并失败：{error}（可重试，只补未合并条目）`（文本保留）。
- dev 正常提示与合并完成信息不变。

`mergeBlockReason` 增补一档：五步装配已加载且 `mergeAnalysis.blocked` 非空时返回
`暂不可合并：{blocked[0] 截断}`——主按钮 title / 点击 toast（BUG-20260920-006「点击必反馈」）
与真实阻止原因一一对应；优先级置于现有检查之后（不改变既有 merging / pushed / 门禁 / 分支
判序）。加载中 / 读取失败 / 合并完成信息等既有态不变。

### 2. 一键加入所有依赖提交（需求 2）

#### 后端：`POST /api/build/version/add-dependencies`（body `{ id }`，server.mjs）

执行时点**服务端现算**隔离分析（不信前端传值）：

1. `buildStore.readVersion`（不存在 → 400）；`buildGit.analyzePublishIsolation(root, v.items)`
   汇总去重全部 intermediates 为依赖集（Map hash → subject/date）。
2. 空依赖 → 200 `{ version, added: [], skipped: [], note }`（幂等，不报错）。
3. 归因：`gitFlow.itemCommitStatusIndex(board, root)` 反查 commit → 归属条目集合
   （commit 台账 + 提交主题条目编号，README 指定口径）。
4. 逐依赖提交判置（跳过项进 `skipped` 清单，不静默丢失）：
   - 无归属条目 → `无法归属到看板条目（提交主题不含条目编号）`；
   - 关联多个条目（混合提交）→ `混合提交（关联 A、B），无法安全归因`；
   - 归属条目已在本版本 → `条目 X 已在本版本（当前关联另一提交）`（数据模型一条目一
     commit，不覆盖既有关联）；
   - 条目状态非 done → `条目 X 尚未完成（当前状态：…）：仅已完成条目可纳入`；
   - 已被其他版本占用（`occupiedItemMap`，排除本版本）→ `条目 X 已纳入版本 BLD-…`。
5. 可加入项按条目归组：同一条目多个依赖提交时**取最新**（按 commit 时间 `%cI`，
   `analyzePublishIsolation` 的 intermediates 增附 `date` 字段，向后兼容）。
6. `added` 非空 → `buildStore.addItems(board, id, added)`——沿用既有校验
   （normalizeItems / 占用兜底 / `assertItemsEditable`：merging → 409、pushed → 409）
   与 `markDocsScopeStale` 范围变化联动。
7. 响应 `{ version, added: [{itemId, commit, title}], skipped: [{commit, subject, reason}] }`。

#### 前端（build.js）

- pf 状态增 `depBusy`（防重复触发）与 `depSkip`（最近一次跳过清单）。
- 按钮仅在有依赖时渲染；`merging` / 推送完成 → `aria-disabled` + title 真实原因（点击仍
  toast，不静默）；执行中 `disabled` +「加入中…」。
- 点击 `addDependencies()`：调新端点 → 成功 toast（全部加入 / 部分跳过 / 全部跳过三态）
  → `refresh()`（发布范围列表更新）+ `ensurePublishPlan(true)`（隔离分析重求值，依赖收敛）
  → `pf.depSkip` 非空时在隔离分析节内渲染「未能纳入的依赖」清单（每条短 hash + 原因）；
  失败 toast 错误、版本数据不变、可重试。

### 3. 兼容

- 手工「＋ 添加条目」路径与其余四步不变；合并 / 重试 / 增量合并行为不变。
- `analyzePublishIsolation` 仅增字段不改既有字段（perItem / blocked / notes / shared 不变）。
- 文案中英同步（scripts/web/i18n.js，EN 静态 / EN_DYNAMIC 插值，值无中文且唯一）。

## 开源选型（REQ-20260909-015）

未引入开源库：本单为既有构建模块内 UI 收敛与一个组合端点（git 读取复用本仓库
build-git / git-flow 既有封装），无新计算 / 渲染依赖需求，自研成本低于引入与适配成本。

## 风险与边界

- **不弱化任何守卫**：混合提交 / 不在 dev / 文档门禁仍由服务端合并前置确定性阻止；移除的
  只是冗长红色呈现，阻止原因经单行 title / 按钮 title / 点击 toast 三通道保持可发现。
- **归因准确性**：以 `itemCommitStatusIndex`（台账 ∪ 主题编号，均经看板核验）为准，不做
  猜测归因；无法归属 / 混合一律跳过并给清单，不误纳入。
- **并发**：addItems 既有占用 / 状态校验兜底（另一会话抢先纳入 → 400 报占用版本号，前端
  toast 可重试）；merging / pushed 由 `assertItemsEditable` 拒绝。
- **同条目多依赖提交**：取最新提交纳入；更早提交随之成为所选提交祖先而自然消失于依赖集
  （其内容已含在所选提交中）。
