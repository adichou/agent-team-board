# 测试报告 — REQ-20260910-001 app 场景点击 Cmd+R 刷新后，需要回到刷新前的界面

- 时间：2026-09-09T23:57:48.885Z
- 执行者：zcode-batch-029-1
- 测试框架：Node vm 行为测试（node:assert/strict，scripts/tests/refresh-restore-20260910-001.test.mjs）
- 覆盖率：92%

## 总结

web 层刷新状态恢复：sessionStorage 会话级快照（键按项目隔离，URL ?project=/?view= 深链优先），boot 首轮 poll 后恢复模块/需求筛选档/详情抽屉与页签/搜索词/任务两面板二级页签/讨论详情与筛选/文件层栈与当前文件（md 渲染态）；恢复目标失效按既有先例静默回落（条目/讨论/文档页签/文件/目录逐层），switchProject 重置后覆盖默认态快照；electron 零改动；16 用例全绿 + run-all 129 文件回归全绿

## 明细

### TDD 过程

1. 先写 `scripts/tests/refresh-restore-20260910-001.test.mjs`（16 用例）跑红：13 失败
   （R8/R10/R11 为「现状基线」用例在实现前自然通过）。
2. 实现 web 层恢复（`scripts/web/app.js` 快照模块 + `oncall.js` 接缝）后跑绿；期间修正实现
   bug 一处（`openFile` 的快照保存在 `mdSource` 赋值之前执行导致存旧值，已调整为状态落定后落盘）。
3. 回归发现 4 个既有提取式/静态契约测试缺新依赖桩或字面量契约，补桩与适配后全绿。

### 新增用例结果（refresh-restore-20260910-001.test.mjs，16/16 通过）

- R1 需求模块：筛选档 / 抽屉条目与页签（含文档页签 loadDoc）/ 搜索词刷新后复原 ✓
- R2 任务模块：一级页签（批量开发）+ 批量开发/批量完善两面板二级页签各自恢复、互不串扰 ✓
- R3 文件模块：横幅层栈按快照逐层展开、当前文件重开、md 源码态恢复 ✓
- R4 讨论模块接缝：applyViewSnapshot 把 oncall 快照委托 ATBOncall.restoreView ✓
- R5 需求抽屉失效回落：条目被删不打开抽屉且无 toast；文档页签被删回落基本信息 ✓
- R6 文件失效回落：目录层失效停在最后有效层；文件被删回默认引导且不发请求 ✓
- R7 URL 深链优先：`?view=files` 覆盖快照 view（深链能力不回归），模块内状态仍恢复 ✓
- R8 项目隔离：快照键按项目路径，项目 A 刷新不恢复项目 B 状态 ✓
- R9 快照写入：模块/筛选/抽屉/页签/搜索/任务页签/目录/文件/讨论事件各挂点即时落盘 ✓
- R10 空快照 = 现状默认初始界面 ✓
- R11 损坏快照（非法 JSON / 未知版本）按无快照容错 ✓
- R12 静态契约：sessionStorage 通道 + boot 恢复时序（首轮 poll 后）+ 深链优先 + electron 壳层零改动 ✓
- O1-O4 oncall.js 恢复语义：restoreView 落位 filter/详情/页签、非法值回落、讨论被删静默回列表
  （无 toast）、atb:oncall-state 事件与 snapshot() 接缝 ✓

### 回归（node scripts/tests/run-all.mjs）

- 129 个测试文件全部通过，失败 0。
- 为新依赖补桩/适配的既有测试（不改断言语义，仅加最小桩与字面量适配）：
  - `discussion-tabs-20260909-012.test.mjs`：沙箱补 `dispatchEvent` 桩（openItem 派发 atb:oncall-state）。
  - `tasks-tabs-20260909-008.test.mjs`：提取式沙箱补 `saveViewSnapshot` 桩。
  - `drawer-tabs-20260909-006.test.mjs`：提取式沙箱补 `saveViewSnapshot` 桩。
  - `refresh-default-view.test.mjs`：boot 保持 `setView(viewParam)` 字面量调用（深链优先经
    `if (!viewParam) viewParam = restored.view` 实现），BUG-20260907-002 契约不回归。

### 未覆盖说明

- 列表滚动位置（需求/讨论）：按 README「待确认」默认结论不纳入恢复，无对应用例。
- 表单草稿 / 勾选集合 / toast：按「明确不恢复」边界维持现状，由 R10 空快照基线间接覆盖。
- app 场景（Electron Cmd+R）真机手工验证未执行（本环境不启动模拟器/桌面壳，按全局规则留人工验证）；
  浏览器直连同走 boot() 通道已由 vm 行为测试覆盖。
