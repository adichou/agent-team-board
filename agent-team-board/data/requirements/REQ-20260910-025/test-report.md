# 测试报告 — REQ-20260910-025 排序下拉组件要和搜索框平齐

- 时间：2026-09-10T12:34:21.793Z
- 执行者：zcode-batch-031-31
- 测试框架：node:assert 静态契约测试
- 覆盖率：100%

## 总结

定位组内排序下拉与搜索框等高平齐：.page-head .locate-group 作用域同一声明块为 .sort-select 与 .module-search 显式同高 32px（border-box 含边框等高、居中沿用），排序下拉内边距放宽 0 8px；复用位置（讨论筛选条 .sort-select、面板 .search-input）与 016 布局/显隐/搜索交互零改动；A1-A6 先红后绿，全量 171 文件除偶发 ECONNRESET 重跑绿外全过

## 明细

（可粘贴命令输出、失败用例说明等）
