# 测试用例 — REQ-20260906-010 文件栏支持 md、图片的渲染展示。并支持复制目录和行号到剪贴板以便在讨论对话框中讨论

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 实现载体：`scripts/tests/file-board.test.mjs` 新增 R 系列（沿用该文件的
> 真实 server 集成 + 源码结构契约两种风格）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | `/api/fs/raw` 返回图片原始字节与正确 Content-Type（png=200 image/png，字节一致） | 高 | 通过 |
| R2 | raw 白名单：jpg/jpeg/gif/webp/svg/ico/bmp/avif 放行各自 MIME；非图片后缀（.sh/.json）400 且提示仅支持图片 | 高 | 通过 |
| R3 | raw 安全：越界/绝对路径/node_modules/不存在/目录/超 8MB 一律 400；响应带 nosniff 与收紧 CSP | 高 | 通过 |
| R4 | 结构契约：app.js 定义 IMAGE_EXT 并在 openFile 分流图片（引用 /api/fs/raw），md 默认 renderMd 渲染且支持源码/渲染切换 | 高 | 通过 |
| R5 | 结构契约：源码视图行号槽（.code-lns + data-line）经 #fileViewer 事件委托复制 `路径:行号`；工具条有「复制路径」按钮（copyPlain 剪贴板降级） | 高 | 通过 |
| R6 | 结构契约：既有源码高亮路径不回归（openFile 仍 hljs.highlightElement；/api/fs/file 文本契约 F4 不变） | 中 | 通过 |
| R7 | CSS 契约：.file-viewer-bar/.code-lns/.ln（可点击、主题变量配色）/.file-image（max-width:100% + 居中）样式齐备 | 中 | 通过 |
| R8 | index.html 查看器占位文案提及图片预览与行号复制（提示可发现性） | 低 | 通过 |

TDD 记录：R1–R5/R7/R8 首轮跑红（raw 404 / 结构契约缺失），R6 为回归守卫首轮即绿；
实现后 file-board 19 用例全绿，`npm test` 43 个测试文件失败 0。
