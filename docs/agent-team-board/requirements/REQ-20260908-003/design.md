# 设计 — REQ-20260908-003 支持待接受的需求删除

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

看板没有条目删除能力（批次删除 REQ-20260907-013 只删批次账本，不动条目）。误登记的单据
只能接受后走完流程或永久滞留在「待接受」列。删除属人工清理操作，仅限尚未进入流程的
submitted 状态；与 REQ-20260907-011（待接受改标题）同一交互范式：core 能力 + server 路由
+ 网页入口 + CLI 子命令。

## 方案

**分层实现（对齐 rename 的既有模式）**：

1. `core.deleteItem(dataDir, id, { by })`（`scripts/lib/core.mjs`，紧跟 `renameItem`）：
   - `resolveItemDir` 定位目录（同时覆盖顶层 requirements/bugs 与需求下嵌套 bugs）；
   - `readStatus` 校验仅 submitted 可删，否则 `AtbError`（错误话术指引走驳回/新单路径）；
   - 需求目录下 `childBugs()` 非空则拒绝（提示先删除下属 Bug 或移动归属），避免连带销毁；
   - `fs.rmSync(dir, { recursive: true, force: true })` 物理移除条目目录；
   - 返回 `{ id, title, type, dir }` 供 CLI/网页回显。单号计数器（config.json）不动——
     单号单调递增不复用，历史单号引用（如 dispatch 账本）不会撞新单。
   - 无需 history 留痕：status.json 随目录一起删除，看板层面不留墓碑；追溯依赖 git 历史
     （docs/ 随代码进版本控制）。
2. server（`scripts/server.mjs`）：`DELETE /api/item/:id` 路由，紧邻既有 title/status
   条目路由；成功 200 返回 `{ ok: true, id, title }`，`AtbError` 走统一 400。跨站防护
   `apiGuardReason` 对全部 `/api/*` 先行生效，DELETE 方法同样受 Origin/Host 校验保护，
   不需要新增防护逻辑。
3. 网页（`scripts/web/app.js`）：
   - 卡片 `reqRowEl` 的 submitted 分支新增「🗑 删除」按钮（`data-delete-id`），与
     「✓ 接受 / ✎ 改标题」并列；点击 `stopPropagation` 不冒泡打开详情。
   - 详情页 `drawerActionsButtonHtml` 的 submitted 分支同样追加删除按钮。
   - `deleteItem(id)`：`uiConfirm({ danger: true })` 页面内确认（文案说明不可恢复）→
     `api(\`/api/item/${id}\`, { method: 'DELETE' })` → toast → `poll()` 刷新；若抽屉正
     展示该条目则 `closeDrawer()`。`bindDeleteButtons` 绑定两处入口（卡片 + 抽屉）。
   - 批量接受勾选集合随轮询剪枝，删除后无需显式清理 `acceptance.selected`。
4. CLI（`scripts/atb.mjs`）：`atb delete <ID>` 分发 `core.deleteItem`；usage 登记。删除为
   人工操作，Agent 侧依旧遵循「不代替人工处置条目」的看板纪律。

## 风险与边界

- **不可逆**：物理删除目录、看板无撤销。缓解：danger 确认对话框 + 文案明示；git 历史兜底。
- **并发窗口**：确认期间条目被他人接受（submitted → accepted）→ 服务端状态校验拒绝，
  toast 报错，界面经 poll 回到真实状态；确认期间被删 → 下一轮 poll 卡片消失。
- **归属 Bug 残留**：需求删除守卫要求先清空下属 Bug，杜绝父目录连带删除导致的孤儿 Bug。
- **计数器不复用**：已回收单号不重复发放，引用旧单号的讨论/账本不会错位。

## 实施记录

- 2026-09-08（zcode-batch-011-1）：按上述方案实施；测试
  `scripts/tests/item-delete.test.mjs`（core / server HTTP / CLI 静态 / UI 静态+沙箱，
  模式对齐 rename-reject.test.mjs）。
