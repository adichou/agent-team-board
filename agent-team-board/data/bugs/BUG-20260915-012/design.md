# 定位与实施记录 — BUG-20260915-012

## 根因分析与证据边界

已排除本仓库当前生成/复制代码主动去除 LF。新增测试从真实 app.js 提取 buildDocRef 和 copyPlain，捕获 Clipboard API 参数以及降级 textarea 的复制值；验证逐字相等、末尾字符码 10、降级清理。此为模拟浏览器 API 的单元测试，不代表操作系统实际剪贴板或 Codex UI 测试。

本机 `/Applications/ChatGPT.app/Contents/Resources/app.asar` 只读检查：

- `webview/assets/app-primary-6cd7b8b3f5e3.js`：`mZt` 创建 composer；`handlePaste(e,t)` 从 `text/plain` 读取 `o`。`c=o?.trim()` 仅用于图片/文件判断，并未取代后续插入变量 `o`。
- Markdown 分支调用 `nbe(_.pmu,fZt(o),...)` 或 `De({schema:...,text:o,...})`，随后 `replaceSelection(...)`。没有在该分支依据原始文本末尾 LF 追加空段落。
- `webview/assets/app-initial-cadb12d4a15e.js`：`F5a` 调用 `e.parse(t)`，再由解析结果创建 slice；普通文本插入函数 `z7a` 则以 `t.split('\n')` 创建段落。
- Markdown 会将格式文本转换成结构化节点，单个终止换行不一定对应空段落。因此接收端 Markdown 路径是与用户跨应用反馈一致的主要假设，尚未实测证实。

Codex 版本：26.901.51231。压缩符号名和资源文件名仅适用于这份本机安装包。未复制安装包源码到仓库，未修改安装包。

## 实施选择

本单用户明确要求「请定位」。只增加边界回归测试、补充定位与验收文档，不为了制造红绿过程改动已有正确行为。新测试当前直接通过，诚实记录为诊断回归测试；未发生业务修复的 TDD 红→绿周期。

不引入开源依赖：Node 内置 assert/fs/vm 足以验证复制边界，引入库成本高于需求。只读拆包使用项目已有 @electron/asar。

## 引入来源

未定位（已检查两项前单及当前生成/复制实现；疑似外部 Codex 输入框行为，无外部历史源码可验证）。前单不是该接收端问题的已确认引入来源。

## 限制与后续

CUA 工具明确拒绝控制 `com.openai.codex`：Computer Use is not allowed to use the app for safety reasons。未绕过限制。需人工在实际 Codex 输入框进行普通文本/编号列表/完整提示词三组对照，才能将主要假设升级为确认根因。
