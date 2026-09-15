# BUG-20260915-007 atb report（无 run 场景）缺系统收口提交，手动 /dev 与批量 run 的提交行为不一致

- 状态：submitted（待人工接受）
- 引入来源：REQ-20260911-009（引入「到待测试自动提交」时只挂在批量 run 回执通道，且 Agent 侧提交一律拦截，未覆盖无 run 的手动 /dev；关联 BUG-20260915-002——其修复只补齐了规则文档层）
- 创建：2026-09-15T01:21:50.241Z

## 现象

同一套 dev 收尾规则（dev-closeout.md：测试通过 → report → 本单提交 → 核验），两种执行端行为不一致：

- **批量 run**：worker 交 `atb run receipt --result reported` → 核验通过 → **系统自动提交**本单改动到 dev（atb 进程内部执行，不经 Agent）；
- **手动 /dev（无 run）**：`atb report <ID> ...` 上报成功后**系统不产生任何版本库提交**；Agent 侧用 Bash 执行提交命令又被钩子一律拦截（REQ-20260911-009/010，无豁免）→ 收尾提交必然落到**人工终端**。

实测（BUG-20260915-006 收尾，2026-09-15）：report 成功、条目进入待测试，但本单路径留在工作区，Agent 提交被拦，最终需人工在终端执行两条命令收口。行为一致性只存在于规则文档层，代码级无保证——不同执行端（ZCode/Codex/人工）是否遵守规则取决于各自环境的钩子覆盖，Codex 会话无拦截即可直接提交（BUG-20260915-002 的两个提交即由此产生），ZCode 会话则必然落到人工。

### 代码级定位（登记时点核实，修复阶段复核）

- `atb report` 无 run 分支（`scripts/lib/core.mjs` 的 `report()`）：仅写 test-report.md、更新 status.json（lastReport / agentCompletedAt / history）并释放认领锁与手工实施锁，**全程不触达任何提交逻辑**；带 `--run` 与否在该函数内只差 runId 记录，均不触发提交（自动提交在 run receipt 收尾，不在 report 内）。
- 批量通道（`scripts/lib/batch.mjs` run receipt，`result=reported` 证据核对通过后）调用 `scripts/lib/git-flow.mjs` 的 `autoCommitForRun()`：归因扫描 → 按现行分组规范提交（doc/test/业务，消息「类型: 描述 单号」，只 commit 不 push）→ 写条目↔提交索引；源码注释明确「由 atb 进程内部执行 git，不经 Agent Bash 工具，不受 state-guard 拦截」——该豁免只授予这条路径。
- 钩子侧（`scripts/state-guard.mjs` 规则⑤，REQ-20260911-009/010）：Agent 经 Bash 的 git commit 一律拦截、无豁免（CMT 批次通道已下线），提示文案只指向「系统自动提交 / 人工终端」两条授权通道——无 run 场景前者不存在，只剩人工。
- 归因基线缺失：`run.treeSnapshot` 仅在批量预留时拍摄（batch.mjs「预留即拍工作区快照——回执核验通过后的自动提交以此为归因基线」）；手动 `atb claim` 不拍快照，无 run 分支即使接入提交内核，也没有现成的「本单改动」界定（设计要点见 design.md 方案 2）。

## 复现步骤

1. 任一条目走手动 `/dev <ID>`（非批量、无 run）：claim → 开发 → 测试通过；
2. `atb report <ID> --framework … --summary …`（不带 `--run`）；
3. 观察：上报成功、状态转「待人工确认完成」，但 `git status` 本单路径仍脏，系统无任何提交动作；
4. Agent 尝试用 Bash 提交 → 被钩子拦截（「流程外 git commit 已拦截」）；
5. 对照批量通道：同仓库任一批量 run 走 `atb run receipt <RUN-ID> --result reported --report-ref test-report.md`，证据核对通过后系统即自动提交本单改动（`atb commit log <ITEM-ID>` 可查）——两条通道收尾行为不一致即本缺陷；
6. （可选，执行端差异实证）在无拦截钩子的执行端（如 Codex 会话）重复步骤 1-3：Agent 可直接经 Bash 提交成功——「一致性」仅由规则文档与各端钩子覆盖程度决定，无代码级保证。

## 期望行为

`atb report`（无 run 场景）在核验通过后执行与批量 run receipt **同口径**的系统收口提交：atb 进程内部完成本单可归因路径的提交（消息带条目编号、写入条目↔提交索引），使 dev 命令与批量 run 的收尾行为在**代码级**一致，不再依赖规则文档或执行端自觉。

口径细节（与批量通道对齐）：

- 提交由 atb 进程内部执行（不经 Agent Bash），沿用现行分组规范（doc/test/业务，消息「类型: 描述 单号」），**只 commit 不 push**；
- 幂等与失败路径同批量通道：已收口不重复提交，失败不静默、不阻断上报，可重试，归属不明走挂起确认闭环；
- 非 git 项目沿用既有「非 git」跳过口径（不报错、不伪造提交）。

## 验收标准

1. 无 run 手动 /dev：report 上报后系统自动提交本单可归因路径（代码/测试/条目文档/报告状态），`atb commit log <ID>` 与 `git log` 均可查到提交，`git status` 本单路径无未提交遗漏（其他任务原有改动允许保留）；
2. 幂等：重复 report、或本单路径已全部入库时识别为已收口，不重复提交（与 `atb run autocommit` 同口径）；
3. 提交失败（如 git 索引被并发占用）不静默：走既有挂起确认闭环（挂起登记 + 任务页「待人工确认」提示），与批量通道一致；上报本身不受阻断，条目仍进入待测试；
4. 只 commit 不 push：收口后本地 git log 有新提交、远端无推送动作；
5. 拦截钩子行为不变：Agent 经 Bash 的提交仍被拦，系统提交不经 Agent 通道；
6. 认领受阻例外分支（dev-closeout：status → in-progress → report，无 claim）同样经此通道收口；
7. 非 git 项目：沿用既有跳过口径，report 正常完成、不报错、不伪造提交记录；
8. 有测试覆盖：无 run report 的自动提交、幂等、失败挂起三条路径。
