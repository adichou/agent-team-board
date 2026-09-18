# 设计 — REQ-20260907-005 待确认改为待测试。已完成界面去掉待确认按钮。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

- 状态机为四态（submitted → accepted → in-progress → done）；`confirming` 只是展示层
  派生分类（REQ-20260906-013）：`in-progress && agentCompletedAt`。
- `agentCompletedAt` 在人工确认完成（→done）时不清空，仅人工驳回（done→in-progress）
  时清空（scripts/lib/core.mjs setStatus）。因此 done 条目继续满足角标渲染条件，
  已完成界面残留「待确认」角标与「请人工确认」提示。

## 方案

纯前端展示层修改（scripts/web/app.js），不动状态机、数据与内部键名：

1. **改名**：`confirming` 档对外文案「待确认」→「待测试」，涉及
   `LANE_LABEL.confirming`、`LANE_HINT.confirming`（"等待人工确认"→"等待人工测试"）、
   `REQ_FILTERS` 第五档、三处 `<span class="flag">` 角标、详情页上报 notice
   （"请人工确认"→"请人工测试"）。内部键 `confirming`、CSS `--confirming` /
   `.s-confirming` 保持不变（改名仅是文案，键名改动会波及 CSS 与存量契约，无收益）。
2. **已完成去角标**：角标/notice 渲染条件由 `it.agentCompletedAt` 收紧为
   `it.agentCompletedAt && it.status !== 'done'`，三处（列表行、详情页头部、
   下属 Bug 行）+ 详情页 notice 一并收紧。数据层不清 `agentCompletedAt`
   （它是上报事实记录，驳回逻辑与执行校验依赖它）。

### 影响面

- scripts/web/app.js（上述五处模板/常量 + 相关注释）
- scripts/web/style.css（仅 `.flag` 注释文案）
- 契约测试：confirm-lane.test.mjs（T1/T3/T6 断言更新 + 新增 REQ-20260907-005 用例）、
  workbench-layout.test.mjs（W5 筛选档文案）、detail-close-btn.test.mjs（T1 描述文案）
- 项目 README.md 两处流程文案（第 28、75 行附近）

## 风险与边界

- 不改 `agentCompletedAt` 生命周期：清空它会破坏 done 条目的上报事实记录
  （执行校验 execution-verifier 依赖 done+agentCompletedAt 判定）。
- `atb` CLI 的「等待人工确认」输出保留：描述的是等待人工确认动作，非看板分类名。
- 存量数据无需迁移：仅前端渲染条件变化。
