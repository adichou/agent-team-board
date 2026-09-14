# BUG-20260907-013 测试用例

测试文件：插件 `scripts/tests/code-guard.test.mjs`（C 组新增 + B5/B6/N3 判例演进）。
运行：`node scripts/tests/code-guard.test.mjs`（cwd 无有效认领锁的临时目录模拟无锁环境）。

## C 组：写目标语义关联（本 Bug 修复面）

| 编号 | 命令形态（无锁） | 期望 | 说明 |
| ---- | ---- | ---- | ---- |
| C1 | `ATB_PORT=8123 node <插件>/scripts/server.mjs > /tmp/agent-team-board.log 2>&1` | 放行 | 本 Bug 原始场景：执行插件脚本 + 日志写 /tmp |
| C1 | `node <SRC> > /tmp/out` / `node <SRC> >> /tmp/out` | 放行 | 写目标在插件外（B5 判例演进：原期望拦截） |
| C2 | `echo x > <插件>/scripts/new.js`（新文件） | 拦截 | 重定向目标是插件源码路径 |
| C2 | `node x 2> <插件>/scripts/err.log` | 拦截 | stderr 重定向目标在插件内 |
| C2 | `cp /tmp/a <插件>/scripts/b` / `cp -t <插件>/scripts /tmp/a` | 拦截 | cp 写目标（末操作数 / -t 值）在插件内 |
| C2 | `mv <SRC> /tmp/out` | 拦截 | mv 源操作数被移出插件根，源与目的地均计目标 |
| C2 | `find <插件>/scripts -name '*.mjs' -delete` | 拦截 | -delete 删除遍历树：起点即写目标（N3 原有用例保持） |
| C2 | `find /tmp -name x -fprint <插件>/scripts/list.txt` | 拦截 | -fprint 族取值是写目标 |
| C3 | `cp <SRC> /tmp/out` | 放行 | cp 源仅被读取，写目标在插件外（B6 判例演进） |
| C3 | `find <插件>/scripts -name 'atb.mjs' -fprint /tmp/atb-out` | 放行 | 遍历仅读取，清单写 /tmp（N3 判例演进） |
| C3 | `cat <SRC> \| tee /tmp/out` | 放行 | 切段后 tee 段无插件路径 |

## 判例不回归（沿用既有用例）

- sed -i / --in-place / -i.bak 原地改写插件源码：拦截（B2）。
- sed 的 w/W/r/e 脚本命令触碰插件源码：拦截（B3，目标在脚本文本内不可静态解析，回退段级检测）。
- 重定向 /dev/null、只读 sed、解释器执行脚本文件：放行（B1/B4/N4）。
- tee/rm/chmod 直接作用于插件源码：拦截（B6）。
- 解释器内联代码（node -e 等）提及插件源码路径：拦截（N3，目标不可静态解析，回退段级检测）。
- perl -pi 原地改写：拦截（N5）。
- 软链别名路径改写源码、写插件内新文件：拦截（S1–S4）。
- 有效认领锁期间：全部放行（G3）。
