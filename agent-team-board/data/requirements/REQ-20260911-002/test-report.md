# 测试报告 — REQ-20260911-002 营销和发布模块隐藏

- 时间：2026-09-11T05:19:59.299Z
- 执行者：zcode-batch-036-1
- 测试框架：node:assert + node:vm
- 覆盖率：12%

## 总结

暂态隐藏营销/发布模块：HIDDEN_VIEWS 同一开关扩展为 oncall/files/marketing/release；index.html 移除两导航按钮收敛为 需求/任务/设置；MODULE_SUB 移出两键；深链/快照回落需求模块+一次性提示+URL view 参数清理；零 /api/marketing|release 请求；服务端路由、模块源码、容器与数据零改动；恢复步骤记录于 design.md。新测试 8/8 绿，同步更新 9 个既有测试口径，npm test 193 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
