# 测试报告 — REQ-20260922-003 文档编写页支持添加多份自定义文档（并入 AI 总结提示词）（run-20260922-346）

- 日期：2026-09-22　执行：dev-3（批次批量开发）
- 测试框架：node:assert/strict + 真实临时 Git 仓库 + HTTP 集成 + vm 前端静态契约
  （仓库自研测试骨架，`node scripts/tests/run-all.mjs` 聚合）
- 覆盖率口径：新增回归覆盖本次全部改动层（publish-flow 纯逻辑 / build-store 与 summary
  账本数据层 / server 接口与提交 pathspec / build.js 前端静态契约 / i18n 词典），
  项目无代码覆盖率工具（纯 node:test 风格自研骨架），按层覆盖计 5/5 层；
  新增 17 例断言全部落在新代码路径上。
- 完整输出：`docs/agent-team-board/dispatch/runs/run-20260922-346/test-output.log`

## 先红后绿

新增 `scripts/tests/req-20260922-003.test.mjs`（17 例，L1 纯逻辑 8 + L2 数据层 3 +
L3 服务接口 1（内含 20+ 子断言的端到端流）+ L4 前端静态契约 4 + L6 i18n 1）。
实现前运行即失败跑红（首个断言 `publishDocFiles(langs, customs)` 仍为 9 ≠ 11，
`normalizeCustomDocName` 不存在），实现后 17/17 通过：

- L1-1 清单展开：`publishDocFiles(langs, customDocs)` = 4×N + LICENSE + 自定义
  （`{ key, lang: null, file: '<KEY>.md', single: true, custom: true }` 末尾追加）；
  空自定义与现状逐字节一致（不回归）；`customDocsOf` 容错归一（大写 / 去重保序 /
  剔除非法项）。
- L1-2 命名校验（normalizeCustomDocName 权威口径）：合法名 / `.md` 省略自动补全 /
  大写归一 / 首尾空白容错；空名、>40 字符、非法字符（数字开头 / 空格 / 斜杠子目录 /
  非 .md 后缀）、保留名（README / readme.md / LICENSE / README_EN / CHANGELOG_cn
  ——含 `_lang` 展开命名空间）、与已有自定义重复（大写比较）、上限 20 份均报错；
  标准类 KEY 带非语言后缀（MIGRATION_EN）不属保留名。
- L1-3 白名单与派生清单：`isPublishDocFile` 含清单内自定义、拒 `_lang` 展开形态与
  未登记名；`defaultDocFiles` 含自定义（AI 总结范围）、`restDocFiles` 不含（AI 翻译
  范围）；`docFileOf` 支持。
- L1-4 AI 总结提示词（核心需求 2）：自定义逐行列入「默认语言文档清单」（`- MIGRATION.md
  （中文 / 自定义）`，与标准 4 类并列其后）；静态段「N 个文档（4 类 + K 自定义 × 1）」、
  「不修改本阶段 N 个文档以外的任何文件」、参数区「共 N 个文档」全部随清单联动；
  无自定义时保持原文「4 个文档（4 类 × 1）」逐字节一致（REQ-20260921-006 缓存前缀不回归）。
- L1-5 AI 翻译提示词：目标与基准均不含自定义文档（不进翻译）。
- L1-6 自定义七态：未总结 →（账本 summarizing）→ 正在总结 →（账本 summarized / 审核记录）
  → 已总结待审核 →（hash 一致）→ 已审核；编辑回退已总结待审核；scopeStale 审核失效；
  人工在盘未总结未审 = 未总结（与四类同口径）。
- L1-7 门禁参与（全参与，只增不减）：自定义归默认语言组计数（分母 4→6）；canFinalize /
  canCommit / missing 含自定义（未总结 / 缺盘均阻塞完结与提交）；canTranslate 与
  translateMissing 排除自定义（翻译解锁不被自定义锁，与 LICENSE A1 同口径）；
  全审（含自定义）+ 完结 → canCommit。
- L1-8 提交口径与指纹：evaluateDocsState 含自定义文件（内容变化 → uncommitted，
  联动合并门禁；未编写提示提及自定义数）；publishScopeFingerprint 随自定义内容变化、
  无自定义口径兼容；detectBaselineShift 不涉及自定义。
- L2-1 build-store：addCustomDoc / removeCustomDoc 持久化 `v.customDocs`（大写归一、
  多份追加保序、重新读取回显）；校验错误 / 上限 20 / merging / pushed（409 冲突类）锁定；
  未知 key 移除报错。
- L2-2 白名单与完结快照：recordDocsReview / recordDocsCommit 放行清单内自定义、拒绝
  `MIGRATION_en.md`；recordDocsFinalize 快照 = 4×2 + LICENSE + 自定义（10 文件），
  自定义缺盘不可完结。
- L2-3 AI 总结账本：createSummaryRun files 含自定义（pending 起步，total=6 联动）；
  `markSummaryFile --file MIGRATION.md` summarizing / summarized 回执被接受（即
  `atb summary file` CLI 回执可接受）；summaryMarksForVer 聚合含自定义；不传
  customDocs 时账本与现状一致、清单外回执拒绝。
- L3 服务接口（HTTP + 真实 Git 仓库端到端）：`POST /api/build/docs/custom` 添加 /
  移除与校验 400（保留名 / 子目录 / 重复）；publish-plan 回显 customDocs 与
  docsFlow（10 文件、MIGRATION 归默认语言组、初始未总结）；「AI 总结」start 提示词含
  「5 个文档（4 类 + 1 自定义 × 1）」与 `- MIGRATION.md（中文 / 自定义）`、run
  counts.total = 5；总结运行中移除 400；save / GET docs 白名单含自定义、清单外拒绝；
  全审（4×2 + LICENSE + 自定义）→ finalize → commit：pathspec = 10 文件含
  MIGRATION.md，git show 实际提交含 MIGRATION.md、不夹带 evil.txt。
