# BUG-20260907-011 测试用例

方案：`initFileBoard` 的幂等短路不再直接 `return`，改为调用新增的后台重拉函数
`refreshBannerLayers()`——对当前层栈（`state.banner.layers` 快照）逐层重新
`fetchDirEntries` 更新 `state.banner.entriesByPath` 后 `renderBanner()`。
单飞（`state.banner.refreshing` 标记）防并发重复拉取；单层失败保留该层旧缓存，
整体不抛错；首次初始化路径（`openDirLayer('')` + 默认展开）不变。

| 编号 | 类型 | 用例 |
| ---- | ---- | ---- |
| C1 | 自动 | 结构契约：`app.js` 存在 `async function refreshBannerLayers`；旧幂等直返 `if (state.banner.initialized) return;` 退役，改为短路时调用 `refreshBannerLayers()` 后 return；单飞标记 `state.banner.refreshing` 存在且 `newBannerState` 含 `refreshing: false` |
| C2 | 自动 | 行为（vm 沙箱真实执行 `refreshBannerLayers`）：对层栈每层各拉取一次并更新 `entriesByPath`（外部新增文件 tiny.png 可见）、随后 `renderBanner()` 一次；`refreshing=true` 时再调用不重复拉取（单飞）；单层拉取失败时该层保留旧缓存、其余层照常更新、`refreshing` 复位 |
| C3 | 自动 | 回归：首次初始化契约保留（`await openDirLayer('')` + `ATBBanner.DEFAULT_PATH` 逐层展开仍在 `initFileBoard`）；file-board.test.mjs 既有 B/W/G 契约全部不回归 |
| M1 | 人工 | ZCode 内置浏览器实测：文件视图打开 → 项目根外部写入新文件 → 切「需求」再切「文件」→ 横幅出现新文件，无需整页刷新 |
