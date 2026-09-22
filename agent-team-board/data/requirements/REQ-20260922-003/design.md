# 设计 — REQ-20260922-003 发布看板的文档编写页面支持增加多份自定义文档。增加的文档要在 AI 总结提示词中加上

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

文档编写步现状（REQ-20260921-008 / 010 / 012、REQ-20260922-002 之后）：

- 文档清单 = 标准 4 类（README / CHANGELOG / FEATURES / AGENTS）× 语言集 + LICENSE 单文件，
  `publish-flow.publishDocFiles(langs)` 为唯一事实源；清单展开同时驱动：白名单（save / review /
  GET docs）、AI 总结范围（`defaultDocFiles`）与账本（`createSummaryRun`）、AI 翻译范围
  （`restDocFiles`）、三阶段门禁（`evaluateDocsFlow`）、提交口径（`evaluateDocsState`）与
  pathspec、完结快照（`recordDocsFinalize`）、范围指纹（`publishScopeFingerprint`）。
- AI 总结提示词 `buildDocSummaryPrompt`：静态段写死「4 个文档（4 类 × 1）」，参数区
  「默认语言文档清单」仅列默认语言 4 文件。
- 前端 `renderDocsPane`（build.js）：语言集输入 + 六按钮 → 阶段条 → 提示词预览 → 按语言
  页签文件列表（七态 chip）→ 门禁条；审查对话框 `renderReviewModal` 按 4 类 + LICENSE 页签。

## 方案

自定义文档建模为**清单追加的单文件条目**（与 LICENSE 的 A1 形态同构，但进入 AI 总结）：
`{ key, lang: null, file: '<KEY>.md', single: true, custom: true }`，追加在标准清单末尾。
清单是唯一事实源：追加后求值 / 白名单 / 账本 / 门禁 / 提交口径 / 指纹全部按既有机制自动联动，
不引入第二套清单逻辑。无自定义文档时全部函数输出与现状逐字节一致（不回归）。

### 「待确认」项的基线落定（保守口径，落定前不弱化既有门禁，只增不减）

