# 设计 — REQ-20260921-010 文档编写界面提供一个输入框，允许输入国际化语言集

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

发布文档体系（REQ-20260920-003 落定）此前固定「四类 × 中英」八个文件：中文 `<KEY>.md`、
英文 `<KEY>.en.md`（点号命名），白名单 / 求值 / 提交 pathspec / AI 总结提示词全部围绕该固定清单。
本需求把「固定中英两种语言」泛化为「用户可配置语言集」，文档数量、文件命名、门禁与提示词
均随语言集动态展开。REQ-20260921-008 已把文档编写页重构为「总结 → 审查 → 提交」流水线
（审查对话框内逐文件编辑），本设计在现行布局上落位语言集能力。

## 方案

### 一、待确认项落定口径（README「待确认」逐条）

1. **语言缩写口径与默认值**：接受 2–3 个 ASCII 字母的语言缩写（覆盖 ISO 639-1 两位码与
   常见三位码），大小写归一为小写；默认语言集 `cn,en`（按需求原文，cn / zh、jp / ja 均为
   合法缩写，由用户按自己习惯输入）。界面层与数据层共用同一校验（`publish-flow.normalizeDocLangs`）。
2. **后缀分隔符与存量兼容**：非首语言用下划线命名 `<KEY>_<lang>.md`（按需求原文示例
   `README_en.md` / `README_fr.md` 与 ui-demo 口径）；**不做存量 `.en.md` 的自动迁移或
   并存识别**——语言集是文件清单的唯一事实源。影响：已有版本记录按新清单求值时，原
   `.en.md` 不在清单内会显示「缺失 / 未编写」，需按新清单重新编写、审核、提交（不自动
   改写用户磁盘文件）。
3. **作用域与持久化**：发布计划级——存版本记录 `version.json` 顶层 `langs` 字段
   （`build-store.saveDocLangs`），缺省回退 `['cn','en']`；重新进入文档编写步回显上次语言集。
   merging / 已正式发布（pushed）锁定不可改（与五步门禁 docs 步锁定口径一致）。
4. **校验细则**：空值、空项（连续逗号）、非 2–3 字母项、重复项（不自动去重）均报错拦截，
   不应用非法值、界面保持上次有效状态；不设语言数上限（清单 = 4 类 × N 全量展开）。
5. **语言显示名映射**：内置常见语言显示名（cn/zh→中文、en→English、fr→Français、jp/ja→
   日本語、de/es/ko/ru/it/pt 等），未命中原样显示缩写；显示名随文件名一并
   `data-i18n-skip` 豁免（标识不是文案，BUG-20260921-004 口径）。
6. **官网同步材料**：不在本单范围——官网发布校验（build-publish）仍要求中英成对材料。

### 二、界面落位（映射 REQ-20260921-008 后的现行布局）

- **语言集输入框**放文档编写页副标题区（`bld-docs-sub`）：`语言集` 标签 + 文本输入（默认
  `cn,en`）+ 行内错误提示；回车 / 失焦确认；客户端先镜像校验（不合法就地报错、不发请求），
  合法则 `POST /api/build/docs/langs` 保存并强制刷新五步装配。
- **语言下拉的验收点由审查对话框承接**：审查对话框每类型页签按语言集展开**全语言列**
  （原「中英双栏」泛化为 N 栏，栅格列数 = 语言数），逐栏加载 / 编辑 / 保存 / 通过审核——
  即「语言选项随语言集动态生成，切换后加载对应文件」在现行布局下的等价实现。
- 文件列表行数、门禁计数（`X/N 已审核`）、AI 总结按钮进度、提交按钮缺口明细、README
  同语言链接提示（`readmeDocLinks`）全部按语言集动态。

### 三、接口与数据设计

- `publish-flow.mjs`（纯逻辑层，唯一事实源）：
  - `DEFAULT_DOC_LANGS = ['cn','en']`；`normalizeDocLangs(raw)` → `{ langs } | { error }`；
  - `docLangsOf(v)`：`v.langs` 合法则用之，否则默认（求值入口统一从这里取语言集）；
  - `publishDocFiles(langs)` / `docFileOf(key, lang, langs)` / `isPublishDocFile(file, langs)` /
    `readmeDocLinks(file, langs)`：首语言无后缀，其余 `<KEY>_<lang>.md`；
  - `buildDocSummaryPrompt({ …, langs })`：文档清单 = 4 类 × N，措辞随语言数动态；
  - `evaluateDocsState` / `evaluateDocsFlow` / `publishScopeFingerprint`：行数与文案随
    `docLangsOf(v)` 动态（去掉硬编码「八个 / 8」）。
- `build-store.mjs`：`saveDocLangs(dataDir, id, { langs })`（校验 + merging/pushed 锁 +
  落盘 `v.langs`）；`recordDocsReview` / `recordDocsCommit` 的白名单校验改按
  `isPublishDocFile(name, docLangsOf(v))`。
- `docs-summary-store.mjs`：`createSummaryRun({ …, langs })` 按语言集展开 files 账本；
  `markSummaryFile` 按 run 自身 files 清单校验（语言集可随版本变化，不依赖全局白名单）；
  `summaryRunView` 的 `counts.total` 按账本文件数动态。
- `build-git.mjs`：`commitPublishDocs(root, { message, files })` 接受文件清单（调用方按
  语言集传入）；缺省保留旧八字节清单（点号 `.en.md`）兼容既有调用方。
- `server.mjs`：`GET /api/build/publish-plan` 响应附 `langs`；新增
  `POST /api/build/docs/langs { id, langs }`；`GET /api/build/docs`、`docs/save`、
  `docs/review`、`docs/commit`、`docs-summary/start` 的白名单 / pathspec / 提示词全部按
  `docLangsOf(v)` 展开。
- `web/build.js`：文档编写页语言集输入框（校验镜像 + 保存 + 联动刷新）；文件列表 / 审查
  对话框列 / 门禁与按钮计数改由 `plan.docsFlow.files`（服务端按语言集求值）驱动，去掉
  前端硬编码 `DOC_FILES`。

### 四、文案（中英同步，BUG-20260912-001）

新增 / 变更界面文案集中在 `scripts/web/i18n.js`：语言集标签、行内校验错误（空 / 空项 /
非法缩写 / 重复）、应用成功 toast、门禁与按钮计数由固定「8」改为 `◇/◇` 动态词条；
被替换的「八个」类词条随界面更新清理。

**开源选型（REQ-20260909-015）**：无合适库——语言集校验为一段 2–3 字母正则、显示名为
十几条常量映射，引入 i18n / 语言代码库的成本与体积高于自研，故不引入依赖、不创建
licenses.md。

## 风险与边界

- **命名切换的存量影响**：默认语言集 `cn,en` 下英文文件名由 `README.en.md` 变为
  `README_en.md`。既有进行中版本（含 `.en.md` 提交记录）按新清单求值会出现「缺失」，需
  人工按新清单补写后重新审核提交；不做自动迁移（不自动改写 / 重命名用户磁盘文件）。
- **审查对话框 N 栏布局**：栅格列数 = 语言数，语言较多时单栏变窄（可横向滚动兜底），
  不设语言数上限（用户自担）；同步滚动逻辑对 N 栏按比例跟随，与双栏一致。
- **语言集变更不回滚已有审核 / 提交记录**：记录按文件名键控，不在新清单内的文件记录
  自然不参与求值；新纳入语言从「未编写」起步。
- 官网材料（faq.zh.md / faq.en.md 等成对校验）维持中英口径，不在本单范围。
