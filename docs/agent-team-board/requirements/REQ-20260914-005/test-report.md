# 测试报告 — REQ-20260914-005 回退 BUG-20260914-015，并把 开始 AI 开发和开始 AI 分析两个按钮改成 AI 开发和 AI 分析就行

- 运行：run-20260914-249（batch-20260913-048，owner zcode-batch-048-22）
- 回退对象：BUG-20260914-015（代码提交 `037b806`、测试提交 `34656bf`；文档提交 `cd977c1` 保留不回退）
- 时间：2026-09-14T15:07:29.220Z
- 执行者：zcode-batch-048-22
- 测试框架：node:assert/strict + 真 server fixture + vm 模拟 DOM + 源码静态契约（项目既有自研用例 runner 模式）
- 覆盖率：未统计
- 完整测试日志：`docs/agent-team-board/dispatch/runs/run-20260914-249/test-logs.txt`

## 总结

回退 BUG-20260914-015 全部代码（server `/api/tasks/state` 路由、app.js `state.taskRun` /
`refreshTaskRunState()` / `poll()` 接线 / `switchProject()` 重置 / `syncAcceptance()` 执行中禁用分支、
4 条 i18n 词条、专属测试文件），按钮恢复 REQ-20260909-007「仅导航、恒不禁用」口径
（`quick.disabled = false` 与注释一并恢复）；两按钮去「开始」二字改「▶ AI 分析 / ▶ AI 开发」
（index.html 可见文案 + aria-label、app.js `syncAcceptance()` 配置、i18n.js 键与英文翻译；
「▶」前缀按默认口径保留，title 均不变）。新增 `scripts/tests/quick-entry-revert-20260914-005.test.mjs`
（R1-R5，先跑红 5/5 后跑绿）；5 个既有测试旧文案断言同步改词；全量 237 个测试文件失败 0；
`git diff 037b806^` 核对：server.mjs 与基线逐字一致，其余文件仅差本条目改名行。

## 改动明细

1. `scripts/server.mjs`（-16 行）：移除 `GET /api/tasks/state` 路由及注释块，该路径回归 404。
2. `scripts/web/app.js`（净 -44 行）：移除 BUG-20260914-015 五处改动；`syncAcceptance()` 快捷入口
   配置改 `{ label: '▶ AI 分析', … }` / `{ label: '▶ AI 开发', … }`（title 原样）；恢复
   `quick.disabled = false; // 仅导航：批量操作进行中也不禁用，任务创建由面板内「启动」承接`。
3. `scripts/web/i18n.js`（净 -8 行）：移除「AI 分析中」「AI 开发中」及两条执行中 title 词条（4 条 + 注释）；
   「▶ 开始 AI 分析 / ▶ 开始 AI 开发」→「▶ AI 分析（▶ AI analysis）/ ▶ AI 开发（▶ AI development）」；
   旧 aria-label 键「开始 AI 分析」删除（新键「AI 分析：AI analysis」为 REQ-20260913-005 既有词条，避免重复键）。
4. `scripts/web/index.html`（1 行）：`#laneQuickEntry` 可见文案「▶ AI 分析」、`aria-label="AI 分析"`，title 不变。
5. 测试：删除 `scripts/tests/bug-quick-entry-running-20260914-015.test.mjs`（-337 行）；改词
   `lane-quick-entry-20260909-007` / `caption-toolbar-20260910-008` / `caption-toolbar-icons-20260910-026` /
   `copy-rename-20260913-005` / `commit-rollback-20260911-010` 旧文案断言；新增
   `scripts/tests/quick-entry-revert-20260914-005.test.mjs`（R1 服务端 404、R2 回退符号零残留 + 恒不禁用恢复、
   R3 新文案恒可点（四路批量 pending 解耦）、R4 词典回退与改词、R5 静态节点新词）。

## TDD 过程

1. 红：新增测试文件（R1-R5）对现状运行 5/5 失败（404 断言 / `state.taskRun` 残留 / 旧文案 / 旧词条 / 旧 aria-label）。
2. 绿：按上述明细实施回退与改名后 R1-R5 全部通过。
3. 回归：5 个改词既有测试 + i18n-coverage / i18n-dict 卡点全过；全量 `node scripts/tests/run-all.mjs`
   237 个测试文件失败 0。
4. 等价性：`git diff 037b806^ -- scripts/server.mjs` 无输出（逐字回到基线）；
   `app.js` / `i18n.js` / `index.html` 对基线仅差本条目 6 处改名相关行，其余 hunks 均为后续条目
   （REQ-20260914-004 / BUG-20260914-017/018）既有改动。

## 验收对照（README 验收标准）

- 快捷入口恒显新文案、任何任务态均与「无任务」一致、可点跳转：R1-R3 + 全量既有 REQ-20260909-007 断言（除文案字符串外零改动）。
- app.js 五处移除 + `quick.disabled = false` 恢复 + 新文案配置：R2。
- index.html 可见文案 / aria-label 新词、title 不变：R5。
- i18n 4 条移除 + 键改名（英文 `▶ AI analysis` / `▶ AI development`）+ aria-label 键同步 + coverage 通过：R4 + i18n-coverage/i18n-dict。
- `/api/tasks/state` 404、其余接口不变：R1（`/api/tasks/settings` 相邻接口抽查 200）。
- 删除专属测试文件 + 5 个既有测试改词 + 全量通过：第 5 点 + 全量 237 失败 0。
- 主轮询不再请求 `/api/tasks/state`：R2（`poll()` 内调用移除）+ R3（vm fetch 桩零命中由 R2 源码契约守）。
- 不改任何条目 status.json、BUG-20260914-015 文档保留：本次未触碰任何条目目录文档（仅本条目自身文档）。

## 用例与结果

```
$ node scripts/tests/quick-entry-revert-20260914-005.test.mjs
✓ R1 服务端回退：GET /api/tasks/state 返回 404（已初始化与未初始化项目均如此），其余接口行为不变
✓ R2 app.js 回退契约：taskRun / refreshTaskRunState / /api/tasks/state / 执行中文案零残留；quick.disabled = false 与「仅导航」注释恢复；poll() 不再调用运行态刷新
✓ R3 前端新文案恒可点：已接受档「▶ AI 分析」、已计划档「▶ AI 开发」，四路批量 pending 均不禁用，title 为导航说明
✓ R4 i18n 回退与改词：「AI 分析中 / AI 开发中」及两条执行中 title 词条移除；「▶ 开始 AI 分析 / ▶ 开始 AI 开发 / 开始 AI 分析」键改「▶ AI 分析 / ▶ AI 开发 / AI 分析」
✓ R5 index.html 静态节点：可见文案「▶ AI 分析」、aria-label="AI 分析"、title 不变；旧文案不残留

5 个用例，失败 0

$ node scripts/tests/run-all.mjs
共 237 个测试文件，失败 0
```

## 遗留与说明（待人工）

- README「待确认事项」① 回退原因、③ BUG-20260914-015 条目状态是否重开/加注，仍待人工处理（本条目不动其 done 状态）。
- 「▶」前缀按默认口径保留；如需去掉请人工注明后另行调整。
- 本条目未引入开源库，不创建 licenses.md。
