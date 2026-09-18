# 测试用例 — REQ-20260910-016 排序菜单放到搜索框左侧，因为都是用于定位单号的

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/sort-locate-group-20260910-016.test.mjs`（S1-S6）；
> 存量契约随迁：`caption-two-row-20260909-009`（C1/C4）、`caption-toolbar-20260910-008`（L1/L5）、
> `search-module-20260910-009`（S10 窄屏断言）改为「排序不在列表工具栏 / 定位组承载」的新口径。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | HTML 静态结构：#pageHead 内定位组容器（.locate-group）先 #reqSort 后搜索组（#searchInput 在其后，Tab 顺序排序→搜索）；#reqSort 五选项、aria-label「列表排序」、初始 hidden；#reqCaption 不再含 #reqSort 且无占位空洞（reqCount/全选/全不选/右组/快捷入口与顺序保留） | 高 | 通过 |
| S2 | CSS 契约：.locate-group flex + align-items:center + wrap + min-width:0 + 靠右（margin-left:auto）；.page-head .module-search 不再自带 margin-left:auto；≤720px 定位组独占整行、组内排序仍在搜索左侧（搜索可伸缩非 100% 强制换行） | 高 | 通过 |
| S3 | 显隐同步行为：需求模块且已初始化时 #reqSort 可见；切其他模块隐藏；切回需求恢复且当前排序值保留；未初始化/无项目时隐藏；setView 与 renderBoard 均接入同步函数（静态契约） | 高 | 通过 |
| S4 | 排序交互不回退：change 后更新 state.reqSort、记忆 localStorage、触发重排（renderBoard）；不清空搜索词、不改变状态筛选档 | 高 | 通过 |
| S5 | 布局稳定不回退：搜索范围标签 / 清除按钮 / Esc 与 / 快捷键仍绑定于 #searchInput（静态契约不回退）；#searchFeedback 仍在 #pageHead 之后独立成条 | 中 | 通过 |
| S6 | ui-demo.html 离线自包含：条目目录存在、README 有相对链接；无外链资源；含排序 / 搜索 / 清除 / 模块切换与 正常/空/加载/失败 四态 | 中 | 通过 |
