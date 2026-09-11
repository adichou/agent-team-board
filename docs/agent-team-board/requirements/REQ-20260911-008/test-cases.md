# 测试用例 — REQ-20260911-008 去新建 Zcode 或 Codex 会话自动拷贝最新的提示词

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 实施测试：`node scripts/tests/session-entry-copy-20260911-008.test.mjs`
> （静态可测部分：复制取材/顺序/toast 口径/守卫回退/防重复/零回归；实机深链落点与真实剪贴板为人工项）

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| C1 | 成功-批量完善：点击链接先复制 `state.refine.data.batch.prompt` 原文，再触发深链；toast「已复制提示词并请求打开 XX，请在新建会话中粘贴发送」 | 高 | 通过 |
| C2 | 成功-批量 Commit：取材 `state.commit.data.batch.prompt`，复制后跳深链，toast 同 C1 口径 | 高 | 通过 |
| C3 | 成功-批量开发：取材 `GET /api/batch/prompt`（同「重新复制」口径，不新建批次），复制返回的 prompt 后跳深链 | 高 | 通过 |
| C4 | 先复制后跳转：剪贴板写入先于 `location.href` 赋值（同一点击序列内顺序断言） | 高 | 通过 |
| C5 | 复制失败（copyDispatchText 返回 false）：深链照常打开，toast「复制失败」+ 回面板「重新复制」指引，不静默 | 高 | 通过 |
| C6 | 提示词获取失败（GET 抛错）：深链照常打开，toast「提示词获取失败（原因）」+「重新复制」指引；不出现「已复制」 | 高 | 通过 |
| C7 | 面板无任务/无提示词（存量批次缺失）：不调剪贴板、不报错，深链照常打开，toast「当前面板暂无任务提示词，请先创建任务」 | 高 | 通过 |
| C8 | 守卫不回退：未选项目 / 未检测到对应宿主 → 不复制、不导航，toast 与 BUG-20260910-005 现状一致 | 高 | 通过 |
| C9 | 防重复点击：首次点击在途（等待提示词/剪贴板）期间再点 → 只取一次提示词、只导航一次；完成后 busy 复位可再次触发 | 中 | 通过 |
| C10 | 不干扰：点击不切页签（state.batch.mode 不变）、不重渲染、不刷新批次/队列（spy + 处理器源码契约） | 高 | 通过 |
| C11 | 键盘一致与单一触发路径：preventDefault 被调用，统一走 location.href（Enter 触发 click 同路径） | 中 | 通过 |
| C12 | title 口径：正常态链接 title 更新为「自动复制提示词并打开」口径且含项目路径；不宣称自动新建/自动发送 | 中 | 通过 |
| C13 | 既有复制入口零回归：面板「重新复制」绑定（batchRecopy / batchResumeCopy / refineRecopy / commitRecopy）与 copyDispatchText 不动 | 高 | 通过 |
| C14 | 不自动发送口径：zcode 深链仍 workspace/open、codex 深链仍 threads/new?path=，均不携带 prompt 参数 | 高 | 通过 |
| C15 | i18n 覆盖：新增中文文案（toast/title）均入 EN_DYNAMIC 词典，无缺失（i18n-coverage 卡点） | 中 | 通过 |
