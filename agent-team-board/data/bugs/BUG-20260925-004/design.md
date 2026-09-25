# 设计 — BUG-20260925-004 不要每次关闭文档编写的编辑界面都重新刷新界面

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**REQ-20260921-008**（`closeReview` 关闭刷新，提交 01db0bf，`atb list` 核验：done）
- 引入来源：**REQ-20260924-006**（`closeEditDialog` 关闭刷新，提交 675a215，`atb list` 核验：in-progress）
- 两个来源同型：均为「关闭编辑界面后调用 `ensurePublishPlan(true)` 同步最新四态与门禁」的意图，
  未考虑 `ensurePublishPlan(force)` 会先置 `pf.phase = 'loading'` 并触发 `render()` 全量重建。

## 根因分析

1. `closeReview()`（原 2183 行附近）与 `closeEditDialog()`（原 3906 行附近）在关闭后：
   - 先 `render()`（`view.innerHTML` 全量重建，窗格 DOM 全换）；
   - 再 `ensurePublishPlan(true)` → 置 `pf.phase = 'loading'` + `render()` →
     `renderDocsPane()` 在 loading 态把窗格主体替换为「正在加载发布流程数据…」占位；
   - publish-plan 请求返回后再次 `render()` 整块重建。
   关闭动作因此被一次网络请求的节奏拖住，观感即「关闭 = 整页刷新」。
2. `.build-view` 是文档编写窗格的滚动容器（`overflow: auto`；`bld-docs-list` 自身不滚），
   `innerHTML` 重建瞬间滚动高度塌陷 scrollTop 归零 → 文件列表滚动回顶、页签视觉重置。
3. 附带竞态同因：`loadEditFile` 末尾 `if (state.pf === pf) render()` 不看弹窗是否已关——
   「打开弹窗随即关闭」时在途读取返回仍会整块重渲染一次。

## 方案

**开源选型（REQ-20260909-015）**：本单为纯前端行为修正（既有关闭路径的刷新策略调整 +
滚动位置记忆），无新增第三方能力需求；无合适库可替代（不引入框架级状态/DOM diff），
自研理由：改动收敛在既有 `build.js` 模块内，复用仓库既有范式（BUG-20260925-001 的
滚动记忆恢复、summaryPoll 的静默拉取 + JSON 比对跳过无变化渲染）。未使用开源库，
不创建 licenses.md。

实现（`scripts/web/build.js`，均为既有范式的组合，无私有 API / 无 HIG 冲突）：

1. **关闭只摘弹窗元素**：`closeReview` / `closeEditDialog` 在状态置空后
   `$('#bldReviewWrap')?.remove()` / `$('#bldEditWrap')?.remove()`——窗格 DOM 不重建，
   滚动 / 页签天然保持；Esc / 遮罩 / ✕ 等既有入口复用同一函数不受影响。
2. **后台静默同步 `syncDocsPlanSilently()`**：替代关闭路径的 `ensurePublishPlan(true)`——
   不置 loading、不清窗格；成功且数据有变化才 `renderPreservingDocsScroll()` 重绘
   （状态徽标 / 门禁 / 计数随新数据更新），无变化不重绘；未就绪（phase 非 ready / 无
   plan）回落常规 `ensurePublishPlan(true)`（首次进入仍走既有加载占位）；迟到响应按
   闭包身份 + seq 丢弃（与 ensurePublishPlan 同口径）；决断重播种（BUG-20260925-002
   口径）不回归。
3. **失败轻量横幅**：`pf.syncErr`（defaultPf 新增会话态）承载失败原因，renderDocsPane
   在内容保持的前提下渲染横幅 + `data-pf-sync-retry` 重试按钮；成功同步 / 常规刷新
   （`ensurePublishPlan` 成功路径）清空；不进整页 error 态。
4. **滚动保持 `renderPreservingDocsScroll()`**：重建前记忆 `#buildView.scrollTop`、
   重建后恢复（innerHTML 塌陷归零场景）；无视图容器（测试沙箱）不阻断渲染。
5. **竞态收口**：`loadEditFile` 末尾渲染改为弹窗仍打开才渲染（内容落点已不存在不重绘）。
6. i18n：新增静态词条「重试同步」+ 动态词条「后台同步失败：◇——当前内容保持不变，可重试
   或点「刷新」全量更新」（中英同步，BUG-20260912-001 口径）；style.css 横幅弱化样式。

## 风险与边界

- 「关闭后同步最新四态与门禁」的产品意图保留（静默同步替代强刷，口径与「刷新」按钮一致），
  仅改变呈现方式；保存后回退待审核、审核基准、门禁计算等数据口径零改动（服务端与
  publish-plan 装配不动）。
- `JSON.stringify` 比对与 summaryPoll 同口径：键序不一致等极端情形最多多一次重绘（保持
  滚动，无观感损伤），不会漏更新。
- 关闭改「摘元素」后，后续任意 `render()` 仍按 `pf.review`/`pf.edit` 已置空渲染，无残留；
  弹窗内未保存草稿保护（三动作）、审查对话框双栏同步滚动、AI 校对建议栏滚动保留
  （BUG-20260925-001）行为均不变（回归项见 test-report）。
- req-20260924-006 既有测试沙箱随接缝依赖变化补 `$` / `syncDocsPlanSilently` 两个桩
  （行为断言本身未改）。
