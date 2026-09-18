# REQ-20260914-006 构建合并策略结论纪要：不采用 rebase，保留逐条 --no-ff 合并，main 观感用 --first-parent 解决

- 状态：accepted（已接受；实际状态以 status.json 为准）
- 创建：2026-09-14T15:30:50.304Z
- 单据性质：**分析结论纪要（决策归档）**，不涉及代码改动

## 描述

### 1. 前因：main 上为什么出现一串 `build:` 提交

BLD-20260914-001（多智能体协作平台成型版）合并入 main 后，`git log --graph` 中出现 28 级"阶梯"状的 `build: <版本名> 合并 <条目号>（BLD-20260914-001）` 合并提交，引发"为什么这么多 build commit"的疑问。

这不是异常，是构建模块的设计行为。合并逻辑在 `scripts/lib/build-git.mjs` 的 `mergeCommitsIntoMain`（消息模板见 build-git.mjs:224）：对构建版本选中的条目**逐条**执行

```
git merge --no-ff -m "build: <版本名> 合并 <条目号>（<版本号>）" <该条目在 dev 上的提交>
```

数字核对（来自 builds/versions/BLD-20260914-001/version.json）：

- 本构建共选中 **288 个条目**（REQ + BUG），main 上产生 **28 个** `build:` 合并提交；
- 其中 **250 个条目指向同一个旧提交 `6f2ead6`**（dev 上较早的公共提交）——合并第一个条目时该提交进入 main，其余 249 条 merge 返回 "Already up to date"，不产生新提交，仅在 version.json 记录 ok；
- 其余约 28 个条目各带独立提交（BUG-20260912-001 ~ BUG-20260914-019、REQ-20260912-001、REQ-20260913-001、REQ-20260914-002/003/004 等），每个各产生一个 `build:` 合并提交。

`--no-ff` 与逐条合并的设计目的（build-git.mjs 内注释即口径）：

- **条目↔提交双向追溯**：合并消息含版本号与条目号，支撑 `atb commit log <ITEM-ID>` / `which <HASH>` 索引，每个条目在 main 上有可定位的合并点；
- **失败隔离 + 幂等续传**：单条冲突即 `merge --abort` 中止，已成功条目保持已合并，重试只补未合并的（"Already up to date" 亦记为成功）；version.json 逐条记录 `mergedAt`/`mergeError`；
- **执行隔离**：合并在临时 worktree 检出 main 执行，不触碰用户当前工作区。

### 2. 备选方案评估：为什么不采用 rebase

针对"main log 观感吵"的问题，评估过"rebase 后合并"方案（rebase dev onto main 后 fast-forward，或按条目 cherry-pick 到 main）。结论：**rebase 换来线性历史的同时，牺牲了本工作流的多个运行时依赖，代价大于收益**。

| # | 代价 | 说明 |
| --- | --- | --- |
| 1 | **共享 dev 分支不可重写** | dev 由多个并行 worker 会话经 `run receipt` 自动提交（autocommit），随时有会话基于 dev 当前状态工作。rebase dev onto main 是重写已发布历史，重写瞬间其他 worker 引用的 commit hash 全部作废。merge 流派从不重写历史，对并发自动化是安全性而非风格。 |
| 2 | **hash 漂移打断账本追溯** | 即便不改 dev、仅 cherry-pick 到 main，main 上也是**新 hash**；而 version.json 的 `it.commit` 与 `atb commit log / which <HASH>` 双向索引引用的都是 dev 原 hash。改 rebase 意味着账本要整体迁移成 patch-id 等价或新 hash 回写逻辑。 |
| 3 | **TDD 提交序列失真** | 每个条目在 dev 上是 `doc: → test:（红）→ fix:（绿）` 的真实序列，merge 保证提交逐字节原样进 main，"test 提交当时是绿的"这一事实被保留。rebase 遇冲突时解冲突改动会揉进重写后的提交，中间状态可能不再自洽；merge 的冲突解法则显式留在合并提交里，集成者与 worker 的责任边界清楚。 |
| 4 | **幂等续传失去自然语义** | 现状"已合入"判定 = merge 返回 "Already up to date"，天然去重、天然断点续传。rebase 需 patch-id 对比或额外账本判定。且本构建实证：288 条目中 250 条共享 1 个提交——条目是看板概念、提交是 dev 线性历史，两者非一一对应，"按条目 rebase"在这种情形下连操作对象都定义不清。 |
| 5 | **rebase 的收益可用更低成本获得** | rebase 的真实收益是线性 log 与 bisect 便利；本单结论的 `--first-parent` 方案零成本覆盖前者（见下）。 |

### 3. 结论（采纳方案）

1. **合并策略保持现状不变**：构建合并仍为 `mergeCommitsIntoMain` 逐条 `--no-ff` 合并，无任何代码改动；
2. **main 观感问题以查看方式解决**：主干历史用
   ```
   git log --first-parent main
   ```
   查看，28 级阶梯压成一条直线（每级只剩一行 `build:` 合并记录）；GUI 工具（Source Tree 等）默认分支视图亦可折叠第二父线。

### 4. 后续可选项（不在本单范围，如需另立单）

- 构建合并完成时在 main 打轻量 tag（如 `BLD-20260914-001`），让构建边界在历史上一等公民可见；
- Status Board 分支浏览页面增加"主干视图（first-parent）"开关。

## 界面展示

不涉及界面改动：本单为分析结论纪要（决策归档），采纳结论即**不修改任何代码**（见验收标准第 2 条），因此不存在界面布局、交互行为或状态反馈层面的改动。具体说明：

- 描述第 4 节提到的「Status Board 分支浏览**页面**增加『主干视图（first-parent）』开关」仅为后续可选项举例，已明确标注**不在本单范围**——如日后采纳需另行立项，届时由该单的界面展示节与 ui-demo.html 演示覆盖（本单描述第 4 节仅作决策出处引用）。
- main 历史观感的解决方式是 git 查看口径 `git log --first-parent main`（命令行参数），不涉及任何产品界面；GUI 工具折叠第二父线为其自带功能，亦非本单改动。
- 故本条目不提供 ui-demo.html 演示。

## 验收标准

- [ ] 本 README 完整记录前因（28 个 build: 提交的由来与数字核对）、备选方案否决理由（rebase 五项代价）、采纳结论（--first-parent 查看方案），可脱离会话独立阅读；
- [ ] 结论为"不改代码"，本单不伴随任何源码改动；
- [ ] 归档后作为"构建合并策略不采用 rebase"这一决策的引用出处（后续讨论合并策略时以本单为准）。
