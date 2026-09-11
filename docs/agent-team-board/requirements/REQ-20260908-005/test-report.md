# 测试报告 — REQ-20260908-005 详情页面高度不要超过列表，要低于状态筛选行

- 时间：2026-09-08T03:21:58.801Z
- 执行者：zcode-batch-013-1
- 测试框架：node:assert 静态契约测试（drawer-height.test.mjs D1–D5）+ run-all 全量回归
- 覆盖率：83%

## 总结

窄屏（≤1020px）详情抽屉与遮罩 #mask 的定位基准从视口改为需求工作区 .req-view（position:relative）：抽屉 fixed→absolute，顶边低于状态筛选行、高度与列表区一致；#mask 移入 #reqView 同域 absolute inset:0，状态筛选行及其以上不再被压暗/拦截。宽屏并排、滑入动画、返回入口不变；app.js 零改动。新增 drawer-height.test.mjs（5 用例）并更新 portrait-board P2 旧契约；run-all 81 文件全绿。执行中发现存量 flaky：execution-verifier V9 已登记 BUG-20260908-005。

## 明细

（可粘贴命令输出、失败用例说明等）
