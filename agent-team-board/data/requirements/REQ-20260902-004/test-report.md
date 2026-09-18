# 测试报告 — REQ-20260902-004 Status Board 一键派发需求给当前项目的全新会话，并注入预设提示词。支持 zcode 和 codex 两个 Agent

- 时间：2026-09-03T00:53:48.686Z
- 执行者：atb-0903-4297
- 测试框架：node:assert 静态契约（dispatch.test.mjs P1–P4）
- 覆盖率：未统计

## 总结

一键派发完成（v1 形态，按对齐默认）：抽屉对 accepted 条目渲染派发区——「派发给 zcode」「派发给 codex」两按钮，点击生成预设提示词并写入剪贴板（zcode 版=/dev <ID> + 标题注释增强版；codex 版=无 slash 命令，改为 agent-team-board skill 指引措辞），反馈「已复制 ✓ 粘贴到新会话」1.8s 后恢复；样式用全局主题变量。机制边界（方案已声明获默认）：本地 server 无法直接创建两客户端的应用内会话（无公开 deeplink/CLI），v1 交付复制提示词形态；若日后获得会话 deeplink 可升级真一键。派发的新会话仍受看板流程约束。测试：新增 dispatch.test.mjs P1–P4 先红后绿全过；十三套测试回归全绿。server/core 零改动。版本 0.3.13→0.3.14。

## 明细

（可粘贴命令输出、失败用例说明等）
