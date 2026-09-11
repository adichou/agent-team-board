# 测试用例 — REQ-20260908-005 详情页面高度不要超过列表，要低于状态筛选行

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> D1–D5 由 `scripts/tests/drawer-height.test.mjs` 静态契约覆盖；M1 为人工视觉核验。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| D1 | 窄屏（≤1020px）详情抽屉不再 `position: fixed` 全视口高，媒体块内为 `position: absolute`（`top/right/bottom: 0`，宽度上限不变） | P0 | 通过 |
| D2 | 定位基准：`.req-view` 提供 `position: relative`（抽屉顶边对齐工作区顶 = 状态筛选行下沿，高度与列表区一致） | P0 | 通过 |
| D3 | 遮罩同域：`#mask` 位于 `#reqView` 内，窄屏媒体块内为 `position: absolute; inset: 0`（状态筛选行及其以上不被压暗/拦截） | P0 | 通过 |
| D4 | 回归：窄屏滑入动画与返回入口不动（`translateX(100%)`、`.has-item { transform: none }`、`.drawer-back { display: inline-flex }`） | P1 | 通过 |
| D5 | 回归：宽屏 `.req-split > .drawer` 仍为 `position: static` 常驻右栏（并排等高布局不受影响） | P1 | 通过 |
| M1 | 人工：≤1020px 宽度打开任一条目详情，抽屉顶边低于状态筛选行、高度不超过列表；筛选行可点击切档；宽屏并排无变化（人工执行） | P1 | 待人工 |
