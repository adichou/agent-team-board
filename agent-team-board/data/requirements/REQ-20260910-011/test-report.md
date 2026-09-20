# 测试报告 — REQ-20260910-011 去掉接受、驳回待接受和加入计划，移出计划等二次提示框，意义不大，因为可以撤销

- 时间：2026-09-10T06:04:05.117Z
- 执行者：zcode-batch-031-12
- 测试框架：node:assert/strict + vm 前端沙箱 + 静态契约
- 覆盖率：12%

## 总结

接受/移入计划/驳回待接受/移出计划四流转去掉 uiConfirm 二次确认（skipConfirm 退役），卡片与详情单条入口 single 路径成功 toast 附撤销按钮走合法回退边；ACTION_UNDO 补 submitted→accepted；删除等不可撤销确认保留并防回归。新增 no-confirm-undo-20260910-011.test.mjs 9 用例，同步更新 6 个旧契约测试，npm test 145 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
