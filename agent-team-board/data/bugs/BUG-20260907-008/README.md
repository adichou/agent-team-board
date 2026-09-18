# BUG-20260907-008 插件源码保护可经符号链接路径绕过：守卫仅认 realpath 与 agent-team-board/<受控目录> 邻接形态

- 状态：in-progress（实施中）
- 归属需求：无（独立 Bug）
- 创建：2026-09-07T09:00:50.809Z

## 现象

生产钩子经 ~/.zcode/cli/plugins/cache/personal/agent-team-board/0.1.0/scripts/state-guard.mjs 调起，其 PLUGIN_ROOT 经 realpathSync 解析到源码仓库（符号链接被解析）。Bash 模式的 hitsPluginSource 只匹配：

1) 命令文本包含 realpath 后的插件根；2) 正则 agent-team-board/(scripts|commands|…) 邻接形态。

通过符号链接路径改写源码两者都不命中（cache 形态中间隔了版本号目录 `agent-team-board/0.1.0/scripts/…`，邻接正则同样落空）。生产形态实测（cache 守卫 + 无有效认领锁 cwd）：

`echo hacked > /Users/adichou/.zcode/cli/plugins/cache/personal/agent-team-board/0.1.0/scripts/web/app.js` → 放行（exit 0），实际写中仓库源文件。

## 复现步骤

1. 取一个无有效认领锁的 cwd（如临时目录，向上找不到带 .locks/ 的看板）。
2. 经 cache 软链路径改写源码：`echo hacked > ~/.zcode/cli/plugins/cache/personal/agent-team-board/0.1.0/scripts/web/app.js`。
3. 守卫 bash 模式 exit 0 放行，仓库源文件被写入（file 模式因 realpathSync 解析别名不受影响）。

## 期望行为

- 无有效认领锁时，命令文本中任何指向插件源码的路径形态——含符号链接别名（cache 形态）、`~` 前缀、经别名写尚不存在的新文件——都应被识别为源码目标并拦截（exit 2）。
- 只读命令（cat、运行测试等）不受影响；docs/ 看板数据目录豁免照旧；别名指向非插件目录时不误拦。

## 修复记录

- `scripts/state-guard.mjs`：hitsPluginSource 在原有两种文本形态外，对命令文本的路径形态 token 做符号链接归一化（tokenRealpathHitsPluginRoot）：`~` 展开 → resolve(cwd) → 目标存在则 realpath、不存在则上溯最近存在祖先 realpath；落在插件根内（docs/ 豁免；祖先即插件根时由剩余段决定落点）即命中。选项 / 环境变量 / URL / 非路径 token 跳过，避免误拦。isPluginSource 与新判定共用 isUnderPluginRoot，行为不变。
- `scripts/tests/code-guard.test.mjs`：新增 S1–S5（别名改写既有源码、别名写新文件、file 模式别名回归、`~` 前缀、误报回归）。

## 关联（引入来源）

- 引入来源：REQ-20260901-003（引入插件源码认领锁保护的两层守卫，其中 Bash 模式 hitsPluginSource 采用 realpath 子串与 `agent-team-board/<受控目录>` 邻接正则两种纯文本匹配，未对命令文本路径做符号链接归一化，软链别名形态可绕过）
- 排查中新发现的相邻缺口已另立 Bug：守卫 file 模式对「新建文件」目标不做源码判定（existsSync 前置导致），见 BUG-20260908-001。
