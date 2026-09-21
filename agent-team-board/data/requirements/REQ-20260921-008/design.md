# 设计 — REQ-20260921-008 发布模块的文档编写页面优化

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

五步流程第三步「文档编写」现状为「AI 写作提示词 + 单文件编辑器 + 提交」三段布局，
状态口径是 未编写 / 未提交 / 已提交 / 需重新编写（面向 Git 提交）。本需求重构为
「总结 → 审查 → 提交」三段式流水线：四态文件状态（未总结 / 正在总结 / 已总结待审核 /
已审核）、副标题 + 四按钮（刷新 / AI 总结 / 审查 / 提交）、集中审查对话框（中英双栏
同步滚动）、提交门禁（八文件全已审核），AI 总结以独立锁的批量任务形态在任务模块与
全局任务面板可见。

## 方案

### 1. 状态机与求值（纯逻辑层 `scripts/lib/publish-flow.mjs`）

新增四态与求值纯函数 `evaluateDocsFlow(v, readFile, marks)`：

- 四态：`unsummarized` 未总结 / `summarizing` 正在总结 / `summarized` 已总结待审核 /
  `reviewed` 已审核（`DOCS_FLOW_LABEL` 唯一事实源，前端复用）。
- 求值输入三路数据：
  - **人工审核记录**：版本记录新增顶层 `v.review = { files: { '<file>': { hash, at } } }`
    （`build-store.recordDocsReview` 写入，hash = 审核时点磁盘内容 sha256）。放顶层而不入
    `v.docs`：`v.docs` 是「提交记录」语义（evaluateDocsState 以其有无区分 none/uncommitted），
    混入会把未提交版本误判为 uncommitted。
  - **磁盘内容**：注入 `readFile(file)`，现算 sha256。
  - **AI 总结账本标记**：`marks = { summarizing: [...], summarized: [...] }`（见 2）。
- 逐文件判定（优先级从高到低）：
  1. 活动运行标记「正在总结」→ `summarizing`；
  2. 审核记录存在且 hash 与磁盘一致且**未 scopeStale** → `reviewed`；
  3. 任一运行曾标记该文件「已总结」，或审核记录存在但内容已变（再次编辑 / 外部 IDE 修改）→
     `summarized`（已审核文件编辑后自动回退，无需显式清记录）；
  4. 否则 `unsummarized`（不经 AI 总结直接审查修改的路径：编辑不改状态，人工「通过审核」
     直接跃迁 reviewed）。
- 输出：`files`（八行带状态）、`reviewedCount`、`canCommit`（8/8 reviewed）、`missing`
  （未审核文件 + 各自状态，供提交按钮禁用 title 与门禁条明细）。
- **scopeStale 口径（README 待确认项落定）**：范围过期时审核全部失效（回退 summarized），
  须重新审查后才能再次提交——不弱化提交门禁与合并前置（合并门禁仍走既有
  `evaluateDocsState.overall === 'committed'`，不变）。
- 提示词：`buildDocWritingPrompt` 更名 `buildDocSummaryPrompt`（沿用技术写作角色与写作约束，
  新增逐文件进度回执指令：`atb summary start/file/done/fail` CLI，见 3）。

### 2. AI 总结账本（新模块 `scripts/lib/docs-summary-store.mjs`）

- 事实源：`<dataDir>/runtime/docs-summary/runs/<runId>/run.json`（独立账本目录，不并入
  `TASK_KINDS` 第三类——AI 总结无 Agent/模型分路配置诉求，不进任务设置；README 待确认项
  落定：独立账本目录）。`runId` 形如 `sum-YYYYMMDD-HHMMSS-xxxx`；`.gitignore` 增
  `docs-summary/runs/`。
- run 形态：`{ version: 1, runId, verId, owner, phase: 'running'|'done'|'failed', files:
  { 八文件: 'pending'|'summarizing'|'summarized' }, createdAt, updatedAt, startedAt,
  finishedAt, summary, reason }`。
