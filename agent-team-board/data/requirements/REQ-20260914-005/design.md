# 设计 — REQ-20260914-005 回退 BUG-20260914-015，并把 开始 AI 开发和开始 AI 分析两个按钮改成 AI 开发和 AI 分析就行

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

BUG-20260914-015（提交 `037b806` 代码 + `34656bf` 测试 + `cd977c1` 文档）在看板列表头快捷入口上叠加了
「任务执行中禁用 + 文案切换」能力：服务端 `GET /api/tasks/state` 聚合接口、前端 `state.taskRun` /
`refreshTaskRunState()` / `poll()` 无条件拉取 / `switchProject()` 重置 / `syncAcceptance()` 执行中分支、
4 条 i18n 词条与专属测试文件。人工决定整体回退该能力（原因待人工补充登记），按钮恢复 REQ-20260909-007
确立的「仅导航、恒不禁用」口径，并顺势把两个入口按钮的文案去掉「开始」二字。

## 方案

**开源选型（REQ-20260909-015）**：自研回退（不引入库）。理由=无合适库：本条目是纯回退 + 文案微调，
删除既有自研代码即可，无任何第三方库适用场景。

- **回退方式：手工移除（diff 等价）**。`037b806` 之后 `scripts/server.mjs` 无其他改动，手工删除后与
  其父提交完全一致；`app.js` / `i18n.js` 因后续条目（REQ-20260914-004、BUG-20260914-017/018）有交叉
  落点，不走 git revert（必然冲突），逐块手工移除并以 `git diff 037b806^` 验证除改名行外零差异。
- **服务端**：删除 `GET /api/tasks/state` 路由及其注释块，未匹配路径回归 404；相邻 `/api/tasks/settings`
  等接口不动。
- **前端 app.js**：删除 `state.taskRun` 字段、`refreshTaskRunState()`、`poll()` 内调用、`switchProject()`
  内重置、`syncAcceptance()` 的 `running` 判定与「AI 分析中 / AI 开发中」配置；恢复
  `quick.disabled = false`（含「仅导航：批量操作进行中也不禁用」注释）；文案配置改为
  「▶ AI 分析」/「▶ AI 开发」，两条导航 title 原样保留。
- **index.html**：`#laneQuickEntry` 可见文案与 aria-label 去掉「开始」（title 不变）。
- **i18n.js**：移除 BUG-20260914-015 的 4 条词条；「▶ 开始 AI 分析 / ▶ 开始 AI 开发」键改
  「▶ AI 分析 / ▶ AI 开发」（英文 `▶ AI analysis` / `▶ AI development`）；aria-label 对应旧键
  「开始 AI 分析」直接删除（新键「AI 分析」在 REQ-20260913-005 词典中已存在，避免重复键）。
- **测试**：删除专属测试文件；5 个既有测试的旧文案断言同步改词；新增
  `scripts/tests/quick-entry-revert-20260914-005.test.mjs` 守回退契约（404 / 符号零残留 / 恒可点新文案 /
  词典 / 静态节点），沿用真 server + vm 桩既有模式。

## 风险与边界

- 手工回退遗漏风险：以 `git diff 037b806^ -- scripts/` 核对除改名行外与基线零差异；新测试 R1-R5 从
  服务端、源码、行为、词典、静态节点五个面守回归。
- 后续若仍需「执行中按钮状态」能力，须另立条目重新设计（是否重做待人工确认）。
- 不修改任何条目 status.json（含 BUG-20260914-015 的 done 状态）；条目文档保留为历史记录。

## 实施记录（2026-09-14，zcode-batch-048-22）

改动文件：

1. `scripts/server.mjs`：移除 `GET /api/tasks/state` 路由及注释（-16 行，与 `037b806` 父提交逐字一致）。
2. `scripts/web/app.js`：移除 `state.taskRun` / `refreshTaskRunState()` / `poll()` 调用 / `switchProject()`
   重置 / `syncAcceptance()` 执行中分支；恢复 `quick.disabled = false` 与「仅导航」注释；快捷入口文案改
   「▶ AI 分析」/「▶ AI 开发」。
3. `scripts/web/i18n.js`：移除 4 条执行中词条与注释、删除旧 aria-label 键「开始 AI 分析」；两键改新词。
4. `scripts/web/index.html`：`#laneQuickEntry` 可见文案「▶ AI 分析」、aria-label「AI 分析」，title 不变。
5. 测试：删除 `scripts/tests/bug-quick-entry-running-20260914-015.test.mjs`（-337 行）；改词 5 个既有
   测试断言；新增 `scripts/tests/quick-entry-revert-20260914-005.test.mjs`（R1-R5，先跑红 5/5 后跑绿）。

测试：全量 `node scripts/tests/run-all.mjs` 237 个测试文件全部通过（含 i18n-coverage / i18n-dict）。

