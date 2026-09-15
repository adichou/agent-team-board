# 测试报告 — REQ-20260915-003（run-20260915-263）

- 条目：REQ-20260915-003 构建模块的产品发布区域需要移到左侧列表的按钮区域。关联条目支持分页和搜索
- 执行者：zcode-batch-20260915-003
- 结果：reported（条目 test-report.md 为完整报告：docs/agent-team-board/requirements/REQ-20260915-003/test-report.md）
- 新增测试：scripts/tests/build-release-card-items-search-20260915-003.test.mjs（R1~R10 共 11 用例）
- 全量回归：npm test = 258 个测试文件全部通过，失败 0

## 测试输出摘要

```
$ node scripts/tests/build-release-card-items-search-20260915-003.test.mjs
✓ R1 每张版本卡片按钮区含「创建发布」「查看发布记录」（未选中卡片也有）；详情不再渲染产品发布操作区
✓ R2 状态口径逐卡 + 按卡片版本绑定：draft/merging/failed 创建发布禁用（title 含「请先完成合并入 main」）；merged 可用；未选中卡片的创建发布打开所在卡片版本弹层；查看记录派发跨模块跳转事件
✓ R3 「＋ 新建版本」与两页签同一工具行右端：无独立 bld-toolbar；分支浏览页不出现新建入口；点击仍打开新建面板
✓ R4 filterVersionItems：覆盖条目 ID / 标题 / 完整与短 commit；忽略大小写与首尾空白；保持原顺序；字段边界不串配
✓ R5 paginateItems：切片与计数准确；页码越界回落最后有效页；零结果不产生虚假页数
✓ R5b 渲染层分页与翻页行为：默认页大小分片；首末页禁用；上一页/下一页翻页；搜索回第一页；清空恢复；切换版本清空搜索并回第一页
✓ R6 空态区分：零关联显示添加引导；无匹配显示关键词与清空入口；两种空态互斥且零结果不出分页条
✓ R7 加载显示提示不出数据操作；读取失败显示失败与重试、重试成功恢复渲染（模块级状态机，列表数据与版本同源）
✓ R8 过滤/翻页后移出与 commit 换选绑定真实条目 ID；merging/merged 锁定不回归；数据减少后越界页回落最后有效页
✓ R9 i18n：新增静态文案入 EN、动态文案入 EN_DYNAMIC（值无中文、不与受检键值重复）
✓ R10 静态契约：搜索/清空/分页绑定与样式类存在；发布按钮迁出详情（renderDetail 无 data-ver-release）

11 个用例，失败 0

$ npm test
共 258 个测试文件，失败 0
```

无阻塞 / 失败错误需要落盘；TDD 红阶段输出（11 例按预期失败）见条目 test-report.md「TDD 过程」节。
