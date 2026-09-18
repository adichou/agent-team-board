# 测试报告 — BUG-20260907-002 浏览器手动刷新需求界面无数据，若切换到其他栏目，再切换回来就有数据

- 时间：2026-09-07T09:26:56.215Z
- 执行者：zcode-batch-006-1
- 测试框架：node:assert + node:vm 模拟 DOM 行为测试（npm test 聚合）
- 覆盖率：85%

## 总结

修复刷新后需求视图无数据：boot() 改为对解析视图统一调用 setView(viewParam)，默认 status 视图不再跳过容器初始化（#reqView 初始 hidden 仅 setView 移除）；引入来源 REQ-20260907-004。新增 refresh-default-view.test.mjs R1-R5（刷新可见/往返/深链/离线空态/静态契约），全量 60 个测试文件全绿

## 明细

（可粘贴命令输出、失败用例说明等）
