# BUG-20260913-006 批量实施 auto-commit 漏提交业务源码：预留时已脏的 build.js 永远不入任何单的提交，HEAD 上已提交的 test/biz 组合自相矛盾 zcode-batch-047-1

- 状态以本条目 status.json 和看板为准。
- 归属：独立 Bug（引入来源见 design.md：快照差集归因机制由 REQ-20260911-009「dev 分支开发 + 到待测试自动 commit」引入）。
- 创建：2026-09-13T13:33:02.947Z。

## 现象

批量批次 zcode-batch-047 中，BUG-20260913-004 与 BUG-20260913-005 两单的 auto-commit fix 组都只含 `scripts/web/i18n.js` + `scripts/web/style.css`，两单实施中对 `scripts/web/build.js` 的改动始终留在工作区：

- 004（run-20260913-215）：doc f164e80 / test aeb07f9 / fix 69db12b（fix 组仅 i18n.js + style.css）。
- 005（run-20260913-216）：doc aa0666b / test 33eaada / fix 6729acb（fix 组仅 i18n.js + style.css）。
- 两单的 auto-commit 明细（`docs/agent-team-board/dispatch/runs/run-20260913-215|216/auto-commit.json`）中 build.js 既不在提交组、也不在 excluded——符合 git-flow.mjs「非看板路径只认预留时快照差集」的归因设计，但 build.js 在 004 领取前已是脏文件（porcelain 码 ' M'），此后每一单的快照差集都看不到它（状态码不随内容修改变化）。
- 旁证：全量扫描 `dispatch/runs/*/auto-commit.json`，没有任何一个 run 的 auto-commit 提交过 build.js；build.js 最后一次入库是 87a2fca（BUG-20260913-001 fix），当前工作区积压 +191/−35 行未提交改动。

后果：

1. **修复代码长期不落 git**：004/005 对 build.js 的实现改动（版本卡片操作按钮等）只存在于工作区，未进入任何提交。
2. **HEAD 自相矛盾**：已提交的 004 测试 aeb07f9 断言 build.js 含 `data-ver-answer` / `data-ver-merge` 标记，而 HEAD 版 build.js 中这两处标记为 0（只存在于未提交的工作区改动里）——对 HEAD 单独跑该已提交测试必失败，提交历史中 test 与被测代码版本不配套。
3. **脏改动持续叠加**：后续单若也改 build.js，预留时快照看到的仍是同一个 ' M'，漏提交继续复现，工作区脏 diff 越滚越大。

期望：auto-commit 对「预留时已脏且与当前单改动同文件」的路径给出明确处理（提示人工核对/人工提交，或经确认后按 diff 归属拆分提交），不要静默留脏。

## 复现步骤

前置：项目为 git 仓库、git 工作流已初始化（dev 分支）。

1. 制造「预留前已脏」状态：确认 `scripts/web/build.js` 存在未提交改动（`git status --porcelain` 显示 ` M scripts/web/build.js`），且该改动不属于即将实施的条目（如上一单遗留）。
2. 登记一个实施时会改动 build.js 的条目（如本批 004/005 这类构建模块界面改动），加入批量批次。
3. 领单（batch next）：`batch.nextItem` 把当前工作区快照写入 `run.treeSnapshot`（scripts/lib/batch.mjs）——build.js 以状态码 ' M' 进入快照 entries；快照只对未跟踪（??）文件记录内容哈希，对已跟踪的脏文件只有状态码、无内容指纹。
4. 实施条目：Agent 修改 build.js 内容，porcelain 状态码不变（仍为 ' M'）。
5. 上报回执（run receipt）触发 `autoCommitForRun`：`changedPathsSince`（scripts/lib/git-flow.mjs）逐路径比较 porcelain 状态码——build.js 快照码 ' M' 等于当前码 ' M'，被判定为「预留前就脏且运行期间未动过」，不计入变更集；非看板路径只认差集，故不进 test/biz 组，也不进 excluded（静默丢弃）。
6. 回执完成：fix 组只含 i18n.js、style.css 等预留时干净（或未跟踪）的路径；`git status` 中 build.js 仍是 ' M'。
7. 验证后果：`git show <fix 提交> --stat` 无 build.js；`git show HEAD:scripts/web/build.js | grep -c 'data-ver-answer'` 为 0，而已提交的 004 测试（aeb07f9）断言该标记存在——对 HEAD 跑该测试失败；重复步骤 2–6 多单后，`git diff --stat scripts/web/build.js` 持续增大。

