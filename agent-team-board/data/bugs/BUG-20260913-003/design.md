# 设计 — BUG-20260913-003 bug 单的文档也要支持讨论菜单，参考需求的文档

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260909-014（经 `atb list` 核验存在）。该需求为需求单文档建立右键「讨论」菜单时，
  `onDocCtxMenu` 入口以 `type !== 'requirement'` 显式排除非需求条目，未覆盖 Bug 单；
  而 Bug 单详情抽屉自 REQ-20260909-006（经核验）起与需求单同构持有「说明 / 设计 / 测试用例」文档页签，
  两单组合形成本缺口（文档路径硬编码 requirements 亦由 REQ-20260909-014 引入）。

## 根因分析

`scripts/web/app.js` 两处：

1. `onDocCtxMenu` 入口门槛 `if (state.drawer.item?.type !== 'requirement') return;`——文档级 contextmenu
   委托对 Bug 单详情抽屉直接短路，自定义菜单永不弹出。
2. `docRefPath(projectRoot, itemId, name)` 硬编码 `docs/agent-team-board/requirements/<单号>/<文档名>`。
   Bug 单真实磁盘位置（`scripts/lib/core.mjs` `resolveItemDir`）为 `docs/agent-team-board/bugs/<编号>/`
   （独立）或 `docs/agent-team-board/requirements/<REQ 编号>/bugs/<编号>/`（归属需求），
   即使放开门槛，复制出的路径也是错的。

## 方案

**开源选型（REQ-20260909-015）**：纯前端少量逻辑改动，复用既有 `openDocCtxMenu` / `buildDocRef` /
`copyPlain` / `uiCopyBox` 链路，无合适且必要的开源库可引入（引入成本远高于自研几行路径拼装），
不创建 licenses.md。

定稿实现（均在 `scripts/web/app.js`）：

1. `onDocCtxMenu`：类型门槛由「仅 requirement」改为白名单 `requirement | bug`（讨论等其他类型抽屉不启用），
   其余校验链（#docView 内、链接/图片放行、加载中/空态/失败态不弹、preventDefault 位置）零改动。
2. `docRefPath` 增加第 4 参 `parent`（Bug 单归属需求编号，取 `state.drawer.item.parent`，与 status.json /
   `core.mjs moveBug` 写入口径一致）：REQ 前缀走原 `requirements/<单号>/`；BUG 前缀且 parent 非空走
   `requirements/<parent>/bugs/<编号>/`；BUG 前缀 parent 为空走 `bugs/<编号>/`。调用点传入 parent。
3. 菜单浮层、复制链路、toast / 手动复制兜底、收起通道全部复用既有实现，无新增文案（i18n 无需改动）。

## 风险与边界

- 需求单右键「讨论」行为零回归：`docRefPath` 对 REQ 前缀与旧实现逐字节一致；既有测试
  `doc-ctx-discuss-20260909-014.test.mjs` 仅 T5 的类型门槛断言随口径更新，其余断言不动。
- 讨论等其他类型抽屉不受影响（白名单制，不放开全类型）。
- 独立 / 归属 Bug 的路径差异依赖 `parent` 字段与磁盘真实位置一致（`moveBug` 写入时同步维护，
  `resolveItemDir` 按同口径解析）；极端数据不一致（parent 缺失但实际嵌套）按独立 Bug 拼装，不引入额外探测请求。
