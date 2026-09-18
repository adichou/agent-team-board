# 测试用例 — REQ-20260909-013 隐藏文件模块

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 自动化：`node scripts/tests/hide-modules-20260909-013.test.mjs`（H1–H9）+ `npm test` 全量回归（H10）。
> 深浅色目检、无空占位等视觉项（README 验收末两条）按 design.md「人工核对清单」执行。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| H1 | 顶栏模块导航收敛为 需求/任务/营销/发布/设置；无「讨论」「文件」按钮与空占位（静态断言 index.html） | P0 | 通过 |
| H2 | 旧深链回落：`?view=oncall` / `?view=files` 打开或刷新，state.view 回落 `status`，URL 的 view 参数被清理（replaceState 不再带 view），过程无异常（vm 行为，boot 全量） | P0 | 通过 |
| H3 | setView 兜底：直接 `setView('oncall')` / `setView('files')` 亦回落需求模块并 toast 一次提示；回落走既有容器显隐初始化，不产生空白视图（vm 行为） | P0 | 通过 |
| H4 | 统一新建「类型」仅 需求（REQ）/ Bug（BUG）两项，无 `value="ask"` 选项；需求 / Bug 表单字段与提交按钮不受影响（静态断言） | P0 | 通过 |
| H5 | 需求 / Bug 详情抽屉：页签行无「讨论纪要」按钮、无 disc 分区、meta-grid 无「来源讨论」行；其余 meta 字段与下属 Bug 列表不受影响（vm 行为，renderDrawer） | P0 | 通过 |
| H6 | 打开需求详情后零讨论请求：renderDrawer / poll 链路不再发起 `/api/oncall/tickets` 与 `/api/req-disc`（vm 行为，fetch 记录断言） | P0 | 通过 |
| H7 | 页签失效回落不回归：`drawerTabValid('disc')` 在隐藏态返回 false，激活 / 快照恢复 `tab='disc'` 回落 `info`（vm 行为） | P1 | 通过 |
| H8 | 搜索间接入口：需求视图搜索反馈条不再渲染 `data-goto-view="files"` 的「在文件查看」入口；`data-goto-view="status"` 返回入口模板保留（静态断言 + 行为） | P1 | 通过 |
| H9 | 暂态可逆·服务端零改动：server.mjs 仍注册 `/api/discussion`、`/api/req-disc`、`/api/oncall` 相关路由；`docs/agent-team-board/discussions|oncall` 目录存在且本需求未删改；实现收敛点为单一 `HIDDEN_VIEWS` 开关（静态断言） | P0 | 通过 |
| H10 | 既有断言口径同步更新且不删无关断言：workbench-layout W2/W6/W7/W8/W9/W13、view-tabs-right T5、layout-topbar-rail T3、discussion-ui、global-search-ui、release-sub-generic、settings-simplify、search-module S1、drawer-tabs T1/T5/T7、refresh-restore R3/R6/R7/R9、refresh-default-view R3、new-item-nav N8（`npm test` 全绿） | P0 | 通过 |

## 用例说明

- H2/H3 的「URL 清理」以 `history.replaceState` 桩记录的最终地址串断言（`syncProjectUrl` 在回落后按 `status` 重写，view 参数消失；project 参数保留）。
- H5 的「来源讨论」整行隐藏与 H4 的移除「讨论（ASK）」选项为 README「待确认 2 / 3」的开发阶段裁定，理由记录于 design.md。
- H6 与 REQ-20260909-006 的文档页签失效回落机制（H7）不冲突：文档页签缺失仍走「尚未创建」空态，本需求只收敛讨论侧入口。