实际发生记录（本仓库，登记时点核实）：run-20260913-215（004，fix=69db12b）与 run-20260913-216（005，fix=6729acb）均复现上述第 5–6 步；build.js 至今未入任何 auto-commit 提交。

## 期望行为

1. **不再静默留脏**：auto-commit 收尾时若存在「预留时已脏（快照中有非 ?? 脏码）、且本单运行期间内容发生变化」的路径，必须显式处理并在回执/账本中体现，不允许无声留在工作区且对外表现为「已全部提交」。
2. **处理策略二选一或组合（design.md 定稿）**：
   - 提示人工核对/人工提交：把疑似含本单改动的预留前脏路径列入清单（回执提示 + auto-commit 明细），给出处理建议，auto-commit 状态如实标记（部分完成/待人工），不得误报全量 committed；
   - 经确认后按 diff 归属拆分提交：仅当能确定性区分「预留前改动」与「本单改动」时才自动提交，否则退回人工处理，不做猜测归属。
3. **提交历史自洽**：同一单的 test 组提交与业务组提交应基于同一版本源码——不允许再产生「测试已提交、被测代码未提交」的组合（本例 aeb07f9 与 HEAD build.js 的矛盾）。
4. **归因安全性不回退**：保留「预留前无关改动绝不卷入本单提交」的设计目标；为此预留时快照需升级到足以区分「未动过 / 动过」的粒度（未跟踪文件已记内容哈希，预留时已脏的已跟踪文件可比照记录内容哈希）。
5. **账本与看板如实**：auto-commit 明细（`dispatch/runs/<runId>/auto-commit.json`）与看板提交徽标不因漏提交路径而误报「已提交」；待人工处理的路径可查。

## 界面展示

不涉及界面改动：本单现象与修复都在 atb 脚本层（scripts/lib/git-flow.mjs / batch.mjs 的预留快照与提交归因逻辑），不触碰 scripts/web 下任何页面与交互；现象中提到的 build.js 版本卡片操作按钮是 004/005 两单的实施内容（其界面演示由各自条目的 ui-demo.html 覆盖），本单针对的是「这些改动未被 auto-commit 提交」的 git 归因问题，修复不改任何界面。故本条目无 ui-demo.html 演示。

## 验收说明

- **核心场景**：预留前 build.js 已脏 + 本单运行期修改 build.js → 回执后不再静默留脏：该路径或被正确归属提交，或被列入「待人工处理」清单（路径 + 建议）并如实标记状态；二者必居其一，且回执输出/账本可见。
- **回归保障（行为不变的口径）**：
  - 预留时已脏、运行期未被动的路径：仍不计入、不卷入提交；
  - 预留时干净的路径：新脏/换码路径照常进 test/biz 组；
  - 未跟踪文件（??）的内容哈希机制不受影响；
  - 幂等（重复回执不重复提交）与部分失败后的差集续传语义不回归；
  - 提交消息校验、路径分块、`--only` 提交等既有机制零回归。
- **历史自洽验收**：修复后新产生的批量单，其已提交 test 对「HEAD 版被测代码」可跑通（可用临时 worktree/stash 方式对 HEAD 验证，方法由 design.md 定稿）。
- **账本验收**：`auto-commit.json` 如实记录漏判/待处理路径；看板「已提交」徽标口径与实际一致（不误点亮）。
- **事实基线（登记时点已核实，供修复比对）**：69db12b / 6729acb 的 fix 组仅含 i18n.js + style.css；build.js 不在两单 excluded 清单；HEAD build.js 无 `data-ver-answer` / `data-ver-merge`；工作区 build.js 未提交 +191/−35。
- **待确认**：① 预留前 build.js 脏改动的最初来源单（早于 004 领取时刻，未定位——dispatch 账本中无任何 run 提交过 build.js）；② 「按 diff 归属拆分提交」的可行边界（整文件提交会连带预留前旧脏内容，是否可接受）与人工确认交互方式，由 design.md 定稿；③ 存量遗留（当前工作区 +191/−35）如何补录，不属本单自动处理范围。
