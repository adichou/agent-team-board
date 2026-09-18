# 测试报告 — BUG-20260909-014 任务模块面板在批量完善和批量开发上方空白较多，而且需要去掉关闭按钮

- 时间：2026-09-09T09:34:14.689Z
- 执行者：zcode-batch-024-3
- 测试框架：node:assert 静态契约断言（run-all.mjs）
- 覆盖率：100%

## 总结

任务面板头部整行移除 .batch-head：去掉 ✕ 关闭按钮及其绑定、去掉与顶栏重复的项目路径行；新增 .batch-drawer .drawer-head 紧凑内边距（12px 18px 0）并将 .batch-modes 上外边距归零，页签直接贴近面板顶部；归因 BUG-20260908-009；契约测试 batch-title-removed/detail-close-btn/settings-simplify 按新契约改写，先红后绿，全量 121 测试文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
