# 测试报告 — REQ-20260906-008 需求和文件切换栏移到智能体团队看板右侧，使用切换样式

- 时间：2026-09-06T15:01:39.940Z
- 执行者：zcode-batch-002-01
- 测试框架：node:assert 静态契约测试
- 覆盖率：83%

## 总结

「需求/文件」切换栏移到顶栏右侧：index.html 将 nav.view-tabs 移入 .top-actions 首位（项目选择器之前），顶栏变为左品牌/右动作组两端布局；style.css 为 .view-tab 增加 background-color/color/box-shadow 0.18s 平滑过渡，沿用 REQ-20260906-001 靛蓝分段切换样式（淡靛蓝底槽+胶囊+激活态填充白字）；窄屏 ≤1020 左缘竖排与 --viewrail-h 机制零改动。新增契约测试 view-tabs-right.test.mjs（T1-T5 先红后绿）；全量回归 43 个测试文件中 42 通过，唯一失败 detail-close-btn.test.mjs 为批量抽屉内联布局导致的既有回归，与本条目无关，已登记 BUG-20260906-017。

## 明细

（可粘贴命令输出、失败用例说明等）
