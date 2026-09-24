# 设计 — BUG-20260925-001 文件编写页面的AI 校对结果页面，每次接收一条都会自动跳到第一条，需要修改为保留在当前修改的条

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-… / BUG-…（编号需经 `atb list` 核验真实存在）
- 引入来源：未定位（排查过程：…）
- （登记时暂空：尚未排查）

### 实施阶段归因（atb list 已核验）

- 引入来源：REQ-20260924-006（`scripts/web/build.js` 校对建议侧栏 `.bld-chk-list`
  （滚动容器）与 `acceptChkSuggestion` / `rejectChkSuggestion` 均为该需求引入；该实现
  以 `render()` 全量重建窗格 DOM，建议列表滚动位置自引入起即随每次决断 / 轮询重渲染丢失，
  非后续回归）。

## 根因分析

`render()`（scripts/web/build.js）用 `view.innerHTML = …` 全量重建「文档编写」窗格。
建议列表 `.bld-chk-list` 是 `max-height: 460px; overflow-y: auto` 的纵向滚动容器
（scripts/web/style.css），DOM 节点被整体替换后 `scrollTop` 归零：

1. **「接受」/「拒绝」**：`acceptChkSuggestion` 决断前后各一次 `render()`；
   `rejectChkSuggestion` 决断后一次 `render()`——每次都重建列表，滚动位置丢失，
   视图跳回第一条建议。
2. **轮询被动刷新**：校对 run / 文档状态变化的轮询同样走 `render()`，打断用户当前
   查看位置。
3. 文件级选择由 `pf.chkFile` 记忆不丢；丢失的是列表内（条目层面）的滚动位置。

## 方案

不改渲染架构（全量重建保持），在 `render()` 前后加滚动位置记忆 / 恢复 / 锚定三段：

1. **记忆**：`captureChkScroll(view)` 在重建前抓旧 `.bld-chk-list` 的 `scrollTop`
   （无列表返回 null）。
2. **恢复 + 锚定**：`restoreChkListScroll(listEl, saved, anchor)` 重建后先恢复记忆位置，
   再把锚点条目按 nearest 口径微调进可视区——完全可见不动、上方露出上移贴顶、下方越界
   下移贴底（只动列表自身 `scrollTop`，不用 `scrollIntoView` 避免滚动外层页面 / 弹窗）。
3. **消费时机**：`applyChkScrollAfterRender(view, saved)`（`bindCommon` 后调用）控制状态：
   - `pf.chkAnchor = { runId, file, idx }` 由接受 / 拒绝在决断前置入；busy 中间渲染
     （`pf.chkBusy` 非空）不消费、保留到决断渲染一次性消费（保存失败同样保留，视图停在
     当前条目可重试）；换 run（新一轮校对）锚点失效丢弃。
   - 轮询等被动重渲染无锚点 → 纯恢复记忆位置（验收第 4 条）。
   - 文件下拉主动切换：`pf.chkScrollReset` 一次性标志 → 新文件列表从顶部开始，不沿用
     旧文件偏移（验收第 6 条）。
4. **锚点钩子**：建议卡片 `<li class="bld-chk-issue">` 增加 `data-chk-idx="<i>"`
   （0 基，与 `data-chk-accept="file|idx"` 口径一致），供重渲染后定位。
5. `defaultPf` 声明会话态字段 `chkAnchor: null` / `chkScrollReset: false`（不持久化）。

**开源选型（REQ-20260909-015）**：未引入开源库——滚动位置记忆与 nearest 可视微调是
十几行原生 DOM 读写（`scrollTop` / `getBoundingClientRect`），无合适且必要的库级抽象，
引入成本高于自研，不创建 licenses.md。

## 风险与边界

- **不改变任何决断 / 保存 / 过期逻辑**：`acceptChkSuggestion` / `rejectChkSuggestion`
  仅各增一行置锚点；幂等（已决断直接返回不置锚点）、stale 不覆盖、保存失败不误标口径不变。
- **无新增界面文案**：不涉及 i18n（验收第 7 条不触发）。
- 修复只作用于 `.bld-chk-list` 一个滚动容器，语言页签、文件列表、整体审查对话框等
  其他区域重渲染行为不变。
- 回归面：REQ-20260924-006 既有口径（解析 / 应用 / 计数纯函数、五步条与侧栏渲染、
  接受拒绝行为、翻译门禁）与 i18n 全套保持通过（npm test 349 个文件全绿）。

## 实施记录（2026-09-25）

- TDD：新增 scripts/tests/bug-20260925-001.test.mjs（6 用例，先红后绿）——L4-1 记忆
  captureChkScroll、L4-2 恢复 / nearest 微调（上下越界 / 可见不动 / 锚点缺失回落 /
  null 安全）、L4-3 消费时机（决断消费 / busy 保留 / 换 run 丢弃 / 换文件重置 / 无列表
  安全）、L4-4 卡片 data-chk-idx 锚点钩子（既有结构不变）、L4-5 接受拒绝置锚点（含
  失败保留与幂等不置）、L4-6 render 接线。
- 实现：scripts/web/build.js——defaultPf 会话态字段、renderDocsPane 卡片锚点钩子、
  captureChkScroll / restoreChkListScroll / applyChkScrollAfterRender 三函数、
  render() 重建前后接线、接受 / 拒绝置锚点、文件下拉切换重置。
