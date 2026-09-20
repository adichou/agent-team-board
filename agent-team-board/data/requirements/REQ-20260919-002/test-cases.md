# 测试用例 — REQ-20260919-002 需求开发中遇到需人工决策的时候，决策界面需要优化布局

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：scripts/tests/req-20260919-002.test.mjs（前端静态契约 + VM 渲染 + i18n 词典）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| A1 | 聚合区卡片信息分层：card-top 元信息行（单号 / 旗标 / 等待时长靠右 hold-wait）、card-title、hold-q-summary（unanswered-count 计数徽标）、hold-acts 四层结构齐备 | 高 | 通过 |
| A2 | 操作分主次两组：acts-primary 含补决策（primary）+ 复工（accent），acts-secondary 含查看进展记录 + 确认完成（ghost 弱化），组间虚线分隔（CSS acts-secondary border-left） | 高 | 通过 |
| A3 | 问题列表组织：未答问题置前且保持 open 加粗；已答默认收起为 data-hold-fold「已答 n 项」按钮（aria-expanded=false），点击展开显示已答问题（aria-expanded=true）；全未答不渲染折叠按钮 | 高 | 通过 |
| A4 | 区头可见性增强：hold-area-head 含「⚠ 待人工确认」文本与 hold-count 计数徽标；hold-area 整区面板化（背景 / 边界描边样式） | 高 | 通过 |
| A5 | 轮询签名剪枝纳入已答折叠态（answeredOpen 进签名），重绘不丢折叠态 | 中 | 通过 |
| B1 | 面板常驻进度条：index.html 有 #holdProgress 且位于头部与内容区之间（flex: none 不压缩）；渲染含「未答 x/y」pill 与提示文案 | 高 | 通过 |
| B2 | 进度实时更新：loadHoldQuestions 渲染表单后更新进度条；saveHoldAnswers 保存后随 refreshHolds 同步更新 | 高 | 通过 |
| B3 | 首个未答可达：打开面板聚焦首个未答问题的 textarea（部分已答时跳过已答项） | 中 | 通过 |
| B4 | 答复框自适应高度：textarea 渲染后带 data-hold-grow 并绑定 input 自动生长，最小 2 行、上限 12 行（min-height / max-height CSS） | 中 | 通过 |
| B5 | 底部常驻：消息行与关闭 / 保存决策按钮位于 .sp-foot 常驻区（不在滚动内容区），保存按钮经 form 属性关联 holdForm 提交 | 高 | 通过 |
| C1 | 复工防呆零回退：未答 > 0 复工按钮 disabled + title「尚缺 N 项决策，补齐后可复工」 | 高 | 通过 |
| C2 | 确认完成防呆零回退：卡片 data-hold-done 保留；confirmDoneGuard 二次确认（仍要确认完成 / force: true）保留 | 高 | 通过 |
| C3 | Esc / ✕ 关闭 + 焦点回归 + 保存中不可关闭保留（closeHoldPanel opener.focus、holdSide.busy 守卫） | 高 | 通过 |
| C4 | 面板三态保留：holdPanelLoading / holdPanelError（含重试）/ holdForm 切换逻辑不变 | 高 | 通过 |
| C5 | 聚合区错误条 + 重试与空态整体隐藏保留（renderHolds error 分支、空态 hidden） | 高 | 通过 |
| C6 | 契约不变：hold-states.mjs / hold-store.mjs 不修改；app.js 仍只调用 /api/holds、/api/hold/<ID>、/api/hold/<ID>/answer、/api/hold/<ID>/resume；无新增 API 路由 | 高 | 通过 |
| D1 | i18n 双语同步：新文案「⚠ 待人工确认」「已答 ◇ 项」「未答 ◇/◇」「待答 ◇ 项，填写后保存草稿」「展开 / 收起已答问题」有 EN 词条（静态或动态）；旧键「⚠ 待人工确认（◇）」随 UI 调整同步移除 | 中 | 通过 |
| D2 | 动态词条往返：t() en 模式插值正确、zh 模式可译回中文（已答 2 项 / 未答 1/3 / 待答 2 项…） | 中 | 通过 |
| E1 | 深浅色：hold 区新增样式全部使用主题变量，无硬编码 hex 色值 | 中 | 通过 |
| E2 | 窄屏 ≤640px：acts-secondary 分隔线取消、hold-acts 换行可用；面板全屏沿用 .side-panel 断点 | 中 | 通过 |
