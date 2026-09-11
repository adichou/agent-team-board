# 测试用例 — REQ-20260911-002 营销和发布模块隐藏

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 自动化：`node scripts/tests/hide-marketing-release-20260911-002.test.mjs`（M1–M7）；
> 既有口径同步（W2 / H1 / marketing U1 / release U1 / T3 / C1 / C3 / B2 / revert-ci T2 等）与全量回归由 `npm test` 承担。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| M1 | 静态：顶栏导航收敛为 需求/任务/设置（`['status','runs','settings']`），无「营销」「发布」按钮与空占位；HIDDEN_VIEWS 单一开关扩展含 marketing / release（oncall / files 保留）；setView 仍以开关兜底；MODULE_SUB 移出 marketing / release 两键（沿用 oncall / files 先例） | 高 | 通过 |
| M2 | 旧深链回落：`?view=marketing` / `?view=release` 打开刷新均回落需求模块（无空白视图）；URL view 参数被清理、project 保留；有一次一次性提示；回落过程不请求 /api/marketing/* 与 /api/release/* | 高 | 通过 |
| M3 | setView 兜底：直接 `setView('marketing')` / `setView('release')` 回落 status 并提示；任务 / 设置等未隐藏模块切换不受影响 | 高 | 通过 |
| M4 | 零网络请求：boot + 主轮询（poll）链路全程不出现 /api/marketing/* 与 /api/release/*（含 /api/marketing/state、/api/release/state）；进入隐藏模块的路径已被 M2/M3 兜底消除 | 高 | 通过 |
| M5 | 刷新快照兜底：快照 view 为 marketing / release 时刷新回落需求模块（不得恢复进入隐藏模块）；快照结构不做破坏性清理（marketing / release 键保留在 schema、不做版本迁移，restoreView 暂存接缝保留；子状态随正常浏览按现状机制自然重建，沿用 REQ-20260909-013 口径） | 高 | 通过 |
| M6 | 服务端与模块零改动：server.mjs 保留 /api/marketing/* 与 /api/release/* 路由注册；marketing.js / release.js 源文件、#marketingView / #releaseView 容器与脚本引用保留；docs/agent-team-board/marketing/ 与 releases/ 数据目录保留 | 高 | 通过 |
| M7 | 暂态可逆：恢复步骤（HIDDEN_VIEWS 移除两键 + 还原 index.html 两个导航按钮 + MODULE_SUB 加回两键，含 BUG-20260911-002 通用副标题文案）完整记录于本条目 design.md | 中 | 通过 |
