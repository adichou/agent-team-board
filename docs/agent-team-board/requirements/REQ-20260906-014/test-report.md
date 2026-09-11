# 测试报告 — REQ-20260906-014 详细页面的操作按钮不要二次确认，提供撤销按钮

- 时间：2026-09-06T12:43:51.856Z
- 执行者：zcode-batch-001-4
- 测试框架：node:assert + vm 沙箱契约测试（drawer-undo.test.mjs）
- 覆盖率：7%

## 总结

详情页操作按钮免二次确认并支持撤销完成：抽屉「接受/确认完成/驳回完成」换绑新 drawerAction，点击即执行零 confirm；toast 扩展可选操作按钮（textContent 组装、8 秒停留），确认完成与驳回完成成功后提供「撤销」按钮，按状态机唯一回退边 done↔in-progress 反向 POST（撤销映射 ACTION_UNDO 与 core.TRANSITIONS 契约测试锁定），接受无回退边不提供撤销；acceptItems 增 skipConfirm 供详情页复用，卡片/批量/拖拽入口 confirm 行为不回归。新增 scripts/tests/drawer-undo.test.mjs（T1–T7 先红 7/7 后绿 7/7）；npm test 40 文件 39 过，唯一失败 detail-close-btn T2 为存量回归（批量抽屉 space-between），已登记 BUG-20260906-013，实施与测试日志见 dispatch/runs/run-20260906-003/impl-log.md。

## 明细

（可粘贴命令输出、失败用例说明等）
