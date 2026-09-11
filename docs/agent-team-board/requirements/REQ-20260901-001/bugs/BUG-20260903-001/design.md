# 设计/实施记录 — BUG-20260903-001 导航范围随实时状态漂移

> 2026-09-05 由 zcode-drawer-nav-freeze 在 /dev 修复时补写。现象、复现、根因、归因见 README.md。

## 根因

`drawerNeighbors()` 按当前条目**实时** `status` 过滤导航列表，`me.status` 随操作按钮触发的状态流转
实时变化；`navDrawer → openDrawer` 又按目标条目重算，漂移被延续。四列看板无用户自设过滤器，这个
「过滤条件」是隐式绑定在会变的条目状态上的。

## 方案：打开抽屉时冻结导航范围

纯前端 `scripts/web/app.js`，零新 API，server/数据层零改动：

1. 新增 `scopeIdsFor(id)`：按打开时刻看板序取同状态条目 id 序列，作为导航快照；
2. `openDrawer(id, keepScope = false)`：打开时把快照存入 `state.drawer.navIds`；`keepScope=true`
   时沿用既有快照——仅 prev/next 导航传 true；点卡片、点 data-goto 跳转链接走默认重算
   （沿用四次修订「跳转后按新条目重算」的语义）；
3. `drawerNeighbors()`：优先用 `navIds` 快照，剔除已不存在（被删）的单号防点空；快照不可得
   （如打开时看板数据未就绪）回退原实时同状态过滤；当前条目流转后保留其在快照中的位置，
   i/N 不跳变，prev/next 始终落在原列表；
4. `closeDrawer`/重开天然重置快照；`attemptTransition`/轮询只走 `refreshDrawer`，不动快照。

## TDD 执行

- 用例：bug test-cases.md B1–B5（B5 为浏览器实测，留人工）。
- 先红：drawer-nav.test.mjs 重写 D2（范围冻结契约）+ 新增 B1–B3，4 个用例失败；
- 后绿：实现上述方案后 D1–D4 + B1–B3 全绿；`run-all` 18 个测试文件全部通过。

## 影响面

- `scripts/web/app.js`：导航三函数重写 + openDrawer 签名扩展（约 30 行）；
- `scripts/tests/drawer-nav.test.mjs`：D2 重写、B1–B3 新增；
- `style.css`、server、atb CLI 零改动。
