# 设计 — BUG-20260922-001 文案“或在 ZCode 会话运行 /dev REQ-20260922-003 让 Agent 直接认领。”优化

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260907-012（其 README「详细内容界面」节明确为详情抽屉操作 notice 写下「未入批次：提示在 ZCode 会话运行 `/dev <单号>` / `/dev next` 认领」——「在 ZCode 会话运行」排他表述的源头）；BUG-20260908-020（删除已接受单批次进入状态显示时重写 accepted 分支 notice 为固定指引，沿用了该 ZCode 专属表述——其 design.md 方案第 1 条「固定返回不含批次内容的指引」）。两编号均经 `atb list` 核验存在（git 历史为巨型合并提交 6f2ead6，无法按提交归因，依据为上述两单文档记载）。

## 根因分析

`/dev` 命令随插件分发（`commands/dev.md`），插件为 ZCode / Codex 双宿主（`scripts/lib/plugin-pack.mjs`「ZCode/Codex 双宿主安装遵循各自官方插件机制」）。REQ-20260907-012 登记时把「会话内运行 /dev」的指引写成了「ZCode 会话」，BUG-20260908-020 重写 accepted 分支 notice 时未校正该表述，i18n 静态词典（`scripts/web/i18n.js`）键随中文原文、英文值译为 "run in a ZCode session"，同步携带该缺陷。属文案口径问题，不涉及逻辑。

## 方案（实施记录）

按 README「期望行为」的通用口径修复（与 `atb.mjs` 既有「复制后在当前项目的 Agent 会话发送」同风格）：

1. `scripts/web/app.js` `drawerActionsNoticeHtml()` accepted 分支：「或在 ZCode 会话运行」→「或在您使用的 Agent 会话运行」，其余不动；同步注释标注 BUG-20260922-001。
2. `scripts/web/i18n.js` 静态词典：键更新为「未入计划。可点「移入计划」排入开发计划（开发启动后最旧优先处理），或在您使用的 Agent 会话运行」，英文值改 "…or run it in your agent session"（不再出现 "ZCode session"）；「让 Agent 直接认领。」词条无宿主名，保留不动。
3. 新增回归测试 `scripts/tests/bug-drawer-notice-generic-20260922-001.test.mjs`（B1–B4：app.js 文案契约、词典新旧键校验、无宿主词条保留、scripts/web 源码全局防线），先红后绿。
4. 开发阶段复核 README 排查结论（与登记一致，行号随仓库演进小幅偏移）：
   - 必改三处已全部处理（app.js 4512 行 + i18n.js 1011 行改写、864 行核对保留）。
   - 保留项维持原状：「未检测到 ZCode.app（zcode:// 深链宿主）…」系列（app.js 7143/7890 行、build.js 1217/4040 行、i18n.js 737/738 行，事实性深链检测提示）；「去新建 Zcode 会话」双宿主并列链接（app.js 7140 行、build.js 1215 行、i18n.js 386 行）。
   - 验收 grep 复核：`grep -rn "ZCode 会话" scripts/` 中面向用户源码（scripts/web/、scripts/atb.mjs 等）0 处命中；剩余命中均为本单新增测试文件对旧文案的注释/断言引用（缺陷描述与移除断言所需，非面向用户文案）。「Zcode 会话」命中为「去新建 Zcode 会话」双宿主并列链接（保留项）。

开源选型：纯文案修改，未引入任何库（无合适库可言——不涉及第三方能力）。

## 风险与边界

- 仅改提示条文案与词典，不动布局与交互（README「界面展示」节确认）。
- i18n 覆盖卡点（i18n-coverage C1）随中文原文同步更新词典键，全部 i18n 套件通过；双语往返（R4）验证英文值唯一可还原。
- 「待确认」两项（「或直接打开 ZCode / ChatGPT 手动新建会话并粘贴提示词」app.js 7133 / build.js 1208 / i18n.js 505 行；atb.mjs 2208 行「提示：ZCode 内置浏览器右侧面板需在会话内用 /board 打开。」）不在本次必改范围，已按 hold 机制声明待人工决策（问题清单见 agent-team-board/runtime/holds/decisions/BUG-20260922-001.md）；人工定夺「需要修改」则复工后按通用口径处理，「保留」则结论以 hold 答复记录为准。