- **独立锁 `.locks/summary.lock`**：run 创建时占用（payload 带 runId/owner），done/fail 收尾
  释放；与 `impl.lock`（AI 开发）、`refine.lock`（AI 分析）物理上是三个不同文件，互不占用。
  项目同一时间至多一个进行中的 AI 总结（重复 start 报错，不排队）。
- API：`createSummaryRun` / `markSummaryFile(runId, file, state)` / `finishSummaryRun({result,
  summary|reason})` / `latestSummaryRun` / `unfinishedSummaryRuns` / `summaryMarksForVer(verId)`
  （扫该版本全部 run 聚合：活动 run 的 summarizing + 所有 run 的 summarized）/
  `summaryRunView`（面板视图：进度 x/8、当前文件、失败原因）/ `summaryBrief`（全局简报）。
- 失败/中断口径：fail 收尾把 `files` 中残留 `summarizing` 回退为原值（pending/summarized），
  不悬挂「正在总结」；任务模块展示失败与原因，可重新 start 续跑（已 summarized 标记保留）。

### 3. CLI（`scripts/atb.mjs` 新增 `summary` 子命令组）

AI Agent 执行提示词时的进度回执通道（与 refine 同范式，走数据目录不依赖看板服务）：

- `atb summary start --id <BLD-ID> --by <会话> --dir <项目根>`：创建 run（返回 runId + 提示词）。
- `atb summary file <RUN-ID> --file <F> --state <summarizing|summarized>`：逐文件进度回执。
- `atb summary done <RUN-ID> --summary "<要点>"` / `atb summary fail <RUN-ID> --reason "<短句>"`。
- `atb summary show [RUN-ID]`：进度视图（x/8、当前文件、锁占用）。

### 4. 服务接口（`scripts/server.mjs`）

- `GET /api/build/publish-plan`：响应新增 `docsFlow`（四态求值结果）与 `summary`（该版本
  最新 run 视图）；移除 `docsPrompt`（提示词改由 start 按需生成，须带 runId）。
- `POST /api/build/docs-summary/start {id}`：校验（merging 锁定 / 已有进行中 run）→ 创建 run
  → 返回 `{ runId, prompt, run }`（prompt 含 CLI 回执指令）。
- `GET /api/build/docs-summary/current[&id=]`：`{ run }` 最新 run 视图（docs 页轮询 +
  任务模块数据源）。
- `POST /api/build/docs/review {id, file}`：人工通过审核——记录当前磁盘 hash；回 `docsFlow`。
- `POST /api/build/docs/commit`：**新增两道前置**——`buildGit.assertOnDev(root)`（不在 dev
  阻止，不自动切分支）+ `evaluateDocsFlow(...).canCommit`（八文件未全审核 → 400 带缺口明细）；
  pathspec 白名单 / 不夹带 / 不空提交口径不变。
- 全局聚合 `projectTaskRows`：追加未收尾 summary run 的 `summaryBrief`（kind `summary`），
  收尾（done/failed）后移出全局面板（与「进行中展示、收尾移出」口径一致）。

### 5. 前端（`scripts/web/build.js` + `style.css`）

- `renderDocsPane` 重写为三段：副标题（目标说明）+ 四按钮（刷新 / AI 总结 / 审查 / 提交）
  → 八文件列表（文件名 + 四态 chip，图标+颜色+文字三重区分）→ 门禁条（x/8 已审核 +
  缺口明细 / 已提交 hash 终态）。数据加载失败时保留按钮区 + 错误横幅 + 重试，不隐藏按钮。
- **刷新**：`ensurePublishPlan(true)` 强制重读（加载态反馈，失败横幅 + 重试）。
- **AI 总结**：POST start → 复制提示词（剪贴板 + toast + 提示词预览折叠框）；docs 步驻留
  期间 15s 轮询 `docs-summary/current` 更新进度（离开 docs 步 / 切版本即停，模式同
  siteTimer）；运行中按钮显示「总结中 x/8」。
