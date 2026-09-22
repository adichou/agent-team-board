# 设计 — BUG-20260922-002 文档编写页面的自定义文档要支持删除，并且自定义文档只需要在默认语言中添加一次，其他语种需要自动添加

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260922-003（经 `atb list` 核验真实存在）。该需求引入自定义文档能力，其实现（dev 提交 9c207d1）在「待确认 2/3」 unresolved 的情况下选择了「默认语言单份、不随语言集展开、不进 AI 翻译」口径（`publish-flow.mjs` `docFileOf`「自定义文档恒单文件」、`buildDocTranslatePrompt` 过滤 custom；`build.js` `docFilesOf` 自定义 `lang: null`）；本单即针对该口径的缺陷与删除遗留问题。

## 根因分析

引入来源 REQ-20260922-003 的实现（dev 提交 9c207d1）在「待确认 2/3」unresolved 的情况下，
将自定义文档建模为**默认语言单份**条目（`{ key, lang: null, single: true, custom: true }`）：

1. **不随语言集展开**（核心缺口）：`publish-flow.publishDocFiles` 对 customDocs 恒输出
   `KEY.md` 一份（`lang: null`）；`build.js docFilesOf` 前端镜像同口径 → 其他语言页签按
   `f.lang === l` 过滤恒不命中，其他语种永远不出现对应文件行。
2. **不进 AI 翻译**：`buildDocTranslatePrompt` 基准清单显式过滤 `!f.custom`、
   `docs-translate-store.createTranslateRun` 装账本时 `restLangFiles(langs)` 调
   `publishDocFiles(ls)` **不传 customDocs** → 翻译目标永远只有标准 4 类 × 剩余语言；
   手工逐语种添加 `MIGRATION_EN` 得到的仍是又一份默认语言单份，与 `MIGRATION` 无语言关联。
3. **删除遗留**：`build-store.removeCustomDoc` 仅从 `v.customDocs` 删除清单项，不清理磁盘
   `KEY.md` 与 `v.review.files` 审核留痕 → 移除后文件退出 pathspec、成为仓库根孤儿未跟踪
   文件；同 KEY 再添加时旧审核 hash 若与磁盘内容一致会直接复活「已审核」。
4. **完结有效性盲区**：`evaluateDocsFlow.finalized` 只比对 `langsKey`，自定义清单增删后
   旧完结记录仍可能放行提交（范围已变未重新完结）。

## 方案

**口径落定**（本单登记即表明用户选择「随语言集展开」而非「默认语言单份」，README 期望
行为与验收已按此表述；同时落定源单「待确认 2/3」为**与标准 4 类完全同口径、全参与**）：

自定义文档与标准 4 类同构随语言集展开：默认语言 `KEY.md`（`lang=首语言`、非 single）+
其余语言 `KEY_<lang>.md`，添加一次即全语种就位。清单是唯一事实源，展开后全部既有机制
自动联动：白名单（save/review/GET docs）、AI 总结（默认语言份）、AI 翻译（其余语言份，
基准 = 默认语言 `KEY.md`）、七态状态机、`canTranslate`（默认语言非单文件全审，含自定义
默认语言份）、三阶段门禁与提交 pathspec、范围指纹、基准变更检测（mtime 含自定义）、
完结有效性（`finalized.customDocsKey` 参与比对，存量记录无字段按 `''` 处理不回归）。

1. **展开重名拦截**：新 KEY 按语言集展开的文件名与既有 KEY 展开文件大小写不敏感重名即
   拒绝（`MIGRATION_EN` ↔ `MIGRATION` 的 `MIGRATION_en.md`；大小写不敏感文件系统同文件）
   ——手工逐语种 workaround 不再可行，报错沿用「自定义文档重复」句式；`saveDocLangs`
   扩展语言集导致既有 KEY 展开撞名同样拒绝（`customDocsExpandConflict` 共用）。
