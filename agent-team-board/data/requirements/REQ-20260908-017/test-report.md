# 测试报告 — REQ-20260908-017 创建完单后直接返回列表即可

- 时间：2026-09-08T13:57:53.121Z
- 执行者：zcode-batch-018-5
- 测试框架：node:assert/strict + vm 沙箱行为测试（scripts/tests/run-all.mjs）
- 覆盖率：24%

## 总结

创建完单后只关弹窗/进模块/刷列表/toast，不再自动导航：submitNew 删 openDrawer(st.id) 与 reveal(t.id)；poll 删「已定位新建条目」toast+跳转，detectNewItem 收敛为纯基线登记（README 要求保留）；oncall.js 删无调用方的 reveal；同步改写 new-item-nav/oncall-question-optional/workbench-layout 契约（旧静态切片标记已失效改函数体提取）。全量 90 测试文件 0 失败；M1/M2 宽窄屏人工验收留待确认。

## 明细

（可粘贴命令输出、失败用例说明等）
