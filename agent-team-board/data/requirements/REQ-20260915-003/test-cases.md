# 测试用例 — REQ-20260915-003 构建模块的产品发布区域需要移到左侧列表的按钮区域。关联条目支持分页和搜索

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 实现：`scripts/web/build.js`（前端纯客户端改动）+ `scripts/web/style.css` + `scripts/web/i18n.js`。
> 测试：`scripts/tests/build-release-card-items-search-20260915-003.test.mjs`（R1~R10）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 版本卡片按钮区含「创建发布」「查看发布记录」（含未选中卡片）；右侧详情不再渲染产品发布操作区（bld-release-block 移除） | 高 | 通过 |
| R2 状态口径逐卡：draft/merging/failed 创建发布禁用且 title 说明「请先完成合并入 main」；merged 可用；未选中卡片的创建发布打开所在卡片版本的核对弹层（不误用右侧选中版本） | 高 | 通过 |
| R3 「＋ 新建版本」与两页签同一工具行（页签行右端），不再有独立 bld-toolbar；分支浏览页不出现新建入口；非 git 不出现；点击仍打开既有新建面板 | 高 | 通过 |
| R4 关联列表搜索：filterVersionItems 覆盖条目 ID / 标题 / 完整与短 commit 哈希；忽略英文大小写与首尾空白；过滤全量（所有页）数据且保持原顺序；字段边界不串配 | 高 | 通过 |
| R5 分页 paginateItems：切片与计数准确；页码越界回落最后有效页；零结果不产生虚假页数。渲染层：超过每页数量出分页条，首末页禁用上一页/下一页；搜索/清空/切换版本回第一页，切换版本清空搜索 | 高 | 通过 |
| R6 空态区分：零关联显示「暂无条目」添加引导；有数据但无匹配显示关键词与清空入口（data-items-search-clear）；两种空态文案互斥 | 高 | 通过 |
| R7 加载与读取失败：模块 loading 显示加载提示（无数据操作入口）；error 显示读取失败与重试；重试成功恢复数据渲染。均为模块级状态机（列表数据与版本同源 /state） | 中 | 通过 |
| R8 过滤与翻页后行内「移出」/commit 换选绑定真实条目 ID；merging/merged 锁定（禁用移出与 commit 换选、添加条目）不回归；数据减少（移出条目）后当前页越界回落最后有效页 | 高 | 通过 |
| R9 i18n：新增静态文案（清空 / 上一页 / 下一页 / 搜索占位符 / 发布按钮等）入 EN，动态文案（匹配 ◇ / 共 ◇ 条、第 ◇ / ◇ 页、没有匹配的关联条目（关键词：◇））入 EN_DYNAMIC；值无中文且不与既有受检键值重复 | 中 | 通过 |
| R10 静态契约：bindCommon 绑定 #bldItemsSearchInput（草稿回写 + 回车）、#bldItemsSearchGo、[data-items-search-clear]、[data-items-pg]；style.css 含 bld-tabs-tools / bld-items-search / bld-items-count / bld-items-pager 样式 | 中 | 通过 |
