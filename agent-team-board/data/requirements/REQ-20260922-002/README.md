# REQ-20260922-002 发布看板的文档编写页面支持 LICENSE.md

- 状态：submitted（待人工接受）
- 创建：2026-09-21T23:56:57.041Z

## 描述

### 背景与现状（代码事实）

发布模块五步流程（概况 → 关联条目与提交 → **文档编写** → 合并入 main → 正式发布，`scripts/web/build.js` 的 `STEP_LABEL`）第三步「文档编写」目前的发布文档清单固定为 **4 类 × 语言集**：

- 清单事实源两处同口径镜像：服务端 `scripts/lib/publish-flow.mjs` 的 `PUBLISH_DOC_KEYS = ['README', 'CHANGELOG', 'FEATURES', 'AGENTS']` 与前端 `scripts/web/build.js` 的 `DOC_KEYS`；`publishDocFiles(langs)` 展开为 4 × N 个文件（语言集首语言不带后缀如 `README.md`，其余 `<KEY>_<lang>.md` 如 `README_en.md`，语言集默认 `cn,en`，REQ-20260921-010 落定）。
- 三阶段流水线与七态状态机（REQ-20260921-008 / 012）：① AI 总结（只覆盖默认语言 4 文件，提示词 `buildDocSummaryPrompt`）→ ② AI 翻译与审查（剩余语言文件，基准 = 已审核默认语言文档，提示词 `buildDocTranslatePrompt`；`atb summary` / `atb translate` CLI 逐文件回执）→ ③ 整体审查完结（`canFinalize` = 语言集内全部文件已审核且无 `scopeStale` / 基准变更）；提交门禁 `canCommit` = 全部已审核 **且** 整体审查已完结。
- 审查对话框（`renderReviewModal`）：按文档类型四页签（`README（x/N）` 形态），页签内全语言栏并排（N 栏、同步滚动），每栏独立 编辑/预览、保存、通过审核；已审核文件编辑保存即回退待审核。
- 服务端白名单：`/api/build/docs/review`、`/api/build/docs/save`、`atb summary/translate file` 回执、`build-store.recordDocsReview` 等均经 `isPublishDocFile()`（= 语言集内 4 类清单）校验；`/api/build/docs/commit` 的 git pathspec 也限定该清单（不夹带业务源码）。
- 项目根现状：`README.md` / `README.en.md` / `CHANGELOG.md` / `FEATURES.md` / `AGENTS.md` 均存在，**无任何 LICENSE 文件**——LICENSE.md 不在文档编写页的支持范围内：页面无法编写、审查 LICENSE.md，提交 pathspec 也不包含它，开源仓库必需的许可证文件目前只能在页面之外手工处理。

### 需求要点（原文）

发布看板的文档编写页面支持 LICENSE.md：

1. 文档编写页的发布文档清单纳入 LICENSE（第 5 类文档），页面可见其文件名与状态（语言页签、计数角标、门禁条随动）；
2. LICENSE 文件可在「审查」对话框中编写 / 编辑 / 保存 / 预览 / 通过审核，走与现有四类同口径的状态机与回退规则；
3. LICENSE 文件纳入整体审查完结与提交门禁的计数与缺口明细；「提交」到本地 dev 分支时 LICENSE 文件随语言集内文档一并进入 pathspec；
4. 服务端白名单（保存 / 审核 / 回执 / 提交）同步放行清单内的 LICENSE 文件、继续拒绝清单外文件。

### 口径待确认（开发前 design.md 定稿，演示默认口径见「界面展示」）

- **A. 文件形态**：方案 A1（开源惯例）——LICENSE.md **单文件、不随语言集展开**（无 `LICENSE_<lang>.md`，许可证文本通常不翻译）；方案 A2——完全同构第 5 类，随语言集展开（`LICENSE.md` + `LICENSE_<lang>.md`）。**待确认**（演示提供两种口径切换，默认按 A1）。
- **B. AI 流水线覆盖**：LICENSE 是否进 AI 总结 / AI 翻译范围。许可证是具法律效力的文本，AI 生成风险高，倾向**不进** AI 总结 / AI 翻译（提示词与账本不含 LICENSE，仅人工在审查对话框编写——复用现有「不经 AI 总结直接审查」路径）。**待确认**（演示为交互完整起见按「参与计数与状态机」处理，提示词口径以定稿为准）。
- **C. 必选 or 可选**：LICENSE 文件是所有发布版本的必备文档（未编写 / 未审核则门禁不放行），还是项目级可选（不启用时页面不出现）。**待确认**（演示按必选：进入门禁计数）。
- **D. 整体审查完结核对清单**：是否增加「LICENSE 与项目实际开源口径一致」一类核对项（现有清单：各语言语义一致 / README 按语言互链 / 与发布范围一致）。**待确认**。
- **E. 命名兼容**：需求原文即 `LICENSE.md`（带扩展名）；开源仓库惯例多为无扩展名 `LICENSE`，是否同时识别 / 迁移无扩展名形态。**待确认**（按需求原文以 `LICENSE.md` 为准）。

