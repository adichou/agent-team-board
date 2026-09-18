# 方案 — BUG-20260907-006 状态守卫引号拆词绕过

## 根因分析

- 位置：`scripts/state-guard.mjs` bash 模式逐段检查循环。旧实现 `seg.replace(/["']/g, ' ').split(/\s+/)` 把引号字符当分隔符切 token，而 shell 语义中成对引号是「词内连接」：`st""atus`、`ac''cepted` 实际就是 `status`、`accepted`。于是：
  - 检查 (2) 人工专属 `atb status <ID> accepted|done` 找不到 `status` / `accepted` 关键 token → 放行；
  - 检查 (1)/(3) 对原始 seg 做 `/\/status\.json/`、`/\/api\/(item|new)/` 子串正则，路径拆词（`st""atus.json`、`it""em`）同样失配 → 放行。
- 与 BUG-20260905-001（误报方向）同为守卫 token 化精度问题，方向相反（漏拦）。
- 引入来源：未定位（排查过程见 README「关联」节——naive 切词随插件初始 state-guard 脚手架带入，早于看板日志化，看板内无对应条目）。

## 方案

1. 新增 `stripPairedQuotes(str)`：单趟扫描，成对引号字符删除（词内拼接归一），未闭合引号按保守处理；反斜杠转义保留原字符（`\"` 不参与拼接——宁可漏并不可误并）。
2. bash 模式每段先 `norm = stripPairedQuotes(seg)`：
   - `tokens = norm.split(/\s+/)` 供检查 (2)(3) 的关键词匹配（`status` / `accepted` / `done` / `--to=…`）；
   - 检查 (1) 的 `/\/status\.json/ + /agent-team-board/` 与检查 (3) 的端口 / `/api/(item|new)` 正则、检查 (4) 的 `hitsPluginSource` 子串匹配改在 `norm` 上进行（防路径拆词）。
3. **改写意图检测 `hasRewriteIntent` 仍传原始 `seg`**：其内部 `shellTokens` 本就引号感知（`'s/>/x/'` 整体单 token），若传入去引号文本会把引号保护的 `>` 误判为重定向（Green 阶段实测到的 B1 回归，已修正并固化注释）。

## 已知边界（不在本条范围）

- ANSI-C 引号 `$'…'`、命令替换 `$(...)`、变量展开 `$VAR` 等动态形态不属于文本层守卫能力范围（如 `A=accepted; atb status X $A`），守卫定位是确定性文本层防线，与既有边界一致。
- 引号包裹的整句数据（如 `--summary "atb status X done"`）维持既有保守拦截口径，本条不收紧也不放松（Q5 用例锁住不新增误拦）。

## 影响面

- `scripts/state-guard.mjs`：新增 `stripPairedQuotes`；bash 模式 4 项检查的匹配文本统一归一化（改写意图除外，见上）。
- `scripts/tests/code-guard.test.mjs`：新增 Q1–Q5 五组回归场景。
- 条目 README（复现步骤/期望行为/归因）、test-cases、test-report。
