# 设计 — BUG-20260910-007 这里的操作按钮去掉中文，全部用图标表示，然后移到和单号同行

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260910-006（经 `atb list` 核验存在，状态 in-progress）。该单把复制按钮并入 `.row-acts`
  并将操作区设计为不可拆分整体，其规范明确「宽度不足时允许整个操作区移至下一行」「不要求信息、完整单号
  与全部操作强制挤在同一行」，同时保留四个按钮的中文文案——本 Bug 的两个现象（操作区独立占一行、按钮
  带中文）由该布局定型。中文文案本身更早来自 REQ-20260906-006（「复制」）与 REQ-20260906-020（「✓ 接受」
  移入单号行），REQ-20260910-006 将其集成为当前操作区形态；归因以布局定型单 REQ-20260910-006 为准。

## 根因分析

- `scripts/web/style.css` 的 `.card-top` 全局 `flex-wrap: wrap` 叠加 `.req-row .row-acts { flex: none; margin-left: auto }`：
  宽度不足时操作区作为不可拆分整体整体落到单号下一行，独立占据一行、拉高卡片。
- `scripts/web/app.js` 的 `reqRowEl` 操作区模板输出「复制」「✓ 接受」「✎ 修改」「🗑 删除」中文文案，
  四按钮约 260px 宽，进一步加剧换行概率。该表现是 REQ-20260910-006 的规范内行为（明确允许整体换行、
  保留文字），属需求口径与用户期望的偏差，而非实现走样。

## 方案

1. 模板（`app.js` `reqRowEl`）：复制/接受/修改/删除改为纯图标按钮 `⧉ / ✓ / ✎ / 🗑`（沿用项目既有按钮
   字形风格），统一加 `icon-act` 类；aria-label 保持「动作 + 单号」并为四按钮补 title 悬停提示（复制按钮
   title 含单号）。按钮顺序与 submitted 显隐规则不变；点击绑定（stopPropagation 防打开详情、删除确认弹窗、
   接受防重复提交）一律不动。`copyIdBtnHtml(id, { icon })` 增加图标模式，仅列表行操作区使用。
2. 同排布局（`style.css`）：`.req-row .card-top { flex-wrap: nowrap }` 使勾选框/单号/操作图标同一工具行、
   垂直居中；标题仍独占下一行。极窄容器：`.req-row .item-id { flex: 0 1 auto; min-width: 0 }` +
   `.cid { text-overflow: ellipsis }` 单号显式省略（`reqRowEl` 给 `.cid` 补 title 全量单号，悬停可看完整值），
   `.row-acts` 保留 `nowrap / max-width:100% / overflow-x:auto` 局部横向滚动，不产生页面级横向溢出。
3. 图标尺寸：`.req-row .row-acts .btn.icon-act` 定宽小方格（min-width 26px、min-height 24px），四按钮等宽
   等高；复制反馈图标（⧉→✓）切换不改变行宽。
4. 复制反馈不回填长文案：`copyId` 识别 `icon-act` 分支——图标位换 `✓` + 就近 title「已复制 <单号>」，
   1.2s 后恢复原图标与原 title；详情抽屉等单号内嵌文本复制按钮仍用「已复制 ✓」文案（范围外不动）。
5. 清理：`.card-accept-btn, .card-rename-btn` 旧尺寸规则并入 icon-act（仅保留禁用态规则）；
   `.req-row .row-acts .copy-id-btn` 旧尺寸规则由 icon-act 取代。
6. 测试：新建 `scripts/tests/bug-row-acts-icon-20260910-007.test.mjs`（B1–B8，先红后绿）；同步 4 个既有
   断言（`req-row-actions-inline` H1/H2、`copy-id` C1/C2/C5/C6、`pending-accept-inline` T4、
   `edit-content` U1/U6）到图标口径。

**开源选型（REQ-20260909-015）**：未引入开源库。图标为 Unicode 字形（⧉/✓/✎/🗑，与项目既有按钮字形一致），
纯模板/CSS 调整即可达成；引入图标库（lucide、font-awesome 等）的体积与改造成本高于四个字形，属「引入成本
高于自研」。未使用开源库，不创建 licenses.md。

## 风险与边界

- 图标语义改由 title/aria-label 承载，新用户需悬停了解含义——四按钮均已提供悬停提示与可访问名称；
  键盘焦点/顺序沿用原生 button 与既有 focus-visible 规则。常规/极窄宽度与深浅色呈现待人工浏览器验收
  （README「待确认」项），本单以静态契约锁定关键规则（nowrap、ellipsis、局部滚动、定宽）。
- `.card-top` 的 nowrap 仅限 `.req-row` 范围；详情抽屉（`.drawer-head > .card-top`）与 oncall 卡片布局不受影响。
- 复制成功反馈的 1.2s 内，复制位 ✓ 与相邻接受位 ✓ 短暂并存：复制位带 `.copied` 绿色态与 title 区分，
  属可接受折中（避免把长文案塞回工具行，README 明确要求）。
