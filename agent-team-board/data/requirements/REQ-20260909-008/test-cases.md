# 测试用例 — REQ-20260909-008 任务界面采用多页签布局优化

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/tasks-tabs-20260909-008.test.mjs`（静态契约 + vm 行为）；
> 1020px 窄屏换行与深浅色外观为人工浏览器实测（同 REQ-20260909-006 口径）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| N1 | 一级页签独立保留：renderBatchDrawer 仍渲染 `.tabs.batch-modes` 行与「批量完善 / 批量开发」两枚 `data-bmode` 按钮；二级页签行位于一级页签之后、内容区之前 | 高 | 通过 |
| N2 | 批量开发运行态渲染二级页签：`task-subtabs` 页签行（role=tablist）含「概况 / 队列 / 提示词 / 记录」四枚 button[role=tab][aria-selected]（顺序正确、默认概况激活），及四个 `task-pane` 分区（role=tabpanel，data-pane=overview/queue/prompt/records），同一时刻仅概况分区无 hidden | 高 | 通过 |
| N3 | 批量完善运行态同样渲染二级页签（scope=refine），结构与 N2 一致 | 高 | 通过 |
| N4 | 启动态与加载态不拆二级页签：无任务（启动区 + 队列单屏）与数据未到达（加载中）输出均不含 task-subtabs / task-pane | 高 | 通过 |
| N5 | 二级页签独立记忆：state.refine.pane 与 state.batch.pane 互不影响（develop 切 queue 不动 refine，反之亦然）；无效 pane 值回落「概况」 | 高 | 通过 |
| N6 | activateTaskPane 切换行为：更新 active/aria-selected/hidden，scope 隔离（只动本面板页签与分区）；纯前端不发起任何请求（fetch 计数为 0）；无效 pane 回落概况 | 高 | 通过 |
| N7 | 内容归组（批量开发）：概况 = 状态行 + 通知条 + meta-grid + 计数行 + 操作（暂停后续领取/终止任务/排队新批次/删除本批次 + 终态启动新一轮）+ 暂停说明；队列 = 排队批次（含删除）+ 待开发队列；提示词 = 主调度提示词块（重新复制/复制续接/打开工作区）；记录 = 四列表格（含重新执行）；各关键操作 id 在整个面板中只出现一次 | 高 | 通过 |
| N8 | 内容归组与空态（批量完善）：概况含 refinePause/refineAbort/meta-grid；队列在终态给空态说明；提示词缺失（b.prompt 为空）时页签保留并显示空态说明；记录空态沿用「暂无执行记录」 | 高 | 通过 |
| N9 | 键盘可达：二级页签为原生 `<button type="button">` + role=tablist/tab/tabpanel + aria-selected；CSS 有 :focus-visible 可见焦点态 | 高 | 通过 |
| N10 | 窄屏与视觉层级：`.task-subtabs` flex-wrap 换行、无横向滚动；二级页签下划线式（区别于一级胶囊式）；`.task-pane` 分区样式存在 | 中 | 通过 |
| N11 | 存量 Codex 执行记录深链兼容：renderBatchDrawer 保留 `mode === 'codex'` 渲染分支（renderCodexPanel），该分支不引入二级页签 | 高 | 通过 |
| N12 | 轮询与草稿保护不回归：refreshBatch/refreshRefine 签名比对机制保留（签名无变化不重渲染）；bindBatchDrawer 绑定 `.task-pane-tab` 点击走 activateTaskPane | 高 | 通过 |
| N13 | 现有功能零回退（控件清单）：启动态 refineCreate/refineMode/refineDev、devMode/devStart；终态 devNextMode/batchNext、refineNextMode/refineNext；运行态 batchPause/batchAbort/queueNewBatch/batchDelete、refinePause/refineAbort；提示词 batchRecopy/batchResumeCopy/batchOpenZcode/refineRecopy；记录 data-retry-run；条目跳转 data-goto-item；排队批次 data-del-batch 均在对应渲染输出中出现 | 高 | 通过 |

人工浏览器实测（不在自动化范围）：
- 窄屏（≤1020px）两级页签行换行、不横向滚动、不遮挡操作；
- 深浅色外观（沿用现有 CSS 变量，不新引入配色）；
- 2 秒轮询下输入开发人员 / 选择执行 Agent 不被打断（签名 + 草稿保护）。
