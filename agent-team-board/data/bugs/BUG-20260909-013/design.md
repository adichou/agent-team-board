# 设计 — BUG-20260909-013 讨论模块界面的“开放式讨论：Agent 会话交流，看板沉淀成果”重复出现

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260909-004（开放式讨论模块重构与纪要生成需求或 Bug，已经 `atb list` 核验存在，状态 in-progress）

归因依据：第三行副标题“开放式讨论：Agent 会话交流，看板沉淀成果”由 REQ-20260907-004 先建立
（`scripts/web/app.js` `MODULE_SUB.oncall`）；REQ-20260909-004 重构讨论模块时又在
`scripts/web/oncall.js` `renderView()` 的筛选 chips 行末新增 `.disc-filter-tip`
“开放式讨论 · Agent 会话交流 · 看板沉淀成果”（样式见 `scripts/web/style.css` `.disc-filter-tip`），
造成同屏两处同义文案。重复由 REQ-20260909-004 的新增引入。

## 根因分析

- 两处文案来自两个先后需求，各自单独看都合理（REQ-20260907-004 的第三行副标题口径 /
  REQ-20260909-004 的筛选条行末口径），但 REQ-20260909-004 落地时未检查与既有副标题的同屏叠加，
  导致同一含义口径（仅 `：` 与 ` · ` 分隔符差异）在讨论模块一屏内上下两行各出现一次。

## 方案

保留一处 + 简凑化（定稿）：

1. **保留第三行模块副标题，删除筛选条行末提示**：
   - `scripts/web/oncall.js`：删除 `renderView()` 内 `<span class="muted small disc-filter-tip">开放式讨论 · Agent 会话交流 · 看板沉淀成果</span>`；
   - `scripts/web/style.css`：删除随之失效的 `.disc-filter-tip { margin-left: auto; }` 死样式。
   - 理由：第三行副标题是 REQ-20260907-004 建立的跨模块统一口径（需求/任务/文件均有），保留它使讨论模块与其余模块一致（设置模块空串是 BUG-20260909-002 特例）；筛选条行末提示是后加的重复元素，删除后 chips 行更紧凑。
2. **副标题简凑文案定稿**：`MODULE_SUB.oncall = '开放式讨论，看板沉淀成果'`（12 字，原 18 字）。
   保留 REQ-20260909-004 的「开放式讨论」口径与「看板沉淀成果」短语，去掉与「开放式讨论」语义重复的中段「Agent 会话交流」。
3. 测试同步：更新 `scripts/tests/workbench-layout.test.mjs` W13 与
   `scripts/tests/settings-simplify-20260909-002.test.mjs` T4 的旧文案断言为新文案，
   并补断言：oncall.js 不再出现该口径文案、style.css 不再有 `.disc-filter-tip` 死样式。

## 风险与边界

- 纯前端文案/展示改动（`app.js` / `oncall.js` / `style.css`），不写任何 status.json，
  不动讨论两态状态机、数据结构与后端 API。
- 其余模块（需求/任务/文件/设置）副标题与界面不受影响；讨论筛选 chips、计数、搜索过滤行为不变。
- 删除 `.disc-filter-tip` 后筛选条仅剩 chips，无布局依赖该类（已全库检索确认仅此两处引用）。
