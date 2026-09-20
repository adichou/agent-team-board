# 测试用例 — REQ-20260910-003 增加一个全局看板，可以看到当前在工作的批量任务

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| G1 | `/api/batch/global` 聚合全部注册项目：开发批次 + 完善批次同现，字段口径与项目内面板一致（batchId/status/counts/current/developer/createdAt/lastActivityAt） | P0 | 通过 |
| G2 | 已结束（finished）与已终止（aborted）批次不出现；在途（running）批次的当前条目（itemId/title/owner）如实透出 | P0 | 通过 |
| G3 | 未初始化注册项目按「无任务」返回（status=ok、tasks=[]，不报错）；已初始化但无批次的项目 tasks=[] | P0 | 通过 |
| G4 | 单项目读盘失败只影响该项目行：项目目录不存在 → status=error；批次账本 JSON 损坏 → status=error；其余项目正常聚合 | P0 | 通过 |
| G5 | 非队首 prepared 批次标记 queued=true（前端显示「排队中」口径数据源）；pauseRequested 如实透出 | P1 | 通过 |
| G6 | 前端静态契约：主导航含「全局」页签（data-view=global）+ `#globalView` 容器；VIEWS 含 global；MODULE_SUB/搜索占位补齐；renderGlobalView/refreshGlobal 存在且 poll 联动；跳转走 switchProject + gotoRuns；样式类存在（深浅色 CSS 变量） | P0 | 通过 |
| G7 | 前端分支契约：无注册项目引导空态、全部收尾空态、项目错误行（读取失败原因）与筛选 chips / 关键词过滤渲染分支存在；全局筛选进视图快照 | P1 | 通过 |

自动化：`node scripts/tests/global-board-20260910-003.test.mjs`（真实起 server：临时注册表 + 5 个临时项目）。
浏览器实测（UI 布局 / 轮询刷新 / 跳转体验 / 深浅色）按验收标准人工核对。
