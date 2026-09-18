# 测试报告 — REQ-20260906-016 创建完需求和 bug 单后，要自动导航到对应单

- 时间：2026-09-06T17:15:52.789Z
- 执行者：zcode-batch-003-2
- 测试框架：node:assert+vm（run-all.mjs 聚合）
- 覆盖率：90%

## 总结

纯前端实现创建后自动导航：app.js 新增 knownIds 基线与 detectNewItem，poll 检测新建条目跳转详情抽屉并提示；弹窗创建成功后显式 openDrawer；首轮/切换项目/初始化只播种不跳；弹窗或批量抽屉打开不抢跳。新增 new-item-nav.test.mjs N1-N8 先红后绿，npm test 46 文件 0 失败；M1/M2 人工验收待办。

## 明细

（可粘贴命令输出、失败用例说明等）
