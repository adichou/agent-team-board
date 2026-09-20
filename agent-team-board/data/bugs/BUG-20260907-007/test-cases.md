# 测试用例 — BUG-20260907-007 状态守卫改写意图检测缺口：node -e 写入与 find -delete 删除 status.json 均放行

> TDD：在 `scripts/tests/code-guard.test.mjs` 中通过子进程执行真实 `state-guard.mjs bash`，新增 N1–N5 组用例（${board} 为临时项目看板、${SRC} 为受保护源码样本、cwd 无认领锁）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 解释器内联代码改写 status.json 应拦截（exit 2）：`node -e/--eval/-p "…writeFileSync(…/status.json,…)"`、`ruby -e "File.write(…/status.json,…)"`、`perl -e "unlink(…/status.json)"`、`python3 -c "open(…/status.json,'w')"` | P0 | ✓ |
| T2 | find 写动作删改 status.json 应拦截：`find <board> -name status.json -delete / -fprint / -fprint0 / -fprintf / -fls` | P0 | ✓ |
| T3 | 解释器内联代码与 find 写动作触碰插件源码应拦截：`node -e "rmSync(<SRC>)"`、`node --eval=…`、`ruby -e "File.delete(<SRC>)"`、`find <插件>/scripts -name '*.mjs' -delete / -fprint` | P0 | ✓ |
| T4 | 误报回归（exit 0）：`node <插件>/scripts/atb.mjs show …`（node 接脚本操作数）、`node --version`、`python3 -m json.tool …/status.json`、只读 `find <board> -name status.json`、`find <插件>/scripts -name '*.mjs' \| head -3`、`atb report --summary "提及 node -e 与 find -delete 字样"`、`echo "文本提及 node --eval 与 find -delete"` | P0 | ✓ |
| T5 | perl 形态回归：`perl -pi -e 's/a/b/' <SRC>`、`perl -pi.bak 's/a/b/' <SRC>`、`perl -e 'unlink(glob("…/status.json"))'` 均拦截 | P0 | ✓ |
| T6 | 既有守卫用例全部回归：G1–G6 / B1–B6 / Q1–Q5 / P1–P4 / F1–F3 不受改动影响 | P0 | ✓ |

## 执行记录

- Red：`node scripts/tests/code-guard.test.mjs` 返回 1；N1/N2/N3/N5 精准失败（node -e/--eval/-p、ruby -e、find -delete/-fprint 族全部 exit 0 放行，与 README 复现一致），N4 误报回归与既有 24 个用例通过，证明测试捕获现有缺陷而非环境问题。
- Green：同一命令返回 0；code-guard 全部 29 个命名用例通过（原 24 + 新 N1–N5），无任何既有用例回归。
- 全量回归：`node scripts/tests/run-all.mjs` 67 个测试文件、失败 0。
- 原样复现验证：stdin 喂入 README 复现命令 `node -e "require('fs').writeFileSync('<项目>/docs/agent-team-board/requirements/REQ-x/status.json','{}')"` 与 `find <项目>/docs/agent-team-board -name status.json -delete` → 均 exit 2 并提示人工专属状态指引；对照只读 `node atb.mjs list`、`find … -name status.json` → exit 0。
- 覆盖率口径：本条验收用例覆盖 6/6（100%）；项目未配置语句/分支覆盖率采集。
