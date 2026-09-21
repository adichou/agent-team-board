# 设计 — REQ-20260921-012 发布模块的文档编写流程需优化成先写默认语言的文档，待默认语言的文档审核完毕后，再提供 AI 翻译的功能编写剩余语言的文档，然后再审查，最后是整体的审查完结流程

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ-20260921-008 把文档编写步重构为「AI 总结 → 审查 → 提交」流水线，REQ-20260921-010
把固定中英八文件泛化为发布计划级语言集（`version.json` 顶层 `langs`，4 类 × N 语言）。
现状一轮 AI 总结覆盖语言集全部文件、无语言阶段先后，也无「整体审查完结」收口动作。

## 方案

### 1. 阶段状态机（scripts/lib/publish-flow.mjs）

- 单文件状态枚举在现有四态上为剩余语言文件扩展三个镜像态（语义与默认语言一一对应，
  `reviewed` 共用）：
  - 默认语言（语言集首语言，文件无后缀）：`unsummarized / summarizing / summarized / reviewed`；
  - 剩余语言（`<KEY>_<lang>.md`）：`untranslated / translating / translated / reviewed`；
  - `DOCS_FLOW_LABEL` 同步扩为七态文案（未翻译 / 正在翻译 / 已翻译待审核）。
- `buildDocSummaryPrompt`（阶段一）：文档清单收窄为**默认语言 4 文件**（4 类 × 1），
  不再包含剩余语言文件；回执口径不变（`atb summary`）。
- 新增 `buildDocTranslatePrompt`（阶段二）：以**已审核的默认语言文档磁盘内容为唯一翻译
  基准**（readFile 注入、全文嵌入提示词），逐文件产出剩余语言全部文件（4 × (N−1)）；
  回执走新 CLI `atb translate file/done/fail`；约束含「不得引入基准外信息、不得编造、
  README 按同语言互链」。
- `evaluateDocsFlow(v, readFile, marks, opts)` 扩展（唯一状态事实源，前端复用同口径）：
  - `marks` 增加 `translating / translated`（docs-translate-store 聚合）；
  - `opts.statFile(file) → mtimeMs | null` 注入磁盘 mtime：同类型文件两两对比，
    默认语言文档 mtime **严格晚于**剩余语言文档 → 该剩余语言文件强制置回 `untranslated`
    （**基准变更检测**；stat 缺失 / mtime 相同不回退——mtime 为弱信号，严格大于才命中，
    内容 hash 复核豁免按 README 待确认口径暂不做）。检测在每次求值读盘时发生（进入 /
    刷新 / 翻译启动前 / 提交与完结门禁计算），不依赖审查界面保存按钮；
  - 输出增加阶段字段：
    - `defaultFiles / restFiles / defaultReviewedCount / restReviewedCount`（按语言分组与计数）；
    - `canTranslate`（默认语言 4/4 已审核且存在剩余语言）与 `translateMissing`
      （默认语言缺口明细，供按钮 title）；
    - `baselineShift`（命中基准变更的剩余语言文件数组）；
    - `canFinalize`（4×N 全部已审核 && 无 scopeStale && 无 baselineShift）；
    - `finalized`（`v.review.finalized` 记录存在且当前仍有效：语言集未变、全部已审核、
      无基准变更、无 scopeStale → `{ at }`，否则 null）；
    - `canCommit` = `canFinalize && finalized` 有效（在原「全部已审核」门禁之上**叠加**
      完结条件，不弱化原门禁）；
  - `scopeStale` 口径沿用：范围变化时审核与完结整体失效（求值层回退，不弱化门禁）。
- 语言集变更交互：语言集变化使 `finalized.langsKey` 不匹配 → 完结失效回退（逐文件审核
  按文件名白名单与内容 hash 自然重算）；在途总结 / 翻译 run 账本按 run 自身 files 校验，
  集外回执仍拒绝（010 口径沿用）。

### 2. AI 翻译账本（scripts/lib/docs-translate-store.mjs，新文件）

