# 测试报告 — BUG-20260925-002 文档编写中 AI 校对的建议接收后点击刷新，又会再提示，但修改后报错。

- 时间：2026-09-24T17:15:33.426Z
- 执行者：zcode-batch-001-1
- 测试框架：node:test 风格分层用例（vm 提取 + HTTP 服务 + git 夹具）
- 覆盖率：13%

## 总结

校对建议决断持久化到服务端账本（docs-check-store run.json decisions + POST /api/build/docs-check/decision + 视图 decisions/supersededDecided），前端 ensurePublishPlan/startProofread/summaryPoll 三处 seedChkDecisions 重播种，整页刷新 / 切版本决断不丢、④ 门禁不回退；acceptChkSuggestion 定位失败先 alreadyAppliedChk 区分「此前已应用」（✓ 反馈标 accepted 不误报）与「人工修改」（仍标过期不覆盖）；新 run 旧决断维持 runId 绑定并加侧栏可感知失效说明；i18n 中英同步；新测试 13 例先红后绿，npm test 350 文件全通过；另登记新问题 BUG-20260925-003（EN_CLI 词条运行时不翻译）。

## 明细

（可粘贴命令输出、失败用例说明等）