- L4 前端静态契约（vm 提取 build.js 函数）：renderDocsPane 表头「＋ 添加文档」按钮 +
  内联添加行（输入 / 添加 / 取消 / 行内错误）；自定义行「自定义」标识 + `data-doc-rm`
  移除入口 + 默认语言面板归属；页签计数与表头计数分母联动（4/6、文件（10 · …））；
  AI 总结运行中移除按钮 disabled + title 提示、总结按钮「总结中 0/5」分母联动；
  renderReviewModal 自定义类型页签（MIGRATION（0/1））单栏 + 标识 + 保存 / 通过审核 /
  编辑预览切换；validateCustomDocName 客户端镜像与服务端同口径（11 组正反例）。
- L6 i18n：新增静态词条 15 条 + 动态词条 6 条中英同步；`I.setLang('en')` 实译
  （＋ Add document / ✓ Added MIGRATION.md (initial state: not summarized) /
  Duplicate custom document…）与切回中文往返不变形。

## 回归

- 相关既有测试逐个复跑通过：req-20260921-008 / 010 / 011 / 012、req-20260922-001 /
  002、build-store、build-publish-20260916-001、i18n-lang、i18n-dict（EN 1279 条 +
  EN_DYNAMIC 429 条唯一性 / 回译无歧义校验通过）。
- `npm test` 全量 325 个测试文件，失败 2：`req-20260918-002.test.mjs`（D1 文档口径
  同步）、`req-doc-entry-20260916-003.test.mjs`（B1a / B2a / B4 README 章节与登记）。
  两者均为批次派发说明中已知的预先存在失败（源于用户未提交的 README.md 重写），
  与本单改动无关，未修复。
- 首轮全量另有 `i18n-dict`（本单「移除」英文值与既有「移出」: 'Remove' 回译冲突，
  已改为 'Remove file' 后通过）与 `commit-serve-20260910-014`（单独复跑与次轮全量
  均通过，判定为偶发）各 1 例，复跑全量后消失。
- 无自定义文档路径的兼容性：publishDocFiles / 提示词 / 求值 / 门禁在不传自定义时
  与改动前逐字节一致（L1-1 / L1-4 显式断言）。

## 实现范围

- `scripts/lib/publish-flow.mjs`：CUSTOM_DOC_MAX / CUSTOM_DOC_KEY_MAX 常量与
  customDocsOf / normalizeCustomDocName；publishDocFiles / docFileOf / isPublishDocFile /
  defaultDocFiles / restDocFiles 追加 customDocs 参数；buildDocSummaryPrompt 清单与
  计数联动；buildDocTranslatePrompt 基准排除自定义；evaluateDocsFlow（customDocsOf(v)
  + 七态分支 `f.single && !f.custom`）；evaluateDocsState 与未编写提示；
  publishScopeFingerprint 含自定义内容。
- `scripts/lib/docs-summary-store.mjs`：createSummaryRun 账本并入自定义（pending 起步）。
- `scripts/lib/build-store.mjs`：addCustomDoc / removeCustomDoc（v.customDocs 持久化、
  merging / pushed 锁定）；recordDocsReview / recordDocsCommit 白名单与
  recordDocsFinalize 快照按含自定义清单。
- `scripts/server.mjs`：新端点 POST /api/build/docs/custom（add / remove；运行中移除
  400、锁定 409）；publish-plan 回显 customDocs；docs-summary/start 传自定义（提示词 +
  账本）；save / review / GET docs 白名单与 commit pathspec / 指纹传自定义清单。
- `scripts/atb.mjs`：summary start（CLI）与服务端同口径传自定义清单。
- `scripts/web/build.js`：docFilesOf(langs, customDocs) 镜像扩展；validateCustomDocName
  客户端镜像校验；openAddDoc / closeAddDoc / submitAddDoc / removeCustomDocFile 动作；
  renderDocsPane（表头「＋ 添加文档」+ 内联添加行 + 自定义行标识与移除入口、运行中
  禁用）；renderReviewModal 自定义追加页签；normalizeFlowEval / 各 docFilesOf 调用点
  联动；saveReviewFile 回退口径区分自定义与 LICENSE。
- `scripts/web/style.css`：自定义标识 / 移除链接 / 添加行样式。
- `scripts/web/i18n.js`：新增词条中英同步（BUG-20260912-001 基线）；AI 总结 / 审查 /
  提交三处按钮 title 随口径更新（旧键随迁）。
- 未引入开源库（纯内部状态机与提示词逻辑，无对应成熟库；不创建 licenses.md）。

## 待确认项的基线落定（design.md，人工可批注调整）

命名（字母开头字符集 / ≤40 字符 / .md 可省略 / 大写归一 / 保留名含 _lang 后缀 / 上限
20 份 / 不支持子目录）、仅默认语言单份不进 AI 翻译、门禁与提交 pathspec 全参与（只增
不减；AI 翻译解锁不被自定义锁）、发布计划级持久化 v.customDocs（merging / pushed 锁定、
总结运行中禁移除）、基准检测不涉及、审查对话框追加页签——均已在条目 design.md 写明
理由，待人工确认后如需调整口径再迭代。
