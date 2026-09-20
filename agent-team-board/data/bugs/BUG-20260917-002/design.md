# 设计 — BUG-20260917-002 收口自动提交对已整体暂存的删除路径 git add -A 报 pathspec fatal，提交被毒死

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：**REQ-20260911-009**（收口自动提交首次引入 `commitPaths` 的 `git add -A -- <path>`，对无匹配 pathspec 无任何容错；编号已经 `atb list` 核验存在）。
- 关联部分修复：**REQ-20260916-007**（提交 21fc312）为迁移期场景补了「英文错误文案正则匹配 → 逐路径重试跳过」的容错，本 Bug 现场即由其遗留缺口暴露（见下）；BUG-20260917-001 仅为暴露现场，非来源。

## 根因分析

- 直接根因：`commitPaths`（scripts/lib/git-flow.mjs）对归因路径执行 `git add -A -- <chunk>`；当路径已被整体暂存删除（`git rm`：索引中无条目、磁盘无文件）时 pathspec 匹配不到任何对象，git 直接 fatal（exit 128），整组提交中止。`autoCommitForRun` 与 `supplementCommitForRun` 共用该函数，故收口与确认补交连环卡死。
- 遗留缺口（本单开发实证）：21fc312 的容错以英文文案正则 `/did not match any files|no such file or directory/i` 判定「无匹配」。git 输出随 `LC_ALL` 本地化——本机实测（git 2.49.0，`LC_ALL=zh_CN.UTF-8`）：`fatal` 输出为「致命错误：路径规格 '…' 未匹配任何文件」，正则失配 → 错误照常上抛 → 非英文 locale 下 Bug 复现。另该正则口径存在反向缺陷：真实错误文案恰含 `no such file or directory`（如 CWD 丢失）时会被误吞。

## 方案

**结构化判定替代文案判定**（scripts/lib/git-flow.mjs）：

- 新增 `pathspecMatchable(root, p)`：磁盘存在该路径，或 `git ls-files --error-unmatch -- <p>` 命中索引（exit 0），才认为 add 对其「有匹配、有事可做」。判定只依赖 git 状态与文件系统，与错误文案 / locale 无关。
- `commitPaths` 整块 `git add -A -- <chunk>` 失败时逐路径重试：`pathspecMatchable` 为假者跳过 add——其删除已在索引中，由后续 `git commit --only` 以 HEAD 跟踪记录为准一并提交（本机实测验证：`git rm` 后 `git commit --only -- <p>` 正确收录删除）；可匹配路径的 add 失败属真实 git 错误（index.lock、钩子等），照常上抛、完整落账（errorFull 不截断，BUG-20260915-003 口径不回退）。
- `autoCommitForRun`（含 `atb run autocommit` 重试）与 `supplementCommitForRun` 共用 `commitPaths`，天然同享容错（测试分别验证两条路径）。

**开源选型（REQ-20260909-015）**：未引入开源库——修复为约 10 行 git 语义判定（磁盘存在性 + `ls-files` 只读探测），无合适库且引入成本高于自研。

**回归测试**（scripts/tests/bug-20260917-002.test.mjs，先红后绿）：B1 核心复现（git rm 共享路径 → 收口 committed、删除被 `--only` 收录）；B2 真实错误不吞（index.lock → failed 挂起、errorFull 落账；解锁后确认闭环补齐不重复）；B3 确认补交显式计入（include）该路径成功收录删除；B4 本地化容错（zh_CN locale 下收口仍成功；环境无该 locale 时跳过）。

## 风险与边界

- 「整块 add 失败且组内全部路径均无匹配」时 add 阶段不再上抛——此时 add 本就无事可做；若失败另有真实原因（如 index.lock），同一错误会在随后的 `commit --only` 阶段上抛并落账，不会静默丢失（B2 覆盖）。
- `ls-files` 逐路径探测仅在 add 失败分支触发（每块 ≤ PATH_CHUNK=200 次只读调用），正常路径零额外开销。
- 相比文案正则，结构化判定顺带消除「真实错误文案含 no such file or directory 被误吞」的反向缺陷：可匹配路径一律重试并如实上抛。
