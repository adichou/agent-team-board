# 设计 — BUG-20260905-001 Bash 守卫误拦只读 sed

## 根因

`scripts/state-guard.mjs` 以单一 `REWRITE_INTENT` 正则判断 Bash 命令片段。正则只要看到 `sed` 或 `>` 就认为
存在改写意图，随后与插件源码路径组合触发拦截，无法表达以下语义差异：

- `sed -n '1,20p' file` 只读取并输出，不修改 `file`；
- `sed -i` / `--in-place` 会原地修改；
- `> /dev/null` 只丢弃输出，而 `> real-file` 会写文件。

该逻辑由 REQ-20260901-003 引入，来源已通过 `atb show REQ-20260901-003` 核验。

## 实施方案

1. 将“是否有改写意图”收敛为独立纯函数，由 status.json 保护和插件源码保护共同调用，避免两处规则漂移。
2. 用轻量 shell token 解析保留单/双引号内容边界，并把未加引号的 `>` / `>>` 识别为独立操作符；不尝试实现
   完整 shell 语法，只覆盖守卫当前支持的常规命令形态。
3. sed 判定分两层：
   - 选项层：`-i`、带备份后缀的 `-i.bak`、组合短选项中的 `i`、`--in-place[=suffix]` 均为改写；
   - 脚本层：从 `-e` / `--expression` 参数和默认脚本参数中提取脚本；命令边界出现 `w/W/r/e` 时为改写，
     不能把 `-e` 选项本身误判为 sed 的 `e` 脚本命令。
4. 重定向逐项检查：目标为 `/dev/null` 的 `>` / `>>` 不构成改写意图；缺失目标或指向其他目标仍按改写处理。
5. `tee/cp/mv/rm/chmod`、`perl -pi`、`python -c` 保持既有判定，`hitsPluginSource` 与认领锁逻辑不改。

## TDD 与影响面

- 先扩展 `scripts/tests/code-guard.test.mjs`，覆盖只读 sed、sed 原地写入、危险脚本命令、`/dev/null` 与普通文件
  重定向；确认新用例在现实现下跑红。
- 再只修改 `scripts/state-guard.mjs` 跑绿，最后执行全部 `scripts/tests/*.test.mjs` 回归。
- 代码影响面仅限上述守卫与测试；条目文档记录根因、用例和报告。

## 风险与边界

- Bash 语法非常宽，本修复保持现有“常规路径确定性拦截”的定位，不扩展为完整 shell 解释器。
- sed 脚本命令解析聚焦 `w/W/r/e` 的起始、地址后和分号/换行命令边界，避免把替换文本中的字母误判为命令。
- `/dev/null` 只豁免输出重定向；`tee` 等独立命令的既有语义不因目标名而放宽。

## 实施记录（2026-09-05）

- 在 `state-guard.mjs` 新增 `splitShellSegments` 与 `shellTokens`：切分 shell 运算符时保留引号内的 sed 脚本，
  仅把引号外 `>` / `>>` 识别为重定向。
- 新增统一 `hasRewriteIntent`，将 sed 原地写入、sed 脚本命令、输出重定向及既有独立改写命令分层判定；
  status.json 与插件源码两处守卫共用该入口。
- sed 脚本解析覆盖默认脚本、`-e` / `--expression` 与组合短选项；原地写入覆盖 GNU/BSD 常见形态。
- Red：新增测试后，B1 只读 sed 与 B4 `/dev/null` 两组按预期失败，退出码均为 2。
- Green：实现后 `code-guard.test.mjs` 原 G1–G6 与新 B1–B6 全绿；补测引号内分号脚本及 `&>/dev/null` 也通过。
- 回归：沙箱内网络集成测试因监听 `127.0.0.1` 被 EPERM 拒绝；在允许本机临时端口的环境重跑后，
  16 个测试脚本、105 个命名用例全部通过。
