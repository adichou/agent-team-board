# 设计 — REQ-20260918-003 clone 后从 git 历史重建看板状态（atb rebuild）

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

条目实时状态的事实源在 `agent-team-board/runtime/status/<ID>.json`（REQ-20260916-007），而 `runtime/` 整目录被根 .gitignore 忽略不进 git。新机器 clone 后 `data/` 条目文档齐全但 `runtime/status/` 为空，看板无法得知哪些条目已完成；且 `atb init` 在 clone 后会因 `dataDirFrom` 判定「已初始化」而拒绝执行，没有恢复入口。

## 方案

新增 `scripts/lib/rebuild.mjs`（数据层）+ `atb rebuild` CLI 子命令（scripts/atb.mjs 接线，登记进 USAGE 帮助文本；未初始化时报错走既有 `core.requireDataDir` 口径）。Web 侧不变（scripts/web/、scripts/server.mjs 无改动）。

**核心流程（`rebuildBoardStatus(dataDir)`）**：

1. **安全边界**：扫描 `runtime/status/` 下形如 `<ID>.json` 的条目状态文件——存在任何**非本命令产生**的文件（history by 不全为 `atb-rebuild`，含文件损坏）即抛错拒绝（防误覆盖既有看板）；既有文件全部由本命令产生时视为**中断重跑**放行。目录不存在时自动创建骨架（mkdir recursive）。
2. **条目扫描**：遍历 `data/requirements/`（含需求内嵌 `bugs/<BUG>` 嵌套 Bug）与 `data/bugs/` 全部条目目录，与 `core.listItems` 清单口径一致。
3. **判定**（README 用户拍板口径）：每条目复用 `commit-store.mjs` 的 `gitLogMessages` + `itemCommittedInGit` 只读口径（历史消息含单号，默认当前检出分支完整历史）→ `done`；无提交痕迹 → `submitted`。不区分「已上报」与「已人工确认完成」，不新增进 git 的终态标记文件。非 git 仓库时全部判 `submitted`（不崩溃，CLI 附提示行）。
4. **写入**：逐条目原子写（`writeJsonAtomic`）`runtime/status/<ID>.json`，字段与 `createItem` 生成的结构一致（id / type / title / status / parent / owner / createdAt / updatedAt / agentCompletedAt / lastReport / history）。title 与 createdAt 从条目 README 首行 `# <ID> 标题`、`- 创建：<ISO>` 行解析（缺失兜底：标题=ID、创建=当前时间）。history 恰一条：`{ from: null, to: <判定状态>, by: 'atb-rebuild', note: 'rebuild 从 git 历史重建（依据提交 <hash10> <主题> | 无提交痕迹）' }`——by 全为 rebuild 标记即幂等重跑的识别依据。
5. **幂等**：已重建条目沿用已判定状态（不翻转、不追加 history）；新增 git 提交不改变既有判定；中断后重跑补齐缺失的状态文件，最终结果与一次完整执行一致。
6. **输出清单**：返回 `{ total, done, submitted, written, kept, lines: [{ id, status, basis, kept }] }`，CLI 逐行打印 `ID → 状态（依据提交 hash+主题 | 无提交痕迹）` + 汇总计数。依据提交由一次 `git log --format=%H%x1f%B%x1e` 结构化扫描（记录内 \x1f、记录间 \x1e，多行消息不拆记录）取最新命中；判定本身仍以 `itemCommittedInGit` 为准（依据扫描仅用于展示）。

**只读保障**：对 git 仅执行 `git log` 类查询（注入 `--no-optional-locks`）；不改 `data/` 条目文档、不产生 commit / push / 分支操作；`runtime/status/` 之外的 runtime 文件（config.json 计数器等）一律不动（`atb init` 的 git init / dev 分支流程不复用）。

**多分支场景**：按 README 验收口径默认仅当前检出分支历史（`git log` 缺省行为），不做跨分支扫描。

**影响面**：新增 scripts/lib/rebuild.mjs；scripts/atb.mjs 增 import、USAGE 两行、`rebuild` 命令分支；scripts/tests/req-20260918-003.test.mjs 新增测试。既有命令与 Web 无行为变化。

**开源选型（REQ-20260909-015）**：自研（无合适库的原因）——功能是本仓看板私有数据格式（runtime/status/<ID>.json 结构、条目 README 模板、commit-store 单号口径）的确定性重建，仅需 fs + `node:child_process` 的只读 `git log`，无成熟通用库可复用；未引入任何依赖，不创建 licenses.md。

## 风险与边界

- **误判面**：判定只依据「提交消息含单号」——人工曾绕过规范提交（消息不带单号）的已完成条目会被判 `submitted`；这是 README 明确接受的口径（与看板「已提交」徽标同源），必要时人工用 `atb status` 修正。
- **中断重跑识别**：以「history by 全为 `atb-rebuild`」判定文件由本命令产生；重建后人工/流程再流转过的条目（history 追加了其他 by）会被视为活看板而拒绝重跑——符合「防误覆盖」意图，需要重跑时人工清空 `runtime/status/`。
- **keep 状态文件的孤儿**：重建后条目目录被删除的残留状态文件重跑时保留不动（不越权清理）。
