# 测试用例 — REQ-20260906-021 文件模块支持文件切换自动换行模式

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 实现载体：`scripts/tests/file-board.test.mjs` 新增 W 系列（沿用该文件的
> 源码结构契约 + CSS 契约 + 真实 server 回归风格）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| W1 | 结构契约：横幅状态含 `wrap` 字段（`newBannerState`，默认 false）；源码视图工具条渲染 `data-wrap-toggle` 按钮（文案显示目标态「自动换行/不换行」、带 aria-pressed），渲染态 md / 图片分支不渲染该按钮 | 高 | 通过 |
| W2 | 结构契约：`buildCodeView` 接收 wrap 并挂 `.file-code` 的 `wrap` class；`openFile` 源码视图调用点（非 md 与 md 源码态共用）把 `state.banner.wrap` 传入 viewerBarHtml 与 buildCodeView，渲染态调用不传（按钮隐藏）；`bindFileViewerOnce` 委托含 `data-wrap-toggle` 分支（翻转 `state.banner.wrap` 后按 activeFile 重开，实现跨文件保持） | 高 | 通过 |
| W3 | CSS 契约：`.file-code.wrap pre` 软换行（white-space: pre-wrap + overflow-wrap: anywhere）；`.file-code.wrap .code-lns` 隐藏（display: none）；按钮选中态 `.file-viewer-acts .btn[aria-pressed="true"]` 取主题色 | 高 | 通过 |
| W4 | 回归：默认（无 wrap）路径不变——`/api/fs/file` 文本契约 F4 仍通过、hljs 高亮调用保留、行号槽 `.code-lns` 与 data-line 复制契约保留（R5 不回归） | 中 | 通过 |

TDD 记录：W1–W3 首轮跑红（wrap 字段 / buildCodeView 签名 / CSS 规则缺失），
W4 为回归守卫首轮即绿；实现后 file-board 27 用例全绿，`npm test` 46 个测试
文件失败 0。W2 断言曾在写用例阶段修正一次：openFile 实际只有一个源码视图
调用点（非 md 与 md 源码态共用 fall-through），非「两处调用」，断言改为
「源码视图调用传 wrap + 渲染态调用不传」更贴合真实结构。
