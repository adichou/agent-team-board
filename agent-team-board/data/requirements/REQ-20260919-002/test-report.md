# 测试报告 — REQ-20260919-002 需求开发中遇到需人工决策的时候，决策界面需要优化布局

- 时间：2026-09-19T15:59:25.901Z
- 执行者：zcode-batch-052-1
- 测试框架：node:assert + 仓内 run-all
- 覆盖率：100%

## 总结

决策界面布局优化：聚合区卡片四层分层+主次操作分组+未答置前/已答折叠+区头计数徽标与整区面板化；面板常驻进度条随保存更新、聚焦首个未答、答复框自适应高度、底部常驻；既有交互口径与 hold 契约零回退；i18n 双语同步。测试 req-20260919-002 先红后绿 20/20，npm test 全量 285 文件 0 失败

## 明细

- 先红后绿：scripts/tests/req-20260919-002.test.mjs 初版 15 例红（实现前）→ 实现 20 例全绿（A1–A5 / B1–B5 / C1–C6 / D1–D2 / E1–E2，与 test-cases.md 一致）。
- 回归：hold-20260911-007.test.mjs（含 U1 / U2 既有 hold 静态契约与 S 组 API 契约）全部通过；i18n-coverage / i18n-dict / i18n-lang / i18n-runtime / i18n-wiring 全部通过。
- 全量：npm test（run-all）→ 共 285 个测试文件，失败 0。
- 改动文件：scripts/web/app.js、scripts/web/index.html、scripts/web/style.css、scripts/web/i18n.js；新增 scripts/tests/req-20260919-002.test.mjs。hold 状态机 / CLI（atb hold *）/ /api/holds* 契约不变（lib/hold-states.mjs、lib/hold-store.mjs、server.mjs 零改动）。
- design 决策（README 待确认项）：可见性增强取「整区面板化 + 区头强调 + 计数徽标」，不改聚合区位置；答复框做自适应高度（最小 2 行、上限 12 行）；聚合区加载中视图维持现状（避免轮询闪动）。
- i18n：新增静态词条「⚠ 待人工确认」「展开 / 收起已答问题」，动态词条「已答 ◇ 项」「待答 ◇ 项，填写后保存草稿」；旧整串动态键「⚠ 待人工确认（◇）」随区头结构调整同步移除（挂起确认区同形长键保留）。