镜像 docs-summary-store 的隔离口径：

- 事实源：`<dataDir>/runtime/docs-translate/runs/<runId>/run.json`，runId 前缀 `tr-`；
- 独立锁 `.locks/translate.lock`：与 AI 总结（summary.lock）、AI 分析（refine.lock）、
  AI 开发（impl.lock）互不占用；同一时间至多一个进行中 run（重复 start 报错不排队）；
- 文件状态 `pending / translating / translated`，run 相位 `running / done / failed`；
- `createTranslateRun` 只装**剩余语言文件**（语言集仅一个语言 → 报错「无剩余语言文档」）；
- `finishTranslateRun` 收尾把残留 `translating` 回退 `pending`（不悬挂「正在翻译」，
  已 translated 跨 run 保留可续跑）；
- `translateMarksForVer`（translated = 任一 run 曾完成；translating = 活动 run 在译）、
  `translateRunView`（counts.translated / total、currentFile、lock: 'translate'）、
  `translateBrief`（kind `'translate'`，进全局任务面板，收尾移出）。

### 3. 完结记录（scripts/lib/build-store.mjs）

- 新增 `recordDocsFinalize(dataDir, id, { langs, readFile })`：人工「确认完结」落
  `v.review.finalized = { at, langsKey, files: { <file>: <sha256> } }`（与提交记录 v.docs
  语义隔离）；merging 拒绝。有效性由求值层（evaluateDocsFlow.finalized）实时判定，
  不在完结时点固化放行。

### 4. 服务接口（scripts/server.mjs）

- 注入 `docStatFile`（磁盘 mtimeMs），全部 `evaluateDocsFlow` 调用统一传入
  （publish-plan / docs / langs / summary current / review / save / commit / finalize）。
- `POST /api/build/docs-translate/start {id}`：门禁 = 非 merging、默认语言 4/4 已审核
  （否则 400 带缺口明细）、语言集存在剩余语言；启动前求值基准变更检测，命中时响应带
  `baselineShift` 与提示（按最新基准翻译——提示词嵌入当前磁盘内容）。
- `GET /api/build/docs-translate/current[?id=]`：最新翻译 run 视图 + docsFlow（任务模块 /
  文档编写页轮询）；`GET /api/build/docs-summary/current` 响应增加 `translate` 字段
  （文档编写页单次 15s 轮询同时吸收两者）。
- `POST /api/build/docs/finalize {id}`：门禁 = 非 merging、全部文件已审核、无 scopeStale、
  无基准变更（否则 400 带原因）；落完结记录并返回 docsFlow。
- `POST /api/build/docs/commit`：在现有门禁之上增加「整体审查已完结」前置——未全审沿用
  原缺口错误；全审未完结给完结缺口错误。提交行为（pathspec 限定语言集内文档、本地 dev、
  noop 不空提交）不变。
- `publish-plan` 响应增加 `translate`（该版本最新翻译 run 视图）。
- `projectTaskRows` 聚合加入 AI 翻译简报（进行中展示、收尾移出）。

### 5. CLI（scripts/atb.mjs）

新增 `translate` 子命令组（镜像 summary）：

- `atb translate start --id <BLD-ID> [--by 会话]`：门禁同服务端（默认语言 4/4 已审核），
  返回 runId + 翻译提示词；
- `atb translate file <RUN-ID> --file <文件名> --state translating|translated`；
- `atb translate done <RUN-ID> --summary <要点>` / `atb translate fail <RUN-ID> --reason <短句>`；
- `atb translate show [RUN-ID]`（进度视图，缺省最新 run）。

### 6. 前端（scripts/web/build.js）

