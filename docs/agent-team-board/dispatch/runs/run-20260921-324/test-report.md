# REQ-20260921-012 测试报告 — 发布模块文档编写三阶段流程

- 执行：zcode-batch-059-09（批次 batch-20260921-059，run-20260921-324）
- 测试文件：`scripts/tests/req-20260921-012.test.mjs`（18 例，TDD 先红后绿）
- 框架：node:assert/strict + node:http 真实服务 + vm 前端函数提取（仓库既有分层口径）
- 全量：`npm test` 305 个测试文件，失败 0（本单调整既有 8 个受影响测试文件后全绿）

## 实施范围

### 阶段一：默认语言先行
- `buildDocSummaryPrompt` 文档清单收窄为默认语言（语言集首语言）4 文件；`createSummaryRun`
  账本只装默认语言文件（进度 x/4）；任务模块与全局面板计数联动。

### 阶段二：AI 翻译与审查
- 新账本 `scripts/lib/docs-translate-store.mjs`（runId 前缀 tr-，独立锁 translate.lock，
  与 summary / impl / refine 互不占用；单语言集报错；中断不悬挂可续跑）。
- 新提示词 `buildDocTranslatePrompt`：以已审核默认语言文档磁盘全文为唯一翻译基准，
  目标 = 剩余语言全部文件（4 × (N−1)），atb translate 逐文件回执。
- 新 CLI `atb translate start/file/done/fail/show`（start 门禁：默认语言 4/4 已审核，
  启动前 mtime 基准变更检测）；cli-registry 注册新命令组。

### 阶段二审查
- `evaluateDocsFlow` 扩展七态：剩余语言 未翻译/正在翻译/已翻译待审核（reviewed 共用）；
  审查对话框沿用（N 栏同步滚动、编辑已审核保存回退待审核；直接审查路径保留）。

### 基准变更检测（mtime 对比，本轮落定口径）
- `detectBaselineShift(langs, statFile)` 纯函数：同类型文件两两对比，默认语言文档 mtime
  严格晚于剩余语言文档 → 该文件回退「未翻译」（未审核）、整体完结失效；mtime 相同 /
  stat 缺失不回退。检测注入全部服务端求值入口（publish-plan / docs / langs / review /
  save / commit / finalize / 轮询），不依赖审查界面保存按钮。

### 阶段三：整体审查完结
- `build-store.recordDocsFinalize` 落 `v.review.finalized`（langsKey + 全文件 hash 快照）；
  有效性实时求值（语言集变化 / 文件回退 / scopeStale / 基准变更即时失效回退）。
- `canCommit` = 全部已审核 + 完结有效（在原门禁之上叠加，不弱化）；`docs/commit` 增加
  完结缺口错误分支；新端点 `POST /api/build/docs/finalize`。

### 服务接口与前端
- 新端点：`docs-translate/start`（门禁 + 基准提示）、`docs-translate/current`；
  `docs-summary/current` 响应增加 translate（单次 15s 轮询同吸两 run）；publish-plan
  增加 translate 视图；全局任务聚合加入 translate 简报。
- build.js：阶段条（① 默认语言先行 → ② AI 翻译与审查 → ③ 整体审查完结）、六按钮
  （新增 AI 翻译 / 整体审查，aria-disabled + title 缺口）、文件列表按语言成组、门禁条
  分组计数 + 完结缺口 + 基准变更提示、完结对核对话框（renderFinalizeModal）、翻译提示词
  预览、完结终态标识；style.css 新样式。
- app.js：任务模块「AI 翻译」页签 + renderTranslatePanel/refreshTranslate；全局面板
  kind=translate（标签 / 筛选 / tr- 前缀兜底 / 计数口径已翻译）。
- i18n.js：新增静态 / 动态词条中英同步；旧门禁动态键随口径迁移清理。

## 用例分层（18 例）

| 层 | 例数 | 覆盖 |
| -- | ---- | ---- |
| L1 纯逻辑 | 6 | 七态枚举 / 分组求值 / 总结收窄与翻译提示词 / canTranslate / mtime 检测（含相同与缺失不回退）/ canFinalize·finalized·canCommit（scopeStale、语言集变化失效） |
| L2 数据层 | 4 | 翻译账本与独立锁 / 进度回执与收尾 / 完结记录 / 总结账本收窄（含 en 首语言） |
| L3 服务接口 | 1 | 三阶段门禁全链路：翻译 start 门禁与重复拒绝、current 进度、全审未完结提交 400、finalize 200、提交 200 pathspec 八文档、外部修改默认语言文档后基准变更命中与完结失效 |
| L4 前端契约 | 4 | renderDocsPane 三阶段视图 / 三按钮禁用态缺口 / 完结对核对话框 / 审查对话框七态与轮询吸收 |
| L5 任务面板 | 1 | AI 翻译页签与全局 kind=translate 静态契约 |
| L6 i18n 与回归 | 2 | 新词条齐备与旧键清理、往返不变形；evaluateDocsState / publishStepsState 零改动 |

## 既有测试调整（README 验收「同步调整」口径）

- req-20260921-008 / 010：总结账本与提示词随范围收窄（8 → 4）；提交前先整体完结；
  门禁断言改分组计数；i18n 旧门禁键清理断言。
- req-20260920-003：提交链路插入 finalize；外部修改场景按基准变更联动重写（重译重审
  重新完结再提交）。
- req-20260920-004：cli-registry 新增 translate 命令组（分组数 12）。
- build-serve：commitDocsFor 插入 finalize。
- bug-20260921-004 / copy-rename / lane-quick-entry：提取函数清单与静态契约随新 UI 更新。

## 结论

新增 18 例全部通过；`npm test` 305 文件 0 失败。提交与合并门禁在原「全部已审核」之上
叠加整体完结条件，未弱化既有门禁（evaluateDocsState / publishStepsState 零改动回归通过）。
