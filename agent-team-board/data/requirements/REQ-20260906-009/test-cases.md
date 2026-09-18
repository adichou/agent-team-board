# 测试用例 — REQ-20260906-009 实时状态标志移动到左侧 logo 处右上角叠加显示

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 覆盖文件：`scripts/tests/logo-poll-badge.test.mjs`（静态契约测试，无浏览器）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 结构迁移：`#pollState` 位于 `.brand` 内徽标容器 `.logo-badge`（与 `.logo` 同容器），且不再出现在 `.top-actions` 中 | 高 | 跑红 → 跑绿 |
| T2 | 叠加定位：`.logo-badge` 为 `position: relative`；`.poll` 为 `position: absolute` 且 top/right 为负偏移（角标悬出 logo 右上角） | 高 | 跑红 → 跑绿 |
| T3 | 配色契约不回归：`.poll` 在线绿 `var(--done)`、`.poll.off` 离线灰 `var(--muted)`；与 layout.test T10 兼容 | 高 | 跑绿（回归） |
| T4 | JS 行为不变：`app.js` 仍经 `#pollState` 更新 `●`/`○`、title 与 `off` class，无其他位置相关改动 | 中 | 跑绿（回归） |
| B1 | 浏览器实测：徽标叠加 logo 右上角、不遮挡标题与操作区；≤640px 窄屏正常（人工） | 中 | 待人工 |
