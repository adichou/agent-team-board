# REQ-20260907-007 删除详细页面的一键派单功能，派单只能通过批量实施

- 状态：submitted（待人工接受）
- 创建：2026-09-07T13:51:21.822Z

## 描述

详情抽屉（drawer）中的「一键派发」区提供「派发给 zcode」「派发给 codex」两个按钮，
绕过批量实施流程直接为单个条目创建执行（codex 通道经 `POST /api/dispatch/codex/item`
调用调度器 `dispatchItem`）。该入口与批量实施并行造成两条派单路径并存。

本需求删除详情页一键派单入口，使派单只能通过「批量实施」进行：

- 前端 `scripts/web/app.js`：删除 `dispatchPrompt` / `dispatchBtnHtml` / `flashDispatchBtn`
  / `launchCodex` / `launchZcode` 及 renderDrawer 中的派发区渲染与 `[data-dispatch]` 事件绑定。
- 后端 `scripts/server.mjs`：删除 `POST /api/dispatch/codex/item` 端点。
- 调度器 `scripts/lib/scheduler.mjs`：删除 `dispatchItem` 方法（自动派发 tick 的
  `startRunForItem` 路径不受影响）。
- 样式 `scripts/web/style.css`：删除 `.dispatch-row` / `.dispatch-btn` 规则。

保留项：

- `copyDispatchText`（剪贴板工具）保留——批量实施提示词复制（`/api/batch/prompt` 等）仍在使用。
- `gotoRuns` 保留——任务模块页签切换的公共入口。
- 详情页 accepted 状态的操作指引 notice（`/dev <单号>` 说明）保留。

## 验收标准

- [ ] 详情抽屉不再出现「一键派发」区与「派发给 zcode / 派发给 codex」按钮。
- [ ] 前端不再残留一键派单函数与 `[data-dispatch]` 绑定；`copyDispatchText` 保留。
- [ ] `POST /api/dispatch/codex/item` 返回 404（未注册），且不创建任何执行记录。
- [ ] 调度器不再暴露 `dispatchItem`；自动派发（tick / startRunForItem）行为不变。
- [ ] 批量实施入口（批次创建、批次提示词、批量执行）不受影响。
- [ ] 相关静态契约与集成测试更新为「一键派单已移除」并通过；全量测试通过。
