# 测试用例 — BUG-20260915-012

| 用例 | 预期 | 结果 |
| --- | --- | --- |
| Clipboard API 主路径 | copyPlain 写入值与 buildDocRef 返回值逐字相同，末尾一个 LF | 通过（API 桩） |
| execCommand 降级路径 | 全选 textarea 值保留一个 LF，完成后移除 textarea | 通过（DOM 桩） |
| 原有右键讨论 T1–T9 | 引用、讨论要求、末尾 LF 保持 | 通过 |
| req-disc D1–D7（含 D2b） | 启动/收尾文本与状态读写回归 | 通过 |
| oncall P1–P8 | 四类提示词末尾 LF 与提交约定回归 | 通过 |
| Codex 普通文本、编号列表、完整提示词三组粘贴后输入标记 | 明确是否为 Markdown 路径吞末尾空行 | 未执行：CUA 禁止控制 Codex |

本次为定位任务，没有业务代码修改，没有红→绿修复记录。上述单元测试不等价于跨应用端到端粘贴测试。
