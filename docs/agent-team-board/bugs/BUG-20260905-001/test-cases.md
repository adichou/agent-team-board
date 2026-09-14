# 测试用例 — BUG-20260905-001 Bash 守卫误拦只读 sed

> TDD：在 `scripts/tests/code-guard.test.mjs` 中通过子进程执行真实 `state-guard.mjs bash`。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 无锁时 `sed -n '1,20p'` 读取插件源码应放行 | P0 | ✓ |
| T2 | 无锁时未使用原地写入的普通 sed 替换脚本应放行 | P0 | ✓ |
| T3 | GNU `sed -i` / `--in-place` 与 BSD `sed -i ''` 读取插件源码路径时仍拦截 | P0 | ✓ |
| T4 | sed 脚本中的 `w/W/r/e` 命令仍视为改写并拦截，`-e '1,20p'` 不误报 | P0 | ✓ |
| T5 | 插件源码命令的 `> /dev/null`、`2>/dev/null` 与带引号目标应放行 | P0 | ✓ |
| T6 | 插件源码命令重定向到普通文件或缺失目标时仍拦截 | P0 | ✓ |
| T7 | `cp/mv/rm/chmod/tee` 等既有改写命令和 G1–G6 守卫用例全部回归通过 | P0 | ✓ |

## 执行记录

- Red：`node scripts/tests/code-guard.test.mjs` 返回 1；B1（只读 sed）与 B4（`/dev/null`）失败，证明测试捕获现有缺陷。
- Green：同一命令返回 0；原 G1–G6 与新 B1–B6 共 12 个命名场景全部通过，其中 B1–B6 覆盖本表 T1–T7。
- 边界补测：引号内 `1p;w /tmp/out` 仍拦截，`&>/dev/null` 放行。
- 全量回归：在允许监听本机临时端口的环境执行全部 `scripts/tests/*.test.mjs`，16 个脚本、105 个命名用例全绿。
- 覆盖率口径：本条验收用例覆盖 7/7（100%）；项目未配置语句/分支覆盖率采集。
