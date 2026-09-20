# 设计 — BUG-20260917-003 挂起确认面板「归属待确认」路径缺少批量计入/排除操作，大量路径时须逐项选择

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260914-001（确认闭环引入「归属待确认逐项显式选择」设计——`renderConfirmForm` 的 `fileRow(f, true)` 行内下拉与 `confirmSide.attr` 逐项存储；批量操作自始缺失，非回归。README 现象一节已注明）

## 根因分析

- `renderConfirmForm`（scripts/web/app.js）把 develop 挂起确认的候选文件分「本单可归属 / 归属待确认」两组渲染，归属待确认每行只有独立 `<select class="attr-select">`（待选择 / 计入 / 排除），组头与表格均无批量入口。
- 每次选择只经 `bindConfirmFormActions` 的 change 监听写入前端 `confirmSide.attr`（Map）并就地更新 `updateConfirmScopeSummary`；「确认并继续」（`confirmContinueAction`）在存在未选行时红字拦截并列出全部未处理路径。358 个路径时人工须逐项点 358 次；面板重开 `confirmSide.attr` 重置为空 Map 后须重来。
- 属于功能缺失（效率工具缺失），非服务端缺陷：`confirm-store.mjs` 的 `include` 显式携带口径（BUG-20260915-003 约束）本身正确，不动。

## 方案

**纯前端改动（app.js 渲染 + 交互绑定、style.css、i18n.js），服务端契约零改动**：

1. `renderConfirmForm` 在「归属待确认」组头与文件表之间渲染批量条：`全部计入` / `全部排除` 两按钮（`data-confirm-batch="include|exclude"`）。禁用口径与行内下拉一致：`resolved || busy`；另加组内无未入库行（全部已入库）时禁用（无作用对象）。
2. `bindConfirmFormActions` 增加批量点击处理：把组内全部 `state !== '已入库'` 的归属待确认路径的 `confirmSide.attr` 一步置为对应值，并同步各未入库行 `<select>` 显示、调用 `updateConfirmScopeSummary` 即时刷新摘要与「待核对」提示；已入库行跳过（不写入、不改显示、不计数）。**批量 = 显式选择的效率工具**：仍走逐项选择同一存储（`confirmSide.attr`）→ 确认时 `include` 由 `confirmAttrOf` 逐路径构建，服务端不静默并入。
3. 覆盖语义：批量后仍可逐项改选（以最后一次操作为准），批量可反复使用、相互覆盖；面板重开重置现状保持（持久化超出本单范围）。
4. 设计决策（README「待确认」项）：**按目录/前缀的分组批量排除本单不做**——验收口径只需「全部计入 / 全部排除」，目录分组涉及目录树 UI 与选择语义设计，收益/风险比不划算，留待确有需求再立项。
5. i18n：新增 7 条中文文案（按钮 2 + aria-label 组名 1 + 前缀标签 1 + title 2 + 组内提示 1）全部入 `scripts/web/i18n.js` EN 词典；`npm test` 中 i18n-coverage / i18n-dict / bug-confirm-btn-guide T5 等卡点全部通过。

**开源选型（REQ-20260909-015）**：自研。无合适库的原因——改动是既有 vanilla JS 面板内的两个按钮与一段点击处理（约 40 行），引入任何前端框架/组件库均远超改动本身；未引入开源库，不创建 licenses.md。

## 风险与边界

- 批量「全部计入」会把全局/来源不明路径整体显式归为本单：语义上仍是人工显式授权（点按钮即选择），且按钮旁常驻提示「作用于归属待确认的未入库路径；批量后仍可逐项覆盖」；确认拦截与 include 口径不弱化（T5 源码契约 + 既有 bug-confirm-panel-scope-20260915-003 P2/P3/P4 回归保护）。
- 已入库行不参与批量与计数，与 `updateConfirmScopeSummary` / `confirmContinueAction` 既有 `state !== '已入库'` 过滤口径一致。
- busy / resolved 态批量按钮与行内下拉一致禁用，避免运行中误改。
- 回归验证：`scripts/tests/bug-20260917-003.test.mjs`（T1-T6：渲染与禁用态 / 全部排除 / 全部计入 / 批量-逐项互相覆盖 / 服务端口径源码契约 / i18n 双语），全量 `npm test` 276 文件通过。
