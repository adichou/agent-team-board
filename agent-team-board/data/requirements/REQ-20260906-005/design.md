# 设计 — REQ-20260906-005 需求单详细页面的关闭按钮要固定在单号右侧。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

`scripts/web/app.js` 的 `renderDrawer()` 中，抽屉头部模板为：左块（card-top 单号行 + h2 标题）+
右端 `#drawerClose` 按钮，外层以内联 `display:flex;justify-content:space-between` 两端布局；
`.drawer-head` CSS 本身也是 flex + space-between。结果 `✕` 悬在整块最右端、与两行左块居中，离单号远。

## 方案

把 `#drawerClose` 移入 `card-top` 单号行内、紧随 `.cid` 单号之后（「待确认」flag 之前），并删除
space-between 内联包装层：

- **app.js `renderDrawer()`**：头部模板简化为
  `<header class="drawer-head"><div class="card-top">chip / cid / ✕ / flag</div><h2>…</h2></header>`；
  `#drawerClose` 的事件绑定（click → closeDrawer）位置不动。
- **style.css**：`.drawer-head` 由 flex+space-between 改为纵向普通块（仅保留 padding/分隔线），
  `.drawer-head h2` 规则不变；新增 `.card-top .icon-btn` 行内适配（`flex:none` + 更小的
  padding/字号，避免在 11px 单号行里显大、被压缩）。
- flag 的 `margin-left:auto` 保持——`✕` 在 flag 之前即可稳定贴住单号右侧。

影响面：仅详情抽屉头部；看板卡片、导航按钮、遮罩/键盘关闭逻辑均不动。

## 风险与边界

- `.card-top` 在卡片（board）与抽屉（drawer）两处复用——样式改动用 `.card-top .icon-btn` 限定作用域，
  卡片侧无 icon-btn，不受影响。
- 极窄窗口下单号 + `✕` + flag 同行可能拥挤：单号不换行（现有 `.cid` 行为），flag 可被推到边缘；
  验收已含窄窗口不破版。

## 实施记录

**2026-09-06（会话 REQ-20260906-005，TDD）**

1. **测试先行**：新增 `scripts/tests/detail-close-btn.test.mjs`（静态契约测试，T1–T4），首跑 T1/T2/T4 红（T3 为存量行为回归守卫，始终绿）。
2. **实现**：
   - `scripts/web/app.js` `renderDrawer()`：头部模板改为 `<header class="drawer-head"><div class="card-top">chip / cid / ✕(drawerClose) / flag</div><h2>…</h2></header>`，删除内联 `display:flex;justify-content:space-between` 包装层；`#drawerClose` 增加 `aria-label="关闭"`。
   - `scripts/web/style.css`：`.drawer-head` 去掉 flex/space-between（保留 padding 与底部分隔线）；新增 `.card-top .icon-btn { flex:none; padding:2px 4px; font-size:14px; }` 行内适配。
3. **测试结果**：新测试 4/4 绿；`scripts/tests/run-all.mjs` 全量回归 24 个测试文件全部通过，0 失败。
4. **浏览器实测（B1，127.0.0.1:8888 内置浏览器）**：
   - 普通条目（REQ-20260906-005）：单号行 DOM 顺序 `chip → cid → ✕`，`✕` 与单号同行、右侧间距 6px，标题独占下一行；
   - 「待确认」条目（REQ-20260830-004）：行顺序 `chip → cid → ✕ → flag`，`✕` 仍紧贴单号（6px）未被 flag 挤走，flag 靠行右缘；
   - 交互：点击 `✕` 关闭抽屉 ✓；`Escape` 关闭 ✓（document keydown 路径，本次未改动）；遮罩点击绑定存量保留；
   - 窄窗口 640px：`✕` 仍在单号行内、未越出视口、与标题无重叠。
5. **部署形态说明**：插件缓存目录与本仓库为同 inode 硬链接，改动即时对运行中的 8888 服务生效，浏览器刷新即可见。

