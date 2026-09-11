# 测试报告 — BUG-20260907-016 我不是要去掉全部需求的过滤条件，而是去掉“全部”这个过滤条件

- 时间：2026-09-07T15:00:20.276Z
- 执行者：zcode-batch-008-01
- 测试框架：node 契约/沙箱测试（npm test）
- 覆盖率：100%

## 总结

恢复需求模块第四行状态筛选条并去掉「全部」档（REQ-20260907-004 的 filterBar 机制恢复为五档 chips：待接受/已接受/开发中/待测试/已完成，默认选中第一档「待接受」）；index.html 恢复 #filterBar，app.js 恢复 REQ_FILTERS/renderFilterBar/reqFilter/applyReqFilter/点击委托，style.css 恢复 .filter-bar/.filter-chip/.filter-count；勾选与批量资格（submittedItems/implCandidates）改为不随档位收窄（仅叠搜索），避免默认档下勾选被剪枝清空；空态文案恢复「当前筛选与搜索下没有条目」。专属测试 req-filter-removed.test.mjs 重写为五档契约（5 用例先红后绿），同步更新 workbench-layout W5、confirm-lane T3/T5、pending-alignment R5、view-tabs-style V3、refresh-default-view 初始 hidden 集，npm test 65 文件全部通过。引入来源：REQ-20260907-006（标题歧义致实施解读为整条移除筛选条，经 atb list 核验）。

## 明细

（可粘贴命令输出、失败用例说明等）
