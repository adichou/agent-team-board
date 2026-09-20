# 测试报告 — BUG-20260910-019 全选和全不选的图标要使用更标准的图标

- 时间：2026-09-10T17:46:20.422Z
- 执行者：zcode-batch-20260910-032-06
- 测试框架：node:assert/strict 静态契约 + vm 行为
- 覆盖率：5%

## 总结

全选/全不选图标标准化：U+2611/U+2610 投票框字形改为自绘内联 SVG（带勾方框/空方框，13×13、等线宽 1.6、stroke=currentColor 随主题与 hover 变色、aria-hidden；语义仍由按钮 aria-label/title 承载），彻底摆脱系统字体回退漂移；.req-caption .btn.icon-act 盒口径 26×24/13px 保持并追加 inline-flex 居中承载 SVG，BUG-20260910-017 的 icon-check 降字号修补规则随字形移除（视觉重量改由 SVG 固定 13×13 承载）；app.js 仅注释同步、逻辑零改动。新增 bug-select-icon-svg-20260910-019 共 5 用例先红后绿；同步修正 caption-toolbar-icons-20260910-026 T1、bug-caption-select-icon-size-20260910-017 T1/T2、selection-lane-scope S1 四处字形断言为 SVG 口径（红 8 处→全绿）；四份相关测试 26 用例 0 失败；全量 182 测试文件仅 body-limit 偶发 ECONNRESET（不涉及本单文件，单独重跑 3/3 通过）。归因引入来源 REQ-20260910-026（atb list 核验存在）；自研论证与开源评估见 design.md；跨环境渲染形态与视觉观感待人工验收

## 明细

### TDD 过程

1. **红**：新建 `scripts/tests/bug-select-icon-svg-20260910-019.test.mjs`（5 用例），并按 README「测试同步」清单修正三份既有测试的字形静态断言
   （`caption-toolbar-icons-20260910-026` T1、`bug-caption-select-icon-size-20260910-017` T1/T2、`selection-lane-scope` S1 的 `>☑` 正则）为内联 SVG 口径。
   对未改动代码跑红：019 测试 T1-T4 红（T5 行为用例天然绿）、026 T1 红、017 T1/T2 红、selection-lane-scope S1 红，共 **8 处红**，全部指向待实施变更。
   日志：`docs/agent-team-board/dispatch/runs/run-20260911-184/test-log-red.txt`
2. **绿**：实施（index.html 两按钮换内联 SVG + 去 icon-check 类；style.css 基础规则追加 inline-flex 居中、删除 icon-check 降字号规则；app.js 仅注释同步）后，
   四份测试 **26 用例全过、0 失败**（019 5 + 026 5 + 017 3 + selection-lane-scope 13）。
   日志：`docs/agent-team-board/dispatch/runs/run-20260911-184/test-log-contract.txt`
3. **全量回归**：`node scripts/tests/run-all.mjs` → 182 个测试文件，仅 `body-limit.test.mjs` 一次 `write ECONNRESET`
   （该用例不引用本单改动的任何文件；单独重跑 3/3 通过，为并行负载下偶发套接字抖动，与本单无关）。
   日志：`docs/agent-team-board/dispatch/runs/run-20260911-184/test-log-full.txt`

### 改动面

- `scripts/web/index.html`：两按钮内容换自绘内联 SVG（全选 = 方框 + 勾 polyline；全不选 = 空方框），`aria-hidden="true"` + `focusable="false"`，class 去掉 `icon-check`；注释同步。
- `scripts/web/style.css`：`.req-caption .btn.icon-act` 保持 26×24 / 13px / 居中，追加 `display:inline-flex; align-items:center; justify-content:center` 承载 SVG 居中；删除 `.req-caption .btn.icon-act.icon-check { font-size: 11px; }` 修补规则；注释同步。
- `scripts/web/app.js`：仅第 2972 行注释的「☐」表述同步，逻辑零改动（syncAcceptance 仍只 toggle hidden/disabled）。
- 测试：新增 1 份 + 同步修正 3 份（见上）；design.md 已补根因 / 方案（自研内联 SVG 论证 + 开源选型评估）/ 风险与引入来源归因。

### 待人工验收提示

- 验收项 1（跨 OS / 浏览器 / 深浅色主题渲染一致）与验收项 3 的最终视觉观感需人工在浏览器确认并记录验证环境；
  SVG 以 `stroke="currentColor"` 继承 `.btn.quiet` 的 `--muted` → hover `--text` 与深浅主题变量，静态契约已由 T2/T4 守护。
- ui-demo.html（条目登记时产物）保留 ☑ / ☐ 缺陷对照演示，不随修复更新（其「修复后（示意）」即本实现采用的同款 SVG 形态）。

