# 测试报告 — REQ-20260830-005 看板卡片一键复制 REQ/BUG 单号

- 时间：2026-08-30T15:11:18.641Z
- 执行者：terminal
- 测试框架：node:assert 静态契约 + 浏览器实测（部分）
- 覆盖率：未统计

## 总结

卡片单号一键复制完成（零依赖）：卡片、抽屉详情头、抽屉下属 Bug 列表三处单号均可点击复制（.cid.link 可点态 + hover 样式 + title 提示）；实现优先 navigator.clipboard.writeText（127.0.0.1 安全上下文可用），异常降级 execCommand('copy')（隐藏 textarea），仍失败 toast 提示「复制失败，请手动框选」；成功反馈就地显示「已复制 ✓」1.2 秒后恢复原文（反馈期间 dataset.copied 防重复点击），不用全局 toast；复制点击 stopPropagation 不冒泡开抽屉，与拖拽换列、2 秒轮询增量渲染不冲突。TDD：新增 scripts/tests/copy-id.test.mjs（C1–C4 先红后绿全过）；C5 浏览器点击目验因当日 IAB 输入管线故障未能完成（点击无事件响应），逻辑由契约覆盖，待人工点击任一单号确认。版本 0.2.2→0.2.3。

## 明细

（可粘贴命令输出、失败用例说明等）
