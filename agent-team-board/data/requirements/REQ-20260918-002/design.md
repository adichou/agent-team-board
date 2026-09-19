# 设计 — REQ-20260918-002 根目录下的 README.md 不受实施互斥锁约束，允许用户和 Agent 更新以及提交

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

state-guard.mjs 的源码保护以 `realpathAncestralHitsPluginRoot` 判定目标是否插件源码：插件根第一层
的 `README.md`（`rel === 'README.md'`）命中保护，无认领锁时 file 模式（denyIfSourceLocked）与
bash 模式（tokenRealpathHitsPluginRoot → bashRewritesPluginSource 写目标判定）均拦；流程外 git
commit 拦截（第 (5) 节）对 Agent Bash 的 commit 一律要求「仅条目目录用户数据 pathspec + 主题含单号」
（REQ-20260917-002），根 README.md 不在放行范围。

## 方案

（技术选型、接口设计、影响面）

1. **编辑豁免（单点改动，双模式生效）**：`realpathAncestralHitsPluginRoot` 两处判定各加一个精确
   豁免——已存在文件 `rel === 'README.md'`、新建文件（祖先即插件根）`suffix[0] !== 'README.md'`。
   该函数同时是 file 模式（denyIfSourceLocked）与 bash 模式（tokenRealpathHitsPluginRoot 写目标
   归一）的唯一落点判定，单点豁免后：Write/Edit 与 sed/重定向/tee 等写动词的落盘目标为插件根
   README.md 时不再计入「插件源码目标」，无锁放行。`README.en.md`、`AGENTS.md`、`package.json`、
   `bin/` 等其他根下文件按精确字符串匹配不获豁免；`scripts/`、`skills/` 内同名 README.md 的
   rel 形如 `scripts/…/README.md`，不等于第一层 `README.md`，照拦。
2. **提交豁免（第 (5) 节新增第四条授权通道，静态分析口径，与 REQ-20260917-002 定案一致）**：
   - 新增 `isPluginRootReadme(absPath)`：祖先回溯 + realpath 归一后精确判定落点为
     `<PLUGIN_ROOT>/README.md`（兼容软链别名与相对路径，兼容文件尚不存在的回溯形态）。
   - 新增 `pathspecIsPluginRootReadme(spec, baseDir)`：与既有 `pathspecInItemScope` 同一静态
     口径（拒绝 `:`/`^` magic 前缀与 glob 元字符），resolve 后走 `isPluginRootReadme`。
   - `allowed` 改为双通道：① 既有条目目录用户数据通道（不变）；② 全部 pathspec（≥1）均解析为
     插件根 README.md，且提交主题行通过 `validateCommitSubject`（复用 scripts/lib/commit-store.mjs
     既有规范核验：五类前缀 + 描述非空 ≤120 字 + 含单号；单号用 ITEM_ID_RE 从主题行提取）。
   - **范围口径定案（README「待确认」两条）**：提交范围与主题均静态解析命令文本——pathspec 限定
     形态下 git 只提交指定路径的改动，预先 `git add` 的其他文件不进入该提交（且其后续提交仍受
     拦截），无夹带通道；主题行不合规（无单号 / 类型前缀不合 / 描述空或超限）不获豁免，按流程外
     提交原规则拦截。混入受保护源码的 pathspec（`README.md scripts/x.mjs`）不满足「全部均为根
     README.md」，照拦。
   - COMMIT_SCOPE_HINT 提示文案补第四通道说明，拦截提示仍指向既有提交通道。
3. **依赖与测试基建**：state-guard.mjs 顶部静态 `import { validateCommitSubject } from
   './lib/commit-store.mjs'`（规范口径同源，避免复制校验逻辑漂移；模块加载无副作用，hook 短命
   进程无性能影响）。code-guard.test.mjs 的 fake-plugin 副本（只复制过 state-guard.mjs 单文件）
   补复制 scripts/lib/commit-store.mjs，否则伪插件形态下 import 报模块不存在。
4. **文档同步**：根 AGENTS.md「改前先登记」条款加根 README.md 例外（无需认领锁，可直接更新并
   按提交规范带条目编号提交）；根 README.md「关键机制索引 · 认领锁与源码守卫」补豁免口径；
   state-guard.mjs 顶部注释同步。hooks.json / hooks/codex.json 为纯 JSON 无注释结构，其
   statusMessage 描述的是状态守卫职责（不涉及本豁免），不改。
5. **有锁路径**：豁免只放宽拒绝条件，不引入新拒绝路径——有锁时既有放行行为不变（锁存在性仅是
   (4) 的放行条件之一，commit 分支与锁无关）。

**开源选型（REQ-20260909-015）**：本单为守卫内部逻辑改造，无引入第三方库——提交主题规范核验
复用本仓库既有共享内核 lib/commit-store.mjs（自研复用，不涉及外部依赖）；未使用开源库，不创建
licenses.md。

## 风险与边界

- 豁免精确限定 `rel === 'README.md'`（插件根第一层单文件）：大小写敏感（README.md 与现状保护
  判定同口径）、不匹配 `README.en.md` / 目录内同名文件。
- bash 模式下 `mv <根README.md> /tmp`（README 作 mv 源被移出）随之放行——与「README.md 是可
  自由更新的用户文档」的豁免语义一致，非源码保护弱化（源码目录内文件作 mv 源仍拦）。
- 静态提交口径的既有边界（glob / magic pathspec / `-F` 消息文件 / `--amend` 等）全部保持拦截，
  不因新通道放宽。
- 用户终端路径不经钩子，行为不变。
