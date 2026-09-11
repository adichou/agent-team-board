# 测试报告 — BUG-20260908-016 批量完善没有显示 zcode 和codex 的选择，生成的提示词都是 zcode

- 时间：2026-09-08T15:58:43.568Z
- 执行者：zcode-batch-018-1
- 测试框架：node:assert/strict + vm 静态契约测试（scripts/tests/run-all.mjs 聚合）
- 覆盖率：88%

## 总结

收尾「启动新任务」（含终止收尾）内嵌 #refineNextMode 执行 Agent 选择：空占位、按设置过滤、全隐藏禁用并提示；创建面板 #refineMode 同改空占位、未选择禁用；createRefineBatchAndCopy 删除 state.refine.mode/'zcode' 静默回退，未选择 toast 且不发 /api/refine/create；草稿轮询重渲染不回落。新增 refine-ui R12-10 用例（先红后绿），refine-ui/refine-store/tasks-refine 及全量 95 测试文件 0 失败（body-limit 首跑偶发，复跑通过，与改动无关）。服务端与批量开发面板零改动。

## 明细

（可粘贴命令输出、失败用例说明等）
