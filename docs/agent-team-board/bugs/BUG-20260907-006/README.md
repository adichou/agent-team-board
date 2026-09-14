# BUG-20260907-006 状态守卫可被引号拆词绕过：atb st""atus / ac""cepted 形态执行人工专属流转不被拦截

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-07T09:00:50.736Z

## 现象

## 现象
state-guard.mjs bash 模式把命令中引号字符替换为空格再切 token（seg.replace(/["']/g,' ')），而 shell 语义是「引号内为同一词的一部分」。因此：
- atb st""atus REQ-xxx accepted（shell 实际执行 atb status … accepted）
- atb status REQ-xxx ac""cepted（实际目标 accepted）
token 化后分别变成 [st,atus] / [ac,cepted]，守卫找不到 'status'/'accepted' 关键 token，放行（stdin 喂入实测 exit 0）。

## 复现
向 state-guard.mjs bash 模式喂 {"tool_input":{"command":"atb st""atus REQ-20260907-001 accepted","cwd":"/tmp"}} → exit 0（应 exit 2）。

## 建议
token 化前先做「引号内拼接」归一（把成对引号删除而非替换为空格），再匹配关键词；或对整个 segment 做去引号后的子串匹配。

## 影响
宣称「确定性拦截」的人工专属状态防线存在文本层绕过；与 BUG-20260905-001（误报方向）同为守卫 token 化精度问题。

## 复现步骤

1. 向 `state-guard.mjs` bash 模式喂入（stdin）`{"tool_input":{"command":"atb st\"\"atus REQ-20260907-001 accepted","cwd":"/tmp"}}`。
2. 观察退出码：实际 exit 0（放行），shell 真实语义是执行 `atb status … accepted`（人工专属流转）。

## 期望行为

- bash 模式 token 化遵循 shell「引号内拼接」语义：成对引号删除而非替换为空格，`st""atus` / `ac""cepted` 归一为 `status` / `accepted` 后参与关键词匹配，人工专属流转命令被拦截（exit 2）。
- 同一归一化应用于 status.json / 人工 API 路径的子串匹配，杜绝同类拆词绕过。
- 引号包裹的普通文本（如 `--summary "…st\"\"atus…"`）、拆词形态的只读命令不新增误拦。

## 关联（引入来源）

- 引入来源：未定位（排查过程：插件目录非 git 仓库、无版本历史可查；检索看板全部条目文档，最早提及 bash 模式的 REQ-20260831-001 与 REQ-20260901-003 的 design 均描述守卫及其 `seg.replace(/["']/g,' ')` 切词「此前已存在」，本批看板内无引入该行的条目——naive 切词随插件初始 state-guard 脚手架带入，早于看板日志化。同病不同向的 BUG-20260905-001 亦归因至守卫 token 化精度。）
