# 设计 — REQ-20260830-005 看板卡片一键复制 REQ/BUG 单号

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

单号（REQ-/BUG-YYYYMMDD-NNN）是 `/dev`、`atb` 命令与沟通中的高频输入，卡片上的单号是 11px 小字，手动框选易错。卡片本身有点击（开抽屉）与拖拽（换列）行为，复制交互必须不干扰二者。

## 方案

纯前端，零依赖（浏览器原生 Clipboard API；`http://127.0.0.1` 属安全上下文，`navigator.clipboard` 可用）：

1. **可点区域**：卡片与抽屉详情里的单号 `<span class="cid">` 改为可点击（`role="button"`、`title="点击复制单号"`、hover 显示下划线）。事件在 `cid` 上 `stopPropagation()`，避免冒泡触发卡片打开抽屉；卡片拖拽由 dragstart 驱动，点击不冲突。
2. **复制实现**：优先 `navigator.clipboard.writeText(id)`；异常（非安全上下文/权限拒绝）降级 `document.execCommand('copy')`（隐藏 textarea 方案）；再失败则 toast 提示「复制失败，请手动框选」。
3. **反馈**：成功后该单号短暂（1.2s）变为「已复制 ✓」，期间再次点击忽略；不使用全局 toast（避免遮挡），反馈就地显示。1.2 秒后恢复原文——轮询增量渲染只在列内容变化时重建 DOM，反馈期间列数据未变则不会被冲掉；若恰逢重建，反馈提前消失属可接受的边缘情况（不影响功能）。
4. **覆盖位置**：看板卡片（`cardEl`）、抽屉详情头（`renderDrawer`）、抽屉内下属 Bug 列表的 Bug 单号。File Board 不涉及。

## 影响面

`scripts/web/app.js`（cardEl/renderDrawer 加 cid 复制处理 + `copyId` 函数）、`style.css`（.cid 可点态与「已复制」样式）；新增 `scripts/tests/copy-id.test.mjs` 静态契约。server/数据层不动。

## 风险与边界

- `navigator.clipboard` 在非 HTTPS/非 localhost 下不可用——本服务绑定 127.0.0.1 属安全上下文；仍保留降级与失败提示兜底。
- 反馈 1.2s 与 2s 轮询存在竞争，接受偶发反馈提前消失（见上）。
- 拖拽与点击的浏览器默认竞争：`click` 只在无拖动发生时触发，无需额外处理。
