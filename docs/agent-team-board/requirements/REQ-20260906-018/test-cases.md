# 测试用例 — REQ-20260906-018 批量实施入口改造：已接受列多选后进入，移除顶栏按钮

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/impl-entry-ui.test.mjs`（前端行为 E1–E11）、`scripts/tests/impl-scope.test.mjs`（后端 S1–S6）；
> 既有契约更新：`batch-ui.test.mjs` U1、`codex-ui.test.mjs` U1（顶栏按钮移除）。
> 2026-09-06 修订（人工反馈）：交互改为与批量接受一致的常驻形态，E1–E10 重写、E11 新增，先红后绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| E1 | 静态契约：index.html 无 `#btnBatch`；app.js 无其绑定与任何模式机件（enter/exitImplMode、implEntry/implSelectBar/implCancel）；已接受列常驻工具栏 `#implAll/#implCount/#implGo`；批量接受工具栏不受影响 | 高 | ✅ |
| E2 | 常驻复选框：已接受卡片（含已认领）无需模式即含 `data-impl-id`；开发中/待接受卡片无；syncImpl 同步选中态与卡片 selected 类 | 高 | ✅ |
| E3 | 勾选与全选：change 增删集合、点击不冒泡开详情；全选仅 accepted 且未认领；三态（含 indeterminate）；无可实施条目时全选禁用 | 高 | ✅ |
| E4 | 进入批量实施（有勾选）：POST `/api/dispatch/scope` 带勾选集合（绑定当前项目）并打开共用抽屉 | 高 | ✅ |
| E5 | 进入批量实施（无勾选）：以默认范围打开抽屉，不推送范围、scopeActive 保持 false | 高 | ✅ |
| E6 | 失效剔除：被认领/离开已接受自动移出集合，计数同步、toast 提示；范围已生效时同步推送剔除 | 高 | ✅ |
| E7 | Zcode 页范围：有勾选显示「本批范围」、上限默认取勾选数、create 请求带 `ids`；无勾选无范围行、默认上限 20、create 不带 `ids` | 高 | ✅ |
| E8 | Codex 页范围：status.scope 非空显示范围提示（含恢复默认条件）；空时无范围行；waiting 含 scope-empty 文案 | 中 | ✅ |
| E9 | 切换项目：勾选与范围重置，向旧项目推送空 scope | 中 | ✅ |
| E10 | Esc 链还原：批量抽屉 → 详情抽屉 → 新建弹窗；无多选模式分支，勾选与范围不受 Esc 影响 | 高 | ✅ |
| E11 | 创建面板统计变化触发重渲染：stats 计入轮询签名，切换勾选范围后范围行/上限值/候选数正确刷新（不残留旧 DOM） | 高 | ✅ |
| S1 | createBatch({ids})：候选=勾选集合且保持规范排序；未勾选不入批 | 高 | ✅ |
| S2 | createBatch({ids})：勾选中已被认领的剔除；过滤后空集给明确错误；limit 缺省取集合大小，显式 limit 截断 | 高 | ✅ |
| S3 | GET /api/batch/current?ids=：stats 按集合过滤（候选/受阻），未传 ids 时保持默认口径 | 高 | ✅ |
| S4 | POST /api/dispatch/scope：设置/清除；GET /api/dispatch/status 返回 scope；非数组 ids 400 | 高 | ✅ |
| S5 | 调度选单范围：setScope 后仅领取范围内条目；范围内无可派发时 waiting=scope-empty 不调模型 | 高 | ✅ |
| S6 | disable()（关闭自动派发）清除 scope，恢复默认全部已接受 | 高 | ✅ |
| U1' | 既有 UI 契约更新：顶栏无批量实施按钮（batch-ui U1 / codex-ui U1），已接受列常驻工具栏 | 高 | ✅ |
| B1 | 浏览器实测（8888 实服务）：首版模式交互全流程通过；修订后复测常驻工具栏/复选框（11 卡）、勾选→范围行+上限=勾选数、清空→默认范围（候选 11）+上限 20、Esc 关抽屉勾选保留 | 高 | ✅ |

补充说明：
- 测试先红：E1–E10（首版）与 S1–S6、U1' 在实施前全部失败；修订时 E1–E10 重写与 E11 再次先红后绿。
- `detail-close-btn.test.mjs` T2 为存量失败，对应已登记 BUG-20260906-011，不在本条目范围。
- impl-scope.test.mjs 早期偶发崩溃：用例通过后残留假 CLI 子进程异步回写 stderr 与 rmSync 临时目录竞态；已按 scheduler.test.mjs 惯例改为 `s.stop()` 不删目录，连跑三次与全量回归稳定。
