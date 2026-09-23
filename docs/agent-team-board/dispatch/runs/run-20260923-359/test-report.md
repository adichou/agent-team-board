# 测试报告 — REQ-20260923-003 md-rich mermaid 图表配色随看板深浅色外观自适应

- 时间：2026-09-23T13:20:00Z
- 执行者：zcode-batch-067-1
- 测试框架：node:test 风格分层测试（run-all.mjs 聚合）
- 覆盖率：90%

## 总结

mermaid 配色外观自适应：md-rich.js initialize 新增 themeVariables 深浅两套（透明底保持无底色，文字/边框/连线/子图描边/标题按外观取亮深两档，靛蓝边框贴近品牌色），外观判定每次渲染时现读 darkMode()，系统切换仍由既有 change 监听重绘；根 README.md（1 处）与 DESIGN.md（4 处）移除全部 %%{init}%% 写死配色指令，看板预览完全随外观自适应，GitHub 等外部渲染走 mermaid 默认主题。新增 5 例测试先红后绿，全量 339 个测试文件 0 失败；深浅两套其余既有行为（strict / 手动渲染 / 回退 / 幂等）由 BUG-20260923-002 既有用例回归覆盖。

## 用例结果（scripts/tests/req-20260923-003.test.mjs）

- 红：实现前 L1-1 断言失败（initialize 缺 themeVariables），退出码 1。
- 绿：
  - L1-1 深色套：matchMedia matches:true → theme=dark，primaryTextColor=#d1d5db、primaryBorderColor=#a5b4fc、primaryColor=transparent
  - L1-2 浅色套：缺省沙箱 → theme=default，primaryTextColor=#475569、primaryBorderColor=#818cf8、primaryColor=transparent
  - L1-3 两套全量对照：clusterBkg / edgeLabelBackground 双透明；lineColor、clusterBorder、titleColor 深浅分档（#94a3b8/#374151/#e5e7eb 与 #9ca3af/#e2e8f0/#334155）
  - L2-1 外观判定每次渲染时读取：同上下文翻转 matchMedia 后重渲染，两次 initialize 取值随之切换
  - L3-1 发布文档无写死配色：README.md / DESIGN.md 不匹配 /%%\{init/，mermaid 围栏保留
- 回归：`npm test` 全量 339 个测试文件失败 0（含 bug-20260923-002.test.mjs 全部 18 例）。

## 说明

- 覆盖率 90%：新增代码路径（MERMAID_VARS 两套 + initialize 分支 + 渲染时现读）已 100% 用例覆盖；剩余为浏览器内深浅外观的目视验收（人工测试步骤，见 design.md 验收节）。
- 未改动：mermaid vendor、四宿主接入、renderMd 消毒口径、i18n 文案（本条目无新增界面文案）。
