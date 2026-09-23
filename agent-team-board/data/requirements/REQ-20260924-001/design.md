# 设计 — REQ-20260924-001 文档编写中的整体审查步骤优化

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

文档编写第三阶段「整体审查完结」对话框（REQ-20260921-012）目前只有静态核对清单：
「各语言内容语义一致」「README 按语言互链真实可达」两项永远显示进行中（◐），
没有任何自动核查支撑，人工逐项核对负担重、易漏检。本单为整体审查步骤补三类自动检查。

## 方案

### 检查一：各语言内容语言一致性（脚本自动检查）

- 新建纯函数库 `scripts/lib/docs-review-checks.mjs`（无副作用，fs / fetch 全部注入，与
  publish-flow 同风格）：
  - `scriptCountsOf(text)`：剥离围栏代码块 / 行内代码后，按 Unicode 文字体系计数
    （汉字 han / 假名 kana / 谚文 hangul / 西里尔 cyrillic / 拉丁 latin）；
  - `expectLangOk(lang, counts)`：按语言缩写判定内容是否为该语言本体——
    cn/zh 要求汉字占比 ≥ 0.5；ja/jp 要求出现假名且（假名+汉字）占比 ≥ 0.3；
    ko 要求谚文占比 ≥ 0.3；西里尔语系（ru/uk/be/bg/sr/mk）要求西里尔占比 ≥ 0.5；
    其余（拉丁语系，含 en/fr/de/…）要求非拉丁字符占比 ≤ 0.2 且拉丁占比 ≥ 0.5；
    字母字符 < 20 判「文本过短无法判定」不通过；
  - `checkDocLangs(docFiles, readFile)`：对语言集内全部带语言文件（标准 4 类 + 自定义
    各语种；单文件类 LICENSE 不参与——许可证文本不翻译）逐文件给出 ✓/✗ 与量化 detail。
- 「以已审核默认语言为基准」的语义同构性超出脚本可判定范围，脚本层落实需求原文的可自动
  判定部分（中文是中文内容、英文是英文内容等）；逐文件 ✗ 红叉明细（文件 + 占比说明）
  在对话框展示，最终判断仍归人工确认完结。

### 检查二：文档内链接可达性（脚本自动检查）

- 同库 `extractMarkdownLinks(text)`：剥离代码块后解析 Markdown 链接与图片
  `[text](href)` / `![alt](src)`，记录行号；纯锚点（`#…`）、`mailto:` 等不可达性目标跳过；
- `checkDocLinks(docFiles, readFile, { existsFile, fetchFn, timeoutMs })`：
  - 本地相对链接（剥 `#anchor`、URL 解码、按项目根解析）→ `existsFile` 判存在；
  - http/https 远程链接 → 注入 fetch 先 HEAD，405/403/501 回退 GET，网络错误 / 超时
    （缺省 5s）/ HTTP ≥ 400 记死链并带原因；并发上限 4、远程链接上限 50 防失控；
  - 逐文件返回 `{ total, dead: [{ href, line, reason }] }`，聚合 `ok` 与死链总数。
- 服务端 `POST /api/build/docs/review-checks {id}` 一次跑两检查（只读，不改盘不设门禁），
  前端「运行自动检查」按钮触发；死链明细逐条展示（详细提示）。

### 检查三：默认语言错别字 / 行文规范（提示词派发 Agent 核查，结果自动上报）

- 账本 `scripts/lib/docs-check-store.mjs`（对齐 docs-summary-store）：
  - 事实源 `runtime/docs-check/runs/<runId>/run.json`，runId `chk-YYYYMMDD-HHMMSS-xxxx`，
    独立锁 `.locks/docscheck.lock`（与 summary / translate / impl / refine 互不占用）；
  - 文件集 = 默认语言（首语言）全部非单文件文件（标准 4 类 + 自定义默认语言份）；
  - 文件状态 `pending → checking → pass|fail`，fail 必须带 issues（问题清单文本，
    ≤2000 字），done/fail 收尾时 checking 回落 pending 不悬挂；同一时间至多一个运行；
  - `checkRunView`（进度计数 + 逐文件状态与 issues）/ `checkBrief`（kind=docscheck，
    全局任务面板「进行中展示、收尾移出」同口径）。
- 提示词 `publish-flow.buildDocProofreadPrompt`：校对人员角色 + 逐文件读盘校对（错别字、
  语言习惯行文规范）+ 只读不改文档 + 不编造问题、问题带位置与修改建议 + atb docscheck
  四步回执指令；缓存优化沿用「静态段在前 + 尾部运行参数区」。
- CLI：`atb docscheck start|file|done|fail|show`（`file` 支持
  `--state checking|pass|fail --issues "…"`）。
