# 测试用例 — BUG-20260922-002 自定义文档支持删除、添加一次随语言集自动展开

用例落盘于 `scripts/tests/bug-20260922-002.test.mjs`（TDD：先跑红后实现跑绿）；
`scripts/tests/req-20260922-003.test.mjs` 断言随口径落定同步更新。

## L1 纯逻辑（publish-flow）

| 编号 | 用例 | 断言要点 |
| ---- | ---- | -------- |
| L1-1 | 清单随语言集展开 | `publishDocFiles(['cn','en'],['MIGRATION'])` = 4×2 + LICENSE + MIGRATION.md（lang=cn，非 single）+ MIGRATION_en.md（lang=en）；空数组与现状逐字节一致；单语言集仅默认语言一份 |
| L1-2 | 白名单 / 派生清单 / docFileOf | `MIGRATION_en.md` 进白名单；语言集外（`_fr`）不展开；defaultDocFiles 含默认语言份、restDocFiles 含其余语言份；docFileOf 按语言展开 |
| L1-3 | 展开重名拦截 | `MIGRATION_EN`（已有 MIGRATION）双向拦截、报「重复」句式；单语言集不冲突；常规命名放行；`customDocsExpandConflict` 清单级检测 |
| L1-4 | AI 翻译提示词 | 目标行含 `- MIGRATION_en.md（English / MIGRATION / 自定义，基准 MIGRATION.md）`；基准段嵌入 MIGRATION.md；计数句 `4 类 + 1 自定义 × 1 语言`；无自定义保持原文 |
| L1-5 | 基准变更检测含自定义 | MIGRATION.md mtime 晚于 MIGRATION_en.md → 回退未翻译；与标准 4 类同屏检出；两参调用不回归 |
| L1-6 | 七态状态机（翻译分支） | 其余语言份 untranslated → translating → translated → reviewed；基准变更回退；分组归属（默认组 / 剩余组） |
| L1-7 | 门禁参与 | canTranslate 被自定义默认语言未审锁、translateMissing 含它；全审 + customDocsKey 匹配完结 → canCommit；customDocsKey 不匹配失效；存量完结记录（无字段、无自定义）不回归 |
| L1-8 | 提交口径 / 指纹 | 未编写提示「共 11 个文件」按 KEY 份数提及自定义；其余语言内容变化 → 指纹变化 |

## L2 数据层（build-store + 账本）

| 编号 | 用例 | 断言要点 |
| ---- | ---- | -------- |
| L2-1 | 增删校验 | addCustomDoc 展开重名拦截；单语言集共存 KEY 扩展语言集（saveDocLangs）撞名拒绝且不改盘 |
| L2-2 | 整份移除 | 清单退出 + 磁盘 MIGRATION.md / MIGRATION_en.md 删除 + review.files 留痕清理；再添加同 KEY 不复活「已审核」；NOPE 报不在清单；merging / pushed 锁定保持 |
| L2-3 | 完结快照 | `MIGRATION_en.md` 进审核白名单；finalized.customDocsKey='MIGRATION'；快照 11 文件 |
| L2-4 | 账本 | 总结账本 5 文件（4 类默认语言 + MIGRATION.md，不含 en 份）；翻译账本 5 文件（4 类 en + MIGRATION_en.md）且 translating / translated 回执被接受 |

## L3 服务接口（端到端）

添加一次 → docsFlow 11 文件（默认组 / 剩余组归属）→ `MIGRATION_EN` 添加 400 → 逐文件写盘
（先默认组后 en 组，避开 mtime 基准回退）全审 → AI 翻译启动（提示词目标与基准含自定义、
账本 total=5）→ finalize → commit pathspec 含 `MIGRATION.md` + `MIGRATION_en.md` 且不夹带
业务文件 → 整份移除（removedFiles 响应、磁盘删除、清单回到 9）。

## L4 前端静态契约（build.js）

| 编号 | 用例 | 断言要点 |
| ---- | ---- | -------- |
| L4-1 | 镜像与反推 | docFilesOf 展开；customDocKeyOfFile('MIGRATION_en.md') → 'MIGRATION'（非自定义 null）；validateCustomDocName 展开重名镜像 |
| L4-2 | renderDocsPane | MIGRATION.md 在 cn 面板、MIGRATION_en.md 在 en 面板（自动展开）；两行均有移除入口；表头 `11 · 默认语言 0/6 · 剩余语言 0/5` |
| L4-3 | renderReviewModal | 自定义页签 `MIGRATION（0/2）` 多语言两栏，en 栏可保存 / 通过审核，栏头标「自定义」 |

## L6 i18n

新增 / 变更词条中英同步：移除 title（静态）、展开重名 / 添加成功 / 整份移除反馈（动态 ◇
占位）；英文往返断言（`已移除自定义文档 MIGRATION（已删除 2 个磁盘文件）`）。

## 回归

`req-20260922-003.test.mjs`（口径落定更新后 17 例）、`req-20260921-008/010/012`、
`req-20260922-001/002/004`、`bug-20260921-005` 全部通过；全量 `npm test` 328 文件仅
2 个已知预存失败（req-20260918-002 D1、req-doc-entry-20260916-003 B1a/B2a/B4，源于用户
未提交的 README.md 重写，与本单无关）。
