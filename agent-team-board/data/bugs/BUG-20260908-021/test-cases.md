# 测试用例 — BUG-20260908-021 需求详情中的交互 Demo 相对链接打开后返回 404

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：插件 `scripts/tests/item-demo-link.test.mjs`（npm test 自动纳入聚合）。

## 端点行为（真实起 server，临时项目）

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| D1 | 条目目录内 `ui-demo.html` 经 `/api/item/:id/demo/:name` 返回 200，Content-Type `text/html; charset=utf-8`，字节与源文件一致；响应带 nosniff 与收敛 CSP（含 `default-src 'none'`、`script-src 'unsafe-inline'`、`style-src 'unsafe-inline'`，保证内联交互可用且无外部加载） | P0 | 通过 |
| D2 | 同名演示文件在不同条目返回各自内容（不串单）；用 A 项目的条目号配 `?project=B` 请求 → 404（不串项目） | P0 | 通过 |
| D3 | 演示文件不存在 / 条目不存在 → 404 人读 HTML 提示页（含文件名与条目号，明确说明原因） | P0 | 通过 |
| D4 | 非法名称一律拒绝：带子目录 `sub/x.html`、穿越 `..%2F..%2FREADME.md`、非 html 后缀 `notes.md`、隐藏文件 `.hidden.html`、空名 → 400 提示页，不泄露文件内容 | P0 | 通过 |
| D5 | 演示文件超 2MB → 400 提示页，说明大小上限 | P1 | 通过 |
| D6 | 站点根 `/ui-demo.html` 维持既有 404（serveFile 行为不变，修复不在静态路径展开） | P1 | 通过 |
| D7 | 回归：`/api/item/:id/doc/README.md`（JSON）、`/api/fs`、`/api/fs/raw`（图片 + CSP 白名单）行为不受影响 | P0 | 通过 |

## 前端接线（结构契约 + vm 行为）

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| U1 | app.js 定义 `linkupDocDemo`；`loadDoc` 渲染 markdown 后调用它（`#docView` 内链接接管） | P0 | 通过 |
| U2 | `linkupDocDemo` 只接管「单文件名 `.html`/`.htm`」相对链接（`./ui-demo.html`、裸 `ui-demo.html`），改写为 `/api/item/<id>/demo/<name>`（经 apiUrl 携带当前 project）；http(s) 链接、`#` 锚点、带子目录/越出条目的相对路径保持原行为 | P0 | 通过 |
| U3 | 被接管的链接设 `target="_blank"` 与 `rel="noopener noreferrer"`（新标签打开，演示页拿不到看板页引用） | P1 | 通过 |
| U4 | vm 行为级：提取 `linkupDocDemo` 在 DOM stub 沙箱执行，逐链接断言改写/跳过结果 | P1 | 通过 |

## 边界与保护（验收标准映射）

- README 源文件 `./ui-demo.html` 写法不变（测试不改动任何条目 markdown 源）。
- 演示端点与看板管理接口隔离：只读 GET、`.html`/`.htm` 白名单、2MB 上限、realpath 越界检查、nosniff + CSP（`connect-src` 随 `default-src 'none'` 收敛 → 演示页 fetch/XHR 被禁，无法触达看板管理 API）。
