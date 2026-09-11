# 测试用例 — REQ-20260906-013 在开发中和已完成之间增加待确认分类

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 实现载体：`scripts/tests/confirm-lane.test.mjs`（VM 加载真实 app.js + 静态契约）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | LANES 契约：五列顺序 submitted→accepted→developing→confirming→done，「待确认」位于「开发中」与「已完成」之间；STATE_LABEL 状态机文案不变（in-progress 仍「开发中」） | 高 | 跑红 → 跑绿 |
| T2 | laneOf 分组：in-progress+agentCompletedAt→confirming；in-progress 无上报→developing；submitted/accepted/done 原样 | 高 | 跑红 → 跑绿 |
| T3 | 列构建：confirming 列标题「待确认」、data-lane=confirming、无批量接受/实施工具栏；developing 列标题「开发中」 | 高 | 跑红 → 跑绿 |
| T4 | 拖放行为：拖入 confirming 列被拒（toast 提示、零请求）；拖入 developing 列 POST to=in-progress；拖入 done 列 POST to=done | 高 | 跑红 → 跑绿 |
| T5 | tab 条与计数：ensureBoardTabs 生成五个 tab、label 含「待确认」；updateBoardTabs 按 laneOf 计数（上报条目计入待确认 tab） | 中 | 跑红 → 跑绿 |
| T6 | 卡片 tooltip：上报条目 title 提示「等待人工确认」，未上报提示开发中 | 中 | 跑红 → 跑绿 |
| T7 | CSS 契约：.board 五列 repeat(5, minmax(180px,1fr))；.s-confirming 用 --confirming、.s-developing 沿用 --inprogress；--confirming 亮暗两套；.flag 前景色与列色一致 | 高 | 跑红 → 跑绿 |
| T8 | 回归：npm test 全量 39 文件，仅存量 detail-close-btn T2 红灯（BUG-20260906-012，与本条目无关）；layout T6 / pending-alignment R5 / portrait P4 四列断言随五列契约更新，「待对齐」守卫保留 | 高 | 跑绿（契约更新） |
| M1 | 浏览器人工核验：真实看板五列渲染、拖放确认完成链路、竖屏 tab 滑动 | 中 | 待人工 |
