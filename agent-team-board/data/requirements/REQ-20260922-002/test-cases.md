# 测试用例 — REQ-20260922-002 发布看板的文档编写页面支持 LICENSE.md

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 口径按 design.md 定稿：A1 单文件 LICENSE.md（不随语言集）；B 不进 AI 总结 / 翻译；C 必选进门禁；D 完结核对新增人工项；E 仅识别 LICENSE.md。
> 新用例落 `scripts/tests/req-20260922-002.test.mjs`（15 例全绿）；既有 4×N 计数断言（req-20260920-003 / 008 / 010 / 012）及受联动影响的夹具（bug-20260921-004 / 013、build-serve、mgt-auto-commit-20260914-007、product-release-serve、req-20260921-011）随新口径更新后全部跑绿；npm test 全量 324 文件仅剩 2 个与本单无关的预先存在失败（req-20260918-002 D1、req-doc-entry-20260916-003，源于用户未提交的 README.md 重写）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1-1 | 清单：publishDocFiles = 4 类 × N + LICENSE.md（single、lang=null，末尾追加）；语言集变化（含单语言集）LICENSE 恒单文件；docFileOf('LICENSE') = 'LICENSE.md' | P0 | 通过 |
| L1-2 | 白名单：isPublishDocFile 放行 LICENSE.md；拒绝 LICENSE（无扩展名）/ LICENSE.txt / LICENSE_en.md / LICENSE_cn.md | P0 | 通过 |
| L1-3 | AI 范围排除（口径 B）：buildDocSummaryPrompt / buildDocTranslatePrompt / defaultDocFiles / restDocFiles 均不含 LICENSE；提示词文件数仍 4 类口径 | P0 | 通过 |
| L1-4 | LICENSE 三态：无盘无记录 unwritten（未编写）→ 在盘 pending（待审核）→ hash 一致 reviewed（已审核）；已审核编辑保存回退 pending；scopeStale 失效；磁盘文件被删回退 pending | P0 | 通过 |
| L1-5 | 分组与门禁：LICENSE 归默认语言组（defaultFiles 含、restFiles 不含，默认语言计数含 LICENSE）；canTranslate / translateMissing 不受 LICENSE 影响（4 类默认语言全审即解锁）；canFinalize / canCommit / missing 含 LICENSE 缺口（C 必选） | P0 | 通过 |
| L1-6 | evaluateDocsState：无记录提示含 LICENSE（共 4×N+1 个文件）；提交口径 LICENSE 缺失 / hash 不一致 → uncommitted；publishScopeFingerprint 含 LICENSE 内容（内容变 → 指纹变） | P1 | 通过 |
| L1-7 | 基准变更检测不涉及 LICENSE（A1 无对应行为）；readmeDocLinks('LICENSE.md') = [] | P1 | 通过 |
| L2-1 | build-store 白名单：recordDocsReview / recordDocsCommit 对 LICENSE.md 放行；LICENSE / LICENSE.txt / LICENSE_en.md 拒「非发布文档文件」 | P0 | 通过 |
| L2-2 | AI 账本（口径 B）：createSummaryRun files 不含 LICENSE.md；markSummaryFile('LICENSE.md') 拒；createTranslateRun 不含；markTranslateFile('LICENSE.md') 拒 | P0 | 通过 |
| L2-3 | recordDocsFinalize 快照覆盖 4×N+1 文件（含 LICENSE.md hash）；LICENSE 不在盘时完结报「不存在或不可读」 | P1 | 通过 |
| L3-1 | publish-plan：files 9 行（cn,en）；LICENSE.md state=unwritten、isDefault=true；表头计数默认语言 0/5 | P0 | 通过 |
| L3-2 | docs/save + docs/review：LICENSE.md 写盘 → 保存 200 → 审核 200 → reviewed；审核不在盘 LICENSE 报「先编写并保存再通过审核」；docs/save LICENSE.txt / GET docs LICENSE（无扩展名）400「非发布文档文件」 | P0 | 通过 |
| L3-3 | 门禁联动：仅四类 + 剩余语言全审、LICENSE 未审 → finalize 400 缺口含 LICENSE.md（未编写/待审核）；补写补审 LICENSE → finalize 200 → commit 200；pathspec 含 LICENSE.md（9 文件）不夹带手工 LICENSE（无扩展名）/ evil.txt | P0 | 通过 |
| L3-4 | AI 翻译解锁（A1 口径）：默认 4 类全审、LICENSE 未审 → docs-translate/start 200（提示词与账本均不含 LICENSE） | P0 | 通过 |
| L4-1 | renderDocsPane：LICENSE.md 行出现在默认语言页签面板并带「不分语言」标签；页签计数角标 x/5；门禁条 / 提交按钮 title 缺口含 LICENSE.md（未编写） | P0 | 通过 |
| L4-2 | renderReviewModal：类型页签含 LICENSE（x/1）单栏；栏头标注「不分语言」；编辑 / 预览 / 保存 / 通过审核按钮齐全 | P0 | 通过 |
| L4-3 | renderFinalizeModal：核对清单新增「LICENSE 文件与项目实际开源口径一致」人工核对项；默认语言计数含 LICENSE | P1 | 通过 |
| L6-1 | i18n：新词条中英齐备（未编写 / 待审核 /（未编写）/（待审核）/ 不分语言 / 完核新项 / 提交 title 新句 / 语言集应用 toast 新动态键）；往返不变形 | P0 | 通过 |
| R-1 | 回归：既有 req-20260920-003 / 008 / 010 / 012 的 4×N 计数断言按「4×N + LICENSE」新口径更新后全部跑绿 | P0 | 通过 |
