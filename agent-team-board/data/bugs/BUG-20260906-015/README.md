# BUG-20260906-015 state-guard PLUGIN_ROOT 多解析一层：docs 豁免永不生效，无锁时条目 markdown 误被拦截

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-06T14:29:13.424Z

## 现象

state-guard.mjs 用 path.resolve(dirname(脚本), '..','..') 解析插件根，从 scripts/ 上跳两层得到插件根的父目录（软链形态=仓库父目录；缓存形态=版本容器目录）。后果：isPluginSource 的 docs/ 前缀豁免分支永不命中，无认领锁时 Write/Edit 条目 markdown（README/design 等）也被拦，违反 SKILL.md「可直接编辑条目下 markdown」；同时保护范围整体上移一层。复现：用 hook 输入 JSON（file_path 指向任意 docs/agent-team-board 下的 md）喂 state-guard.mjs file，期望放行，实际 exit 2

## 复现步骤

1. 在无有效认领锁的 cwd（如任意临时目录）执行：
   `echo '{"tool_name":"Write","tool_input":{"file_path":"<任意 docs/agent-team-board 下的 md 绝对路径>"}}' | node scripts/state-guard.mjs file`
2. 期望放行（exit 0），实际 exit 2，报「插件源码受保护」。

## 期望行为

- `PLUGIN_ROOT` 应解析为插件根（`scripts/` 上跳**一层**），使 `isPluginSource` 的 `docs/` 前缀豁免对插件根内看板数据目录生效：无锁时 Write/Edit 条目 markdown（README/design 等）放行，status.json 直写仍拦。
- 保护范围收敛回插件根内：插件根**同级**其他项目的文件不再被误当插件源码拦截。

## 关联（引入来源）

- 引入来源：REQ-20260901-003（其 design 方案一即写明「以 `import.meta.url` 向上两级解析真实路径」，但守卫脚本位于 `<插件根>/scripts/`，上跳两级得到的是插件根的**父**目录；实施照方案落地，docs 豁免与保护范围自此双双错位）。
