# 测试报告 — REQ-20260915-003 构建模块的产品发布区域需要移到左侧列表的按钮区域。关联条目支持分页和搜索

- 时间：2026-09-15T15:27:28.739Z
- 执行者：zcode-batch-20260915-003
- 测试框架：node:assert/strict + vm 模拟 DOM（scripts/tests/run-all.mjs 聚合）
- 覆盖率：88%

## 总结

构建模块布局调整：产品发布「创建发布/查看发布记录」迁入左侧版本卡片按钮区（draft/merging/failed 禁用并提示请先完成合并入 main，merged 可用，按所在卡片版本绑定；详情不再重复渲染发布操作区）；「关联条目与 commit」联合列表支持搜索（条目 ID/标题/完整与短 commit，大小写与空白不敏感，全量过滤保持原顺序）与分页（每页 10 条为待确认产品参数；首末页禁用、零结果不出虚假页数、数据减少越界回落、切换版本清空搜索回第一页）；「＋ 新建版本」上移至页签工具行右端（分支浏览页无入口）。新增 11 用例全绿，npm test 258 个测试文件 0 失败。

## 明细

### TDD 过程

先在 test-cases.md 列出 R1~R10 并新建 `scripts/tests/build-release-card-items-search-20260915-003.test.mjs` 跑红
（11 例全部按预期原因失败：卡片无发布按钮 / 无搜索输入框与分页条 / filterVersionItems 与 paginateItems
不存在 / i18n 无词条 / renderDetail 仍渲染 bld-release-block），实施后跑绿 11/11。

### 用例与结果

| 用例 | 断言要点 | 结果 |
| --- | --- | --- |
| R1 卡片发布按钮 | 每张卡片（含未选中）含 data-ver-release / data-ver-release-view，aria-label 带版本号；顺序 AI 完善 → 合并 → 创建发布 → 查看发布记录 → 删除；详情无 bld-release-block | ✓ |
| R2 状态与绑定 | draft/merging/failed 禁用且 title 含「请先完成合并入 main」；merged 可用；未选中卡片直调 openReleaseConfirm 打开所在卡片版本弹层、选中态不变；gotoProductRelease 派发 atb:goto-view（release + product） | ✓ |
| R3 新建上移 | bldNewBtn 在 rel-tabs/bld-tabs 行内 bld-tabs-tools 右端、位于两页签之后；无 bld-toolbar；分支浏览页 / 非 git 无入口；点击仍打开既有新建面板 | ✓ |
| R4 过滤纯函数 | 命中条目 ID / 标题 / 完整与短 commit（短为完整前缀，包含匹配覆盖）；大小写与首尾空白不敏感；空 / 纯空白关键词返回全量；\t 分隔防跨字段串配；保持原顺序 | ✓ |
| R5 分页纯函数 | 切片与计数；页码越界回落最后有效页；非法页码回落第一页；total=0 时 pages=0（不产生虚假页数） | ✓ |
| R5b 渲染与交互 | 头部行顺序 标题 → 搜索输入/按钮（/清空）→ 添加条目；12 条分 2 页；首末页 prev/next 禁用；翻页只渲染当前页行；搜索「匹配 4 / 共 12 条」回第一页且顺序保持；清空恢复；经真实卡片点击切换版本清空搜索回第一页 | ✓ |
| R6 空态区分 | 零关联显示「暂无条目」添加引导（无分页条、无匹配 0 计数）；无匹配显示关键词 + data-items-search-clear 清空入口 + 「匹配 0 / 共 12 条」；两空态互斥 | ✓ |
| R7 加载与失败 | 模块 loading 显示加载提示且无数据操作入口；error 显示失败原因 + bldRetryLoad 重试；重试成功恢复版本与列表渲染（列表数据与版本同源 /state，模块级状态机即列表区域状态） | ✓ |
| R8 行内操作与锁定 | 过滤后 data-remove-item / data-commit-item 绑定命中条目的真实 ID；merged/merging 移出、commit 换选、添加条目禁用口径保留；12→10 条后第 2 页回落第 1 页且计数更新 | ✓ |
| R9 i18n | 新增静态文案（清空/上一页/下一页/占位符/创建发布/查看发布记录等）入 EN，动态（匹配 ◇ / 共 ◇ 条、第 ◇ / ◇ 页、没有匹配的关联条目（关键词：◇））入 EN_DYNAMIC；值无中文；受检键值唯一性不回归 | ✓ |
| R10 静态契约 | bindCommon 绑定 #bldItemsSearchInput（草稿回写 + 回车）/ #bldItemsSearchGo / [data-items-search-clear] / [data-items-pg]；renderDetail 无 data-ver-release、renderVersionList 有；style.css 含 bld-tabs-tools / bld-items-search / bld-items-count / bld-items-pager，bld-items-head 允许换行，bld-toolbar 样式移除 | ✓ |

### 验收标准对应

1~7 项（工具行布局 / 卡片发布按钮 / 按卡片绑定与禁用 / 搜索口径 / 分页与重置 / 四种状态区分 / 行内操作与锁定）
由 R1~R10 覆盖；第 8 项 ui-demo.html 为需求创建时已交付的单文件离线演示（内联 CSS/JS、无外网依赖，
README 已含布局 / 交互 / 状态说明与相对链接），本次实现与演示口径一致（联合列表 + 每页数量为待确认产品
参数，产品实现取 10 条并在代码与测试中注明）。

### 变更文件

- `scripts/web/build.js`：卡片发布按钮（renderVersionList）、详情联合列表搜索分页（renderDetail +
  filterVersionItems / paginateItems / itemsPageView / submitItemsSearch / clearItemsSearch /
  gotoItemsPage / selectVersion / resetItemsList）、bldNewBtn 上移页签工具行（render）、
  绑定与导出接缝；移除详情 bld-release-block 与独立工具栏。
- `scripts/web/style.css`：bld-tabs-tools / bld-items-search / bld-items-count / bld-items-pager /
  bld-items-pageinfo 新样式；bld-items-head 允许换行；bld-toolbar 与 bld-release-block 样式移除
  （卡片 card-acts 既有 flex-wrap 容纳五键自动换行）。
- `scripts/web/i18n.js`：EN 新增 14 条静态词条、EN_DYNAMIC 新增 3 条动态词条（值与既有受检键错开）。
- `scripts/tests/build-release-card-items-search-20260915-003.test.mjs`：新增 11 用例。
- `docs/agent-team-board/requirements/REQ-20260915-003/test-cases.md`：用例表及结果。

### 全量回归

`npm test`：258 个测试文件全部通过，失败 0（含既有 build-ui / bug-build-ver-card-acts /
product-release-ui / bug-remote-empty-explain / i18n-coverage 等构建模块相关测试零回归）。
