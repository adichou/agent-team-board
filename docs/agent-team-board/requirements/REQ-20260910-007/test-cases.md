# 测试用例 — REQ-20260910-007 支持快捷键

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

自动化载体：`scripts/tests/shortcuts-20260910-007.test.mjs`（vm 行为测试 + 静态契约，K1/K2/K9/K10
静态断言 index.html / style.css / app.js，K3–K8 行为断言 keydown 派发）。K11 为人工离线验收。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| K1 | 顶栏有「快捷键 ?」帮助入口（#btnShortcuts，type=button 可键盘访问）；搜索框容器内有 `/` 键位提示（kbd） | 高 | ✓ |
| K2 | 帮助面板 #shortcutHelpWrap：role=dialog + aria-modal，列出 `/ ? ←/→ Esc Tab` 五组键位、作用与生效条件，含输入态限制说明与始终可达的关闭按钮 | 高 | ✓ |
| K3 | `/` 聚焦当前模块搜索框：正常路径 preventDefault + focus；输入框 / contenteditable / 组合输入 / 任一弹窗开启 / 设置模块（搜索隐藏）不触发且不吞字符（不 preventDefault） | 高 | ✓ |
| K4 | `?` 打开帮助：焦点进入面板；重复按键不重开（不叠加、不重复聚焦）；关闭恢复打开前焦点，入口失效回落帮助按钮；带 Ctrl/Meta/Alt 不触发 | 高 | ✓ |
| K5 | Tab / Shift+Tab 圈定：焦点在末元素按 Tab 回绕首元素、Shift 反向；面板中间元素不拦截；面板外焦点拉回面板内 | 高 | ✓ |
| K6 | `←/→` 详情导航守卫：正常路径沿用冻结范围与边界停止（首条再按 ← 不动）；新建 / 项目管理 / 确认弹层开启、e.repeat、isComposing、Ctrl/Meta/Alt 均不切换 | 高 | ✓ |
| K7 | Esc 分层一次关一层：帮助 > 项目管理 > 新建弹窗 > 抽屉；既有优先级不回归（impl-entry-ui E10 兼容） | 高 | ✓ |
| K8 | 单次触发与零业务请求：document 级 keydown 注册点唯一；`/ ? Esc` 按键路径不产生任何业务请求，处理器内无 api/批次启动调用 | 高 | ✓ |
| K9 | 样式：.kbd-hint 键帽样式；帮助面板窄屏可滚动（max-height + overflow）且头部关闭按钮 sticky；按钮 :focus-visible 键盘焦点样式 | 中 | ✓ |
| K10 | 抽屉导航按钮标注方向键：title 含「已是第一条 / 最后一条」边界提示与快捷键说明，aria-keyshortcuts 声明 ArrowLeft/ArrowRight | 中 | ✓ |
| K11 | ui-demo.html 可离线直接打开，帮助、状态切换（正常/空/加载/失败）与失败重试可鼠标 + 键盘演示（现状基线，人工验收） | 中 | 待人工验收 |
