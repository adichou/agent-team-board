# 测试用例 — REQ-20260911-007 受阻待人工决策条目的承接机制：持久呈现、人工决策入口与复工通路

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/hold-20260911-007.test.mjs`（run-all 自动发现）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| D1 | worker 声明：in-progress 条目 `atb hold declare` 两个问题 → holds/holds.json 落 holding（未答 2）、条目目录生成 decisions.md 含问题清单与声明信息、事件留痕 declared | P0 | 通过 |
| D2 | 声明校验：非 in-progress（planned）拒绝；holding 中重复声明拒绝；无问题拒绝；问题文本/数量超限拒绝 | P0 | 通过 |
| D3 | CLI 清单：`atb hold list --json` 输出活动清单（条目/未答计数/声明时间/原因）；无活动时输出空态且退出码 0；`atb hold show` 含问题明细 | P0 | 通过 |
| D4 | 人工作答：answer q1 → 未答 1、decisions.md 更新（答复/作答人/时间）；重复作答覆盖并追加事件；未知 qid 拒绝；允许部分作答（草稿） | P0 | 通过 |
| D5 | 复工闭环：未答完 resume 拒绝并列缺项；答完 resume → 条目 planned 且 owner 清空、history 留痕、认领锁清理、hold 记录 resumed、条目重新进入 candidateItems（可被批量开发取单） | P0 | 通过 |
| D6 | 复工状态校验：条目已被人工确认 done 后 resume → 拒绝并提示状态已变化，不静默变更 | P0 | 通过 |
| D7 | 作废：cancel → holding→cancelled、条目状态不变；此后确认完成不再被拦截 | P1 | 通过 |
| D8 | 多轮承接：resumed 后再声明 → 新一轮（round 2），旧轮进 archived，decisions.md 保留历史轮次 | P1 | 通过 |
| D9 | 存量滞留单：已有 owner 的 in-progress 旧条目（无任何 run 记录）可被声明承接（不要求 --run） | P0 | 通过 |
| P1 | 认领防呆：holding 条目任何 owner（含原 owner）claim 均拒绝并提示「待人工决策（N 项未答）」；resume 后 claim 恢复可用 | P0 | 通过 |
| P2 | 确认完成防呆：未答完 setStatus done 拒绝（提示缺项与处理指引）；force 越过并闭环 hold（closed-done）；答完后 setStatus done 放行并闭环 | P0 | 通过 |
| P3 | 回执向后兼容：声明 hold 后该条目的运行仍可交 blocked 回执（语义不变，declare 与回执正交） | P0 | 通过 |
| G1 | 钩子拦截：Agent Bash 执行 `atb hold answer/resume/cancel` 与 curl POST /api/hold/:id/{answer,resume,cancel} → exit 2 | P0 | 通过 |
| G2 | 钩子放行：`atb hold list`、`atb hold declare`、`atb hold show` → exit 0（worker 声明与查询不被拦） | P0 | 通过 |
| S1 | GET /api/holds：活动清单载荷（itemId/title/state/unanswered/declaredAt/reason/questions）；空时 items 为空数组 | P0 | 通过 |
| S2 | POST /api/hold/:id/answer 保存草稿；resume 齐备 → planned；未齐备 → 400 且状态不变 | P0 | 通过 |
| S3 | /api/board 对 holding 条目附加 hold 徽标数据（unanswered>0）；/api/item/:id 详情含 hold 概要 | P1 | 通过 |
| S4 | POST /api/item/:id/status done：未答完 → 400（错误含待人工决策指引）；force:true → 200 | P0 | 通过 |
| U1 | UI 静态契约：index.html 含待人工确认聚合区与侧拉决策面板容器；app.js 含渲染/作答/复工绑定、复工按钮缺项禁用、确认完成带未答计数的二次确认与 force 提交；style.css 含对应样式 | P1 | 通过 |
| U2 | i18n：新增中文文案均有 EN 词典/动态词条（i18n-coverage 全量测试兜底，此处抽查核心词条） | P1 | 通过 |
| R1 | 全量回归：`npm test`（run-all）既有用例全部通过；既有 blocked/failed 回执、状态机与认领锁行为无回归 | P0 | 通过 |
