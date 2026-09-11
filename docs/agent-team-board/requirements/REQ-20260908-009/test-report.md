# 测试报告 — REQ-20260908-009 去掉 bug 单的归属需求选项，默认都是独立 Bug，然后需要在 Bug 单的设计说明书中明确表明引入问题的源单是什么

- 时间：2026-09-08T03:36:27.182Z
- 执行者：zcode-batch-013-1
- 测试框架：node:test（node:assert/strict 自研 runner）
- 覆盖率：92%

## 总结

Bug 一律独立创建：CLI/usage 去掉 --req；core.createItem 拒绝 bug+parent、目录固定顶层 bugs/；bugReadme 去归属行，新增 bugDesign 模板（引入来源三选一指引）随创建落盘 design.md；/api/new 带 parent 返回 400；web 表单去归属下拉与 parent 提交；SKILL/bug.md/dev.md 归因落点同步为 design「引入来源（源单）」节；存量归属经 moveBug 兼容。新增 bug-standalone-origin.test.mjs 8 用例，全量 82 个测试文件通过

## 明细

（可粘贴命令输出、失败用例说明等）
