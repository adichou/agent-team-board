# 测试用例 — REQ-20260830-002 File Board：浏览项目相关文件夹并支持语法高亮

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> F1–F7 由 `scripts/tests/file-board.test.mjs` 覆盖（真实起 server + 临时项目）；F8 为回归；F9 为浏览器实测。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| F1 | `GET /api/fs?path=` 列项目根：含 docs 目录与普通文件；目录在前；带 name/dir/size/mtime | P0 | ✓ |
| F2 | `GET /api/fs?path=docs/agent-team-board` 列数据目录（requirements、config.json、README.md 等） | P0 | ✓ |
| F3 | 越界/排除项一律 400：`../`、绝对路径、`docs/../..`、`node_modules/*`、点开头的隐藏段 | P0 | ✓ |
| F4 | `GET /api/fs/file?path=…` 返回文本内容与扩展名（README.md / script.sh / data.json） | P0 | ✓ |
| F5 | >1MB 文件 → 400，错误信息含「1MB」提示，不返回内容 | P0 | ✓ |
| F6 | 二进制文件（含 NUL 字节）→ 400，错误信息含「二进制」提示 | P0 | ✓ |
| F7 | 静态契约：web/ 含 highlight.min.js、两套主题 CSS、wunderbaum.umd.min.js、wunderbaum.css；index.html 引用它们并含 看板/文件 视图 Tab；app.js 使用 mar10.Wunderbaum 与 hljs 高亮 | P1 | ✓ |
| F8 | 回归：multi-project.test.mjs 与 layout.test.mjs 仍全绿 | P0 | ✓ |
| F9 | 浏览器实测：切到「文件」标签 → 树默认展开 docs/agent-team-board → 点需求 README.md 右侧高亮渲染 → 切回「看板」功能正常 | P0 | ◐ |
| F10 | 树主题适配（BUG-20260830-002）：`--wb-*` 变量映射全局双主题变量、选中态主题色半透明、行高 26px | P0 | ✓ |
| F11 | 树零依赖图标：mask 矢量（展开箭头/目录/文件）、展开态旋转、rowHeightPx 与 CSS 同步 | P1 | ✓ |
| F12 | 滚动条主题适配（BUG-20260903-003）：亮色 `:root` 与暗色媒体查询各定义 `--scrollbar-thumb(-hover)`；html 设标准 `scrollbar-color`（继承覆盖文件树/内容区/看板列/抽屉等全部滚动容器）；全局 `::-webkit-scrollbar` 兜底用同一变量、轨道透明——暗色下滑块不再亮白 | P0 | ✓ |

## 执行记录（2026-08-30）

- F1–F7：`node scripts/tests/file-board.test.mjs` 全绿（先红后绿：初跑 7 项全失败——fs API 尚不存在）。真实起 server（随机端口 + 临时项目 + 1.1MB 大文件 + 二进制文件样本）。
- F8：multi-project / layout 两组回归全绿。
- F9（部分通过）：`?view=files` 深链进入文件视图 ✓；树完整渲染且默认展开 docs/agent-team-board（含 requirements/bugs/config.json/README.md）✓；查看器初始提示 ✓。**未完成**：点击树节点后高亮渲染的最终目验——当日 IAB 浏览器输入管线故障（playwright 点击全部超时、截图报 guest 错误、CUA 无法命中虚拟滚动树行），无法模拟点击；该代码路径与已验证的 markdown 文档渲染（loadDoc）同构，服务端文件读取已由 F4 实测。待人工点开一个文件即可确认。
- 过程修复：apiUrl 在已含 query 的 URL 上重复拼 `?project=`（应为 `&`）；Wunderbaum 根节点空 key 被自动改号（改哨兵 key）；事件签名为单参数 `(e: WbNodeEventType)`（非 Fancytree 的 `(e,d)`）；lazyLoad 需 return 节点列表。另：新增 `?view=` 深链（与 `?project=` 组合）；看板列按内容签名增量渲染，消除轮询全量重渲染对点击/拖拽的干扰。

## 执行记录（2026-09-05，BUG-20260903-003）

- F12：`node scripts/tests/file-board.test.mjs` 先红（7 项断言缺 `--scrollbar-thumb`）后绿——实现见 Bug README「修复方案」：双主题变量 + html 标准 `scrollbar-color`（继承统一覆盖所有滚动容器）+ 全局 `::-webkit-scrollbar` 兜底。
- 回归：`run-all` 20 组测试中 19 组全绿；`default-port.test.mjs` V7 为环境性失败（运行中的 Status Board 实例占用 8888，与本改动无关，改动仅涉 style.css 与测试文件）。
- 归因：引入来源 REQ-20260830-002，已核验存在并写入 Bug README「关联（引入来源）」节。