1. **命名规则（待确认 1）**：去首尾空白；`.md` 后缀可省略（大小写不敏感，自动补全）；
   KEY 匹配 `^[A-Za-z][A-Za-z0-9_-]*$`（字母开头，字母 / 数字 / 连字符 / 下划线），
   长度 ≤ 40 字符；**不支持子目录**（`/`、`\` 按非法字符报错——现状发布文档均在项目根）；
   大小写归一为大写（与标准 4 类一致），去重按大写比较。保留名拒绝：
   `^(README|CHANGELOG|FEATURES|AGENTS|LICENSE)(_[A-Z]{2,3})?$`（标准 4 类本体 + 语言集
   展开命名空间 `<KEY>_<lang>` + LICENSE 单文件；含 `_lang` 后缀形态，防语言集变化后撞名）。
   数量上限 **20 份**（防提示词与清单无限膨胀）。
2. **多语言展开（待确认 2）**：仅默认语言单份 `KEY.md`，不随语言集展开、不进 AI 翻译
   （阶段二目标与翻译基准均不含自定义文档）——按 README「至少并入 AI 总结」基线。
   语言集变化不影响自定义文档清单（恒单份）。
3. **门禁与提交参与（待确认 3）**：**全参与**——进入七态状态机与「通过审核」hash 口径、
   canFinalize / canCommit 全审口径、提交 pathspec、evaluateDocsState（合并门禁）与范围指纹。
   理由：不参与提交会出现「已总结已审核的文档永久遗留磁盘、不随版本发布」，与用户添加
   发布文档的意图相悖，且待确认 3 指出的「遗留未提交文件如何提示」问题随之消解；全参与
   只收紧不放宽（不弱化）。**AI 翻译解锁（canTranslate）例外**：只看标准 4 类默认语言文件
   （自定义文档不锁翻译——翻译范围不含它，与 LICENSE A1 同口径，translateMissing 不含它）。
4. **持久化与锁定（待确认 4）**：发布计划级，存版本记录顶层 `v.customDocs`（大写 KEY
   字符串数组，顺序保留；类比 `v.langs` / `saveDocLangs` 先例）；merging / 已正式发布
   （pushed）锁定增删（与语言集口径一致）；**AI 总结运行中禁止移除**（服务端按
   `unfinishedSummaryRuns` 校验 + 前端按钮禁用），运行中允许添加（该文档进入下一轮
   AI 总结，不影响进行中 run 的账本）。移除已总结 / 已审核文档：允许（非运行中），其
   审核记录留存 `v.review.files` 但随清单移出不再参与求值；已提交后移除：提交记录中该
   文件 hash 留存，evaluateDocsState 按当前清单求值（清单即范围），磁盘遗留文件由用户
   自行处理（提交 pathspec 不再包含它）。
5. **基准变更检测（待确认 5）**：自定义文档无多语言版本，`detectBaselineShift` 维持
   标准 4 类两两 mtime 对比，不涉及。
6. **提示词与文案（待确认 6）**：静态段计数句随清单联动——无自定义时保持原文
   「4 个文档（4 类 × 1）」（缓存前缀稳定、不回归）；有自定义时「N 个文档（4 类 + K
   自定义 × 1）」；「不修改本阶段 N 个文档以外的任何文件」同步；参数区清单行逐文件列出，
   自定义行标注「自定义」。审查对话框：每个自定义文档一个类型页签（追加在四类 + LICENSE
   之后），单栏、标「自定义」，沿用编辑 / 保存 / 通过审核。README 互链约束不适用
   （`readmeDocLinks` 只匹配 README，不改动）。

### 落点（模块 / 接口）

- `scripts/lib/publish-flow.mjs`（核心）：
  - `CUSTOM_DOC_MAX = 20`、`CUSTOM_DOC_KEY_MAX = 40`、保留名 RE；
  - `customDocsOf(v)`：v.customDocs 容错读取 + 归一（大写 / 去重 / 过滤非法，读取宽容）；
  - `normalizeCustomDocName(raw, { existing })` → `{ key }` 或 `{ key: null, error }`
    （保留名 RE 已覆盖任意 2–3 字母 `_lang` 后缀，无需按语言集展开比对；
    服务端权威校验；前端 `validateCustomDocName` 客户端镜像先行，不发请求）；
  - `publishDocFiles(langs, customDocs = [])` / `isPublishDocFile(file, langs, customDocs = [])` /
    `docFileOf(key, lang, langs, customDocs = [])` 追加自定义条目；
  - `defaultDocFiles(langs, customDocs = [])`：`f.custom || f.lang === 首语言`（AI 总结范围含
    自定义）；`restDocFiles` 不变（`lang != null` 天然排除）；
  - `buildDocSummaryPrompt({ …, customDocs })`：清单与计数并入（核心需求 2）；
  - `buildDocTranslatePrompt`：基准过滤 `!f.custom`（翻译不涉及自定义）；
  - `evaluateDocsFlow`：清单经 `customDocsOf(v)`；状态机分支 `f.single && !f.custom` 走
    LICENSE 三态，自定义走默认语言七态（summarizing / summarized / reviewed / hash 回退）；
    分组计数 / canFinalize / canCommit / missing 含自定义；canTranslate / translateMissing
    排除自定义；
  - `evaluateDocsState`：清单含自定义（提交口径与合并门禁联动，reasons 文案提及自定义数）；
  - `publishScopeFingerprint(items, readFile, langs, customDocs = [])`：自定义内容参与指纹。
- `scripts/lib/docs-summary-store.mjs`：`createSummaryRun({ …, customDocs })` 账本装
  `f.custom || f.lang === 首语言` 文件（pending 起步）；`markSummaryFile` 按 run 自身账本
  校验（既有机制，`atb summary file --file MIGRATION.md` 自动可回执）。
- `scripts/lib/build-store.mjs`：`addCustomDoc(dataDir, id, { name, by })` /
  `removeCustomDoc(dataDir, id, { key, by })`（锁 merging / pushed；校验 / 上限 / 去重；
  落 `v.customDocs`）；`recordDocsReview` / `recordDocsCommit` 白名单与
  `recordDocsFinalize` 快照按含自定义清单。
- `scripts/server.mjs`：新端点 `POST /api/build/docs/custom {id, op: add|remove, name|key}`
  （成功回 `{ ok, customDocs, version, docs, docsFlow }`；校验 400、锁 409、运行中移除 400）；
  `publish-plan` 响应增 `customDocs` 回显；`docs-summary/start` 传自定义清单（提示词 +
  账本）；save / review / GET docs 白名单与 commit pathspec 传自定义清单。
- `scripts/web/build.js`：文件区表头右侧「＋ 添加文档」按钮 + 内联添加行（输入 + 添加 /
  取消 + 行内错误，草稿重渲染不丢字）；自定义行 = 文件名 +「自定义」标识 + 七态 chip +
  移除入口（总结运行中禁用）；表头计数 / 页签角标 / 阶段条 / 门禁条 / 提示词预览经
  docsFlow 联动（服务端求值为准）；`docFilesOf(langs, customDocs)` 镜像扩展；
  `renderReviewModal` 追加自定义页签；`validateCustomDocName` 客户端镜像校验。
- `scripts/web/style.css`：自定义标签 / 移除链接 / 添加行样式（沿用 single-tag 弱化呈现）。
- `scripts/web/i18n.js`：新增词条中英同步（BUG-20260912-001 基线）；AI 总结 / 审查按钮
  title 文案随口径更新（含自定义文档）。

**开源选型（REQ-20260909-015）**：未引入开源库。自研理由：全部为项目内部状态机、清单
展开与提示词装配逻辑，无对应成熟开源库；不创建 licenses.md。

## 风险与边界

- **不回归**：无自定义文档时 `publishDocFiles` / 提示词 / 门禁 / 求值输出与现状逐字节一致
  （REQ-20260921-006 提示词缓存前缀、既有 -008 / -010 / -012 / -002 测试口径不动）。
- **门禁只增不减**：自定义文档计入 canFinalize / canCommit / 合并门禁 / pathspec；用户添加
  后未总结 / 未审核会阻塞完结与提交（UI 缺口明细列出自定义文件与状态），属预期收紧。
- **添加 / 移除与运行中 run**：添加不动进行中账本（下一轮生效）；移除在运行中被拒（服务端
  400 + 前端禁用）；done / failed 收尾后即可增删。
- **语言集展开命名空间**：保留名 RE 拒绝 `<标准KEY>_<2-3字母>` 形态，防语言集变化后自定义
  文档与展开文件撞名；自定义 KEY 之间的 `<KEY>_<lang>` 形态（如 MIGRATION_EN）不展开、
  不冲突，允许。
- **范围**：不改 CLI 回执语义（账本制）、不改三阶段流程结构、不改 LICENSE / 语言集既有口径。
