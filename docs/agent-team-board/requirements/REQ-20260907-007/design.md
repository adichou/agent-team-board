# 设计 — REQ-20260907-007 删除详细页面的一键派单功能，派单只能通过批量实施

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

一键派单（REQ-20260902-004 引入，REQ-20260906-019 改走调度器后台执行）在详情抽屉
为 accepted 条目提供 zcode / codex 两个按钮。codex 通道经
`POST /api/dispatch/codex/item` → `scheduler.dispatchItem(id)` → `startRunForItem`
直接创建单条执行，与批量实施（`/api/batch/*` 创建批次）形成两条并行派单路径。
需求要求收敛为唯一路径：派单只能通过批量实施。

现状引用关系（调查结论）：

- `dispatchItem` 唯一调用方是 server.mjs 的一键派发端点；批量实施与自动派发 tick
  均不经过它（tick 直接调 `startRunForItem`）。
- `dispatchPrompt` / `launchZcode` / `launchCodex` / `flashDispatchBtn` 仅被详情页
  按钮链路使用。
- `copyDispatchText` 被批量实施提示词复制（batch prompt 等 5 处）共用，必须保留。
- `gotoRuns` 是任务模块页签公共入口，与本次无关，保留。

## 方案

彻底删除一键派单链路，按层收口：

1. `scripts/web/app.js`
   - 删除函数：`dispatchPrompt`、`dispatchBtnHtml`、`flashDispatchBtn`、`launchCodex`、
     `launchZcode` 及「一键派发」注释段。
   - `renderDrawer`：删除 `${dispatchBtnHtml(it)}` 与 `[data-dispatch]` 绑定循环。
   - 保留 `copyDispatchText`（改名注释说明现役用途为批量实施提示词复制）。
2. `scripts/server.mjs`：删除 `POST /api/dispatch/codex/item` 端点。删除后该路径落入
   既有「未知接口」404 fallback，行为可预期。
3. `scripts/lib/scheduler.mjs`：删除 `dispatchItem` 方法（行 801-821）。`startRunForItem`
   与自动派发 tick 不动。
4. `scripts/web/style.css`：删除 `.dispatch-row` / `.dispatch-btn` / `.dispatch-btn.copied`。

测试收口（契约改为「已移除」防回归，沿用 req-filter-removed 的项目惯例）：

- `dispatch.test.mjs` 全文改写：断言前端无派发函数 / 无按钮文案 / 无 `[data-dispatch]`
  绑定 / 样式已删，且 `copyDispatchText` 保留。
- `dispatch-launch.test.mjs`：U1/U2/C1/C2（按钮与前端链路契约）删除；U3 改为
  「服务端无该端点、无 dispatchItem 调用」；U4（lib 旧链路清理回归）保留；I1-I3
  集成合并为「端点 404 且不产生执行记录」。
- `dispatch-api.test.mjs` T7：改为「POST /api/dispatch/codex/item → 404、无执行记录」。
- `scheduler.test.mjs` D21-D25（dispatchItem 行为）：删除，替换为一条
  「调度器不再暴露 dispatchItem」静态断言。

## 风险与边界

- 误删共用代码：`copyDispatchText` / `gotoRuns` 有批量实施等其他调用方，逐处核对后保留。
- 自动派发回归：`dispatchItem` 与 tick 共用 `startRunForItem`，只删方法不动内部路径；
  全量测试验证。
- 历史账本兼容：已有一键派发产生的 run 记录只读展示，不迁移不清理。
- `docs/agent-team-board/batch-execution.md` 中「当前一键派发」为历史对比描述，
  不是使用说明，不改动。
