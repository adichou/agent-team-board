# 测试用例 — REQ-20260910-001 app 场景点击 Cmd+R 刷新后，需要回到刷新前的界面

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 行为测试文件：`scripts/tests/refresh-restore-20260910-001.test.mjs`（app.js vm 全量加载，
> 模拟 Cmd+R 整页重载 = 重新求值 app.js；sessionStorage 桩跨「刷新」保留）。
> 讨论模块恢复语义另见同文件 O 组（oncall.js vm 加载）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | 需求模块恢复：快照含 view=status、reqFilter=done、drawer={id,tab=test-cases.md}、searchQ → 刷新后仍在需求模块、同筛选档、同一条目抽屉与页签恢复、搜索词回填并发起 /api/search | P0 | 通过 |
| R2 | 任务模块恢复：快照 batchMode=develop、batchPane=records、refinePane=queue → 刷新后任务模块一级页签与两面板二级页签各自恢复、互不串扰 | P0 | 通过 |
| R3 | 文件模块恢复：快照 layers=['','docs']、activeFile、mdSource=true → 刷新后横幅层栈按快照展开（/api/fs 逐层拉取）、文件重开且为源码视图；md 渲染态（false）同样恢复 | P0 | 通过 |
| R4 | 讨论模块恢复（oncall.js vm）：restoreView 落位 filter/selectedId/tab，详情拉取后页签命中；filter/tab 非法值回落 discussing / 概况 | P0 | 通过 |
| R5 | 讨论失效回落：restore 的讨论 id 已不存在（详情接口失败）→ 静默 closeDetail（无 toast、selectedId 置空）| P0 | 通过 |
| R6 | 需求抽屉失效回落：快照 drawer.id 不在看板条目中 → 刷新后不打开抽屉（空态）、无 toast；页签文档被删 → activateDrawerTab 回落基本信息 | P0 | 通过 |
| R7 | 文件失效回落：恢复层栈中目录拉取失败 → 停在最后有效层不抛错；activeFile 在父层条目中不存在 → 不打开文件、查看器回默认引导文案 | P1 | 通过 |
| R8 | URL 深链优先：`?view=files` + 快照 view=oncall → 进入文件模块（?view= 深链能力不回归）；模块内状态仍按快照恢复 | P0 | 通过 |
| R9 | 项目隔离：sessionStorage 仅存项目 B 的快照 → 项目 A 刷新不恢复（reqFilter 保持默认第一档）；快照键带项目路径 | P0 | 通过 |
| R10 | 快照写入：切换模块/筛选档/打开抽屉/切页签/搜索/切任务页签/进入目录/打开文件后，sessionStorage 快照对应字段即时更新；closeDrawer 后 drawer 置 null | P0 | 通过 |
| R11 | 空快照 = 现状：无 sessionStorage 快照刷新 → 默认初始界面（需求模块 · 待接受 · 抽屉空态），refresh-default-view.test.mjs 全部不回归 | P0 | 通过 |
| R12 | 损坏快照容错：sessionStorage 存非法 JSON / 未知版本 → 按无快照处理，boot 正常、无异常抛出 | P1 | 通过 |
| R13 | 讨论状态落盘接缝：oncall.js 状态变化（openItem/closeDetail/切筛选/切页签）派发 atb:oncall-state 事件；snapshot() 返回当前 {filter,selectedId,tab} | P1 | 通过 |
| R14 | 静态契约：electron/ 目录零改动；快照通道为 sessionStorage（键含项目路径）；boot 在首轮 poll 后应用快照且 URL 深链优先 | P1 | 通过 |
