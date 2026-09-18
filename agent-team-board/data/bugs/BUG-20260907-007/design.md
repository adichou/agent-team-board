# 方案 — BUG-20260907-007 状态守卫改写意图检测缺口：node -e 写入与 find -delete 删除 status.json 均放行

## 根因分析

- 位置：`scripts/state-guard.mjs` `hasRewriteIntent`。改写意图是封闭动词枚举（重定向、sed 危险形态、`tee/cp/mv/rm/chmod`、`perl -pi`、`python -c`），两类等价写能力不在其中：
  1. 解释器内联代码：`node -e "require('fs').writeFileSync('…/status.json','{}')"` 命令文本中无任何枚举动词，实际可任意改删文件（`python -c` 判例已承认该类风险，但枚举只补了 python 一家）；
  2. find 写动作谓词：`find <看板> -name status.json -delete` 中写动词是 find 的谓词而非独立命令。
- 第二缺口叠加目标形态失配：规则 (1) 的 status.json 判定要求 `/` 前缀路径形态（防文档/测试「提及」误拦），而 find 段中文件名（`-name status.json`）与目录路径分离，路径形态匹配不到目标，即使意图命中也不会拦。
- 引入来源：REQ-20260901-003 的封闭动词枚举（详见 README「关联」节）。
- 与 BUG-20260907-006（引号拆词绕过）同向：扩大守卫假阴性面，status.json 事实源可被绕过改删。

## 方案

按 Bug 建议前两条做确定性枚举扩展（不采用第三条「触碰 status.json 即默认拒绝」——白名单枚举只读命令的误拦面与回归风险远大于收益，与守卫「确定性文本层防线」定位不符）：

1. `hasInterpreterEvalIntent(tokens)`：解释器命令名（node/nodejs/deno/bun/ruby/perl/php/python/python3/osascript）→ 内联代码短选项集（node 族 `e|p`、ruby/perl/osascript `e`、php `r`、python `c`）+ 长形态 `--eval|--print|--run`（含 `=` 附参）。选项扫描自解释器 token 起、至首个非选项操作数（脚本路径）或 `--` 止——`node atb.mjs show/list/report` 等正常调用不参与判定，atb 全部子命令零误拦。吸收既有 `python -c` 判例（原独立检查删除，行为等价并扩展覆盖附参形态）；`perl -pi` 原地改写保留原判定。
2. `hasFindWriteAction(tokens)`：`find` 命令后任一 token 命中 `^-(delete|fls|fprintf|fprint0?)(=|$)` 即计为改写意图；只读谓词不受影响。
3. `hitsBoardStatusTarget(norm)`：规则 (1) 目标形态在原 `/` 前缀路径正则外，补 find 按名定位形态 `(^|\s)-i?name\s+status\.json(\s|$)`（在引号归一化文本上匹配，`-name "status.json"` 与 `-name st""atus.json` 均命中，与 BUG-20260907-006 的 stripPairedQuotes 协同）。
4. 改写意图检测仍传原始 seg（`shellTokens` 引号感知，BUG-20260907-006 B1 回归教训不变）。

## 已知边界（不在本条范围）

- find 通配谓词形态（`-name '*.json' -delete`）：文本层无法确定性断定目标是 status.json，不拦；触碰插件源码目录时仍由规则 (4) 经 PLUGIN_ROOT 子串拦截。
- 变量展开/命令替换（`node -e "$CMD"`、`find … -exec $X`）、awk 程序内重定向（`awk '{print > "f"}'`）等动态或深层形态，与既有边界一致，属文本层守卫能力之外。
- 解释器「选项区扫描到首个操作数即止」按 shell 真实语义（node 的选项必须在脚本前）实现；`node app.js -e` 中 `-e` 是 app.js 的参数，不判为内联。

## 影响面

- `scripts/state-guard.mjs`：新增 `INTERPRETER_EVAL_SHORTS`/`hasInterpreterEvalIntent`/`hasFindWriteAction`/`hitsBoardStatusTarget`；`hasRewriteIntent` 接入前两者；规则 (1) 目标判定换用 `hitsBoardStatusTarget`；删除被吸收的 python -c 独立检查。
- `scripts/tests/code-guard.test.mjs`：新增 N1–N5 五组用例。
- 条目 README（复现步骤/期望行为/归因）、design.md、test-cases、test-report。
