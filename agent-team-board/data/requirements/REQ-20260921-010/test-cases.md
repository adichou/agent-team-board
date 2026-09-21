# 测试用例 — REQ-20260921-010 文档编写界面提供一个输入框，允许输入国际化语言集

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/req-20260921-010.test.mjs`（分层 L1 纯逻辑 / L2 数据层 / L3 服务接口 / L4 前端契约 / L6 i18n）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1-1 | normalizeDocLangs：默认 `cn,en`；空白容错与大小写归一（`CN, en`→`cn,en`）；空值 / 空项 / 非 2–3 字母 / 重复项报错且文案明确 | 高 | 通过 |
| L1-2 | publishDocFiles / docFileOf / isPublishDocFile：首语言无后缀 `README.md`，其余 `README_en.md`、`README_fr.md`（下划线）；`cn,en,fr,jp` 共 16 文件；白名单按语言集判定 | 高 | 通过 |
| L1-3 | docLangsOf：`v.langs` 合法则用之；缺失 / 非法回退默认 `cn,en` | 高 | 通过 |
| L1-4 | readmeDocLinks：README 按语言链接同语言 CHANGELOG / FEATURES（`README_fr.md → CHANGELOG_fr.md、FEATURES_fr.md`） | 高 | 通过 |
| L1-5 | buildDocSummaryPrompt({langs})：文档清单按语言集展开（16 行）、措辞含「4 类 × 4 语言」、README 链接行随语言命名 | 高 | 通过 |
| L1-6 | evaluateDocsState / evaluateDocsFlow：行数 = 4×N；reasons / 计数不硬编码 8；语言集变化后新文件从缺失 / 未总结起步 | 高 | 通过 |
| L1-7 | publishScopeFingerprint：语言集不同（文件清单不同）指纹不同 | 中 | 通过 |
| L2-1 | build-store.saveDocLangs：合法保存并回显 `v.langs`；merging / pushed 拒改；非法语言集报错不改盘 | 高 | 通过 |
| L2-2 | recordDocsReview / recordDocsCommit 白名单按语言集：`README_fr.md`（fr 在集合）可审核可记录；不在集合的文件拒绝 | 高 | 通过 |
| L2-3 | docs-summary-store：createSummaryRun({langs}) 账本按 4×N 展开；markSummaryFile 拒绝集合外文件；summaryRunView.counts.total 动态 | 高 | 通过 |
| L3-1 | POST /api/build/docs/langs：保存后 publish-plan 回显 langs；非法 400；merging 409 | 高 | 通过 |
| L3-2 | GET /api/build/docs + save / review：`README_fr.md` 在 `cn,en,fr` 下可用，默认语言集下 400 | 高 | 通过 |
| L3-3 | docs/commit：三语言 16 文件全审核后提交成功，pathspec 仅含 16 个语言集内文件（不夹带业务源码），无变化 noop | 高 | 通过 |
| L4-1 | renderDocsPane：语言集输入框（data-pf-langs）默认值 / 回显 / 行内错误；文件列表行数随语言集（16 行）；门禁计数 `X/16` | 高 | 通过 |
| L4-2 | renderReviewModal：页签计数 `n/N` 按语言集；README 页签出现 `README_fr.md` 列（全语言列，非固定双栏） | 高 | 通过 |
| L4-3 | 客户端校验镜像 validateLangSet：空 / 空项 / 非法 / 重复被拦截且不触发保存请求 | 高 | 通过 |
| L6-1 | i18n：新增词条（语言集标签、校验错误、应用反馈、动态计数门禁）中英同步；固定「八个 / 8」旧词条随界面更新清理 | 高 | 通过 |
| 回归 | 存量测试迁移：publish 流相关测试的 `.en.md` 夹具改 `_en.md` 命名（req-20260920-003 / req-20260921-008 / build-serve），`npm test` 全量通过 | 高 | 通过 |
