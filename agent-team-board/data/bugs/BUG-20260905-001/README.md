# BUG-20260905-001 源码保护的 Bash 守卫把只读 sed 误判为改写意图（读操作被拦）

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-05T07:51:31.254Z

## 现象

state-guard.mjs 第 108 行 REWRITE_INTENT = /(\bsed\b|\btee\b|\bcp\b|\bmv\b|\brm\b|\bchmod\b|>|>>|perl\s+-pi|python3?\s+-c)/i 只做词法匹配：sed -n '1,20p' 插件源码这类纯读命令因含 sed 一词即被判为改写意图，叠加 hitsPluginSource + 无认领锁 → 误拦。注释声称『只读放行』但实现未区分。修复方向：对 sed 段做读写判别（出现 -i/--in-place 或 w/W/r/e 脚本命令才算改写；BSD sed 的 -i 备份后缀形态 -i '' 也要覆盖）；cp/mv/rm/chmod/tee/> 语义保持；重定向 > 需排除 >/dev/null 之类丢弃目标。验收：只读 sed 读插件源码放行；sed -i 改源码仍拦；> /dev/null 放行；> 实文件仍拦；现有守卫用例不回归。

## 复现步骤

1. 在没有有效认领锁的项目目录中，通过 Bash 守卫检查只读命令：
   `sed -n '1,20p' <插件根>/scripts/state-guard.mjs`。
2. 观察守卫因命令片段同时命中 `sed` 与插件源码路径而返回退出码 2。
3. 对照执行 `cat <插件根>/scripts/state-guard.mjs`，该命令返回退出码 0。

## 期望行为

- `sed -n`、普通替换脚本但未使用原地写入的 sed 命令属于只读操作，应放行。
- `sed -i`、`sed --in-place` 及含 `w/W/r/e` 危险脚本命令的 sed 操作仍应拦截。
- 输出重定向到 `/dev/null` 应放行，重定向到普通文件仍应拦截。
- `cp/mv/rm/chmod/tee` 等既有改写意图与全部守卫回归用例不受影响。

## 根因分析与修复

【引入来源：REQ-20260901-003（新增 Bash 插件源码保护时，以包含 `sed` 或 `>` 的单一正则近似改写意图，
没有区分 sed 的只读/原地写入语义，也没有区分丢弃型与文件型输出重定向；来源 ID 已通过 `atb show` 核验）】

修复采用局部语义判定替换宽泛词法命中：轻量解析命令片段并保留引号边界；sed 仅在出现原地写入选项或
`w/W/r/e` 脚本命令时视为改写；输出重定向逐项检查目标，目标仅为 `/dev/null` 时不视为改写；其余既有
改写命令保持原语义。完整实施记录与验证结果分别见 `design.md`、`test-cases.md` 和最终 `test-report.md`。

## 关联

- 引入来源：REQ-20260901-003（引入 Bash 插件源码保护及宽泛 `REWRITE_INTENT` 判定）