2. **整份移除**（README「界面展示」交互已写明整份移除）：任一语言页签行尾「移除」均按
   KEY 整份生效——清单退出 + `v.review.files` 留痕清理（防再添加复活已审核）+ 删除项目根
   该 KEY 全部语言文件（`fs.rmSync force`，删除失败不阻塞清单移除；服务端回传
   `removedFiles` 供前端提示）——不残留退出 pathspec 的孤儿文件；merging / pushed /
   AI 总结运行中拦截口径保持。
3. **审查对话框**：自定义页签随清单天然多语言多栏（既有 `pair = docFiles.filter(key)` 机制
   零改动支持），其余语言文件可编辑 / 保存 / 通过审核（进入门禁的必经入口）。
4. **前端**：`docFilesOf` 镜像展开；`customDocKeyOfFile` 从行文件名（`KEY_<lang>.md`）反推
   整份 KEY；`validateCustomDocName` 增加 langs 参数镜像展开重名；文案（添加 / 移除反馈、
   title、i18n 词条）随口径更新，中英同步（BUG-20260912-001 基线），死键清理。
5. **CLI 对齐**：`atb translate start` 同 server 口径传 customDocs（账本 + 提示词）。

**开源选型（REQ-20260909-015）**：未引入开源库。自研理由：全部为项目内部清单展开、状态机
与提示词装配逻辑，无对应成熟开源库；不创建 licenses.md。

## 实施记录（dev-7，2026-09-22）

- `scripts/lib/publish-flow.mjs`：`customDocFilesOf`（KEY×语言展开）与
  `customDocsExpandConflict`（清单级冲突检测）新增；`publishDocFiles` / `docFileOf` /
  `defaultDocFiles` / `restDocFiles` 改展开口径（空 customDocs 输出与现状逐字节一致）；
  `normalizeCustomDocName` 增加 `langs` 展开重名校验；`buildDocTranslatePrompt` 基准含
  自定义、目标计数句随清单联动（无自定义保持原文）；`detectBaselineShift` 第三参
  customDocs；`evaluateDocsFlow` 状态机分支注释更新 + `canTranslate` 注释 +
  `finalized` 比对 `customDocsKey`（`?? ''` 存量兼容）；`evaluateDocsState` 未编写提示按
  KEY 份数计。
- `scripts/lib/build-store.mjs`：`addCustomDoc` 传 langs 校验；`saveDocLangs` 语言集扩展
  冲突拒绝；`removeCustomDoc(dataDir, id, { key, by, projectRoot })` 整份移除（留痕清理 +
  删盘）；`recordDocsFinalize` 落 `customDocsKey`。
- `scripts/lib/docs-summary-store.mjs`：账本过滤改为 `x.lang === ls[0]`（自定义默认语言份）。
- `scripts/lib/docs-translate-store.mjs`：`restLangFiles(langs, customDocs)` /
  `createTranslateRun` 接收 customDocs（其余语言份入账本）。
- `scripts/server.mjs`：`docs-translate/start` 传 customDocs（账本 + 提示词）；
  `docs/custom` remove 传 projectRoot、响应 `removedFiles`。
- `scripts/atb.mjs`：`translate start` 同口径传 customDocs。
- `scripts/web/build.js`：`docFilesOf` 镜像展开；`customDocKeyOfFile` 新增；
  `validateCustomDocName(raw, existing, langs)` 镜像展开重名；`submitAddDoc` /
  `removeCustomDocFile`（KEY 反推 + removedFiles 反馈）；移除按钮 / 添加入口 / 输入框
  title 与审查对话框注释更新；`renderReviewModal` docsFlow 缺失兜底态按语言分支。
- `scripts/web/i18n.js`：新增展开重名 / 添加成功 / 整份移除词条（静态 1 + 动态 4+1），
  旧词条（移除该自定义文档 / 已添加初始状态 / 已移除单键）随文案变更清理。
- 测试：新增 `scripts/tests/bug-20260922-002.test.mjs`（L1×8 / L2×4 / L3×1 / L4×3 / L6×1，
  17 例）；`scripts/tests/req-20260922-003.test.mjs` 断言随口径落定更新（展开计数、翻译
  含自定义、canTranslate 同口径、完结 customDocsKey、L4 多栏、i18n 词条迁移）。

## 风险与边界
