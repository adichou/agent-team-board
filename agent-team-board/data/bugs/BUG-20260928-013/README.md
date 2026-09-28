# BUG-20260928-013 发布流程删除官网 content/ 双语成对内容文件的强制检查

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-28T14:34:12.030Z

## 现象

创建发布 v1.0.0 预检失败：✕ 发布失败：缺少：content/agent-team-board/changelog/v1.0.0.zh.md、content/agent-team-board/changelog/v1.0.0.en.md、content/agent-team-board/faq.zh.md、content/agent-team-board/faq.en.md、content/agent-team-board/support.zh.md、content/agent-team-board/support.en.md、content/agent-team-board/docs/ 的中英成对文档（如 docs/quick-start.zh.md 与 docs/quick-start.en.md）。期望：删除对这类文件（content/<产品id>/ 下 changelog/faq/support/docs 中英成对 md）的检查，发布流程不再强制要求它们存在。

## 复现步骤

1.

## 期望行为
