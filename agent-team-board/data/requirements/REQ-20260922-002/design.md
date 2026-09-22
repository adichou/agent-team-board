# 设计 — REQ-20260922-002 发布看板的文档编写页面支持 LICENSE.md

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

发布文档清单现行口径为「4 类 × 语言集」（README / CHANGELOG / FEATURES / AGENTS，
REQ-20260920-003 / REQ-20260921-010），三阶段流水线与七态状态机（REQ-20260921-008 / 012）、
服务端白名单（`isPublishDocFile`）、提交 pathspec 全部由 `publishDocFiles(langs)` 单一事实源
展开。本需求把开源仓库必备的 `LICENSE.md` 纳入文档编写页的编写 / 审查 / 提交能力，
README 中 A–E 五项口径待确认，本设计按下文定稿。

## 方案

### 一、待确认项落定口径（README A–E 逐条）

1. **A. 文件形态 → A1 单文件**：LICENSE 恒为 `LICENSE.md` 单文件，**不随语言集展开**
   （无 `LICENSE_<lang>.md`；语言集变化不影响 LICENSE 清单）。理由：README 演示默认 A1；
   许可证文本具法律效力，开源惯例不随语言翻译。
2. **B. AI 流水线覆盖 → 不进 AI 总结 / AI 翻译**：`buildDocSummaryPrompt` /
   `buildDocTranslatePrompt` 的文档清单、AI 总结 / 翻译 run 的 files 账本、进度分母（x/N）
   均不含 LICENSE；LICENSE 仅人工在审查对话框编写（复用现有「不经 AI 总结直接审查」路径），
   `atb summary file` / `atb translate file` 对 LICENSE.md 回执一律拒绝（账本外）。
   LICENSE **参与**状态机与门禁计数（canFinalize / canCommit / missing 缺口明细）。
3. **C. 必选 or 可选 → 必选**：LICENSE 与四类同口径进入门禁——未编写 / 未审核时
   「整体审查」「提交」不放行，缺口明细列出 `LICENSE.md（状态）`；提交到本地 dev 分支时
   LICENSE.md 随语言集内文档一并进入 git pathspec。
4. **D. 完结核对清单 → 增加一条人工核对项**：「LICENSE 文件与项目实际开源口径一致」，
   与 README 互链项同型（◐ 人工核对，不做自动校验）；默认语言 / 剩余语言计数含 LICENSE。
5. **E. 命名兼容 → 仅识别 `LICENSE.md`**：按需求原文，不识别无扩展名 `LICENSE`、
   `LICENSE.txt`、`LICENSE_<lang>.md`（A1 下均为清单外文件，保存 / 审核 / 提交一律拒绝）；
   不做存量迁移。

### 二、清单与状态机（publish-flow.mjs，唯一事实源）

- `PUBLISH_DOC_KEYS`（4 类，随语言集）不变；新增 `PUBLISH_DOC_SINGLE_KEYS = ['LICENSE']`
  （单文件类，不随语言集）。`publishDocFiles(langs)` = 4 类 × N + `LICENSE.md`
  （`{ key:'LICENSE', lang:null, file:'LICENSE.md', single:true }`，追加在末尾）。
  下游求值（evaluateDocsFlow / evaluateDocsState / publishScopeFingerprint）、
  白名单（isPublishDocFile）、完结快照（recordDocsFinalize）、提交 pathspec
  （server /docs/commit）全部随该清单自动纳入 LICENSE。
- `defaultDocFiles` / `restDocFiles`（AI 阶段范围）排除 single 文件：`defaultDocFiles`
  按 `lang === 首语言` 天然排除（lang=null）；`restDocFiles` 过滤补 `f.lang != null`，
  docs-translate-store 的 `restLangFiles` 同步排除（否则 LICENSE 会被当作翻译目标）。
- **LICENSE 三态状态机**（不进 AI，新增两态，加入 DOCS_FLOW_LABEL）：
  - `unwritten`（未编写）：磁盘无文件且无审核记录；
  - `pending`（待审核）：文件在盘（含人工编写保存）或有历史审核记录但内容 hash 与
    审核基准不一致（已审核后再次编辑保存 → 回退待审核，与四类回退口径一致）；
  - `reviewed`（已审核）：审核记录 hash 与磁盘内容一致且未 scopeStale。