### 范围边界

- 本需求只做「文档编写页面支持 LICENSE.md」的编写 / 审查 / 提交能力；**选择何种开源许可证（MIT / Apache-2.0 等）由人工决定**，不属于本需求范围（项目内依赖开源选型白名单是另一条线，见 `scripts/web/app.js` 的 `OSS_LICENSE_WHITELIST`）。
- 不弱化现有门禁（`canTranslate` / `canFinalize` / `canCommit`）与 `scopeStale` / 基准变更回退口径；LICENSE 文件的审核失效与回退规则与四类一致。
- README 按语言互链要求（`readmeDocLinks`）只涉及 README → CHANGELOG / FEATURES，LICENSE 无互链要求。
- 提交仍 pathspec 限定（新增 LICENSE 文件一并纳入），不夹带业务源码；提交消息形态不变（`docs: 发布文档 <BLD-ID>`）。

### 涉及文件（现状）

- `scripts/lib/publish-flow.mjs`：`PUBLISH_DOC_KEYS` / `publishDocFiles` / `docFileOf` / `isPublishDocFile`（清单唯一事实源）、`buildDocSummaryPrompt` / `buildDocTranslatePrompt`（提示词清单）、`detectBaselineShift` / `evaluateDocsFlow` / `evaluateDocsState`（状态机与门禁）、`publishScopeFingerprint`（范围指纹含文档清单）；
- `scripts/lib/docs-summary-store.mjs` / `docs-translate-store.mjs`：AI 总结 / 翻译 run 的 files 账本（自 `publishDocFiles` 派生）与回执校验；
- `scripts/lib/build-store.mjs`：`recordDocsReview` / `recordDocsCommit` 白名单校验（`isPublishDocFile`）；
- `scripts/lib/build-git.mjs`：`commitPublishDocs`（pathspec = 语言集内文档清单）；
- `scripts/web/build.js`：`DOC_KEYS` 镜像、`renderDocsPane`（语言页签 + 文件七态列表 + 阶段条 + 门禁条 + 六按钮及 title 缺口提示）、`renderReviewModal`（类型页签 + N 栏）、`renderFinalizeModal`（完结核对清单）；
- `scripts/web/i18n.js`：新增界面文案须中英同步（文件名等标识沿用 `data-i18n-skip` 豁免口径，BUG-20260921-004）；
- `scripts/server.mjs`：`/api/build/publish-plan`、`/api/build/docs/review|save|commit|finalize`、`/api/build/docs-summary/start`、`/api/build/docs-translate/start` 等接口白名单；
- `scripts/tests/`：既有按「4 类 × N」口径断言的用例（如 req-20260921-008 / 012 系列的计数断言）随定稿口径更新。

## 界面展示

本需求涉及 UI（文档编写页文件清单、语言页签计数、审查对话框页签与栏、门禁条与按钮缺口提示均有改动）。可交互演示：**[./ui-demo.html](./ui-demo.html)**（单文件 HTML、内联 CSS/JS、无外网依赖、浏览器直接打开即可交互；含深浅色切换）。

- **界面布局**（沿用文档编写页现有布局，新增 LICENSE 相关元素）：五步导航（文档编写高亮）→ 语言集输入框 + 六按钮（刷新 / AI 总结 / AI 翻译 / 审查 / 整体审查 / 提交）同一水平行 → 三阶段条 → 语言页签（`cn · 中文（默认）x/N` 角标）+ 文件行（文件名 + 七态 chip）→ 门禁条。A1 口径下 LICENSE.md 显示在默认语言页签内并标注「不分语言」；A2 口径下各语言页签各多一行 `LICENSE[_<lang>].md`。
- **交互行为**：演示提供「LICENSE 口径」切换（单文件 A1 / ×语言集 A2）与场景切换（初始 → AI 总结进行中 → 待审核 → 默认语言已审核 → AI 翻译 → 全部已审核 → 已完结 → 已提交）；「审查」对话框按类型页签打开（新增 LICENSE 页签，A1 单栏 / A2 N 栏），每栏可 编辑/预览 切换、保存（已审核回退待审核）、通过审核；「AI 翻译」「整体审查」「提交」未解锁时点击给缺口明细反馈（toast 列出缺失文件与状态）；「整体审查」打开完结核对对话框、确认完结后「提交」解锁；语言集输入框可回车应用（非法输入行内报错不应用）。
- **状态反馈**：正常（各阶段推进、进度标注「AI 总结 x/5 · 当前文件」）、空（LICENSE.md 未编写时审查对话框预览显示「（空文档）」占位）、加载（发布流程数据读取中 / 文档内容读取中 / 刷新按钮「正在读取…」）、失败（publish-plan 读取失败红色横幅 + 重试按钮；重试恢复）。门禁条实时汇总「默认语言 x/y · 剩余语言 x/y 已审核」与缺口文件清单。

