# 测试用例 — REQ-20260910-026 全选和全不选使用图标，去掉文字，然后把操作按钮和开始完善按钮放在同一行

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/caption-toolbar-icons-20260910-026.test.mjs`（用法：`node scripts/tests/caption-toolbar-icons-20260910-026.test.mjs`）。
> 既有回归 `selection-lane-scope` S1 的静态文字断言随图标化同步修正（README 已列为开发阶段事项），
> 其语义（成对全选 / 全不选入口 + 点击绑定）不变。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 全选 / 全不选图标化静态契约：`#selectOperable` 内容仅 ☑、`#selectNone` 内容仅 ☐（无中文文字），均保留 `aria-label="全选"/"全不选"` 与 `title` 完整语义（「仅勾选当前筛选档内可见的可操作条目…叠搜索范围」「仅取消当前筛选档的勾选」口径不变），type=button、两按钮 class 一致 | P0 | |
| T2 | 图标按钮等宽尺寸：`.req-caption .btn.icon-act` 规则存在，min-width / min-height 定宽等高、text-align 居中（沿用 BUG-20260910-007 行内图标口径，两按钮尺寸一致、垂直居中） | P1 | |
| T3 | 同一行绑定静态契约：`#selGroup` 与 `#laneQuickEntry` 同处 `#captionActions`（.caption-actions）容器且 批量组 → 快捷入口 顺序；容器 display:flex、flex-wrap:nowrap（恒不拆散到两行）、margin-left:auto（空间足够时整组靠右）、flex:none；`.sel-group` 仍 wrap 且无 margin-left:auto；`.req-caption` 仍 wrap 非 column（整组换行兜底、不横向滚动不裁切） | P0 | |
| T4 | 行为语义零变化（vm 模拟）：多轮 syncAcceptance / 全选 / 全不选 / 批量进行中后两图标按钮 textContent 恒为 ☑ / ☐（无代码写回文字）；三选择档图标按钮可见、非选择档隐藏；全选叠搜索仅勾当前档可见可操作项、全不选仅清当前档（其他档保留）；零勾选禁用全不选、无可操作项禁用全选、批量进行中两者禁用；勾选首项 #selGroup 出现、清零隐藏；快捷入口按档显隐与文案（▶ 开始完善 / ▶ 开始开发）、批量进行中不禁用 | P0 | |
| T5 | ui-demo.html 离线自包含：条目目录存在 ui-demo.html，无外链 script/link/@import/网络 url；含调整前 / 调整后对照、☑ / ☐ 图标按钮（aria-label 保留）与同行容器演示（same-row nowrap） | P1 | |
