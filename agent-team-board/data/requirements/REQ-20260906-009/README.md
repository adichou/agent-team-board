# REQ-20260906-009 实时状态标志移动到左侧 logo 处右上角叠加显示

- 状态：submitted（待人工接受）
- 创建：2026-09-06T03:37:46.654Z

## 描述

看板顶栏的实时连接状态标志（`#pollState`：在线 `●` 绿 / 离线 `○` 灰）目前位于右上
操作区 `.top-actions`（项目切换器旁）。将其移动到左侧 logo（`.logo` ▦）的右上角，
以角标（badge）形式叠加显示：徽标容器 `position: relative`，状态点绝对定位负偏移
叠在 logo 右上角。作用：连接状态紧邻品牌标识、减少右上操作区元素数量。

## 验收标准

- [ ] `#pollState` 从 `.top-actions` 移出，渲染在 `.brand` 内 logo 的徽标容器
      （`.logo-badge`）中，`.logo-badge` 为 `position: relative`，`.poll` 为
      `position: absolute` 负偏移，叠加显示在 logo 右上角
- [ ] 配色契约不变：在线 `.poll` 绿（`var(--done)`）、离线 `.poll.off` 灰
      （`var(--muted)`）；悬停 title 提示保留
- [ ] `app.js` 轮询逻辑不变（仍按 `#pollState` 更新 textContent / classList / title）
- [ ] 窄屏（≤640px）下徽标随 logo 正常显示，不遮挡标题与操作区（`portrait-board`
      既有契约不回归）
- [ ] `npm test` 全量通过，新增 `scripts/tests/logo-poll-badge.test.mjs` 覆盖
