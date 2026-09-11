# 测试报告 — REQ-20260909-012 讨论详情也要支持多页签布局

- 时间：2026-09-09T09:21:10.258Z
- 执行者：zcode-batch-024-1
- 测试框架：node:assert + vm（静态契约/行为测试，npm test 全量 121 文件通过）
- 覆盖率：91%

## 总结

讨论详情页签化：renderDetail 重构为 头部→drawer-tabs 四页签（概况/纪要/成果/提示词，补齐 role=tab/aria-selected/tabpanel）→常驻 #ocNotice + 四分区 hidden 切换；提示词由浮层迁入页签（promptHtml 空态常驻，收起=清展示回默认页签）；成果页签计数角标；openItem/closeDetail 重置默认页签 overview，detailSig 记忆不重置；doFinish/#ocStart/reveal 跳 prompt、doCreate 跳 drafts；仅改 scripts/web/oncall.js + style.css（新增 .disc-empty-prompt），#ocBack/.drawer-back 未动；新测试 T1–T10 跑红转绿，discussion-ui U5 文案断言同步更名

## 明细

（可粘贴命令输出、失败用例说明等）
