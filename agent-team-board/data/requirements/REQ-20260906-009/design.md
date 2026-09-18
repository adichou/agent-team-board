# 设计 — REQ-20260906-009 实时状态标志移动到左侧 logo 处右上角叠加显示

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

现状：`scripts/web/index.html` 顶栏结构为 `.brand`（`.logo` ▦ + `.brand-text`）、
`.view-tabs`、`.top-actions`（`#projectSel` + `#pollState` + `#btnNew`）。
实时连接标志 `#pollState`（`●`/`○`，REQ-20260903-002 验收后仅保留圆点图标、
说明放 title）混在右上操作区，与其他操作控件并列，视觉上不构成「状态指示」。

## 方案

纯结构 + 样式调整，JS 轮询逻辑零改动：

1. `index.html`：把 `<span id="pollState" class="poll">` 从 `.top-actions` 移入
   `.brand`，与 `.logo` 同包进徽标容器：
   `<span class="logo-badge"><span class="logo">▦</span><span id="pollState" …>●</span></span>`
2. `style.css`：新增 `.logo-badge { position: relative; flex: none; }`；
   `.poll` 改为角标：`position: absolute; top/right 负偏移`，加 `--panel` 色
   halo（`box-shadow` 圆环）保证绿点压在 logo 靛蓝渐变上仍可辨；
   `.poll.off` 灰色契约保留。
3. `app.js`：不改（仍按 `$('#pollState')` 更新 textContent/title/classList）。

影响面：仅 `scripts/web/index.html`、`scripts/web/style.css` 与新增测试
`scripts/tests/logo-poll-badge.test.mjs`。既有静态契约测试
`layout.test.mjs`（T10 配色/图标）、`portrait-board.test.mjs`（P8 窄屏）、
`topbar-overflow.test.mjs`（#4 `.top-actions` flex:none）均不受影响。

## 风险与边界

- 角标悬垂出 logo 约 3–5px：`.topbar`/`.brand` 无 `overflow: hidden` 裁剪，
  sticky 顶栏 z-index 5，不会被看板内容遮挡。
- 窄屏 ≤640px：`.brand` 仍 `flex: 1 1 auto`，徽标随 logo 缩放位置不变；
  `.top-actions` 只剩切换器与新建按钮，右侧更宽松。
- 离线 `○` 与在线 `●` 同位叠加，仅换字符与颜色，无布局跳动（角标定宽定位于容器）。
