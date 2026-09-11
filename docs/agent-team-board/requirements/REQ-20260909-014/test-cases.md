# 测试用例 — REQ-20260909-014 需求模块详细页面的说明，设计，测试用例文档支持右键菜单“讨论”

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 自动化：`node scripts/tests/doc-ctx-discuss-20260909-014.test.mjs`（静态契约 + vm 纯函数）；
> 浏览器实测（菜单视觉定位/深浅色/窄屏）：人工目检，见 test-report.md。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | parseDocBlocks 1 基源行块解析：标题/多行段落合并、列表吸收缩进栅栏、松散列表跨空行合并、表格/引用/围栏/hr 行范围正确（对齐 marked 顶层节点） | 高 | ✓ |
| T2 | annotateDocLines 顶层元素按序配对写 data-doc-start/end/kind；文本子序列校验失准即停止标注（宁缺勿错，不给错行号） | 高 | ✓ |
| T3 | docSelLines 段落/围栏代码内按换行精确映射行；跨块与列表/表格等富文本回退整块行范围 | 高 | ✓ |
| T4 | buildDocRef/docRefPath：有选中＝单号+文档名+行范围+绝对路径+原文；无选中＝路径+行号（无「原文」节）；行范围文案「第 x–y 行 / 第 x 行」 | 高 | ✓ |
| T5 | 右键入口契约：document 级委托仅 #docView 内、需求单、当前文档页签就绪时拦截弹菜单；链接/图片/文档区外/未创建/加载中放行原生；纯前端无任何 api/fetch 调用 | 高 | ✓ |
| T6 | loadDoc 渲染后调 annotateDocLines 且 docCache 存标注后 HTML（缓存回填保留行标注）；renderDrawer/activateDrawerTab/closeDrawer 主动收起菜单 | 高 | ✓ |
| T7 | 菜单浮层：单例复用重定位、视口边缘内收不溢出；外部 pointerdown/Esc/任意滚动/resize 关闭且不执行；打开注册的监听随关闭清理 | 中 | ✓ |
| T8 | 复制链路：走 copyPlain 双回退；成功 toast「已复制 引用：<文档> 第 x–y 行」；失败 toast+页内自绘只读文本域手动复制引导（不用 window.prompt——IAB 内会冻结） | 高 | ✓ |
| T9 | 样式契约：.doc-ctx-menu/.doc-ctx-item 用面板变量体系（--panel/--border/--shadow）、focus-visible 可见焦点、不新引入配色 | 中 | ✓ |
| T10 | 配对前提：真实 marked.min.js 对夹具（含列表内缩进栅栏、松散列表）的顶层块级节点数与 parseDocBlocks 块数一致 | 高 | ✓ |
