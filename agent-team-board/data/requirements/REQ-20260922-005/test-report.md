# 测试报告 — REQ-20260922-005 AI 总结 LICENSE.md 时，要弹框让用户选择开源协议，提供一个表格罗列主流开源协议的定义，官网网址和优劣

- 时间：2026-09-22T05:50:36.429Z
- 执行者：dev-8
- 测试框架：node:test（分层自研断言）
- 覆盖率：12%

## 总结

「AI 总结」时 LICENSE.md 未编写先弹「选择开源协议」框：表格五列（协议/定义/官网/优势/劣势）罗列 11 项主流协议（宽松→著佐权→公共域，SPDX 标识），选中经既有 /api/build/docs/save 白名单通道写入 SPDX 标准文本（scripts/lib/license-catalog.mjs + license-texts/ 内置）转「待审核」后继续总结；暂不选择/关闭不写盘；✕/Esc/遮罩关闭不启动；已编写不弹框。002 口径零改动（publish-flow 未动，LICENSE 仍不进 AI 总结/翻译）。新增 GET /api/build/doc-licenses；i18n 弹框与目录 11 项文案中英同步；自研理由：spdx-license-list 为 CC-BY-4.0 不在白名单，无合适库。测试 11 例先红后绿；npm test 全量 329 文件仅 2 个已知预先存在失败（req-20260918-002、req-doc-entry-20260916-003，与本单无关），另 2 个首跑偶发失败复跑通过（端口/时序，详见 test-report.md）

## 明细

（可粘贴命令输出、失败用例说明等）
