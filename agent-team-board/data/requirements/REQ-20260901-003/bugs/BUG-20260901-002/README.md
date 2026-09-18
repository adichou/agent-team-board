# BUG-20260901-002 守卫 Bash 模式误报：命令文本提及看板目录与状态文件名即被拦

- 状态：in-progress（已认领 zcode-bash-guard-fp，待人工确认完成）
- 归属需求：REQ-20260901-003
- 创建：2026-09-01T03:45:54.705Z

## 现象

现象：执行合法的看板登记命令（atb new req）时被 PreToolUse 守卫拦截，原因仅是命令参数的描述文本中同时出现了看板数据目录路径与机器状态文件名两个字样——守卫把它们当成要触碰该文件的命令片段误判。影响：任何描述里需要提及这两个词的登记、查询类命令都会被误拦（本条 Bug 的登记命令也不得不改措辞绕开）。根因（初步）：守卫脚本 bash 模式对每个命令切段做「片段同时匹配目录名与文件名即拒绝」的启发式判断，未区分「引用提及」与「实际写入路径」，也没有白名单 atb 子命令。期望：1) atb 合法子命令（new、list、show、claim、report、move、init）不受该启发式误拦；2) 仅在片段存在真实写入语义（重定向、sed -i、tee、rm 等落盘动词）时才拒绝；3) 现有对越权状态写入的拦截能力不回退（用原攻击样例回归）。引入来源：初版守卫脚本的启发式设计（未定位到具体需求编号，排查过程：git 不可用，按仓库历史文档比对，初版即如此）。

## 复现步骤

1. Agent 执行 `node <插件>/scripts/atb.mjs new req "标题" --desc "…docs/agent-team-board…status.json…"`
   （命令描述文本同时含看板数据目录与状态文件名字样）；
2. 旧版守卫 bash 模式对每个命令切段做「同时匹配目录名与文件名即拒绝」启发式，PreToolUse exit 2，
   合法登记命令被拦。

## 期望行为

- [x] atb 合法子命令（new、list、show、claim、report、move、init）命令文本提及看板目录与
  status.json 字样不被误拦（code-guard.test.mjs F1）
- [x] 仅当片段存在真实写入语义（重定向、sed -i、tee、rm 等落盘动词）且目标为路径形态
  `/status.json` 时才拒绝（F2 放行只读提及；F3 回归改写仍拦）
- [x] 现有对越权状态写入的拦截能力不回退：原攻击样例（echo 重定向 / sed -i / tee / rm 写
  status.json）仍全部拦截（F3）

## 备注（2026-09-02）

- 修复已随 REQ-20260901-003 一并落地（其 design 开放点 3 取默认）：state-guard bash 模式对 status.json 的
  拦截增加「改写 intent + 路径形态目标」双条件，cat/ls/grep 等只读命令与纯文字提及均放行
  （code-guard.test.mjs G5 覆盖）。本条目接受 + 对齐后可直接确认完成。

## 关联（引入来源）

- 引入来源：未定位（初版守卫脚本的启发式设计。排查过程：仓库非 git 无法追溯提交历史；遍历
  requirements/ 各条目 README，仅 REQ-20260901-003 与 REQ-20260905-003 提及守卫/state-guard，
  均晚于守卫初版，误报初版即存在）。
- 修复归属：REQ-20260901-003（design 方案 3「同时顺带修复 BUG-20260901-002」）。
- 2026-09-05 /dev（zcode-bash-guard-fp）：核验修复有效，补 F1–F3 回归测试，见 test-cases.md / design.md。
