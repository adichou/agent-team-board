# 测试报告 — BUG-20260907-006 状态守卫可被引号拆词绕过：atb st""atus / ac""cepted 形态执行人工专属流转不被拦截

- 时间：2026-09-07T15:58:39.311Z
- 执行者：zcode-batch-009-1
- 测试框架：node:assert 子进程守卫实测 + run-all 全量回归
- 覆盖率：100%

## 总结

引号拆词绕过修复：bash 模式新增成对引号词内拼接归一 stripPairedQuotes（st""atus→status、ac""cepted→accepted），关键词 token 与 status.json/人工 API 路径子串均改在归一化文本上匹配；改写意图检测保留原始 seg（shellTokens 本就引号感知，避免 's/>/x/' 的 > 被误判重定向，Green 阶段实测 B1 回归并修正）。TDD：Red Q1–Q4 精准失败，Green 后 code-guard 24 命名用例全绿，run-all 67 个测试文件 0 失败；README 原样复现 stdin 喂入实测 exit 2。引入来源：未定位（排查过程见 README 关联节）。

## 明细

### Red（测试先行，捕获缺陷）

- 命令：`node scripts/tests/code-guard.test.mjs`
- 结果：退出码 1，4 个用例失败——Q1 子命令拆词（`atb st""atus … accepted`）、Q2 目标状态拆词（`ac""cepted` / `don""e` / `--to=do""ne`）、Q3 curl 人工 API 拆词（`-d "to=ac""cepted"`、`/api/it""em/`）、Q4 status.json 路径拆词改写（`> …/st""atus.json`）。失败形态均为「期望 exit 2、实际 exit 0」，与 README 复现一致；Q5 误报回归与既有 19 用例不受影响。

### Green（含一次回归修正）

- 初版实现把去引号文本传入 `hasRewriteIntent`，引发 B1 回归：`sed 's/>/x/'` 中被引号保护的 `>` 被判为重定向而误拦。修正：改写意图检测保留原始 `seg`（内部 `shellTokens` 引号感知），归一化文本仅用于关键词 token 与裸子串正则。
- 命令：`node scripts/tests/code-guard.test.mjs`
- 结果：退出码 0，24 个命名用例全部通过（原 G/B/P/F 系列 19 个 + 新 Q1–Q5）。

### 全量回归

- 命令：`node scripts/tests/run-all.mjs`
- 结果：67 个测试文件、失败 0。

### 原样复现验证

- stdin 喂入 README 复现命令 `{"tool_input":{"command":"atb st\"\"atus REQ-20260907-001 accepted","cwd":"/tmp"}}` → exit 2，stderr 提示人工专属流转指引；合法命令 `atb list` → exit 0。

### 影响面

- `scripts/state-guard.mjs`：新增 `stripPairedQuotes`；bash 模式检查 (1)(2)(3) 匹配文本归一化，检查 (4) 的 `hitsPluginSource` 归一化、`hasRewriteIntent` 保留原始段。
- `scripts/tests/code-guard.test.mjs`：新增 Q1–Q5 回归场景。
- 条目 README（复现步骤/期望行为/关联归因）、design.md（根因与方案）、test-cases.md（T1–T6 全 ✓）。

### 覆盖率口径

- 本条 test-cases T1–T6 全覆盖（6/6，100%）；项目未配置语句/分支覆盖率采集。
