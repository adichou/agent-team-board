# 设计 — REQ-20260917-002 调整 state-guard 拦截口径，放行文档讨论轮对看板条目文档的 git 提交

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

见 README「已核实的现状」：`scripts/state-guard.mjs` bash 模式第 (5) 条对看板项目内
Agent Bash 的 git commit 一律拦截，且 `gitSubcommandOf` 在段内任意位置扫 token 产生
参数文本误拦。

## 方案

改动集中在 `scripts/state-guard.mjs`（自研守卫脚本，无新增依赖），分四层：

1. **命令位语义识别（消除误拦）**：新增 `gitAtCommandPosition`——git 处于命令位
   （段首或 `NAME=value` 环境变量赋值前缀之后）才进入 commit 判定；参数文本
   （`--desc "…git commit…"`、`grep "git commit"` 等）中的 git 字样不再构成提交命令。
   commit 判定分支的 token 化改用既有的引号感知 `shellTokens`（`-m "多词消息"` 保持
   单 token；`st""atus` 拼接归一等价，不弱于旧 `stripPairedQuotes`+split 防绕过口径）。
2. **放行细则（三者同时满足）**：`parseGitInvocation`（全局选项区：`-C` 值作为
   pathspec 基准；`--git-dir/--work-tree` 等改变仓库落点 → 拦）→ `parseCommitArgs`
   （静态收集 `-m/--message` 消息与 pathspec）→ 放行判定：pathspec 非空且全部经
   `pathspecInItemScope` 解析（基准 = `hook.cwd`，有 `-C` 时换 `-C` 目录）落在
   `data/{requirements,bugs}/<条目ID>/` 条目目录内（`ITEM_DIR_RE`，目录边界即用户
   数据边界，嵌套 `bugs/<ID>/` 天然覆盖），且消息拼接文本含条目编号（`ITEM_ID_RE`）。
3. **非授权形态默认拦（保守白名单解析）**：`-a/--all/--amend/-o/-i/-p/-e`、
   `-C/-c/-F/-t`（复用消息 / 消息文件 / 模板）、`--fixup/--squash/--author/--date`、
   `--pathspec-from-file`、无 `-m`（编辑器/消息不可知）、未知短选项、pathspec 含
   glob 元字符或 `:`/`^` magic 前缀——一律拦；拦截提示统一 `COMMIT_SCOPE_HINT`
   说明三条通道与放行范围。
4. **间接执行兜底（防绕过）**：git 不在命令位但段内存在 git→commit token 序列时，
   命令位命令属「再解释/透传类」白名单（bash/sh/…/eval/exec/xargs/find/ssh/sudo/
   env 等；解释器 node/python 仅当带 `-e` 等内联选项，`hasInterpreterEvalIntent`
   复用）即拦；另预扫描「stdin 消费的解释器段」（`| bash`、`| python` 无操作数
   形态，`hasStdinShellConsumer`）与含提交序列的上游段跨段关联，堵
   `echo "git commit …" | bash` 型绕过。`;`/`&&`/`|` 拼接由既有 `splitShellSegments`
   切段逐段判定，维持不变。

**测试**：新增 `scripts/tests/state-guard-20260917-002.test.mjs`（P1–P9 放行 /
B1–B15 保护 / N1–N5 误拦消除 / E1 讨论轮端到端真实落库）；改造 dev-flow 的 D10
用例（原断言均为无 pathspec 形态天然兼容，补放行/源码拦/误拦三个抽样断言）。

**文档同步**：根 `AGENTS.md`「TDD 与收口」report 收口说明与「测试与拦截速查」表；
`skills/agent-team-board/SKILL.md` 铁律区新增第 7 条（git 提交通道）、「常见错误」表
新增拦截提示行、铁律第 6 条残留的「看板数据目录（docs/）」旧表述修正为
`agent-team-board/data/`。

**开源选型（REQ-20260909-015）**：无合适库的原因——本单是对既有自研守卫脚本
（`state-guard.mjs`）的拦截口径调整，属纯 Node 内 shell 命令文本静态分析逻辑，
与该脚本既有解析函数（`shellTokens`/`splitShellSegments` 等）深度耦合；引入通用
shell 解析库（如 shell-quote）反而引入与既有分段/token 语义不一致的双口径，
且放行判定依赖看板自身目录布局，无现成开源库覆盖。未引入依赖，不创建 licenses.md。

## 待确认项定案（README「待确认」节）

- **pathspec 静态解析深度**：守卫只做命令文本静态分析，不对照 git 索引；相对路径
  按 `hook.cwd`（有 `-C` 时按 `-C` 目录）resolve 后做范围判定；目录整体作 pathspec
  放行（目录边界即用户数据边界）；**通配符与 `:`/`^` magic 前缀不解析，保守拦**。
- **主题校验位置**：在守卫拦截层校验（README 细则 4 的「放行须同时满足」要求）——
  消息拼接文本须匹配 `REQ-/BUG-\d{8}-\d{3}`；消息来源不可静态解析（`-F`/`-C` 复用/
  无 `-m`）一律拦，commit-store 规范仍作为收口通道的第二道约束。
- **`--amend`/`--only`/`--include` 等变体**：默认按非授权形态拦（含 `--amend`——
  改写上一笔提交超出放行语义；`-o/-i/-p/-e/--fixup/--squash` 同为不可静态核验形态）。

## 风险与边界

- 放行面限于条目目录用户数据——目录内任意文件均算（条目目录本就是 Agent 可自由
  编辑的 Write 边界），提交它们不新增越权面；源码、`runtime/`（含 `status.json`、
  config、账本）、板级共享路径（`data/` 整体、`data/requirements` 整体）与
  `..` 逃逸路径仍拦。
- 间接执行白名单是黑名单思路的补充（保守方向）：白名单外命令的参数文本不拦，
  理论上存在未列入的再解释执行器（如冷门 shell 包装器）绕过——与守卫
  「命令文本静态分析」的既定边界一致，超出部分由流程约束兜底。
- 非 git 项目、无看板上下文项目不管辖（维持现状）。
