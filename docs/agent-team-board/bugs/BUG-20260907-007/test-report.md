# 测试报告 — BUG-20260907-007 状态守卫改写意图检测缺口：node -e 写入与 find -delete 删除 status.json 均放行

- 时间：2026-09-07T16:09:59.732Z
- 执行者：zcode-batch-009-1
- 测试框架：node:assert 子进程守卫实测 + run-all 全量回归
- 覆盖率：100%

## 总结

改写意图检测缺口修复：新增解释器内联代码判定（node/nodejs/deno/bun/ruby/perl/php/python/osascript 的 -e/--eval/-p/-r/-c，扫描至首个脚本操作数即止，atb 正常调用零误拦，吸收既有 python -c 判例）与 find 写动作谓词判定（-delete/-fls/-fprintf/-fprint0?）；status.json 目标形态补 find 按名定位形态（-name status.json，引号归一文本匹配）。TDD：Red N1/N2/N3/N5 精准失败，Green 后 code-guard 29 用例全绿，run-all 67 文件 0 失败；README 两条复现命令实测 exit 2。引入来源：REQ-20260901-003。

## 明细

### Red（测试先行，捕获缺陷）

- 命令：`node scripts/tests/code-guard.test.mjs`
- 结果：退出码 1，4 个用例失败——N1 解释器内联改写 status.json（`node -e/--eval/-p`、`ruby -e`、`perl -e`）、N2 find 写动作（`-delete/-fprint/-fprint0/-fprintf/-fls`）、N3 同形态触碰插件源码、N5 `perl -e` 内联。失败形态均为「期望 exit 2、实际 exit 0」，与 README 复现一致；N4 误报回归与既有 24 用例不受影响。

### Green

- 命令：`node scripts/tests/code-guard.test.mjs`
- 结果：退出码 0，29 个命名用例全部通过（G/B/Q/P/F 系列 24 个 + 新 N1–N5），一次通过、无回归修正。

### 全量回归

- 命令：`node scripts/tests/run-all.mjs`
- 结果：67 个测试文件、失败 0。

### 原样复现验证

- stdin 喂入 README 复现命令一 `node -e "require('fs').writeFileSync('<项目>/docs/agent-team-board/requirements/REQ-x/status.json','{}')"` → exit 2，stderr 提示「禁止用 Bash 改写 docs/agent-team-board 下的 status.json」与人工专属状态指引。
- stdin 喂入 README 复现命令二 `find <项目>/docs/agent-team-board -name status.json -delete` → exit 2，同上提示。
- 只读对照：`node <插件>/scripts/atb.mjs list --dir <项目>` → exit 0；`find <项目>/docs/agent-team-board -name status.json`（无写谓词）→ exit 0。

### 影响面

- `scripts/state-guard.mjs`：新增 `INTERPRETER_EVAL_SHORTS`/`hasInterpreterEvalIntent`/`hasFindWriteAction`/`hitsBoardStatusTarget`；`hasRewriteIntent` 接入；规则 (1) 目标判定换用 `hitsBoardStatusTarget`；删除被吸收的 python -c 独立检查（行为等价）。
- `scripts/tests/code-guard.test.mjs`：新增 N1–N5 回归场景。
- 条目 README（复现步骤/期望行为/关联归因 REQ-20260901-003）、design.md（根因与方案、已知边界）、test-cases.md（T1–T6 全 ✓）。

### 覆盖率口径

- 本条 test-cases T1–T6 全覆盖（6/6，100%）；项目未配置语句/分支覆盖率采集。
