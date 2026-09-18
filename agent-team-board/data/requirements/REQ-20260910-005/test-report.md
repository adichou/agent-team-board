# 测试报告 — REQ-20260910-005 支持项目管理

- 时间：2026-09-10T01:32:18.653Z
- 执行者：zcode-batch-029-1
- 测试框架：Node assert（真实 server 集成 + 静态契约）
- 覆盖率：14%

## 总结

项目管理落地：server 注册表增 removed 闸门（防轮询/深链隐式重现、空表不回播）；新增 /api/project/preview 与 /api/project/remove，register 支持 requireInitialized 导入校验，init 支持 body.path（兼容 ?project=）并在落盘后显式登记；前端顶栏「管理项目」弹窗（初始化两步确认/导入/切换/移出确认、busy 禁用、失败保留输入）与无项目空态、clearProjectState 清 URL/记忆/旧画面；P1–P14 全过，npm test 133 文件失败 0

## 明细

（可粘贴命令输出、失败用例说明等）
