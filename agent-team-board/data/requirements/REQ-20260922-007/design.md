# 设计 — REQ-20260922-007 AI 开发过程中忽略文档的编写差异，不要提交文档到 git。文档有另外的流程提交

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

`scripts/lib/git-flow.mjs` 的 `autoCommitForRun`（批量 run 收口与手动 `/dev` 收口
（`manual-closeout.mjs`）共用内核）以「认领时工作区快照 → 收口时差集」归因，把看板
板根内当前全部脏路径（排除其他条目目录、本单条目目录整体纳入）作为 doc 组提交——
AI 开发期间编写的 `design.md`、`test-cases.md`、条目 README、`test-report.md` 等条目
文档随收口自动入库，与「文档走另外的流程提交」（REQ-20260917-002 文档讨论轮 + 人工
通道）的分工冲突。

## 方案

只动归因分组与完整性判定，不动提交执行、不动两条文档既有通道：

1. **归因忽略（git-flow.mjs / autoCommitForRun 分组循环）**：看板路径分支内，路径属
   本单条目目录（`inItem` 且 `owningItemIdOf` 解析归属本单）且**非重命名（R 码）**的，
   不再进入 doc 组，改记入新集合 `ignoredDocs`——不提交、不还原，保留在工作区。判定
   复用既有 `owningItemIdOf`：留痕文档（confirmations.md / decisions.md）解析为板级共享
   （owner=null）、重命名一律 owner=null，二者自然落回 doc 组照旧收纳，迁移成对入库与
   BUG-20260918-003 出库口径不回归；其他条目目录仍 excluded；看板共享文件仍随 doc 组。
   过渡期旧前缀（docs/agent-team-board/）路径不属新条目目录，行为不变（板级迁移口径）。
2. **结果与账本如实**：`autoCommitForRun` 结果携带 `ignoredDocs`（committed / skipped
   各出口）；`writeAutoCommitLedger` 明细（dispatch 运行目录 auto-commit.json）记录
   `ignoredDocs` 与跳过原因；仅文档改动（plan 为空且无 pendingManual）时 status=
   skipped、原因注明「按 REQ-20260922-007 不随收口提交、保留在工作区走文档流程」，
   commits 为空——徽标账本（commits/runs）只在实际有提交时写入，不误报 committed。
   批量回执 `receipt.autoCommit` 增列 `ignoredDocs`（截断 10 条）。
3. **完整性判定（confirm-store.mjs / commitIncompleteReason）**：`skipped` 且携带
   `ignoredDocs`（即仅条目文档差异被忽略的跳过）视为预期完整收口，不声明「待人工确认
   提交」挂起、不暂停批次——否则每个正常开发轮（都会写 test-cases.md 等）都会被挂起。
   failed / pendingManual / heldGroups 语义不变。
4. **两通道一致**：批量 `finishRun` 与手动 `closeoutManualReport` 复用同一内核，行为
   天然一致；手动通道 CLI 的 skipped 输出走既有 `= 收口提交：<reason>` 分支。
5. **流程表述同步**：根 AGENTS.md、skills/agent-team-board/SKILL.md、
   skills/agent-team-board/dev-closeout.md 中「收口提交含文档」类描述改为「收口只提交
   源码与测试；条目文档（含 test-report.md）不随收口提交，走文档讨论轮（pathspec +
   `doc: … <单号>` 主题）/ 人工通道；板级共享路径仍随收口 doc 组收纳」。
6. **不动**：REQ-20260917-002 文档讨论轮 Bash 放行口径（state-guard.mjs）、
   REQ-20260918-002 根 README 例外、人工确认补交闭环（supplementCommitForRun——人工
   显式确认后的授权提交，属人工通道）、幂等（重复 report / 已入库路径退出脏集合天然
   去重）、pendingManual 暂扣逻辑。

边界决定（README「待确认」项的落地口径，供人工复核）：

- **板级共享路径维持现状仍随收口收纳**：重命名（R 码）、留痕文档出库删除、看板共享
  文件照旧进 doc 组——否则迁移成对入库会断（BUG-20260918-003 口径不回归）。
- **仅文档改动的收口轮**：skipped + 原因如实（不误报 committed、不报错中断、不挂起），
  徽标不点亮；文档经文档讨论轮提交后，git 历史消息含单号，`atb commit log` 自然关联。

**开源选型（REQ-20260909-015）**：无引入开源库——本单为既有收口内核的归因规则调整
（纯 Node 内置实现），无合适库可替代该仓库内部流程逻辑，引入成本高于自研。

## 风险与边界

- 既有测试按旧口径断言「doc 组含条目文档 / 收口后条目目录干净」的（dev-flow、
  auto-commit-pre-dirty、bug-report-closeout 等），随本单同步改为新口径（提交数、
  工作区残留断言）。
- 条目文档自此长期滞留工作区（跨轮持续 dirty）：属预期行为（`atb status` /
  挂起候选扫描会持续列出，直到文档讨论轮提交），不视为遗漏；dev-closeout.md 第 5 步
  核验口径同步改写。
- 收口提交后条目目录仍有未提交差异，可能影响依赖「工作区干净」的外部脚本——仓库内
  无此依赖（CI/发布以 git 历史为准）。
