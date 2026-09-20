# BUG-20260907-013 实施记录

## 方案：改写意图与插件源码按「写目标」语义关联

改动文件：插件 `scripts/state-guard.mjs`（bash 模式第 (4) 检查）。

### 核心变更

1. 新增 `rewriteTargetTokens(tokens)`：提取段内每个写动作的落盘目标 token：
   - `>` / `>>` → 操作符后随操作数（`&fd` 引用不是文件目标）；
   - `tee` → 全部非选项操作数；`mv` / `rm` / `chmod` → 全部非选项操作数（mv 源被移出插件根同样是改写）；
   - `cp` → 末操作数与 `-t/--target-directory` 值（源操作数仅被读取，与 `cat <SRC> >/tmp` 同口径）；
   - `sed -i` → 新增 `sedFileOperands`（与 sedScripts 同一选项扫描骨架）取首个脚本 token 之后的文件操作数；
   - `perl -pi` → 脚本（-e 参数或裸操作数）之后的文件操作数；
   - `find` → `-delete` 取起点路径（删除遍历树）；`-fprint/-fprintf/-fprint0/-fls` 取选项值（起点仅被遍历读取）；
   - `<` 输入重定向对是读取来源，不计入写目标。
2. 新增 `bashRewritesPluginSource(seg, norm)`：`hasRewriteIntent && hitsPluginSource` 快速短路后，解析写目标并逐一 `tokenRealpathHitsPluginRoot` 判定；**目标不可静态解析（解释器内联代码、sed w 脚本、残缺命令）时回退段级检测保守拦截**，保护面不弱于旧实现。
3. 第 (4) 检查替换为 `!hasValidClaimLock(hook.cwd) && bashRewritesPluginSource(seg, norm)`。status.json 检查（第 1 项）与人工状态检查（第 2、3 项）不动。

### 判例演进（旧用例更新，均在「读/遍历插件源码 + 写插件外文件」同口径下）

| 命令 | 旧 | 新 |
| ---- | ---- | ---- |
| `node <插件源码> > /tmp/out` / `>>`（B5） | 拦 | 放 |
| `cp <插件源码> /tmp/out`（B6） | 拦 | 放 |
| `find <插件>/scripts -name x -fprint /tmp/out`（N3） | 拦 | 放 |
| `node <插件源码> >`（残缺命令，B5） | 拦 | 拦（保守） |

### 已知边界（静态检测面之外，与旧实现一致）

- 变量形态路径（`$P/x`）、`find / -name x -delete` 这类起点为 `/` 的遍历删除不命中（确定性守卫非安全边界，旧实现同样检测不到变量路径）。
- 解释器内联代码（`node -e` 等）内的路径无法 token 化提取，维持段级回退拦截（N3 判例）。

## 验证

- `scripts/tests/code-guard.test.mjs`：新增 C1/C2/C3 三组，更新 B5/B6/N3 判例，35 用例全绿。
- `scripts/tests/run-all.mjs` 全量回归：70 个测试文件，失败 0。
- 无锁冒烟（直接以 hook 输入调用守卫）：启动 server 重定向日志 → 放行；`echo >` / `tee` 写插件源码 → 拦截，无文件副作用。
