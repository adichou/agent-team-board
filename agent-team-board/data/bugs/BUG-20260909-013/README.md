# BUG-20260909-013 讨论模块界面的“开放式讨论：Agent 会话交流，看板沉淀成果”重复出现

- 状态：accepted（已接受；实际状态以 status.json 为准）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-09T08:48:42.177Z

## 现象

1、“开放式讨论：Agent 会话交流，看板沉淀成果”优化为更简凑的文案（登记人原始诉求，保留）。

落实为具体缺陷：讨论模块页面在**同一屏内两处**出现含义相同的“开放式讨论 / Agent 会话交流 / 看板沉淀成果”口径文案，信息重复、页面不够紧凑：

1. **第三行模块副标题**：`scripts/web/index.html` 的 `#pageHead` > `#moduleSub`（第 43–44 行），内容由 `scripts/web/app.js` 的 `MODULE_SUB.oncall = '开放式讨论：Agent 会话交流，看板沉淀成果'`（约第 584 行）经 `updatePageHead()`（约第 625–630 行）写入——REQ-20260907-004 的“第三行各模块副标题”口径。
2. **筛选条行末提示**：`scripts/web/oncall.js` 的 `renderView()`（约第 144 行）在讨论筛选 chips 行（`.disc-filters`）末尾渲染 `<span class="muted small disc-filter-tip">开放式讨论 · Agent 会话交流 · 看板沉淀成果</span>`，样式 `.disc-filter-tip { margin-left: auto; }` 见 `scripts/web/style.css`（约第 1340 行，处于 REQ-20260909-004 讨论模块重构的样式块）。

两处文案仅分隔符不同（`：` vs ` · `），含义完全一致；进入「讨论」模块时两者同时可见，构成同屏重复。

## 复现步骤

1. 启动 Status Board 服务：在项目根目录执行 `node scripts/server.mjs`（零依赖本地服务，端口 8888，见 `README.md`）。
2. 浏览器打开看板页面（`http://localhost:8888`），确保看板已初始化（讨论模块依赖已初始化的项目，未初始化时显示空态卡片，见 `oncall.js` `renderView()` 的 `oncall-empty` 分支）。
3. 点击顶部第二行模块导航中的「讨论」（`#moduleSub` 切换为 `MODULE_SUB.oncall`，即“开放式讨论：Agent 会话交流，看板沉淀成果”）。
4. 观察讨论视图第一行筛选条（讨论中 / 已归档 chips）：行末 `.disc-filter-tip` 同时显示“开放式讨论 · Agent 会话交流 · 看板沉淀成果”。
5. 结果：同一含义文案在一屏内上下两行各出现一次。

## 期望行为

1. 讨论模块页面（`scripts/web/oncall.js` + 第三行副标题）上，“开放式讨论 / Agent 会话交流 / 看板沉淀成果”这一含义的文案**至多出现一处**，不再同屏重复。
2. 按登记人诉求，保留的那处文案应**更简凑**（在现有 18 字基础上精简；最终文案由 design.md 定稿，此处不锁定字串）。
3. 保留位置（第三行副标题或筛选条行末提示）**待确认**，由 design.md 结合两处来源需求（REQ-20260907-004 副标题口径 / REQ-20260909-004 讨论重构口径）定夺；若删除的是副标题，`MODULE_SUB.oncall` 可参照 BUG-20260909-002 处理 settings 的先例置空串占位，不破坏其余模块副标题。
4. 其他模块（需求 / 任务 / 文件 / 设置）的第三行副标题与各自界面不受影响；讨论筛选 chips、计数、搜索过滤等功能行为不变。

## 验收说明

1. 进入「讨论」模块，全屏检查：旧口径完整文案（“开放式讨论：Agent 会话交流，看板沉淀成果”及 ` · ` 变体）不再同屏出现两处；保留的一处为 design.md 定稿的简凑文案。
2. 切换到需求 / 任务 / 文件 / 设置各模块：第三行副标题仍分别为“从想法到验收，跟进每一项工作”、“进度、队列与结果集中在这里”、“项目资料与源码，专注阅读”、空（BUG-20260909-002 口径），与改动前一致。
3. 讨论模块功能回归：筛选 chips（讨论中 / 已归档）切换与计数、标题/编号搜索过滤、列表与详情打开均正常，纯文案改动不涉及任何后端 API 与状态流转。
4. 钉住旧文案的既有测试需同步更新并通过：`scripts/tests/workbench-layout.test.mjs`（约第 197 行断言 app.js 含“开放式讨论：Agent 会话交流，看板沉淀成果”）、`scripts/tests/settings-simplify-20260909-002.test.mjs`（约第 137 行遍历 MODULE_SUB 四条副标题）；`node --test scripts/tests/` 全绿。
5. 改动范围限定为前端文案/展示（`scripts/web/app.js`、`scripts/web/oncall.js`、必要时 `scripts/web/style.css`），不写任何 status.json，不改动讨论两态状态机与数据结构。
