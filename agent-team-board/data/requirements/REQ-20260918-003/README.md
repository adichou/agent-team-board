# REQ-20260918-003 clone 后从 git 历史重建看板状态（atb rebuild）

- 状态：accepted（已接受）
- 创建：2026-09-18T08:02:43.629Z

## 描述

背景：条目实时状态的事实源在 `agent-team-board/runtime/status/<ID>.json`（REQ-20260916-007，见 scripts/lib/core.mjs 的 `statusFileOfItemDir`/`readStatus`），而 `runtime/` 整目录被根 .gitignore 忽略（`ensureRuntimeIgnore`，唯一忽略规则）不进 git。新机器 clone 后 `data/` 条目文档齐全但 `runtime/status/` 为空，看板无法得知哪些条目已完成；且 `atb init` 在 clone 后会因 `dataDirFrom` 判定「已初始化」而拒绝执行（scripts/lib/core.mjs `initData`），没有恢复入口。目标：新增 `atb rebuild` 命令，在新机器上从 git 历史重建条目状态。

判定口径（用户拍板，与 BUG-20260918-003 design.md 一致）：扫描 `data/`（requirements/ 与 bugs/）条目目录，git 提交历史中存在带该单号的提交（提交主题规范见 scripts/lib/commit-store.mjs：`类型: 描述 单号`，类型限 feat/fix/chore/doc/test；判定复用 `gitLogMessages`/`itemCommittedInGit` 的「历史消息含单号」口径）→ done；无提交痕迹 → submitted。不区分「已上报」与「已人工确认完成」，不为此新增进 git 的终态标记文件。

安全边界：仅允许在 runtime 条目状态为空（`runtime/status/` 下无任何 `<ID>.json`）时重建，防误覆盖既有看板；命令幂等可重试；重建结果输出清单（每个条目 → 判定状态 + 依据提交）。对 git 全程只读，不产生提交 / 推送 / 分支变更，不改 `data/` 下任何条目文档。

关联：BUG-20260918-003（confirmations.md/decisions.md 迁 runtime 后 git 入库面更干净，利于判定）。

## 验收标准

- [ ] 新增子命令 `atb rebuild`（`node scripts/atb.mjs rebuild --dir <项目根>`，遵循现有 `--dir` 约定），登记进 atb.mjs usage/help 帮助文本；未初始化（找不到 agent-team-board/data）时给出与现有命令一致的明确报错
- [ ] 判定正确性：扫描 `data/requirements/` 与 `data/bugs/` 全部条目目录，对每个条目 ID 以 git 提交历史判定——历史提交消息含该单号（复用 scripts/lib/commit-store.mjs 的 `gitLogMessages` + `itemCommittedInGit` 只读口径，默认当前检出分支完整历史）→ 置 done；无提交痕迹 → 置 submitted
- [ ] 安全边界：`runtime/status/` 已存在任何条目状态 `<ID>.json` 时拒绝执行并报错说明（防误覆盖既有看板）；仅当目录为空或不存在（自动创建骨架）时执行重建
- [ ] 重建写入：为每个条目生成 `runtime/status/<ID>.json`，结构与现有状态文件一致（id / type / title / status / history 等），history 留痕本次重建（from null → 判定状态，by 标记 rebuild 来源）；重建后 `atb list` / `atb show` 可正常读取全部条目状态
- [ ] 幂等可重试：执行中断后重跑可完成剩余条目，最终结果与一次完整执行一致；对已重建的条目不重复追加 history、不翻转已判定状态
- [ ] 输出清单：执行后打印每个条目一行（ID → 判定状态 + 依据：命中提交的 hash 与主题，或「无提交痕迹」）及汇总计数（done / submitted 各多少）
- [ ] 只读保障：全程对 git 只读（仅 `git log` 类查询），不改 `data/` 条目文档、不产生 commit / push / 分支操作；`agent-team-board/runtime/status/` 之外的 runtime 文件（config.json 计数器等）不因此命令损坏
- [ ] TDD：在 scripts/tests/ 新增 `<前缀>-rebuild` 相关测试（先跑红后跑绿），覆盖有提交→done、无提交→submitted、状态非空拒绝、幂等重跑、清单输出；交付前 `npm test` 全量通过
- [ ] 多分支场景（如仅存在于其他分支的提交、squash 合并改写主题）是否纳入扫描范围：待确认（默认仅当前检出分支历史）

## 界面展示

本需求为 CLI 子命令，无 Web 界面改动（scripts/web/、scripts/server.mjs 不变）；交互面是终端输出与重建后的看板状态数据，演示见 [./ui-demo.html](./ui-demo.html)（单文件、无外网依赖、浏览器直接打开可交互）：

- **界面布局**：左侧终端模拟（执行 `node scripts/atb.mjs rebuild --dir .` 的逐行输出），右侧看板状态视角（runtime/status/ 的 done / submitted 两列 + runtime 状态说明行）；顶部为场景切换与操作按钮。
- **交互行为**：点击「执行」按钮运行 rebuild；三个场景可切换——正常重建（混合 done/submitted）、空仓库（data/ 无条目）、失败（runtime/status 非空被拒）；「重置」回到就绪态。
- **状态反馈**：加载态（扫描 data/ 目录、读 git 历史时带光标动画逐条判定）；成功态（重建结果清单逐行输出：ID → 状态 + 依据提交 hash 与主题，末尾汇总计数，右侧看板列同步填充）；失败/拒绝态（status 非空时红色报错并说明安全边界）；空态（空仓库提示无可重建内容，看板两列显示「（空）」）。深浅色随系统自适应。
