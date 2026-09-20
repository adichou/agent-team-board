# 测试用例 — REQ-20260907-007 删除详细页面的一键派单功能，派单只能通过批量实施

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | 前端契约：app.js 不再有 `dispatchPrompt`/`dispatchBtnHtml`/`flashDispatchBtn`/`launchCodex`/`launchZcode`，无「派发给 zcode/codex」按钮文案，无 `[data-dispatch]` 事件绑定 | P0 | 通过（dispatch.test.mjs） |
| R2 | 保留契约：`copyDispatchText`（navigator.clipboard）保留，批量实施提示词复制不受影响 | P0 | 通过（dispatch.test.mjs） |
| R3 | 样式契约：style.css 不再含 `.dispatch-row`/`.dispatch-btn` | P1 | 通过（dispatch.test.mjs） |
| R4 | 服务端契约：server.mjs 不注册 `/api/dispatch/codex/item`、不调用 `dispatchItem`；旧 `.command`/`open` 链路移除的回归断言保持 | P0 | 通过（dispatch-launch.test.mjs U3） |
| R5 | 调度器契约：scheduler 不再暴露 `dispatchItem`（`typeof s.dispatchItem === 'undefined'`），tick 保留 | P0 | 通过（scheduler.test.mjs D21） |
| R6 | 集成：`POST /api/dispatch/codex/item` 返回 404，且不产生任何执行记录（runs.total === 0），条目状态不改写 | P0 | 通过（dispatch-launch.test.mjs I1、dispatch-api.test.mjs T7） |
| R7 | 回归：批量实施提示词复制链路（`copyDispatchText` 调用点）与任务模块 `gotoRuns` 正常；全量测试通过 | P0 | 通过（npm test：65 文件失败 0） |
