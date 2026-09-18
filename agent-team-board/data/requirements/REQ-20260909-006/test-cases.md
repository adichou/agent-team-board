# 测试用例 — REQ-20260909-006 需求 bug 单详情页布局优化，使用页签式布局

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 自动化：`node scripts/tests/drawer-tabs-20260909-006.test.mjs`（静态契约 + vm 行为）；H1–H10 覆盖下列 T1–T11，浏览器实测项标注为人工。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 页签栏结构：drawer-head 之后、drawer-body 之前渲染 `drawer-tabs`，五固定页签顺序为 基本信息 → 说明 → 设计 → 测试用例 → 讨论纪要；`test-report.md` 存在时作为附加页签排在「测试用例」之后，不存在不渲染 | 高 | ✅ |
| T2 | 默认页签与切换重置：初始 state / `openDrawer()` / `closeDrawer()` 均重置 `tab:'info'` 与 `docCache`；上一条/下一条、`data-goto`、下属 Bug 跳转切换条目后回到基本信息，旧条目文档缓存不串显 | 高 | ✅ |
| T3 | 基本信息页签完整：info pane 含 meta-grid、完善徽标、Agent 已上报提示、操作 notice、`.drawer-actions`（上一条/下一条仍在操作行两翼，不进页签栏）、下属 Bug 列表、`batchSettingsHtml`；notice→操作行结构契约不回归（drawer-actions-row / drawer-nav 既有用例保持绿） | 高 | ✅ |
| T4 | 文档页签渲染：说明/设计/测试用例共用 `#docView`，`loadDoc` 渲染 markdown 后经 `linkupDocDemo` 接管相对 `.html` 演示链接（BUG-20260908-021 契约不动）；页签点击绑定 `activateDrawerTab` | 高 | ✅ |
| T5 | 不重复请求：`loadDoc` 成功写入 `docCache`；再次激活已加载文档命中缓存直接回填（不 fetch）；首次激活显示加载态后 `loadDoc` | 高 | ✅ |
| T6 | 缺失文档空态：条目 `docs` 不含该文档时内容区显示「尚未创建」空态，不发请求、不置 `state.drawer.doc` | 中 | ✅ |
| T7 | 讨论纪要页签：需求单 disc pane 含关联讨论列表（`reqDiscussionsHtml`）与 `#reqDocDisc` 文档讨论挂载点（REQ-20260909-003 `ATBReqDisc.mount` 按 id 挂载不回归）；Bug 单显示「暂不支持关联讨论」空态而非空白 | 高 | ✅ |
| T8 | 轮询不重置页签：`renderDrawer` 按 `state.drawer.tab` 恢复页签 active 与 pane 显隐（itemJson 变化触发的重渲染不回跳基本信息）；tab 失效（如文档被删）回落 info | 高 | ✅ |
| T9 | 键盘与焦点：页签为 `<button type="button" role="tab" aria-selected>`，原生 Tab 导航 + Enter/Space 激活；`.drawer-tab:focus-visible` 可见焦点态 | 中 | ✅ |
| T10 | 窄屏换行：`.drawer-tabs` `flex-wrap: wrap`，无横向滚动样式；宽屏并排右栏 / 窄屏覆盖层两形态（1020px 断点）布局类不回归 | 中 | ✅ |
| T11 | 搜索命中定位：文档命中条带点击后 `loadDoc(hitDoc, true)` 经 `activateDrawerTab` 切到对应文档页签（既有调用不回归） | 中 | ✅ |

人工浏览器实测（不在自动化内）：五页签切换交互、深浅色、1020px 断点两形态目检。