- 服务端：
  - `POST /api/build/docs-proofread/start {id}`：门禁 = 非 merging + 默认语言非单文件文件
    全部已审核（否则 400 带缺口）；创建 run 返回 runId + 提示词（复制给 Agent）；
  - `GET /api/build/docs-proofread/current?id=`：最新 run 视图 + 三阶段求值；
  - publish-plan / docs-summary-current 响应增 `docsCheck`（前端轮询自动吸收校对进度与结果，
    即「核查结果自动上报」的展示通道）；`/api/batch/global` 简报增 docscheck 行。

### 前端（build.js 整体审查对话框）

- 「各语言内容语义一致（以已审核默认语言为基准）」项改由检查一驱动：未运行 ◐（提示运行
  自动检查）、通过 ✓、不通过 ✗ + 逐文件明细；
- 链接项改为「所有文档内链接真实可达（README 按语言互链：同语言 CHANGELOG 与 FEATURES）」，
  由检查二驱动，死链红叉逐条明细；
- 新增「默认语言错别字与行文规范（AI 校对自动上报）」项：由最新 docscheck run 驱动——
  未运行提示、运行中进度 ◐ x/N、全部 pass ✓、任一 fail ✗ + issues 明细、中断 ✗ + 原因；
- 对话框底脚新增「运行自动检查」「AI 校对」两按钮（busy 态禁用；AI 校对成功复制提示词，
  与 AI 总结 / AI 翻译同交互）；
- LICENSE 人工核对项与本版发布范围一致项保持人工口径不变；
- 完结门禁不弱化：`canFinalize` / `canCommit` 求值零改动，自动检查结果供人工决策，
  确认完结仍是人工动作。

### 开源选型（REQ-20260909-015）

自研理由（引用库评估）：语言判定仅按 Unicode 文字体系（CJK / 假名 / 谚文 / 西里尔 / 拉丁）
计数即可满足需求原文「中文是中文内容，英文是英文内容」；franc 等自然语言识别库面向
同文字体系内语言区分（需携带 trigram 数据包），引入体积与打包链路成本显著高于本检查
所需的 ~40 行纯函数，且本仓库当前零运行时依赖。链接检查用 Node 内置 fetch / fs，无合适
必要依赖。未引入开源库，不创建 licenses.md。

## 风险与边界

- 语言判定为启发式（占比阈值）：代码块已剥离，中文文档内嵌英文术语不影响；极端短文档判
  「无法判定」红叉，交人工复核——宁误报不漏报；
- 远程链接检查依赖网络：失败原因明示（超时 / DNS / HTTP 状态码），不做静默放行；链接检查
  仅在用户点击「运行自动检查」时执行，不加轮询、不设门禁；
- docscheck 账本属 runtime 应用数据本地留存（.gitignore 追加 `docs-check/runs/`），
  不进 git、不作为发布文档；
- 校对 Agent 只读不改文档：提示词明示，账本按 run 白名单拒收集外文件；
- 合并中（merging）拒绝启动校对；已完结后再次校对/检查不失效完结记录（完结有效性仍由
  既有求值按内容 hash 实时判定）。

## 实施记录（2026-09-23 批量实施）

- 新增：`scripts/lib/docs-review-checks.mjs`（scriptCountsOf / expectLangOk / checkDocLangs /
  extractMarkdownLinks / checkDocLinks，fs·fetch 注入）；`scripts/lib/docs-check-store.mjs`
  （chk- 账本 + docscheck.lock + checkRunView / checkBrief）。
- 扩展：`scripts/lib/publish-flow.mjs`（buildDocProofreadPrompt）；`scripts/atb.mjs`（docscheck
  子命令 + 帮助）；`scripts/lib/cli-registry.mjs`（docscheck 组，agentOnly 整组隐藏）。
- 服务端：`POST /api/build/docs/review-checks`、`POST /api/build/docs-proofread/start`（默认语言
  非单文件全审门禁）、`GET /api/build/docs-proofread/current`；publish-plan 与 docs-summary/current
  响应增 `docsCheck`；`/api/batch/global` 增 kind=docscheck 简报（进行中展示、收尾移出）。
- 前端：`scripts/web/build.js`（renderFinalizeModal 三核对项自动驱动 ✓/✗ + 明细 + 两按钮；
  runReviewChecks / startProofread；summaryPoll 同吸 docsCheck）；`scripts/web/app.js`
  （GLOBAL_KIND_FILTERS / LABEL / PREFIXES / 计数分支增 docscheck）；`scripts/web/style.css`
  （bld-finalize-sub / -details / -actions）；`scripts/web/i18n.js`（新文案中英同步 +
  cli-registry docscheck 组词条）。
- 测试：`scripts/tests/req-20260924-001.test.mjs` 10 例（先红后绿）；同步 3 个既有测试字面口径
  （copy-rename-20260913-005 / req-20260920-004 / req-20260922-001）；npm test 343 文件 0 失败。