- **审查对话框**（modal，随 render 挂载）：按文档类型四页签（README / CHANGELOG /
  FEATURES / AGENTS），页签内中英双栏并排；每栏独立 编辑/预览 切换、保存（沿用单文件保存
  API 与 2 MiB 白名单口径）、「通过审核」（POST review）；双栏**同步滚动**（编辑态同步
  textarea、预览态同步内容区，按 scrollHeight 比例跟随，互斥标志防回环）；编辑已审核文件
  保存后状态回退 summarized 并 toast 提示需重新审查；页脚实时显示 本页签 x/2 · 全部 x/8。
- **提交**：八文件全已审核才可用（aria-disabled + title 缺口明细，模式同 BUG-20260920-006
  合并按钮）；提交中反馈、成功显示提交 hash 与「已提交到本地 dev 分支」、失败保留可重试。
- 文件名标识一律 `data-i18n-skip`（沿用 BUG-20260921-0004 口径，防反向词典误译）。

### 6. 任务模块与全局面板（`scripts/web/app.js`）

- 任务页签一级导航新增第三档「AI 总结」（`data-bmode="summary"`），`renderSummaryPanel`：
  进行中（进度条 x/8 + 当前文件 + 独立锁标注）/ 失败（原因 + 可重启）/ 已完成 / 空态
  （暂无进行中的 AI 总结任务）；随主轮询 `refreshSummary`（签名剪枝）。
- 全局任务面板：类型筛选与标签新增 `summary`（AI 总结）、前缀兜底 `sum-`；行渲染 summary
  分支（版本号 + 进度，无条目跳转挂点），点击进入该项目任务模块 AI 总结子面板。

### 7. i18n（`scripts/web/i18n.js`）

文档编写页签内「AI 写作」文案全部更名「AI 总结」（EN 'AI summary'），新增本单全部新文案
的静态/动态词条（四态、四按钮、门禁、审查对话框、任务模块/全局面板），旧键随界面删除
清理；「正式发布」步「官网 AI 写作」按 README 默认口径**不改**（不在本单范围）。

### 8. 影响面与兼容

- 存量版本记录无 `v.review` / 无 summary run：求值全量回退「未总结」，八行完整显示，
  旧流程（直接编辑保存→提交）需先通过审查（新门禁，属本单目标行为）。
- `evaluateDocsState` / `publishStepsState` / 合并门禁零改动（回归保障）。
- 存量测试更新：`req-20260920-003.test.mjs`（提示词函数更名、提交前置补审核+dev、L5 静态
  契约文案）与 `bug-20260921-004.test.mjs`（类型下拉随旧编辑区移除，B2 改验审查对话框
  文件名标识豁免）。

## 开源选型（REQ-20260909-015）

未引入开源库：本单为既有自研看板（Node 原生 http + 原生前端）内的流程重构，双栏同步滚动
为约 15 行原生 scroll 事件比例跟随，无合适且必要的三方依赖；提示词复制、modal、页签均复用
仓库既有自研模式。

## 风险与边界

- **锁隔离**：summary.lock 为新文件，不触碰 impl.lock / refine.lock 的读写路径；AI 总结
  进行中不影响 claim/batch/refine（测试覆盖三者并存）。
- **状态悬挂**：AI Agent 中断不回执 → run 永久 running。口径与 refine.lock/impl.lock 一致
  （无超时自动接管）：任务面板可见占用与 owner，人工核对后由新 start 拒绝提示引导处理
  （`atb summary fail` 收尾后重启）；不做自动接管。
- **审核基准**：审核记录存内容 hash，外部 IDE 修改后自动失效回退（不悬挂假「已审核」），
  提交门禁随之收紧——满足「不得弱化门禁」。
- **merging / 已正式发布**：docs/save、docs-summary/start、review 均 merging 阻止；
  步导航锁定口径不变。
