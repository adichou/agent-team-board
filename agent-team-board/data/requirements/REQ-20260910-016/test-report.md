# 测试报告 — REQ-20260910-016 排序菜单放到搜索框左侧，因为都是用于定位单号的

- 时间：2026-09-10T08:40:38.136Z
- 执行者：zcode-batch-031-20
- 测试框架：node:assert + vm 契约测试
- 覆盖率：100%

## 总结

排序菜单迁至搜索框左侧定位组：#pageHead 新增 #locateGroup（#reqSort 在 #searchInput 前，Tab 顺序排序→搜索），#reqCaption 移除排序不留占位；syncReqSortVisibility 仅需求模块且已初始化可见（setView+renderBoard 接入）；CSS 定位组靠右可换行、≤720px 组独占整行且组内排序仍在搜索左侧。新增 S1-S6 六用例先红后绿，随迁 4 组存量契约断言，全量 153 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