## 验收标准

> 文件命名按定稿口径：A1 单文件为 `LICENSE.md`；A2 为 `LICENSE.md` / `LICENSE_<lang>.md`。以下「LICENSE 文件」指按定稿口径展开的全部 LICENSE 清单内文件。

### 清单与状态机

- [ ] 文档编写页文件清单出现 LICENSE 文件，表头汇总计数（`文件（N · 默认语言 x/y 已审核 · 剩余语言 x/y 已审核）`）、语言页签计数角标、阶段条进度全部把 LICENSE 计入，与四类文档同口径展示（文件名 `data-i18n-skip`）。
- [ ] LICENSE 文件走同口径状态机：初始态（按定稿口径命名）→ 待审核态 → 已审核；已审核后再次编辑保存回退待审核；参与 `canTranslate`（若 A2）/ `canFinalize` / `canCommit` 的全量计数与 `missing` 缺口明细。
- [ ] AI 总结 / AI 翻译对 LICENSE 的覆盖与提示词、账本、进度计数（x/N）一致：按口径 B 定稿——若「进」：提示词文件清单、run files 账本、进度分母含 LICENSE；若「不进」：提示词与账本不含 LICENSE，LICENSE 状态永不悬挂「正在总结 / 正在翻译」。
- [ ] 不使用 AI 总结 / AI 翻译、直接在审查对话框人工编写 LICENSE 并通过审核的路径可用（现有「不经 AI 直接审查」能力不回收）。

### 审查对话框

- [ ] 类型页签新增 `LICENSE（x/N）`；A1 口径单栏展示 `LICENSE.md`，A2 口径按语言集 N 栏（与四类同栅格、同步滚动）。
- [ ] LICENSE 栏 编辑 / 预览 / 保存 / 通过审核 全流程可用：预览为 Markdown 渲染（空文档显示「（空文档）」占位）；保存成功后状态即时更新（已审核回退待审核）；通过审核后按钮转「✔ 已审核」禁用态；内容上限 2 MiB 超限报错口径与四类一致。

### 门禁与提交

- [ ] LICENSE 文件未审核时：「整体审查」「提交」保持既有 aria-disabled + title 缺口明细口径（toast 列出 `LICENSE…（状态）`）；整体审查完结核对清单的默认语言 / 剩余语言计数含 LICENSE（是否新增许可证核对项按口径 D 定稿）。
- [ ] 全部已审核 + 确认完结后「提交」可用：LICENSE 文件随语言集内文档一并进入 git pathspec 提交到本地 dev 分支，提交消息形态不变；不夹带清单外文件（如手工创建的 `LICENSE.txt` / 无扩展名 `LICENSE`，按口径 E 定稿前不识别）。
- [ ] 服务端白名单同步：`/api/build/docs/save`、`/api/build/docs/review` 对清单内 LICENSE 文件放行、清单外文件名返回「非发布文档文件」错误；`atb summary file` / `atb translate file` 回执校验口径一致（按口径 B）。

### 语言集与动态展开

- [ ] 语言集变化（如 `cn,en` → `cn,en,fr`）时 LICENSE 清单按定稿口径联动：A1 恒为单文件 `LICENSE.md`；A2 展开新增 `LICENSE_fr.md`（初始未翻译）；删除语言后对应文件移出清单与门禁计数；语言集非法输入（空项 / 非 2–3 字母 / 重复）行内报错不应用。

### 状态反馈与容错

- [ ] publish-plan 读取失败：六按钮恒渲染 + 红色错误横幅 + 重试（现有口径不回退）；LICENSE 文件不存在（未编写）时状态展示与「先编写并保存再通过审核」提示明确；审查对话框读取中 / 保存中 / 失败反馈与四类一致。
- [ ] 新增界面文案中英同步（`scripts/web/i18n.js`）；深浅色下新增元素可读。

### 回归

- [ ] 既有四类文档全流程（AI 总结 → AI 翻译 → 逐文件审查 → 整体审查完结 → 提交 → 合并门禁）无回归；`scopeStale` / 基准变更（mtime）回退口径不变（A2 口径下 LICENSE 同类型两两对比参与基准检测，A1 无对应行为）。
- [ ] 既有测试按新口径更新断言（4 类 × N 计数处）并全部跑绿；为 LICENSE 新增用例覆盖上述清单 / 门禁 / 白名单要点。
