# 测试报告 — BUG-20260920-006 为什么在版本计划详情页面，点击合并到 main 按钮没有响应

- 时间：2026-09-20T16:53:45.723Z
- 执行者：zcode-batch-055-2
- 测试框架：node:assert 自研 runner（vm 假 DOM 前端行为 + 静态契约 + i18n 断言）
- 覆盖率：8%

## 总结

合并入口点击无响应三路径修复：新增 mergeBlockReason 统一求值不可合并真实原因（mergeBusy > merging > 已正式发布 > 五步门禁 > 不在 dev 含分支名），详情页主按钮与卡片行内按钮共用，禁用从 HTML disabled 改 aria-disabled（disabled 不派发 click 是无反馈根因；沿用 BUG-20260913-005 aria-disabled+点击 toast 先例），title 归因与真实原因一一对应不再误回落「前置条件未满足」，两入口可用性/反馈口径一致（选中版本装配已加载时卡片同查门禁与 dev；未加载放行至后端 409+toast）；openMergeConfirm/doMerge 守卫不再静默（版本不存在→提示刷新、合并执行中→勿重复触发 toast），防重复触发仍由 state.mergeBusy 状态守卫保证；style.css .btn 禁用样式扩展 aria-disabled；i18n 新增 9 静态+1 动态词条中英同步。新增 bug-build-merge-click-feedback-20260920-006.test.mjs 8 例全绿（先红后绿）；同步核对 card-acts B2、bug-20260920-005 U1 断言。npm test 293 文件仅 req-20260920-003.test.mjs 失败：既有日期型夹具问题（干净 HEAD 复现，已有登记 BUG-20260921-001），与本单无关。引入来源归因 REQ-20260920-003（详情按钮禁用/title 回落）+ REQ-20260913-004（卡片按钮口径），已写入 design.md。

## 明细

（可粘贴命令输出、失败用例说明等）
