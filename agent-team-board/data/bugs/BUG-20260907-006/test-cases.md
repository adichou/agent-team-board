# 测试用例 — BUG-20260907-006 状态守卫引号拆词绕过

> TDD：在 `scripts/tests/code-guard.test.mjs` 中通过子进程执行真实 `state-guard.mjs bash`，新增 Q1–Q5 组用例。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | `atb st""atus` / `atb 'st'atus` / `atb st"at"us` 等子命令拆词后接 `accepted`/`done` 应拦截（exit 2） | P0 | ✓ |
| T2 | 目标状态拆词：`atb status X ac""cepted`、`atb status X don""e`、`--to=do""ne` 应拦截 | P0 | ✓ |
| T3 | curl 人工 API：`-d "to=ac""cepted"` 与路径拆词 `/api/it""em/` 应拦截 | P0 | ✓ |
| T4 | status.json 路径拆词改写：`echo … > …/st""atus.json`（agent-team-board 下）应拦截 | P0 | ✓ |
| T5 | 误报回归：`atb report --summary "…st\"\"atus…"` 文本、引号包裹普通字样、拆词只读（`cat …/st""atus.json`）、`atb st""atus X in-pro""gress` 均放行（exit 0） | P0 | ✓ |
| T6 | 既有守卫用例全部回归：G1–G6 / B1–B6 / P1–P4 / F1–F3 不受归一化影响 | P0 | ✓ |

## 执行记录

- Red：`node scripts/tests/code-guard.test.mjs` 返回 1；Q1–Q4（T1–T4 拆词攻击面）精准失败（当前实现 exit 0 放行），Q5 与既有 19 个用例通过，证明测试捕获现有缺陷而非环境问题。
- Green 初版引入 B1 回归：把去引号文本传入 `hasRewriteIntent` 后，`sed 's/>/x/'` 中被引号保护的 `>` 被误判为重定向。修正为改写意图检测保留原始 seg（内部 `shellTokens` 本就引号感知），归一化文本仅用于裸子串正则与关键词 token。
- Green：同一命令返回 0；code-guard 全部 24 个命名用例通过（原 19 + 新 Q1–Q5）。
- 全量回归：`node scripts/tests/run-all.mjs` 67 个测试文件、失败 0。
- 原样复现验证：stdin 喂入 README 复现命令 `atb st""atus REQ-20260907-001 accepted` → exit 2 并提示人工专属流转；合法 `atb list` → exit 0。
- 覆盖率口径：本条验收用例覆盖 6/6（100%）；项目未配置语句/分支覆盖率采集。
