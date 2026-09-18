# REQ-20260906-019 Codex 一键派发要使用批量实施的方案，放弃当前的方案

- 状态：以 status.json 为准（批次实施中）
- 创建：2026-09-06T09:44:42.838Z

## 描述

详情抽屉「一键派发：派发给 codex」当前走 REQ-20260903-003 的旧链路：前端复制提示词 →
服务端生成 `.command` 脚本 → `open` 拉起 Terminal 新标签自动执行；CLI 缺位或服务不可达时降级
`codex://threads/new` 深链 + 剪贴板。该方案弹出终端、无执行账本、无法在看板追踪进度。

REQ-20260906-003 已落地 Codex 批量实施方案（调度器后台 `codex exec`、`dispatch/runs` 账本、
Status Board「批量实施 → Codex 自动派发」页签完整可视化）。本需求把一键派发整体切换到该方案：
点击按钮即为该条目创建一次后台执行，全程不打开终端、不做深链/剪贴板兜底；旧 `.command` 链路移除。
zcode 侧派发（复制 + 工作区深链）不在本需求范围，保持不变。

## 界面布局

- 详情抽屉派发区（`dispatch-row`）布局不变：仍是「一键派发：」+「派发给 zcode」「派发给 codex」两按钮。
- 「派发给 codex」按钮 title 更新为：后台 codex exec 执行本项，进度与日志在「批量实施 → Codex 自动派发」查看，不打开终端。
- 执行过程的展示复用现有「批量实施」抽屉 Codex 页签（当前执行卡片、运行记录、日志），不新增界面。

## 交互行为

1. 仅已接受（accepted）条目的详情抽屉显示派发区（现状不变）。
2. 点「派发给 codex」：前端 `POST /api/dispatch/codex/item`（body 仅 `{ id }`）；不再复制剪贴板、不再构造 `codex://` 深链。
3. 服务端调用调度器 `dispatchItem(id)`：为该条目创建 run（进入 `dispatch/runs` 账本），后台启动 `codex exec`
   执行内置 worker 提示词（claim → 读文档 → TDD → report --run）。
4. 派发成功：按钮短暂反馈「已开始后台执行 ✓」，并自动打开「批量实施」抽屉的 Codex 页签，用户直接看到当前执行阶段。
5. 派发失败：toast 显示服务端返回原因，按钮状态复原；不降级为弹终端或复制粘贴（永不降级）。
6. 派发不要求开启「自动派发」总开关：一键派发是针对单条目的显式动作；但共享全局并发（1）、项目实施互斥与依赖检查。
7. 一键派发指定的是具体条目，不改变 REQ-20260906-018 的勾选范围（scope）语义；scope 只影响自动选单。

## 状态反馈

- 按钮成功反馈：`已开始后台执行 ✓`（1.8 秒后复原）。
- 失败原因（toast，来自调度器）：当前有执行进行中 / 条目不存在或非已接受 / 依赖未满足 / 项目被其他执行占用 /
  全局执行中 / 未配置 codex CLI / 服务正在关停。
- 执行阶段、会话 ID、日志、最终回复、上报结果均经 Codex 页签现有展示；非法单号由服务端 400 拒绝。

## 后端语义

- 调度器新增 `dispatchItem(itemId)`：前置校验（S.stopping / S.current / 条目存在且 accepted / 依赖满足 /
  项目占用 / 全局并发 / CLI 配置）→ 复用与自动选单一致的启动路径（hub → 项目锁 → newRun → prompt 落盘 → 后台执行）。
- 服务端以 `POST /api/dispatch/codex/item` 替换旧 `POST /api/dispatch/codex`；旧端点与
  `buildCommandScript`、`buildCodexThreadUrl`、`shQuote`、`CODEX_CLI_DEFAULT` 一并移除（放弃当前方案）。
- 前端 `dispatchPrompt` 移除 codex 版提示词（调度器内置 worker 提示词），zcode 版不变。

## 验收标准

- [ ] 点「派发给 codex」后无 Terminal、无 `codex://` 深链、无剪贴板动作；改为后台执行并在 Codex 页签可见。
- [ ] `POST /api/dispatch/codex/item`：合法单号返回 `{ ok: true, runId }`；非法单号 400。
- [ ] 未开启自动派发开关时一键派发可用；开关状态不被一键派发改写。
- [ ] 前置校验生效：非 accepted 拒绝、依赖未满足拒绝、当前有执行拒绝、项目被手工/批次占用拒绝、CLI 未配置拒绝。
- [ ] 执行记录进入 `dispatch/runs` 账本，条目按内置提示词走 claim/report，上报后与自动派发同样落账 reported。
- [ ] 旧端点 `/api/dispatch/codex`（.command + open）与 `buildCommandScript`/`buildCodexThreadUrl`/`shQuote`/`CODEX_CLI_DEFAULT` 移除；`ITEM_ID_RE`、zcode 深链构造保留。
- [ ] zcode 派发链路（提示词、复制、workspace/open 深链）无回归。
- [ ] 新增 scheduler/API/前端契约测试并通过；`npm test` 全绿。