- `DOCS_FLOW_LABEL / CLS / ICON` 扩展七态（前端唯一事实源同步）。
- `renderDocsPane` 重构为三段：**阶段条**（① 默认语言先行 → ② AI 翻译与审查 → ③ 整体
  审查完结，各阶段状态 ✔ 已完成 / ● 进行中 / ○ 未解锁，按求值字段计算）；**动作区**
  六按钮（刷新 / AI 总结 / AI 翻译 / 审查 / 整体审查 / 提交）：
  - AI 翻译：`canTranslate` 前禁用（aria-disabled + title 列默认语言缺口），运行中
    「翻译中 x/◇」；点击启动 + 复制翻译提示词（预览框同 AI 总结口径）；
  - 整体审查：`canFinalize` 前禁用（title 列缺口）；点击打开**完结核对对话框**
    （核对清单 + 提示 + 取消 / 确认完结）；
  - 提交：`canCommit`（全审 + 已完结）前禁用；已完结前 title 说明「整体审查未完结」；
- **文件列表按语言成组**：默认语言组头 + 各剩余语言组头，行状态 chip 七态；
- **门禁条**：默认语言 x/4 · 剩余语言 y/◇ 已审核 + 完结 / 提交缺口 + 基准变更提示
  （「默认语言文档已更新：X 个翻译文档需重新 AI 翻译」）；
- `renderReviewModal` 沿用（默认语言栏即已审核基准，N 栏同步滚动，编辑已审核保存回退
  待审核——剩余语言侧回退态为「已翻译待审核」）；直接审查路径保留（不经 AI 翻译也可
  编辑 / 通过审核，阶段门禁只约束 AI 翻译与整体完结解锁）。
- 完结对话框 `renderFinalizeModal`：明确人工动作；确认后完结标识（终态与时间）。
- 轮询：`summaryPoll` 吸收 `translate` 与 `docsFlow`（阶段 / 基准变更自动刷新）。

### 7. 任务模块与全局面板（scripts/web/app.js）

- 任务模块新增「AI 翻译」页签（`data-bmode="translate"`）+ `renderTranslatePanel` /
  `refreshTranslate` / `state.translate`（镜像 AI 总结面板：进行中进度 / 失败可续跑 /
  已完成 / 空态，独立锁 translate 标注）。
- 全局任务面板：`GLOBAL_KIND_LABEL` / `GLOBAL_KIND_FILTERS` 增加 translate（AI 翻译）、
  前缀兜底 `['tr-', 'translate']`、计数口径 doneLabel「已翻译」、行中段同 summary 口径。

### 8. i18n（scripts/web/i18n.js）

新增文案中英同步：七态文案、阶段条、AI 翻译按钮 / 提示词条、整体审查与完结对话框、
门禁条新口径（替换旧「提交门禁：◇/◇ 已审核 ——…」两条动态键）、基准变更提示；文件名 /
语言代码等标识沿用 `data-i18n-skip` 豁免口径。

### 9. 兼容与回归

- 五步流程其余四步行为不变；「合并入 main」仍以文档已提交（docs.overall=committed）为
  前置；`evaluateDocsState / publishStepsState` 零改动。
- 既有 AI 总结相关测试随范围收窄同步调整（008 / 010：账本 4 文件、剩余语言初始态
  「未翻译」、提交前先完结）；`npm test` 全量通过。

## 开源选型（REQ-20260909-015）

未引入开源库：本需求是纯流程状态机 + 既有看板前端扩展，无合适可复用的成熟能力形态
（翻译执行由外部 AI Agent 承担，账本 / 门禁 / UI 均为项目自有领域逻辑），自研成本低于
引入与适配成本。

## 风险与边界

- **mtime 弱信号**：git 检出 / 复制 / touch 会更新 mtime 而内容未变——按 README「本轮
  落定」口径仅严格大于才命中（相同 / 不可获取不回退）；内容 hash 复核豁免为待确认项，
  本轮不做，误报后果为「多走一轮重新翻译 / 重新审核」，不弱化任何门禁。
- **完结有效性实时求值**：完结记录不固化放行，任何使「全部已审核 / 语言集 / 基准」失效
  的变化即时反映到 `finalized` / `canCommit`，杜绝旧完结标识为新内容放行。
- **单语言集**：无剩余语言时 AI 翻译不可用（无文件可翻），整体审查完结与提交门禁正常。
