# 测试报告 — REQ-20260920-003 构建和发布流程整改（run-20260920-307）

- 日期：2026-09-20　执行：zcode-batch-054-2
- 新增测试：`scripts/tests/req-20260920-003.test.mjs`（TDD 先红后绿，22 例：L1 纯逻辑 10 /
  L2 数据层 3 / L3 Git 隔离 6 / L4 服务接口 1（全链路多断言）/ L5 前端契约 2）
- 全量回归：`npm test` → **290 个测试文件，失败 0**（完整输出见同目录 test-output.log）
- 覆盖框架：Node 内建 `node:test` 风格自研 runner（assert/strict + 临时 git 仓库 + HTTP 实测，
  与仓库既有测试同构）

## 交付内容

1. `scripts/lib/publish-flow.mjs`（新增）：版本号提取、八文档清单与 README 互链、AI 写作 /
   官网写作双提示词、计划号边界匹配、官网时间窗扫描（预算 / waiting / scanning / missed / hit）、
   文档状态机、范围指纹、五步门禁。
2. `scripts/lib/build-git.mjs`：`assertOnDev`（非 dev / detached 阻止，提示自行切回）、
   `analyzePublishIsolation`（未选祖先 + 混合提交阻止）、`mergeIsolatedIntoMain`（临时工作树
   cherry-pick -x 重放隔离合并 + replays 证据 + 冲突中止）、`pushMainBranch`（只推主分支）、
   `siteMainLog` / `siteEvidenceReachable`（官网本地主分支读取，main 优先 master 回退）、
   `commitPublishDocs`（pathspec 限定八文档，无变化不空提交）。
3. `scripts/lib/build-store.mjs`：docs / release 状态（范围变化 scopeStale、推送起点同基准不
   重置、官网检测落盘）、`assertMergeDocsGate` 合并门禁、`saveMergeReplays` 累积落账。
4. `scripts/server.mjs`：`GET /api/build/publish-plan`、`GET|POST /api/build/docs`、
   `POST /api/build/docs/commit`、`POST /api/build/docs/open-ide`（TRAE CN / TRAE）、
   `POST /api/build/release/push`、`POST /api/build/release/site-scan`（60s 间隔 + force 立即检测 +
   常驻提示）；`/api/build/version/merge` 改隔离流程（dev 前置 → 文档门禁 → 混合提交阻止 →
   cherry-pick 重放 → replays 落账）。
5. 发布检验适配重放证据：`build-publish.mjs`（BPUB create/precheck/refreeze）与
   `product-release-git/pipeline/store`（PREL：verifyItemsOnMain 认可重放祖先、额外提交剔除
   重放、frozen.replays）。
6. 前端：顶栏「构建」→「发布」；详情五步导航（版本计划 / 关联条目与提交 / 文档编写 / 合并入
   main / 正式发布）；文档页（AI 写作提示词 + TRAE 入口 + 文档语言选择 + 编辑预览 + 保存 +
   提交文档到 Git + 状态与过期原因）；合并页（范围 + 隔离分析 + dev 前置）；正式发布页（推送主
   分支 → 官网提示词 → 60s 检测轮询 + 立即检测，离开即停止；常驻「不代表已推送 / 部署」提示）；
   产品发布记录并入第 5 步；样式与窄屏纵向堆叠；i18n 中英文同步。
7. 条目文档：design.md（方案与取舍）、test-cases.md（22 例全表）补齐。

## 受影响既有测试（同步更新，均因行为按需求变化）

- build-ui（N1/N3 导航与搜索更名「发布」；N7a 关联列表在「关联条目与提交」步）
- build-serve（合并前置需八文档提交；包含性断言改重放证据）
- product-release-serve / product-release-pipeline / product-release-git / product-release-store
  （fixture 落回 dev + 文档提交；重放证据回归）
- mgt-auto-commit R3（fixture 改 dev + 文档基线提交）
- bug-release-tab-inplace（「概况 / 发布」页签 → 五步导航；R5d 已发布断言收窄为状态 chip）
- bug-build-ver-card-acts / bug-build-ver-published-chip / build-release-card-items-search
  （详情分步后的结构断言）
- bug-commit-hash-display T6（'已提交' 以发布文档状态 chip 静态键重新入 EN）
- i18n-dict / i18n-coverage（新词条；值唯一性冲突已修正）

## 验收对照（README 验收标准）

已覆盖：入口更名与版本号显示（含前导零）、五步前置约束与空计划锁、AI 写作提示词与八文档编辑 /
README 互链、预览编辑双语保存与 TRAE 入口（未安装明确提示手动路径）、文档提交只含八文档展示
hash / 无变化不空提交 / 未提交与过期不放行合并、增删条目换 hash 与外部修改重新校验、A 不随 B
入 main（cherry-pick 隔离）且文档提交不夹带、混合提交与依赖冲突阻止并解释、dev 未提交 / 暂存
修改保持与重复操作禁用、非 dev 分支与 detached 阻止合并推送、主分支只新增所选与最新文档、先推
主分支再官网步骤（不推 dev 不强推）、官网提示词口径、60 秒检测 / 立即检测 / 本地事实源提示 /
完整计划号匹配 / 三态可区分、推送成功时间持久保存与页面重载不重置、批量预算（scanning 不伪报
未命中）、证据失效退回等待、正常空加载失败与文档过期可验证、中英文同步。

说明（实现口径，非缺口）：重试幂等由「只补未合并条目 + replays 按 original 累积」保证；官网
HEAD 增量读取为优化项未实现（每轮按预算重读时间窗口，语义与验收一致）。
