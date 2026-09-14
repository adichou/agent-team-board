# 设计 / 实施记录 — BUG-20260901-002

## 修复归属

修复随 REQ-20260901-003 一并落地（其 design.md 方案 3「同时顺带修复 BUG-20260901-002」、开放点 3 取默认），
本条目 /dev 阶段核验修复有效并补齐 Bug 专属回归测试，无需再改守卫代码。

## 修复方案（已实现，`scripts/state-guard.mjs` bash 模式规则 ①）

旧启发式：切段只要同时出现看板目录名（`agent-team-board`）与状态文件名（`status.json`）即拒绝——
「引用提及」与「实际写入」不分，导致 `atb new req --desc "…docs/agent-team-board…status.json…"`
等合法登记命令被误拦。

新判定为三条件同时满足才拦（state-guard.mjs:294-301）：

1. 片段含路径形态的 `/status.json`（纯文字提及、无 `/` 前缀不算目标）；
2. 片段含 `agent-team-board`；
3. 片段存在真实改写意图（`>`/`>>` 非丢弃重定向、`sed -i` 或 w/W/r/e 脚本、`tee`/`cp`/`mv`/`rm`/`chmod`、
   `perl -pi`、`python -c`）。

## 本次 /dev 增量

- `scripts/tests/code-guard.test.mjs` 新增 F1/F2/F3 三个用例：F1 复现原始误报形态（atb 合法子命令描述
  文本同时含两个词）、F2 只读路径形态提及放行、F3 原攻击样例（echo/sed -i/tee/rm 写 status.json）回归
  确认拦截能力不回退。修复已在位，故无「先红后绿」过程，F 系列起回归验证作用。
- 全部 15 用例（G1–G6、B1–B6、F1–F3）通过。
