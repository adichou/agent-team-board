# 测试用例 — REQ-20260922-003 发布看板的文档编写页面支持增加多份自定义文档。增加的文档要在 AI 总结提示词中加上

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 分层：L1 纯逻辑（publish-flow）/ L2 数据层（build-store + summary 账本）/ L3 服务接口 /
> L4 前端静态契约（build.js）/ L6 i18n。测试文件：`scripts/tests/req-20260922-003.test.mjs`。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1-1 | 清单展开：publishDocFiles(langs, customs) = 4×N + LICENSE + 自定义（single/custom 形态、末尾追加）；无自定义时与现状逐字节一致 | P0 | 通过 |
| L1-2 | 命名校验 normalizeCustomDocName：合法名 / .md 省略补全 / 大写归一；空名、超长、非法字符（数字开头 / 空格 / 斜杠 / 点）、保留名（README / readme.md / LICENSE / README_EN / CHANGELOG_cn）、重复、超上限（>20） | P0 | 通过 |
| L1-3 | 白名单与派生清单：isPublishDocFile 含 MIGRATION.md、拒 MIGRATION_en.md（不随语言集展开）；defaultDocFiles 含自定义、restDocFiles 不含；docFileOf 自定义 | P0 | 通过 |
| L1-4 | AI 总结提示词（核心）：自定义并入默认语言文档清单（逐行列出 + 标注自定义）；总数与阶段说明「N 个文档（4 类 + K 自定义 × 1）」一致；无自定义时保持「4 个文档（4 类 × 1）」原文 | P0 | 通过 |
| L1-5 | AI 翻译提示词：目标与基准均不含自定义文档 | P1 | 通过 |
| L1-6 | 七态状态机：自定义 unsummarized → summarizing（marks）→ summarized（marks / 审核记录）→ reviewed（hash 一致）；编辑回退 summarized；scopeStale 失效 | P0 | 通过 |
| L1-7 | 门禁参与：分组计数 / canFinalize / canCommit / missing 含自定义（全参与，只增不减）；canTranslate 与 translateMissing 排除自定义（翻译解锁不被自定义锁） | P0 | 通过 |
| L1-8 | 提交口径与指纹：evaluateDocsState 含自定义文件（committed / uncommitted 联动合并门禁）；publishScopeFingerprint 随自定义内容变化；detectBaselineShift 不涉及自定义 | P1 | 通过 |
| L2-1 | build-store：addCustomDoc 持久化 v.customDocs（大写归一）；校验错误 / 上限 20 / merging / pushed 锁定；removeCustomDoc 移除与未知 key 报错 | P0 | 通过 |
| L2-2 | 白名单联动：recordDocsReview / recordDocsCommit 放行清单内自定义文件、拒绝 MIGRATION_en.md；recordDocsFinalize 快照含自定义（缺盘报错） | P0 | 通过 |
| L2-3 | AI 总结账本：createSummaryRun files 含自定义（pending 起步）；markSummaryFile 对自定义文件回执 summarizing / summarized 被接受；summaryMarksForVer 聚合 | P0 | 通过 |
| L3 | 服务接口：POST /api/build/docs/custom 添加 / 移除 + 校验 400 + 回显；publish-plan 回显 customDocs 与 docsFlow；AI 总结 start 提示词含自定义且 run total 联动；save / GET docs 白名单；运行中移除 400；全审 + 完结后 commit pathspec 含自定义且不夹带业务文件 | P0 | 通过 |
| L4-1 | renderDocsPane：表头「＋ 添加文档」按钮；内联添加行（输入 + 添加 / 取消 + 行内错误）；自定义行带「自定义」标识 + 移除入口（总结运行中禁用）；默认语言页签计数分母含自定义 | P0 | 通过 |
| L4-2 | renderReviewModal：自定义文档追加类型页签（x/1）单栏、标「自定义」，保存 / 通过审核按钮齐全 | P1 | 通过 |
| L4-3 | validateCustomDocName 客户端镜像：与服务端同口径（空名 / 非法 / 保留名 / 重复 / 上限） | P1 | 通过 |
| L6 | i18n：新增文案（添加 / 校验 / 移除 / 标识 / 反馈）中英同步；动态词条 ◇ 占位；往返不变形 | P0 | 通过 |
