# REQ-20260903-003 一键派发升级：codex 用自带 CLI 拉起终端新会话（自动执行提示词）；zcode 深链打开项目工作区（会话标题以单号关联）

- 状态：submitted（待人工接受）
- 创建：2026-09-03T02:00:48.212Z
- 前置：REQ-20260902-004（v1「复制提示词」派发，已交付待人工确认）；本条为其「真·一键」升级

## 背景 / 诉求

用户原话（两轮）：能不能支持 codex 的一键打开新会话？zcode 的不要在旧会话中输入提示词——希望一键打开新会话，并且会话名设置为单号。随后追问 codex 是否有更好方案（例如安装 CLI）。

实机调研结论（2026-09-03）：

- **codex CLI 已自带且免登录**：`/Applications/ChatGPT.app/Contents/Resources/codex`（codex-cli 0.151.0，Mach-O arm64），与桌面版共用 `~/.codex`（`codex login status` 实测 Logged in using ChatGPT）。关键能力：`codex [PROMPT]` 位置参数即初始提示词并自动开始执行（文档化用法）、`-C/--cd <dir>` 精确指定工作根目录、会话支持名字（archive/delete 均「by id or session name」）。
- 备选通道：桌面 app 注册了 `codex://` scheme，存在 `codex://threads/new?prompt=<文本>` 深链（app.asar 内部构造格式，未文档化）——降级为 fallback。
- ZCode 注册了 `zcode://` scheme，但路由仅 `workspace/open?path=<路径>`（官方 Finder「在 ZCode 中打开」workflow 同款）与 oauth/payment 回调；没有「新建会话 / 注入提示词 / 命名」深链，本机也无 zcode CLI 可执行文件。

## 方案对比（codex 侧，为何选 CLI）

| | A. 深链 threads/new | **B. 自带 CLI + 终端（选定）** | C. codex exec 无人值守 |
|---|---|---|---|
| 一键程度 | 预填提示词，可能仍需回车 | **提示词自动开始执行** | 全自动后台 |
| 项目绑定 | 靠 app 项目上下文，不精确 | **`-C` 精确 = 看板项目根** | 同 B |
| 稳定性 | prompt 参数未文档化 | **文档化用法** | 文档化 |
| 会话名/单号 | 自动标题 | **终端标签标题精确设为单号**；会话自动标题含单号 | 无交互面 |
| 体验 | 桌面 GUI | 终端 TUI | 板上看日志 |

C（server 直接 `codex exec` 后台跑、板上看进度）留作后续独立需求，本期不做。

## 界面与交互（接受即视为设计认可）

布局：详情抽屉内 accepted 条目的「一键派发」区保持两按钮（沿用 REQ-20260902-004 的位置与样式），行为升级：

- **派发给 codex（CLI 方案）**：点击 → ① 派发提示词先写入剪贴板（常驻兜底）；② 调用服务端新增的派发端点，由 server 生成临时 `.command` 脚本（内容：设置终端标签标题为单号 → `cd <项目根>` → 执行内置 CLI `codex -C <项目根> "<提示词>"`）并用 `open` 打开——macOS 会新开一个 Terminal 标签自动执行，无需 AppleScript/TCC 授权；③ 按钮短暂显示「已拉起 Codex 会话 ✓」。
- **派发给 zcode**：点击 → ① 提示词写入剪贴板；② 构造 `zcode://workspace/open?path=<encodeURIComponent(state.project)>` 触发跳转，打开/聚焦 ZCode 中该项目工作区（用户在出现的会话里 Cmd+V 发送）；③ 按钮短暂显示「已复制并打开 ZCode ✓」。
- 状态反馈：成功/失败沿用现有按钮态与 toast；深链触发本身静默。
- 提示词模板沿用 v1：zcode 版首行即 `/dev <ID>`（保证自动标题含单号）；codex 版为 skill 指引措辞、含完整单号。
- 服务端改动：新增一个本地派发端点（仅 127.0.0.1）负责生成并 `open` 上述 `.command`；CLI 路径探测不到（ChatGPT.app 未装/被移走）时端点返回降级信号，前端回退 `codex://threads/new?prompt=` 深链，再不行剪贴板兜底。

## 边界（明确不做 / 做不到）

- zcode 会话名不可程序化设置：无深链参数可控，仅靠提示词首行单号使自动标题**含**单号（近似关联，不保证标题精确等于单号）。
- codex 终端标签标题可精确设为单号，但 Codex 会话列表内的名字仍是自动标题（含单号，不保证精确等于单号）。
- `codex://threads/new` 的 prompt 参数与 CLI 的启动行为均以实测为准；剪贴板兜底常驻，拉起失败静默降级。
- 不用 computer-use/UI 自动化操控界面；`codex exec` 无人值守不在本期。

## 验收标准

- [ ] codex 按钮点击后新开 Terminal 标签，标题为单号，codex 会话在正确项目根下自动开始执行派发提示词（含完整单号）。
- [ ] ChatGPT.app 缺位时自动回退深链/剪贴板兜底，按钮态如实反馈。
- [ ] zcode 按钮点击后 ZCode 打开/聚焦当前看板项目的工作区（path = 当前项目根），提示词已在剪贴板，模板首行为 `/dev <ID>`。
- [ ] 深链构造与 `.command` 生成逻辑有 node:assert 单测（URL 编码、路径与单号注入、脚本内容不含未转义注入）；复制兜底路径保留。
- [ ] 手工验收记录写入 test-report.md。