- **分组**：single 文件 `isDefault = true`，归默认语言组——默认语言页签内展示并标注
  「不分语言」，默认语言计数（默认语言 x/y 已审核）含 LICENSE；
  `canTranslate` / `translateMissing` 仅按 4 类默认语言文件求值（README 验收：
  canTranslate 参与「若 A2」，A1 下 LICENSE 不锁 AI 翻译）。
- 基准变更检测（detectBaselineShift）只遍历 4 类，LICENSE 无对应行为（A1）；
  README 互链（readmeDocLinks）不涉及 LICENSE。
- `evaluateDocsState`（提交口径）无记录时的提示文案补 LICENSE（清单 4 类 × N + LICENSE.md）。

### 三、界面（web/build.js，与服务端同口径镜像）

- `docFilesOf(langs)` 追加 single 条目（`single:true, isDefault:true`）；文件行、语言页签
  计数角标、表头汇总、阶段条、门禁条随 docsFlow 求值自动含 LICENSE；LICENSE 行文件名后
  加「不分语言」标签（独立非 skip 元素，可随界面语言翻译；文件名本身沿用 data-i18n-skip）。
- 审查对话框类型页签 = `DOC_KEYS + ['LICENSE']`：A1 单栏（N=1 栏），栏头标注「不分语言」，
  编辑 / 预览 / 保存 / 通过审核与四类同口径（空文档「（空文档）」占位、2 MiB 上限、
  已审核编辑保存回退待审核）。
- 整体审查完结核对清单新增 D 的人工核对项；「AI 翻译」「整体审查」「提交」未解锁时的
  toast / title 缺口明细自动含 LICENSE（状态文案用新词条）。
- 「提交」按钮 title 与语言集应用 toast 的清单描述补「+ LICENSE」（4 类 × N + LICENSE.md）。

### 四、文案（i18n.js，中英同步）

新增词条：`未编写`、`待审核`、`（未编写）`、`（待审核）`（缺口明细用）、`不分语言`、
完结核对新项、提交 title 新句、语言集应用 toast 动态键随清单口径更新、LICENSE 编辑保存
回退 toast（回到「待审核」）；文件名 / 类型页签名（LICENSE）沿用标识豁免（data-i18n-skip，
BUG-20260921-004 口径）。

### 五、不改动项

- 五步门禁（publishStepsState）、合并门禁、`scopeStale` 回退、AI 总结提示词缓存结构、
  独立锁（summary / translate）、`commitPublishDocs` 的 files 参数契约（调用方传全清单）。
- 开源许可证选型（MIT / Apache-2.0 等）不在本单范围（`OSS_LICENSE_WHITELIST` 另线）。

**开源选型（REQ-20260909-015）**：无合适库——本单为既有纯逻辑清单 / 状态机 / 界面镜像的
口径扩展（常量清单 + 三态判定 + 渲染分支），无第三方库可复用，不引入依赖、不创建 licenses.md。

## 风险与边界

- **门禁收紧的存量影响**：既有进行中版本按新清单求值会多出 `LICENSE.md（未编写）` 缺口，
  整体完结 / 提交需补写 LICENSE 并审核（与 REQ-20260921-010 命名切换的存量口径一致：
  清单是唯一事实源，不自动生成 LICENSE 内容——选择哪种许可证由人工决定）。
- **已完成审核的存量版本**：`v.review.files` / 完结快照按文件名键控，不含 LICENSE 的旧
  记录在新清单下求值自然失效（全部已审核条件不满足），需补审 LICENSE 后重新完结——
  不弱化门禁的既定口径（README 范围边界）。
- **状态词与七态并存的展示**：`unwritten` / `pending` 仅用于 single 文件，四类文档七态
  不变；前端 chip 样式（图标 + 颜色 + 文字三重区分）为新态补同型样式。
- 语言集非法输入（空项 / 非 2–3 字母 / 重复）行内报错不应用，沿用 REQ-20260921-010 口径，
  LICENSE 清单不受语言集合法变化以外的影响。
