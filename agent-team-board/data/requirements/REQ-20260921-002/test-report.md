# 测试报告 — REQ-20260921-002 分支浏览提交记录升级为 git 提交树可视化并支持搜索

- 时间：2026-09-21T01:22:42.706Z
- 执行者：zcode-batch-059-01
- 测试框架：node:test（vm 沙箱 + 真实临时 git 仓库 + fake GitgraphJS 注入）
- 覆盖率：18%

## 总结

分支浏览右栏升级为 vendored @gitgraph/js 1.4.0 提交树（git2json import 扁平 DAG：泳道/圆点/分支名/tag 标签/message+短hash，浅深双色板随 prefers-color-scheme 重画，vendor 失败降级行式列表）；搜索升级双模式——highlight 数据集不变+matchedHashes 高亮滚动定位、filter 匹配∪祖先闭包保留集分页（matchedTotal/allTotal 计数）；数据层复用 branch-log 链路附 tags（for-each-ref 解引用 annotated）；i18n 中英同步并清理断档虚线旧词条；自研 logGraph/graphSvg 随渲染层替换移除；条目目录维护 licenses.md（vendor 例外口径）

## 明细

（可粘贴命令输出、失败用例说明等）
