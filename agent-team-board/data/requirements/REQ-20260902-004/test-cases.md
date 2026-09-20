# 测试用例 — REQ-20260902-004 一键派发提示词

> P1–P4 由 `scripts/tests/dispatch.test.mjs`（静态契约）覆盖。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| P1 | dispatchPrompt 模板：zcode（/dev 入口）/codex（skill 指引）两版，含单号与标题 | P0 | ✓ |
| P2 | 抽屉 accepted 状态渲染派发区（派发给 zcode / 派发给 codex 两按钮） | P0 | ✓ |
| P3 | 复制走 navigator.clipboard，成功反馈「已复制 ✓ 粘贴到新会话」 | P0 | ✓ |
| P4 | 派发区样式存在且用全局主题变量 | P1 | ✓ |

## 执行记录（2026-09-03）

- dispatch.test.mjs P1–P4 全绿（先红后绿）。十三套测试回归全绿。
- v1 形态按对齐默认：复制提示词 + 无 scheme 尝试（用户未提供会话 deeplink/CLI）；派发入口仅 accepted 状态；
  提示词用增强版（含单号与标题注释）。派发的新会话仍受看板流程约束。
