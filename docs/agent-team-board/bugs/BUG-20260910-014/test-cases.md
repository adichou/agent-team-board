# 测试用例 — BUG-20260910-014 批量 Commit 功能需要有 UI

被测对象：
- 服务接口：`scripts/server.mjs` 新增 `/api/commit/*`（current / create / pause / abort / records / item-status）与 `scripts/lib/commit-store.mjs` 新增只读索引 `committedItemIndex`。
- 前端：`scripts/web/app.js`（任务模块「批量 Commit」子面板 + 已完成条目提交状态徽标/详情）与 `scripts/web/style.css`。

测试文件：
- `scripts/tests/commit-ui-20260910-014.test.mjs`（前端静态契约 + vm 渲染）
- `scripts/tests/commit-serve-20260910-014.test.mjs`（真实 git 临时仓库 + 真实服务进程端到端）

## 用例

| # | 用例 | 断言 |
|---|------|------|
| U1 | 任务模块类型入口 | 一级页签含 `data-bmode="commit"`「批量 Commit」，与批量完善/批量开发并列；`refreshBatch` 分发 commit 模式到 `refreshCommit`；快照恢复 batchMode/commitPane 支持 commit |
| U2 | 启动区（无任务） | 候选计数为「已完成」口径；有候选时「启动」可点；无候选禁用并说明「暂无已完成候选」；说明文案含「只 commit 不 push / 浏览页面不执行提交」 |
| U3 | 创建流程 | `POST /api/commit/create` 带 developer；成功复制提示词；`created:false` 幂等提示不宣称新建 |
| U4 | 运行面板 | 概况（状态 chip/批次号/当前条目/子代理会话/计数行：已提交/异常/待处理）、暂停/恢复、终止（uiConfirm 二次确认）、提示词分区（重新复制）、二级页签（概况/队列/提示词/记录） |
| U5 | Commit 记录渲染 | 记录含结果标签（已提交/失败/已出局/已中断/处理中）、summary/reason、每个提交号完整 hash + 独立复制按钮（data-copy-hash） |
| U6 | 已完成条目徽标 | done 条目默认「未提交」；有核验提交记录显示「已提交」+ 可展开全部提交号；非 done 条目不渲染徽标 |
| U7 | 提交状态加载失败 | 查询失败显示「提交状态加载失败」+ 重试入口（data-commit-retry），不伪装成未提交，不抹掉已成功加载的数据 |
| U8 | 详情页提交状态 | done 条目详情基本信息区含「提交状态」字段：未提交 / 已提交 + hash 列表 / 失败 + 重试；hash 逐个可复制 |
| U9 | 样式 | `.commit-badge` 及三态、`.commit-hash-list/.commit-hash`、`.chip.rs-committed` 样式存在 |
| S1 | item-status 索引 | 无账本时返回空 statuses；提交成功回执核验后返回该条目全部完整 hash（多 run 去重合并）；失败/跳过/中断不产生已提交记录 |
| S2 | current（无批次） | `{ batch: null, stats.candidates }`，candidates=done 条目数（不含已上报待确认） |
| S3 | create + current | create 返回 CMT- 批次号、prompt 含 `atb commit next`、幂等重复创建 `created:false`；current 返回 batch（含 prompt）/counts/records/recordsTotal/pending/nextAction |
| S4 | pause / abort | 暂停→pauseRequested true；终止→aborted、剩余出局；已终止批次再暂停返回 400（不能暂停/恢复） |
| S5 | records 分页 | `offset/limit` 分页可取全部记录，含 commits hash 数组 |
| S6 | 项目隔离 | 未初始化项目（无 dataDir）调用返回 400 错误提示，不落任何账本 |

## 执行与验证记录

见 test-report.md（跑红 → 实现 → 跑绿）。
