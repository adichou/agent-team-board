# BUG-20260908-001 守卫 file 模式不拦新建文件：无锁可经 Write 在插件源码目录新建文件

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-07T16:19:21.062Z

## 现象

denyIfSourceLocked 先 existsSync 再 isPluginSource(realpath)，目标文件不存在（新建）时直接跳过源码判定。实测（无锁 cwd）：file 模式 Write 到 <插件根>/scripts/brand-new-file.mjs 或经 cache 软链别名同路径均 exit 0 放行。Bash 模式经 BUG-20260907-008 修复的最近存在祖先回溯已覆盖新建场景，file 模式未覆盖。建议与 tokenRealpathHitsPluginRoot 同口径：目标不存在时上溯最近存在祖先做 realpath 判定（docs/ 豁免照旧）。

## 复现步骤

1. 在无认领锁的 cwd（如 /tmp）下向 state-guard.mjs file 模式下发 Write 输入：
   `{"tool_name":"Write","cwd":"/tmp","tool_input":{"file_path":"<插件根>/scripts/brand-new-file.mjs"}}`
   （`<插件根>` 用真实仓库路径或 `~/.zcode/cli/plugins/cache/…` 软链别名均可）。
2. 修复前守卫 exit 0 放行，新文件可无锁落在插件源码目录。

## 期望行为

目标文件不存在（新建）时，file 模式上溯最近存在的祖先做 realpath 判定，与
tokenRealpathHitsPluginRoot（BUG-20260907-008）同口径：落点在插件根内且非 docs/
即拦截；docs/ 看板数据豁免、插件根外目标、有效认领锁期间照旧放行。

## 关联（引入来源）

- 引入来源：REQ-20260901-003（引入 file/bash 两层源码守卫，file 模式原始实现
  `isPluginSource` 注释即写明「不存在会抛错，调用方先 existsSync」，新建文件场景
  从未进入源码判定；Bash 侧后续经 BUG-20260907-008 补了最近存在祖先回溯，file 侧未同步）
