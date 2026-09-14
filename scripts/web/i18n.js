'use strict';
// REQ-20260911-005 支持英文国际化资源 —— 集中词典 + 运行时 DOM 翻译层。
// 设计：以中文原文为键（静态精确 EN / 动态 EN_DYNAMIC，◇ 为插值占位），
// 全文匹配才替换：未命中保持原文（优雅降级），用户数据（标题/描述/文档）不会被误翻。
// app.js 零改动：本文件在 app.js 之前加载，静态 HTML 先译，动态渲染由 MutationObserver 接住。
// 语言：navigator.languages 含 en-* → en，否则 zh（默认）；手动切换记忆 localStorage('atb.lang')，
// 手动选择优先于自动检测。同时作为 ESM 被 scripts/tests/i18n-*.test.mjs 引入（Node 下只暴露
// globalThis.ATBI18N，不触碰 DOM）。

// ---------- 英文词典（静态精确：键 = 中文原文全文） ----------
const EN = {
  '智能体团队看板': 'Agent Team Board',
  // REQ-20260913-001 构建模块（顶栏页签 + 模块副标题 + 搜索 + 高频标签）
  '构建': 'Build',
  '版本计划与分支，集中在这里': 'Version plans and branches, all in one place',
  '搜版本 / 单号 / 分支…': 'Search versions / items / branches…',
  '版本计划': 'Version plans',
  '分支浏览': 'Branches',
  '新建版本': 'New version',
  '创建版本计划': 'Create version plan',
  '添加条目': 'Add items',
  '添加所选条目': 'Add selected items',
  '合并入 main': 'Merge into main',
  '重试合并入 main': 'Retry merge into main',
  // BUG-20260913-004：「提示词与回答回填」更名「AI 完善」（按钮迁入版本卡片，弹窗标题同步）
  'AI 完善': 'AI refine',
  '复制提示词': 'Copy prompt',
  // REQ-20260913-004 支持版本删除（卡片删除键 + 确认弹窗 + 反馈）
  '确认删除': 'Confirm delete',
  '合并中，不可删除': 'Merging in progress — deletion disabled',
  '删除中…': 'Deleting…',
  '删除该版本计划（需确认，删除后不可恢复）': 'Delete this version plan (confirmation required; cannot be undone)',
  '删除后不可恢复，关联条目与 commit 关联一并移除；条目本身可重新纳入其他版本。': 'This cannot be undone: linked items and their commit associations are removed; the items themselves can be added to another version later.',
  '仅删除看板版本记录，不影响已合并入 main 的提交与代码。': 'Only the board record is removed; commits and code already merged into main are untouched.',
  '此操作不可撤销，请确认后再继续。': 'This action is irreversible — please confirm to continue.',
  // BUG-20260913-005：版本回填弹窗「去新建 XX 会话」入口——既有复制 toast 一并补齐词条
  '✓ 提示词已复制，去 Agent 粘贴执行后把回答粘贴到下方': '✓ Prompt copied — paste it into the Agent, run it, then paste the answer back below',
  '剪贴板不可用：请在提示词文本框中全选（⌘A）并手动复制': 'Clipboard unavailable: select all (⌘A) in the prompt box and copy manually',
  '解析并预览': 'Parse & preview',
  '同步远端': 'Sync remote',
  '推送': 'Push',
  '计划中': 'Planning',
  '合并中': 'Merging',
  '已合并': 'Merged',
  '关键词在版本列表内前端过滤（版本名 / 单号），不发请求': 'Keywords filter the version list client-side (name / item id); no request is made',
  // REQ-20260911-009 设置页「Git 工作流」分区（dev 分支初始化）
  'Git 工作流': 'Git workflow',
  '正在获取 Git 状态…': 'Loading Git status…',
  '当前分支：—（不是 git 仓库）': 'Current branch: — (not a git repository)',
  '已存在': 'exists',
  '未创建': 'not created',
  // BUG-20260912-001：状态行拆段（分支名/状态词各成独立文本节点）后按段翻译，
  // 整句动态键「当前分支：◇ · dev 分支：◇」因捕获组不翻译而移除（英文残留中文）。
  '当前分支：': 'Current branch: ',
  '· dev 分支：': '· dev branch: ',
  '已在 dev 分支': 'On the dev branch',
  '初始化 dev 分支': 'Initialize the dev branch',
  '项目不是 git 仓库：请先在终端完成 git 初始化（新项目可经 atb init 自动初始化）。': 'The project is not a git repository: initialize git in the terminal first (new projects are initialized automatically via atb init).',
  // REQ-20260912-001 设置页「Git 工作流」详细描述（双分支协作 / 分支职责 / 自动提交）
  '采用 dev + main 双分支协作：': 'Adopt the dev + main dual-branch workflow:',
  'dev 分支承载需求设计、开发和测试；main 分支承载版本构建，发布构建物。': 'The dev branch carries requirement design, development, and testing; the main branch carries version builds and release artifacts.',
  '每个需求或 Bug 单开发完自动提交到本地（仅本地分支操作，不 push）。': 'Each requirement or bug item is auto-committed locally once development finishes (local branch operations only, no push).',
  '正在创建并切换到 dev 分支…': 'Creating and switching to the dev branch…',
  '初始化 dev 分支？': 'Initialize the dev branch?',
  '将按需创建 dev 分支，并把整个项目工作区切换到 dev（已在 dev 则仅提示就绪；仅本地分支操作，不 push）。': 'Creates the dev branch as needed and switches the whole workspace to it (already on dev: just reports ready; local branch operations only, no push).',
  '初始化并切换': 'Initialize and switch',
  '✓ 已就绪：当前分支 dev（开发在 dev 分支进行，到待测试自动提交）': '✓ Ready: current branch is dev (development on dev, auto-commit on reaching in-test)',
  '待接受': 'Pending',
  '已接受': 'Accepted',
  '已计划': 'Planned',
  '开发中': 'Developing',
  '待测试': 'In test',
  '已完成': 'Done',
  '全选': 'Select all',
  '关闭': 'Close',
  '搜需求 / Bug / 文档…': 'Search reqs / bugs / docs…',
  'Agent 已上报完成，等待人工测试': 'Agent reported; awaiting manual testing',
  'Agent 开发中（未上报）': 'Agent in progress (not reported)',
  'Bug 单暂不支持关联讨论；如需讨论请到「讨论」模块发起。': 'Bugs do not support linked discussions yet; start one in the Discussions module.',
  'CLI 入口': 'CLI entry',
  'CLI 路径': 'CLI path',
  'Codex 后台自动派发（REQ-20260906-003）：每项直接启动独立 codex exec 会话，事件与错误日志落盘、进程受管回收，结果在看板查看。': 'Codex background auto-dispatch (REQ-20260906-003): each item starts an isolated codex exec session; events and error logs are persisted, processes are reaped, and results are viewed on the board.',
  'Codex 模型（默认继承项目设置）': 'Codex model (inherits project settings by default)',
  'Electron 壳': 'Electron shell',
  'Profile 文件': 'Profile file',
  'package.json 等根级文件': 'Root-level files such as package.json',
  '· 历史记录未记录模型': '· model not recorded in history',
  '· 受依赖阻塞': '· blocked by dependencies',
  '· 已暂停': '· paused',
  '· 已请求暂停': '· pause requested',
  '· 待启动': '· prepared',
  '· 待核对': '· needs review',
  '· 按记录配置请求，实际模型未返回': '· requested per record; actual model not returned',
  '· 排队中': '· queued',
  '· 模型': '· model',
  '· 运行时确认': '· runtime confirmed',
  '← 上一条': '← Previous',
  '↩ 移出计划': '↩ Remove from plan',
  '↩ 驳回完成': '↩ Reject completion',
  '↩ 驳回接受': '↩ Reject acceptance',
  '▶ 开始 AI 分析': '▶ Start AI analysis',
  '▶ 开始 AI 开发': '▶ Start AI development',
  '⚠ 文件视图组件（banner.js / highlight.js）未加载': '⚠ File view components (banner.js / highlight.js) not loaded',
  '✎ 修改': '✎ Edit',
  '✓ 接受': '✓ Accept',
  '✓ 确认完成': '✓ Confirm done',
  '✕ 关闭': '✕ Close',
  '➤ 移入计划': '➤ Add to plan',
  '「暂停后续领取」只阻止领取下一项（当前项继续）；立即停止正在运行的工具请到 Zcode 原生任务界面操作。': '"Pause next pickup" only stops claiming the next item (the current one continues); to stop running tools immediately, use the Zcode native task view.',
  '一句话说清这条需求 / Bug / 讨论': 'Summarize this request / bug / discussion in one line',
  '一次只关一层；关闭后恢复至打开入口': 'Closes one layer at a time; focus returns to the opener',
  '上传图片': 'Upload images',
  '下一条 →': 'Next →',
  '不在此收集任何密钥；沿用本机 codex 登录与模型配置。': 'No secrets are collected here; local codex login and model config are reused.',
  '不在目录中也可输入（标注尚未验证）': 'You can also type a value not in the catalog (marked unverified)',
  '不存在': 'Missing',
  '不换行': 'No wrap',
  '不随顶栏项目选择变化': 'Does not follow the top-bar project selection',
  '业务源码': 'Business source',
  '两类批量任务均为子代理模式，子代理模型跟随主调度会话；保存仅对后续新任务生效。': 'Both batch task types run in subagent mode; the subagent model follows the dispatch session. Saving only affects future tasks.',
  '✓ 已保存批量任务设置（流转开关仅对后续完善回执生效）': '✓ Batch task settings saved (flow toggle affects only future refine receipts)',
  '✓ 已保存运行配置（模型设置将用于后续新执行；进行中的执行与续跑保持原设置）': '✓ Run config saved (model settings apply to future runs; running runs and resumes keep the original)',
  '✓ 已初始化 docs/agent-team-board/': '✓ Initialized docs/agent-team-board/',
  '✓ 自动派发已开启：将串行处理已计划条目（最旧优先）': '✓ Auto dispatch enabled: planned items will be processed serially (oldest first)',
  '个在工作的批量任务': 'active batch tasks',
  '主调度提示词（在本项目的 Agent 会话粘贴发送，提示词通用）：': 'Dispatch prompt (paste into an Agent session of this project; the prompt is agent-agnostic):',
  '仅待接受条目可改': 'Only pending items can be edited',
  '仅显示最近 2 条；其余条目仍在本轮处理范围内，实际领取顺序不变。': 'Only the latest 2 shown; the rest remain in this round and their pickup order is unchanged.',
  '仅显示部分结果（每类前 50 条），请缩小关键词': 'Partial results only (top 50 per category); narrow the keywords',
  '从想法到验收，跟进每一项工作': 'From idea to acceptance, track every piece of work',
  '以已计划队列（最旧优先）重建任务并复制提示词': 'Rebuild the task from the planned queue (oldest first) and copy the prompt',
  '以当前已完成候选创建新任务并复制提示词': 'Create a new task from current done candidates and copy the prompt',
  '以当前已接受未完善候选创建新任务': 'Create a new task from current accepted-but-unrefined candidates',
  '以新配置重试本项': 'Retry this item with the new config',
  '任务': 'Tasks',
  '任务已人工终止：本轮全部处理记录已保留；在途子代理请在对应子代理会话人工停止。': 'Task aborted manually: all processing records of this round are kept; stop in-flight subagents manually in their own sessions.',
  '任务已人工终止：本轮全部处理记录已保留；在途子代理请在对应子代理会话人工停止；终止后可立即「启动新一轮」。': 'Task aborted manually: all processing records of this round are kept; stop in-flight subagents manually in their own sessions. You can "Start a new round" right away.',
  '任务已创建，但复制失败：请在下方选中提示词手动复制，或点「重新复制」（不会产生新任务）': 'Task created, but copying failed: select the prompt below and copy manually, or click "Recopy" (no new task is created)',
  '任务已创建，但复制失败：请在提示词分区手动复制，或点「重新复制」（不会创建新任务）': 'Task created, but copying failed: copy the prompt manually from the prompt pane, or click "Recopy" (no new task is created)',
  '任务已创建，但复制失败：请展开提示词手动复制': 'Task created, but copying failed: expand the prompt and copy it manually',
  '任务已创建，但复制失败：请展开提示词手动复制，或点「重新复制」（不会创建新任务）': 'Task created, but copying failed: expand the prompt and copy it manually, or click "Recopy" (no new task is created)',
  '任务已收尾：待完善队列已清空（条目保持已接受）。': 'Task wrapped up: the refine queue is empty (items stay accepted).',
  '任务已收尾：本轮待处理队列已清空。': 'Task wrapped up: this round\'s pending queue is empty.',
  '任务已终止': 'Task aborted',
  '任务面板': 'Task panel',
  '会话 ID': 'Session ID',
  '会话数据': 'Session data',
  '保存': 'Save',
  '保存中…': 'Saving…',
  '保存依赖': 'Save dependencies',
  '保存并切换': 'Save and switch',
  '保存批量任务设置': 'Save batch task settings',
  '保存本项模型设置': 'Save model settings for this item',
  '保存配置': 'Save config',
  '候选：已完成': 'Candidates: done',
  '候选：已接受未完善': 'Candidates: accepted, not refined',
  '停止': 'Stop',
  '停止中…': 'Stopping…',
  '停止当前执行': 'Stop the current run',
  '停止请求已发出：显示「停止中」，确认回收后转为已中断': 'Stop request sent: shows "Stopping"; turns interrupted once the process is reaped',
  '允许非 Git 项目执行': 'Allow non-Git projects',
  '先请求中断，确认回收后显示「已中断」；收尾未确认不放锁、不派下一项。': 'It first requests an interrupt and shows "Interrupted" once reaped; until cleanup is confirmed, no lock is released and no next item is dispatched.',
  '全不选': 'Select none',
  '全不选：仅取消当前筛选档的勾选': 'Select none: clears checkboxes in the current lane only',
  '全局': 'Global',
  '全局任务': 'Global tasks',
  '全局任务列表': 'Global task list',
  '全局任务（跨项目）': 'Global tasks (cross-project)',
  '全局总览聚合所有已注册项目的批量任务。请先在顶栏「＋ 新建」旁的项目选择器打开 / 注册项目，或运行': 'The global overview aggregates batch tasks across registered projects. Open/register a project via the project selector next to "+ New" in the top bar, or run',
  '全部': 'All',
  '全部类型': 'All types',
  '全部项目的批量任务（跨项目总览）': 'Batch tasks of all projects (cross-project overview)',
  '关联讨论（旧绑定记录）': 'Linked discussions (legacy bindings)',
  '关键词在下方面板内前端过滤（编号 / 标题 / 执行器），不发请求': 'Keywords filter the panel below on the client (ID / title / executor); no request is sent',
  '关键词已保留：点击「重试」用当前词重新搜索，或修改关键词后再试。': 'Keywords kept: click "Retry" to search again with the current terms, or edit them first.',
  '关闭全局任务面板': 'Close the global tasks panel',
  '关闭全局任务（Esc）': 'Close global tasks (Esc)',
  '关闭大图预览': 'Close the image preview',
  '关闭快捷键帮助': 'Close the shortcut help',
  '关闭新建面板': 'Close the new-item panel',
  '关闭最上层可关闭面板': 'Close the topmost closable panel',
  '关闭确认弹窗': 'Close the confirmation dialog',
  '关闭编辑面板': 'Close the edit panel',
  '关闭项目管理面板': 'Close the project management panel',
  '关闭（Esc）': 'Close (Esc)',
  '关闭（等于取消）': 'Close (same as cancel)',
  '其他目录': 'Other directories',
  '其他项目': 'Other projects',
  '准备中': 'Preparing',
  '切换': 'Switch',
  '切换中…': 'Switching…',
  '切换项目看板': 'Switch project board',
  '列表排序': 'Sort list',
  '列表排序（更新 / 创建 / 单号）': 'Sort list (updated / created / ID)',
  '创建': 'Create',
  '创建中…': 'Creating…',
  '创建失败：看板服务版本过旧，提交会丢弃截图。请在终端运行 atb serve 自动重启过旧服务，然后重试': 'Create failed: the board service is outdated and submitting would drop screenshots. Run "atb serve" in a terminal to restart it, then retry',
  '创建并接受': 'Create & accept',
  '创建数据目录，需求与 Bug 随代码进 git。': 'Creates the data directory; requirements and bugs go into git with the code.',
  '初始化': 'Initialize',
  '初始化 = 在新目录创建看板数据；导入 = 加入已有看板数据的项目；移出仅移出列表，目录与文档保留。': 'Initialize = create board data in a new directory; Import = add a project that already has board data; Remove only drops it from the list — the directory and documents are kept.',
  '初始化、导入或移出项目': 'Initialize, import, or remove projects',
  '初始化、导入或移出项目；移出仅移出列表，目录与文档保留': 'Initialize, import, or remove projects; removing only drops the list entry — directory and documents are kept',
  '初始化一个项目目录，或导入已有看板数据的项目；移出过的项目可随时重新导入。': 'Initialize a project directory, or import a project that already has board data; removed projects can be re-imported anytime.',
  '初始化中…': 'Initializing…',
  '初始化项目（在新目录创建看板数据）': 'Initialize project (create board data in a new directory)',
  '删除': 'Delete',
  '刷新前查看的文件已不存在；请从上方横幅选择其他文件。': 'The file you viewed before refreshing no longer exists; pick another from the banner above.',
  '刷新配置': 'Refresh config',
  '前置条目人工验收完成后才自动实施；父子归属不算依赖。': 'Items are implemented automatically only after their prerequisites pass manual acceptance; parent-child ownership does not count as a dependency.',
  '加载中…': 'Loading…',
  '加载更多日志': 'Load more logs',
  '单号': 'ID',
  '单项时限（分钟）': 'Per-item time limit (minutes)',
  '历史记录未记录': 'Not recorded in history',
  '历史记录未记录（创建于模型配置记录之前）': 'Not recorded in history (created before model-config logging)',
  '原文：': 'Source: ',
  '去新建 Codex 会话': 'New Codex session',
  '去新建 Zcode 会话': 'New Zcode session',
  'Zcode 工作区': 'the Zcode workspace',
  'Codex 新会话': 'a new Codex session',
  '双击查看大图': 'Double-click to enlarge',
  '发布': 'Release',
  '取消': 'Cancel',
  '受阻': 'Blocked',
  '可留空，后续补充': 'Optional; can be filled in later',
  '启动': 'Start',
  '启动 = 创建任务并复制主调度提示词（复制成功 ≠ 执行中，登记运行后才算执行中）；提示词通用，可在任意一种 Agent 会话粘贴执行；条目保持 accepted，不占实施互斥。': 'Start = create the task and copy the dispatch prompt (copied ≠ running; it counts as running only after the run is registered). The prompt is agent-agnostic — paste it into any Agent session. Items stay accepted and do not take the implementation mutex.',
  '启动中': 'Starting',
  '启动新一轮': 'Start a new round',
  '图片加载中…': 'Loading image…',
  '在新标签页打开交互演示': 'Open the interactive demo in a new tab',
  '在项目内初始化看板。': 'Initialize the board inside the project.',
  '基本信息': 'Info',
  '填写讨论背景，不需要关联需求；留空也可创建': 'Describe the discussion background; no requirement link needed. Can be created empty',
  '处理中': 'Processing',
  '处理中…': 'Processing…',
  '复制': 'Copy',
  '复制失败，请手动复制': 'Copy failed; please copy manually',
  '复制失败，请手动复制提示词': 'Copy failed; please copy the prompt manually',
  '复制失败，请手动框选单号': 'Copy failed; please select the ID manually',
  '复制失败，请手动框选完整提交号': 'Copy failed; please select the full commit hash manually',
  '复制失败：请手动选中提示词文本复制': 'Copy failed: please select the prompt text and copy it manually',
  '复制续接提示词': 'Copy continuation prompt',
  '复制路径': 'Copy path',
  '失败': 'Failed',
  '失败的项目已保留在列表中，可重新检测后重试。': 'Failed projects are kept in the list; re-check and retry.',
  '子代理会话': 'Subagent session',
  '子代理模式（提示词通用，任意 Agent 会话可执行）': 'Subagent mode (agent-agnostic prompt; any Agent session can run it)',
  '子代理正在完善本文档；点击查看 AI 分析面板': 'A subagent is refining this document; click to view the AI analysis panel',
  '存在': 'Present',
  '完善中': 'Refining',
  '完善完成后自动转入计划': 'Auto-move to plan after refining',
  '实时连接：每 2 秒自动刷新': 'Live connection: auto-refreshes every 2s',
  '客户端检测失败：无法确认本机 Zcode / Codex 是否可用': 'Client detection failed: cannot confirm whether Zcode / Codex is available on this machine',
  '导入中…': 'Importing…',
  '导入项目': 'Import project',
  '导入项目（加入已有看板数据的项目）': 'Import project (add a project that already has board data)',
  '将先请求中断，确认回收后才释放占用。': 'It first requests an interrupt; the slot is released only after the process is confirmed reaped.',
  '将在': 'Will create',
  '尚无最终回复': 'No final reply yet',
  '尚无注册项目': 'No registered projects',
  '尚无测试报告（条目未上报）': 'No test report yet (item not reported)',
  '尚未创建，开发阶段补充。': 'Not created yet; to be added during development.',
  '尚未检测目录存在性。': 'Directory existence not checked yet.',
  '尚未进行真实验证（验证会产生一次模型请求，仅按钮触发）。': 'Not verified for real yet (verification issues one model request and is button-triggered only).',
  '尚未验证（目录未收录或未加载；验证按钮可真实触发一次）': 'Unverified (not in the catalog or not loaded; the verify button can trigger one real check)',
  '尝试次数': 'Attempts',
  '已上报': 'Reported',
  '已中断': 'Interrupted',
  '已人工确认完成': 'Manually confirmed done',
  '已保存，仅对后续启动的任务生效': 'Saved; affects only tasks started afterwards',
  '已关闭自动派发：当前执行完成后停止派发': 'Auto dispatch off: dispatching stops after the current run finishes',
  '已出局': 'Dropped out',
  '已到末尾': 'End of list',
  '已加入本轮重试队列': 'Added to this round\'s retry queue',
  '已加载设置': 'Settings loaded',
  '已加载设置（未配置，按默认生效）': 'Settings loaded (unset; defaults apply)',
  '已取消，项目列表未变更。': 'Cancelled; the project list is unchanged.',
  '已处理': 'Processed',
  '已复制 ✓': 'Copied ✓',
  '已复制提示词；请在当前项目的 Agent 会话粘贴发送': 'Prompt copied; paste and send it in an Agent session of this project',
  '已复制续接提示词；新主会话粘贴发送后先核对再继续': 'Continuation prompt copied; in the new dispatch session, verify before continuing',
  '已完善': 'Refined',
  '已归档': 'Archived',
  '已恢复默认清单（源代码目录与条目文档）——仍需保存后生效': 'Default scope restored (source directories and item documents) — still needs saving to take effect',
  '已排入开发计划，开发启动后最旧优先处理': 'Planned; development processes the oldest first',
  '已接受未完善：可由 AI 分析任务补全文档；点击查看 AI 分析面板': 'Accepted but unrefined: an AI analysis task can complete the documents; click to view the AI analysis panel',
  '已接受，可在详情页「移入计划」排入开发计划': 'Accepted; use "Add to plan" in the detail view to schedule it',
  '已是最后一条': 'This is the last item',
  '已是第一条': 'This is the first item',
  '已暂停': 'Paused',
  '已暂停本项目 Codex 自动派发（不自动换模型/降级强度）。修复后在下方「检查设置」「重新验证」，或到执行详情「按原配置恢复本项 / 以新配置重试本项」。': 'Codex auto dispatch is paused for this project (no automatic model fallback or effort downgrade). After fixing, use "Check settings" / "Re-verify" below, or "Resume with original config / Retry with new config" in the run detail.',
  '已暂停，等待恢复': 'Paused, awaiting resume',
  '已注册项目': 'Registered projects',
  '已终止': 'Aborted',
  '已结束': 'Finished',
  '已自动转入计划（planned）': 'Automatically moved to plan (planned)',
  '已计划候选': 'Planned candidates',
  '已请求暂停': 'Pause requested',
  '已释放': 'Released',
  '开启后完善完成即自动移入计划；默认关闭＝人工移入计划。': 'When on, refined items move to the plan automatically; default off = manual planning.',
  '开始 AI 分析': 'Start AI analysis',
  '开始时间': 'Started at',
  '开源许可': 'Open-source licenses',
  '异常': 'Abnormal',
  '归属': 'Parent',
  '当前': 'Current',
  '当前执行': 'Current run',
  '当前条目': 'Current item',
  '当前目录路径': 'Current directory path',
  '当前筛选与搜索下没有匹配的任务。': 'No tasks match the current filter and search.',
  '当前筛选与搜索下没有条目。': 'No items match the current filter and search.',
  '当前筛选列表中上一条 / 下一条详情': 'Previous / next detail within the filtered list',
  '当前项目尚未初始化看板': 'This project has no board yet',
  '当前：': 'Current: ',
  '待人工核对': 'Awaiting manual review',
  '待启动': 'Prepared',
  '待启动：请在 Agent 会话粘贴调度提示词': 'Prepared: paste the dispatch prompt into an Agent session',
  '待启动：请在对应项目的 Agent 会话粘贴调度提示词后登记运行': 'Prepared: paste the dispatch prompt into an Agent session of the corresponding project, then register the run',
  '待处理': 'Pending items',
  '待处理 0': 'Pending 0',
  '待完善': 'To refine',
  '待开发': 'To develop',
  '待核对': 'Needs review',
  '待检测': 'To check',
  '待确认': 'To confirm',
  '快捷键': 'Shortcuts',
  '快捷键 ?': 'Shortcuts ?',
  '快捷键 ←': 'shortcut ←',
  '快捷键 →': 'shortcut →',
  '快捷键说明（按 ? 打开）': 'Shortcut help (press ?)',
  '恢复后续领取': 'Resume pickup',
  '恢复默认（源代码目录与条目文档）': 'Restore defaults (source directories and item documents)',
  '或直接 ⌘V 粘贴': 'or paste with ⌘V',
  '或直接打开 ZCode / ChatGPT 手动新建会话并粘贴提示词': 'or open ZCode / ChatGPT directly, start a session manually and paste the prompt',
  '截图大图预览': 'Screenshot preview',
  '截图（可选）': 'Screenshots (optional)',
  '所有项目的批量任务均已收尾': 'All batch tasks across projects have wrapped up',
  '到各项目的任务模块（「任务」页签）可启动新的 AI 开发 / AI 分析任务；新任务登记运行后会自动出现在这里。': 'Open the Tasks module of each project (the "Tasks" tab) to start new AI development / AI analysis tasks; newly registered runs appear here automatically.',
  '手动复制讨论引用': 'Copy discussion reference manually',
  '打开文件': 'Open file',
  '打开本快捷键帮助': 'Open this shortcut help',
  '打开目录': 'Open directory',
  '终止 AI 分析任务？': 'Abort AI analysis task?',
  '终止 AI 开发任务？': 'Abort AI development task?',
  '执行中': 'Running',
  '执行器已暂停': 'Executor paused',
  '执行日志': 'Run log',
  '执行状态': 'Run status',
  '执行状态待核对': 'Run status needs review',
  '批量任务': 'Batch tasks',
  'AI 分析': 'AI analysis',
  'AI 分析：对已接受条目批量补全文档——需求补 README（描述 + 验收标准；涉及 UI 需含界面展示），Bug 补现象/复现步骤/期望行为/验收说明（涉及 UI 的 Bug 同样须提供可交互 ui-demo.html 演示）。派子代理只补文档：条目保持已接受、不写业务源码、未知事实标「待确认」。': 'AI analysis: completes documents of accepted items in bulk — READMEs for requirements (description + acceptance criteria; UI items need an interface demo) and symptoms/repro/expected behavior/acceptance for bugs (UI bugs also need an interactive ui-demo.html). Subagents only touch documents: items stay accepted, business source is untouched, unknown facts are marked "to confirm".',
  'AI 开发': 'AI development',
  '批量操作': 'Batch actions',
  '批量移出确认': 'Batch removal confirmation',
  '指定模型': 'Specified model',
  '按会话 ID 续跑中': 'Resuming by session ID',
  '按原配置恢复本项': 'Resume this item with the original config',
  '按实际 CLI、CODEX_HOME、Profile 与项目 .codex 配置层解析；模型列表存在不等于账户可用。': 'Resolved against the actual CLI, CODEX_HOME, profiles and project .codex config layers; being listed does not mean your account can use it.',
  '按状态筛选需求': 'Filter requirements by status',
  '按键': 'Key',
  '接受': 'Accept',
  '接受中…': 'Accepting…',
  '接受所选': 'Accept selected',
  '推理强度': 'Reasoning effort',
  '推理强度不支持': 'Reasoning effort unsupported',
  '描述': 'Description',
  '描述（多行，保存时整体替换对应章节）': 'Description (multi-line; replaces the whole section on save)',
  '提交号': 'Commit hash',
  '提交状态': 'Commit status',
  '提交状态加载失败': 'Failed to load commit status',
  '提供方身份变化': 'Provider identity changed',
  '提示词': 'Prompt',
  '插件元数据': 'Plugin metadata',
  '搜任务、编号或执行器…': 'Search tasks, IDs or executors…',
  '搜索全局任务（跨项目）': 'Search global tasks (cross-project)',
  '搜索当前模块': 'Search this module',
  '搜索结果反馈': 'Search feedback',
  '搜项目 / 条目编号…': 'Search projects / item IDs…',
  '摘要': 'Summary',
  '撤销': 'Undo',
  '操作': 'Actions',
  '收尾待核对': 'Cleanup pending review',
  '放大查看': 'View enlarged',
  '放弃': 'Discard',
  '数据随看板轮询自动刷新（2 秒）；「暂停 / 终止 / 删除」等操作请点击任务进入对应项目的任务模块执行。': 'Data refreshes automatically with the board poll (2s); for pause / abort / delete, click a task to open that project\'s Tasks module.',
  '文件': 'Files',
  '斜杠命令': 'Slash commands',
  '新建条目': 'New item',
  '新条目，等待人工接受': 'New item, awaiting acceptance',
  '无': 'None',
  '无会话 ID': 'No session ID',
  '无会话 ID ·': 'No session ID ·',
  '无关联讨论记录。新版讨论不绑定需求；就本需求文档讨论请用上方「文档讨论」区块。': 'No linked discussions. New-style discussions are not bound to requirements; use the "Document discussion" block above to discuss this document.',
  '无命中': 'No hits',
  '无命中文件': 'No matching files',
  '无弹窗且焦点不在可编辑区域': 'No dialog open and focus is not in an editable area',
  '无法停止': 'Cannot stop',
  '无法恢复': 'Cannot resume',
  '无法重试': 'Cannot retry',
  '暂停后续领取': 'Pause next pickup',
  '暂无可完善候选：已接受条目均已完善（或尚无已接受条目）': 'No refine candidates: accepted items are all refined (or there are none)',
  '暂无可完善候选：已接受条目均已完善（或尚无已接受条目）。': 'No refine candidates: accepted items are all refined (or there are none).',
  '暂无已计划候选：请先在看板接受条目并「移入计划」': 'No planned candidates: accept items on the board and "Add to plan" first',
  '暂无已计划候选：请先在看板接受条目，并在详情页「移入计划」（仅已计划且未被认领的条目进入实时队列）。': 'No planned candidates: accept items on the board and "Add to plan" in the detail view (only planned and unclaimed items enter the live queue).',
  '暂无待处理条目。': 'No pending items.',
  '暂无执行记录': 'No run records',
  '暂无调度提示词。': 'No dispatch prompt.',
  '暂无需求或 Bug：点击右上「＋ 新建」创建第一条。': 'No requirements or bugs yet: click "+ New" at the top right to create the first one.',
  '暂无项目': 'No projects',
  '暂无项目。使用上方表单初始化或导入项目。': 'No projects. Use the form above to initialize or import one.',
  '暂无项目：打开「管理项目」初始化或导入': 'No projects: open "Manage projects" to initialize or import',
  '更新': 'Updated',
  '最后事件': 'Last event',
  '最后活动': 'Last activity',
  '最新创建': 'Newest created',
  '最新更新': 'Recently updated',
  '最早创建': 'Oldest created',
  '最早更新': 'Oldest updated',
  '最终回复': 'Final reply',
  '最近回执': 'Latest receipt',
  '最近报告': 'Latest report',
  '有未保存的更改': 'Unsaved changes',
  '服务离线：数据停止刷新': 'Service offline: data is no longer refreshing',
  '未发现不存在的目录。': 'No missing directories found.',
  '未启动执行': 'Not started',
  '未完善': 'Unrefined',
  '未找到匹配结果：换个关键词试试，或清除搜索恢复模块内容。': 'No matches: try different keywords, or clear the search to restore the module.',
  '未找到该执行记录，请刷新后重试': 'Run record not found; refresh and retry',
  '未提交': 'Not committed',
  '尚无关联提交（自动提交完成后更新标记）': 'No associated commits yet (the badge updates after the auto-commit completes)',
  '已有经核验/自动提交的关联提交记录': 'Has associated commits (verified / auto-committed)',
  '未检测到 ChatGPT.app（codex:// 深链宿主）：可能未安装或装在非默认路径；可直接打开 ChatGPT 手动新建会话并粘贴提示词': 'ChatGPT.app not detected (host of codex:// deep links): it may be uninstalled or in a non-default location; open ChatGPT directly, start a session manually and paste the prompt',
  '未检测到 ChatGPT.app：可能未安装或装在非默认路径，可直接打开 ChatGPT 手动新建会话并粘贴提示词': 'ChatGPT.app not detected: it may be uninstalled or in a non-default location; open ChatGPT directly, start a session manually and paste the prompt',
  '未检测到 ZCode.app（zcode:// 深链宿主）：可能未安装或装在非默认路径；可直接打开 Zcode 手动新建会话并粘贴提示词': 'ZCode.app not detected (host of zcode:// deep links): it may be uninstalled or in a non-default location; open Zcode directly, start a session manually and paste the prompt',
  '未检测到 ZCode.app：可能未安装或装在非默认路径，可直接打开 Zcode 手动新建会话并粘贴提示词': 'ZCode.app not detected: it may be uninstalled or in a non-default location; open Zcode directly, start a session manually and paste the prompt',
  '未知': 'Unknown',
  '未知原因': 'Unknown reason',
  '未知执行': 'Unknown run',
  '未知接口：': 'Unknown API: ',
  '未知类型': 'Unknown type',
  '未能识别类型，按「未知类型」兜底展示（仅在「全部类型」筛选下可见）': 'Type unrecognized; shown as "Unknown type" fallback (visible only under the "All types" filter)',
  '未自动转入计划（条目当前为 planned）：无需自动转入': 'Not auto-planned (item is already planned): no action needed',
  '未记录': 'Not recorded',
  '未设置': 'Unset',
  '未选择项目：请先在顶栏选择项目后再新建会话': 'No project selected: pick one in the top bar before starting a session',
  '未配置 codex CLI：请先完成运行环境检查': 'codex CLI not configured: run the environment check first',
  '未配置 · 默认生效（源代码相关目录与条目文档）——保存后按自定义范围生效。': 'Unset · defaults apply (source-related directories and item documents) — a custom scope takes effect after saving.',
  '本批范围已处理完毕': 'This batch scope is fully processed',
  '本轮已结束': 'This round has ended',
  '本项指定': 'Per-item override',
  '本项指定优先于项目默认；保存仅影响本项后续新执行，进行中的执行与续跑保持原设置。': 'A per-item override beats the project default; saving affects only this item\'s future runs — running runs and resumes keep the original settings.',
  '条目': 'Items',
  '条目文档与看板数据': 'Item documents and board data',
  '条目状态读取失败': 'Failed to read item status',
  '条目详情': 'Item detail',
  '来源': 'Source',
  '来源讨论': 'Source discussion',
  '查看大图': 'View image',
  '查看执行记录': 'View run records',
  '标题': 'Title',
  '标题不能为空': 'Title cannot be empty',
  '标题与描述均无变化': 'Neither title nor description changed',
  '桌面入口未接通，请查看看板日志': 'Desktop entry unreachable; check the board log',
  '检查运行环境（静态）': 'Check environment (static)',
  '检测中': 'Checking',
  '检测中…': 'Checking…',
  '检测失败': 'Check failed',
  '概况': 'Overview',
  '模块导航': 'Module navigation',
  '模型': 'Model',
  '模型不存在': 'Model not found',
  '模型与推理强度': 'Model & reasoning effort',
  '模型配置待处理': 'Model config pending',
  '模型配置待处理：点击查看原因与恢复入口': 'Model config pending: click to see why and how to recover',
  '模型配置待处理：解析继承值失败，已暂停派发。请刷新配置或显式选择模型后重新开启。': 'Model config pending: inherited values failed to resolve and dispatching is paused. Refresh the config or pick a model explicitly, then re-enable.',
  '模型（可搜索，或手动输入 ID）': 'Model (searchable, or type an ID)',
  '次数': 'Count',
  '正在保存上一条编辑，请稍候': 'Saving the previous edit; hang on',
  '正在加载任务设置…': 'Loading task settings…',
  '正在搜索……': 'Searching…',
  '正在检测本机 Agent 客户端…': 'Detecting local Agent clients…',
  '正在读取描述…': 'Reading description…',
  '没有匹配的处理记录，清空搜索恢复。': 'No matching records; clear the search to restore.',
  '没有匹配的待处理条目，清空搜索恢复。': 'No matching pending items; clear the search to restore.',
  '没有匹配的执行记录，清空搜索恢复。': 'No matching run records; clear the search to restore.',
  '没有匹配的条目': 'No matching items',
  '没有可移入计划的已接受条目': 'No accepted items to plan',
  '没有可移出计划的已计划条目（已进入开发中的单不能移出计划）': 'No planned items to unplan (items already in development cannot be unplanned)',
  '没有可驳回待接受的已接受条目': 'No accepted items to reject to pending',
  '沿用原生顺序；本帮助开启时焦点留在帮助内': 'Native order; while this help is open, focus stays inside it',
  '沿用本机配置': 'Reuse local config',
  '流转执行失败': 'Transition failed',
  '测试报告': 'Test report',
  '测试用例': 'Test cases',
  '清空搜索并恢复模块内容': 'Clear the search and restore module content',
  '清除搜索': 'Clear search',
  '渲染': 'Rendered',
  '源代码相关目录（默认勾选）': 'Source-related directories (checked by default)',
  '源码': 'Source code',
  '点击上方横幅中的文件查看内容（md 默认渲染可切源码、图片直接预览、其余语法高亮；点击行号复制「路径:行号」便于在讨论对话框中引用）': 'Click a file in the banner above to view it (md renders by default with a source toggle, images preview directly, others get syntax highlighting; click a line number to copy "path:line" for quoting in discussions)',
  '点击任意处关闭放大图': 'Click anywhere to close the enlarged image',
  '点击进入讨论详情': 'Click to open the discussion',
  '焦点不在可编辑区域且无其他弹窗；重复按键不叠加面板': 'Focus not in an editable area and no other dialog; repeated presses do not stack panels',
  '状态': 'Status',
  '环境错误': 'Environment error',
  '生效条件': 'Applies when',
  '用户配置': 'User config',
  '目录分层横幅': 'Directory banner',
  '目录存在性检测': 'Directory existence check',
  '确定': 'OK',
  '确定停止当前执行？': 'Stop the current run?',
  '确认初始化': 'Confirm initialize',
  '确认后停止派发后续项：账本剩余未领取项标记出局，在途项标记人工终止并释放占用；本轮全部处理记录保留。在途子代理需在对应 Agent 会话人工停止。终止后可立即「启动新一轮」。': 'After confirming, no further items are dispatched: unclaimed ledger items are dropped, in-flight ones are marked manually aborted and their slots released; all records of this round are kept. Stop in-flight subagents manually in their own Agent sessions. You can "Start a new round" right away.',
  '确认后停止派发后续项：账本剩余未领取项标记出局，在途项标记人工终止并释放项目占用（已认领条目的业务状态不动，由人工后续处理）；本轮全部处理记录保留。在途子代理需在对应 Agent 会话人工停止。终止后可立即「启动新一轮」。': 'After confirming, no further items are dispatched: unclaimed ledger items are dropped, in-flight ones are marked manually aborted and the project slot is released (business statuses of claimed items are untouched and handled by you later); all records of this round are kept. Stop in-flight subagents manually in their own Agent sessions. You can "Start a new round" right away.',
  '确认完成': 'Confirm done',
  '确认移出': 'Confirm removal',
  '移入中…': 'Planning…',
  '移入计划': 'Add to plan',
  '移出': 'Remove',
  '移出中…': 'Removing…',
  '移出所有不存在目录': 'Remove all missing directories',
  '移出确认': 'Removal confirmation',
  '移出计划': 'Remove from plan',
  '移出计划（退回已接受）：仅已计划且未进入开发中的条目可移出': 'Remove from plan (back to accepted): only planned items not yet in development can be unplanned',
  '等待会话创建': 'Waiting for session creation',
  '等待领取下一项': 'Waiting to claim the next item',
  '管理项目': 'Manage projects',
  '类型': 'Type',
  '类型推断': 'Type inference',
  '类型未知': 'Type unknown',
  '粘贴或选择图片，创建后写入描述（png / jpg / webp 等，单张 ≤ 8MB）': 'Paste or choose images; they are written into the description on create (png / jpg / webp etc., ≤ 8MB each)',
  '素材·生成物': 'Assets & artifacts',
  '终止任务': 'Abort task',
  '继承值未加载：点击「刷新配置」解析本机有效配置。': 'Inherited values not loaded: click "Refresh config" to resolve the effective local config.',
  '继承本机配置': 'Inherit local config',
  '继承项目设置': 'Inherit project settings',
  '继承项目设置 / 本机配置': 'Inherit project / local config',
  '编辑条目': 'Edit item',
  '缺失': 'Unresolved',
  '缺少当前查看的执行详情，无法恢复': 'No run detail is open; cannot resume',
  '网络重试次数': 'Network retry count',
  '网络错误退避重试中': 'Backing off after network errors',
  '耗时': 'Elapsed',
  '聚焦当前模块搜索框': 'Focus this module\'s search box',
  '背景（可选）': 'Background (optional)',
  '自动复制失败，请在弹出的文本框中手动复制': 'Auto-copy failed; copy manually from the text box that opened',
  '自动换行': 'Wrap lines',
  '自动派发': 'Auto dispatch',
  '自动派发未开启': 'Auto dispatch off',
  '自定义': 'Custom',
  '营销': 'Marketing',
  '营销档案有未保存内容': 'The marketing profile has unsaved changes',
  '解析中…': 'Resolving…',
  '解析时间': 'Resolved at',
  '解析路径': 'Resolve path',
  '认领者': 'Owner',
  '讨论': 'Discussions',
  '讨论中': 'Discussing',
  '讨论看板': 'Discussions board',
  '讨论纪要': 'Discussion minutes',
  '让 Agent 直接认领。': 'and let the Agent claim it directly.',
  '记录': 'Records',
  '设置': 'Settings',
  '设置读取失败': 'Failed to load settings',
  '设计': 'Design',
  '该执行缺少模型快照（历史记录未记录）；恢复前需以新配置重试建立一次明确选择，不伪造旧模型。': 'This run lacks a model snapshot (not recorded in history); before resuming, retry once with a new config to establish an explicit choice — the old model is never faked.',
  '该模型能力未知：强度不做兼容性冒认': 'Model capabilities unknown: effort compatibility is not assumed',
  '该目录已初始化：请改用「导入项目」。': 'This directory already has a board: use "Import project" instead.',
  '详情已打开、非输入态；边界停止，不循环': 'Detail open, not typing; stops at the ends, no wrap-around',
  '说明': 'README',
  '请先初始化看板': 'Initialize the board first',
  '请求与运行时模型不一致': 'Requested model differs from runtime model',
  '请求模型': 'Requested model',
  '请确认实际写入位置后，再次点击「确认初始化」。': 'Verify where data will be written, then click "Confirm initialize" again.',
  '请输入项目根目录的绝对路径': 'Enter the absolute path of the project root',
  '账户无权使用该模型': 'Account not entitled to this model',
  '跨项目批量任务': 'Cross-project batch tasks',
  '路径必须是绝对路径（以 / 开头）': 'The path must be absolute (starting with /)',
  '输入框、文本域、下拉选择、contenteditable 及中文输入法组合输入期间不触发以上快捷键；带 Ctrl / ⌘ / Alt 的组合键与未列出的按键保留浏览器默认行为。快捷键只触发现有界面入口，不直接接受、计划、删除条目或启动批量任务。': 'These shortcuts do not fire while typing in inputs, textareas, selects, contenteditable, or during IME composition; combos with Ctrl / ⌘ / Alt and unlisted keys keep browser defaults. Shortcuts only trigger existing UI actions — they never accept, plan, delete items, or start batch tasks.',
  '运行环境': 'Environment',
  '运行配置': 'Run config',
  '进入任务模块 AI 分析面板：对已接受未完善条目批量补全文档（与勾选无关）': 'Open the AI analysis panel: complete documents of accepted unrefined items in bulk (independent of checkboxes)',
  '进入任务模块 AI 开发面板：以已计划队列（最旧优先）为范围，由面板内「启动」创建任务': 'Open the AI development panel: scoped to the planned queue (oldest first); "Start" inside the panel creates the task',
  '进入项目任务': 'Open project tasks',
  '进度、队列与结果集中在这里': 'Progress, queues and results live here',
  '进行中': 'In progress',
  '连接中…': 'Connecting…',
  '选择上方文档查看': 'Pick a document above to view',
  '选择左侧列表中的条目查看详情': 'Select an item on the left to see details',
  '通过': 'Passed',
  '配置方式': 'Config source',
  '配置无法解析': 'Config cannot be resolved',
  '重启后自动继续': 'Continues automatically after restart',
  '重新复制': 'Recopy',
  '重新执行': 'Run again',
  '重新检测': 'Re-check',
  '重试': 'Retry',
  '重试读取': 'Retry loading',
  '钩子配置': 'Hooks config',
  '错误输出': 'Error output',
  '队列': 'Queue',
  '队列已空：等待已计划条目（新置计划的条目可继续派发）': 'Queue empty: waiting for planned items (newly planned items can still be dispatched)',
  '阶段': 'Stage',
  '需人工处理': 'Needs manual action',
  '需求': 'Requirements',
  '需求 / Bug': 'Requirements / Bugs',
  '需求 / Bug 同一表单，按类型切换字段': 'One form for requirements and bugs; fields switch by type',
  '需求列表': 'Requirements list',
  '需求（REQ）': 'Requirement (REQ)',
  '需要改模型？以新配置重试本项': 'Need a different model? Retry this item with a new config',
  '需要重新验证（配置已变化，旧结果不适用）': 'Re-verification needed (config changed; old result no longer applies)',
  '项目': 'Projects',
  '项目并发 1 · 全服务并发 1': 'Per-project concurrency 1 · service-wide concurrency 1',
  '项目指定': 'Project default',
  '项目根': 'Project root',
  '项目根目录绝对路径': 'Absolute path of the project root',
  '项目管理': 'Project management',
  '项目设置': 'Project settings',
  '项目配置': 'Project config',
  '项（每轮实时读取，含本轮新接受的单）': 'items (re-read live each round, including newly accepted ones)',
  '顺序移动焦点': 'Move focus in order',
  '驳回中…': 'Rejecting…',
  '驳回完成（退回开发）': 'Reject completion (back to development)',
  '驳回待接受': 'Reject to pending',
  '驳回待接受（退回待接受）：勾选的已接受条目逐条退回待接受；完善中的单待本轮 AI 分析结束后再驳回': 'Reject to pending: selected accepted items return to pending one by one; refining items wait until this AI analysis round ends',
  '驳回接受（退回待接受）': 'Reject acceptance (back to pending)',
  '验收标准、现象与复现步骤等（可留空，后续补充）': 'Acceptance criteria, symptoms and repro steps (optional; can be added later)',
  '验证中…（真实最小执行）': 'Verifying… (real minimal run)',
  '验证模型可达': 'Verify model reachability',
  '💬 讨论': '💬 Discuss',
  '🗑 删除': '🗑 Delete',
  '（暂无内容）': '(empty)',
  '（暂无执行记录）': '(no run records)',
  '（未填）': '(not filled)',
  '（未检测到）': '(not detected)',
  '（根文件）': '(root files)',
  '（目录未收录）': '(directory not in catalog)',
  '（空目录）': '(empty directory)',
  '（空，等待已计划条目）': '(empty, waiting for planned items)',
  '（缺）': '(missing)',
  '＋ 新建': '+ New',
  'thread.started 提供的确切 ID；未获得不显示假 ID': 'Exact ID from thread.started; no fake ID is shown when missing',
  '下属 Bug': 'Child bugs',
  '主会话退出/压缩后，新会话用同一提示词续接': 'After the dispatch session exits or compacts, a new session continues with the same prompt',
  '任务分区': 'Task sections',
  '会真实发起一次最小 codex exec（消耗一次模型请求），需明确点击触发': 'Actually starts a minimal codex exec (one model request); must be triggered by an explicit click',
  '使用已记录的确切会话 ID 与原配置快照续跑本项（不新开上下文）': 'Resume this item with the recorded session ID and original config snapshot (no fresh context)',
  '停止派发后续项；剩余项出局；本轮记录保留；在途子代理需在对应会话人工停止': 'Stop dispatching further items; remaining items drop out; this round\'s records are kept; stop in-flight subagents manually in their own sessions',
  '允许 Codex 在此项目没有 Git 仓库时执行，沙箱和审批沿用本机设置': 'Allow Codex to run when this project has no Git repo; sandbox and approval follow local settings',
  '全局任务筛选': 'Filter global tasks',
  '切换 Markdown 的渲染 / 源码视图': 'Toggle Markdown rendered / source view',
  '切换自动换行（设置在切换文件后保持）': 'Toggle line wrap (persists across files)',
  '创建任务并复制通用主调度提示词（子代理模型跟随主调度会话）': 'Create the task and copy the generic dispatch prompt (subagent model follows the dispatch session)',
  '删除（仅待接受，移除整个条目目录且不可恢复）': 'Delete (pending only; removes the whole item directory and cannot be undone)',
  '复制失败可重试；重试复制不会创建新任务': 'If copying fails you can retry; recopying does not create a new task',
  '如 gpt-6-astra': 'e.g. gpt-6-astra',
  '如 high': 'e.g. high',
  '已请求暂停后续领取：当前项继续，完成后暂停': 'Pause of next pickup requested: the current item finishes, then pickup pauses',
  '开启后看板服务串行取单：每项后台启动独立 codex exec 会话；关闭只停止领取新项，当前项继续': 'When on, the board service claims items serially: each starts an independent codex exec session in the background; turning it off only stops claiming new items — the current one continues',
  '普通 codex exec 会话默认不进入桌面侧栏；可见性未验证前不提供跳转，请在看板查看日志': 'Plain codex exec sessions do not appear in the desktop sidebar by default; until visibility is verified there is no jump link — check logs on the board',
  '服务重启后核对通过时自动恢复取单（默认关闭）': 'Automatically resume claiming after the service restarts and verification passes (off by default)',
  '本次执行创建时的配置快照；续跑/重试保持不变': 'Config snapshot taken when this run was created; resumes/retries keep it unchanged',
  '查看执行详情与日志': 'View run detail and logs',
  '查看执行详情（摘要/日志/最终回复/测试报告）': 'View run detail (summary/logs/final reply/test report)',
  '模型配置待处理：点击行查看，或到设置模块的「模型与推理强度」处理': 'Model config pending: click the row to view, or handle it in Settings → Model & reasoning effort',
  '缺失原因': 'Missing reason',
  '自动探测（PATH / ChatGPT.app 内置）': 'Auto-detect (PATH / built into ChatGPT.app)',
  '详情分页': 'Detail paging',
  '跳转到来源讨论详情': 'Open the source discussion',
  '重新检测本机 Zcode / Codex 客户端（只读存在性检查）': 'Re-detect local Zcode / Codex clients (read-only existence check)',
  '重新解析本机有效配置（只读，不发模型请求）': 'Re-resolve the effective local config (read-only; no model request)',
  '重新读取提交状态': 'Reload commit status',
  '重试复制不会创建新任务': 'Recopying does not create a new task',
  '文档': 'Docs',
  '文档讨论、纪要归档与说明同步': 'Document discussion, minutes archiving and doc sync',
  '接受（仅待接受）': 'Accept (pending only)',
  '编辑标题与描述（仅待接受）': 'Edit title & description (pending only)',
  '搜索编号 / 标题过滤条目': 'Filter items by ID / title',
  '收起详情': 'Collapse detail',
  '本轮处理记录': 'Records of this round',
  '本轮已处理完毕': 'This round is fully processed',
  '排队中': 'Queued',
  '已排入开发计划，开发启动后最旧优先自动处理；未进入开发中前可「移出计划」退回已接受。': 'Planned; development processes the oldest first automatically. Before it starts, "Remove from plan" reverts it to accepted.',
  '本轮完善队列已处理完毕（条目均保持已接受，后续流转由人工判断）': 'This refine round is fully processed (items all stay accepted; next steps are up to you).',
  '保留原记录并增加一次执行尝试；不可重试时会给出原因与后续操作': 'Keeps the original record and adds one more attempt; when retry is impossible, the reason and next steps are shown',
  '全选：仅勾选当前筛选档内可见的可操作条目（待接受 / 已接受 / 已计划；叠搜索范围）': 'Select all: checks only operable items visible in the current lane (pending / accepted / planned; scoped by search)',
  '复制文件相对路径': 'Copy the file\'s relative path',
  '已选 0 项': '0 selected',
  '查看条目': 'View item',
  '标题（不超过 120 字）': 'Title (max 120 chars)',
  '模型 ID': 'Model ID',
  '禁止引入，请替换': 'Banned; please replace',
  '移入计划（排入开发计划）：勾选的已接受条目逐条置为已计划，开发启动后最旧优先处理': 'Add to plan: selected accepted items become planned one by one; development processes the oldest first',
  '移出计划（退回已接受）': 'Remove from plan (back to accepted)',
  '（仅记录了会话 ID 且已收尾的执行可恢复）': '(only runs with a recorded session ID that already finished can be resumed)',
  '完善中，待本轮 AI 分析结束后再驳回': 'Refining; reject after this AI analysis round ends',
  '，已复制其提示词': ', its prompt copied',
  '；复制失败请在下方手动复制': '; if copying failed, copy manually below',
  '；复制请在提示词分区手动操作': '; to copy, use the prompt pane manually',
  '；队列位次已前移': '; queue positions shifted up',
  '；面板已切换到当前队首': '; the panel switched to the current queue head',
  '已请求暂停后续领取：当前项继续执行，完成后暂停，不再领取下一项。': 'Pause of next pickup requested: the current item finishes, then pickup pauses — no further items are claimed.',
  '文档已由 AI 分析补全；点击查看 AI 分析面板': 'Documents completed by AI analysis; click to view the AI analysis panel',
  '未入计划。可点「移入计划」排入开发计划（开发启动后最旧优先处理），或在 ZCode 会话运行': 'Not planned. Use "Add to plan" to schedule it (development processes the oldest first), or run in a ZCode session',
  '模型目录默认档位': 'Catalog default tier',
  '（最旧优先，实时读取；运行中新置计划的条目自动进入队列）': '(oldest first, read live; items planned while running join the queue automatically)',
  // REQ-20260911-007 待人工决策承接（hold）：聚合区 / 决策面板 / 复工 / 确认完成防呆
  '待人工确认': 'Pending human decisions',
  '⚠ 等人工决策': '⚠ awaiting decisions',
  'worker 已声明待人工决策': 'worker declared this item blocked on human decisions',
  'worker 声明受阻待人工决策的条目在此承接：补决策 → 复工回已计划队列；清单不随本轮任务结束消失': 'Items blocked on human decisions are handled here: answer decisions → resume back to the planned queue; the list persists after task rounds end',
  '查看进展记录': 'Progress log',
  '收起记录': 'Hide log',
  '补决策': 'Decide',
  '复工': 'Resume',
  '复工中…': 'Resuming…',
  '仍要确认完成': 'Confirm done anyway',
  '常规路径是补齐决策并复工；确认后将越过未答决策完成条目（留痕写入条目 decisions.md）。': 'The normal path is to answer the decisions and resume; confirming will complete the item while skipping unanswered decisions (recorded in the item\'s decisions.md).',
  '未答': 'Unanswered',
  '人工决策': 'Human decisions',
  '逐项作答后复工；支持保存未答完的草稿': 'Answer each item, then resume; partial drafts can be saved',
  '正在读取决策项…': 'Loading decisions…',
  '关闭人工决策面板': 'Close the decisions panel',
  '保存决策': 'Save decisions',
  '人工答复（必填才计入已答）': 'Human answer (required to count as answered)',
  '补充说明（可选）': 'Note (optional)',
  '请至少填写一项答复再保存': 'Fill in at least one answer before saving',
  '决策已齐备，可复工': 'All decisions answered — ready to resume',
  '决策已齐备，可复工（回到已计划队列）': 'All decisions answered — ready to resume (back to the planned queue)',
  '决策已齐备：条目回已计划队列，可被 AI 开发重新取单': 'All decisions answered: the item returns to the planned queue and can be picked up by AI development again',
  '决策留痕见条目目录 decisions.md': 'Decision trail is kept in the item\'s decisions.md',
  '声明': 'Declared',
  '已作答': 'Answered',
  '已复工': 'Resumed',
  '已作废': 'Cancelled',
  '随完成闭环': 'Closed with done',
  '刚刚': 'just now',
  '（暂无事件）': '(no events yet)',
  '（条目已删除）': '(item deleted)',
};

// ---------- 英文词典（动态：键中 ◇ = 插值占位，编译为 ^…(.+?)…$ 锚定正则） ----------
const EN_DYNAMIC = {
  // REQ-20260913-001 构建模块搜索反馈（命中数动态拼接）
  '命中 ◇ / 共 ◇ 个版本（按版本名 / 单号）': '$1 of $2 versions matched (by name / item id)',
  // REQ-20260913-004 支持版本删除：弹窗标题 / 成功失败反馈（动态拼接）
  '删除版本（◇）': 'Delete version ($1)',
  '✓ 已删除版本（◇）': '✓ Version deleted ($1)',
  '✕ 删除失败：◇': '✕ Delete failed: $1',
  // REQ-20260911-009 Git 工作流：状态/失败就近反馈（动态拼接）
  'Git 状态加载失败：◇': 'Failed to load Git status: $1',
  '失败：◇（可重试；已存在的分支不会重复创建）': 'Failed: $1 (retryable; an existing branch is never re-created)',
  // BUG-20260912-001：状态行改为按段翻译（见 EN 区注释），原整句动态键移除
  '已选 ◇ 项': '$1 selected',
  '接受 ◇': 'Accept $1',
  '/ 强度 ◇ · 来源 ◇ · 快照时间 ◇◇': '/ effort $1 · source $2 · snapshot $3$4',
  // REQ-20260911-007 待人工决策承接（hold）：聚合区 / 决策面板 / 复工 / 确认完成防呆
  '⚠ 待人工确认（◇）': '⚠ Pending human decisions ($1)',
  '已等待 ◇': 'waiting $1',
  '◇ 天': '$1 d',
  '◇ 小时': '$1 h',
  '◇ 分': '$1 min',
  '未答 ◇/◇': 'unanswered $1/$2',
  '已答：◇': 'answered: $1',
  '尚缺 ◇ 项决策，补齐后可复工': '$1 decision(s) still missing; answer them to enable resume',
  '待人工决策：◇ 项未答；到列表下方「待人工确认」区补决策并复工': 'Awaiting human decisions: $1 unanswered; answer and resume in the "Pending human decisions" area below the list',
  '受阻原因：◇': 'Blocked reason: $1',
  '运行：◇（详情见 docs/agent-team-board/dispatch/runs/，决策留痕见条目目录 decisions.md）': 'Run: $1 (see docs/agent-team-board/dispatch/runs/; decision trail in the item\'s decisions.md)',
  '进展记录读取失败：◇': 'Failed to load the progress log: $1',
  '待确认清单加载失败：◇': 'Failed to load pending decisions: $1',
  '人工决策 · ◇': 'Human decisions · $1',
  '声明：◇（◇）◇ · 未答 ◇/◇': 'Declared: $1 ($2)$3 · unanswered $4/$5',
  '保存失败：◇（输入已保留，可重试）': 'Save failed: $1 (input kept; you can retry)',
  '草稿已保存，尚缺 ◇ 项': 'Draft saved; $1 item(s) still missing',
  '草稿已保存，尚缺 ◇ 项（◇），复工保持禁用': 'Draft saved; $1 still missing ($2) — resume stays disabled',
  '决策项读取失败：◇': 'Failed to load decisions: $1',
  '复工失败：◇': 'Resume failed: $1',
  '已复工 ◇：回到已计划队列，可被 AI 开发重新取单': 'Resumed $1: back to the planned queue, ready for AI development to pick up again',
  '尚有 ◇ 项决策未答，仍要确认完成吗？': '$1 decision(s) unanswered — confirm done anyway?',
  '✓ ◇ 已确认完成': '✓ $1 confirmed done',
  'README 缺少「◇」节，无法编辑描述': 'README is missing the "$1" section; cannot edit the description',
  '· 出局 ◇': '· $1 out',
  '· 回复「◇」': '· replies "$1"',
  '↩ 已撤销 ◇，状态已回退': '↩ Undone: $1; status reverted',
  '◇ / ◇ 项，仅列最新 ◇，更早请搜索': '$1 / $2 items; only the latest $3 listed — search for older ones',
  '◇ / 强度 ◇': '$1 / effort $2',
  '◇ · ◇ 次尝试◇': '$1 · attempt $2$3',
  '◇ · 创建 ◇': '$1 · created $2',
  '子代理模式（提示词通用，任意 Agent 会话可执行） · 创建 ◇': 'Subagent mode (agent-agnostic prompt; any Agent session can run it) · created $1',
  '执行 Agent ◇（子代理模式） · 创建 ◇': 'Run Agent $1 (subagent mode) · created $2',
  '◇ ← 前置未完成：◇': '$1 ← prerequisite unfinished: $2',
  '◇ 个任务': '$1 tasks',
  '◇ 个项目 ·': '$1 projects ·',
  '◇ 已不在已接受状态，已从选择中移除': '$1 is no longer accepted; removed from selection',
  '◇ 已不在已计划状态，已从选择中移除': '$1 is no longer planned; removed from selection',
  '◇ 已有看板数据（◇），不会覆盖；如需加入列表请切换到「导入项目」。': '$1 already has board data ($2); nothing will be overwritten. To add it to the list, switch to "Import project".',
  '◇ 轮 · ◇': '$1 rounds · $2',
  '◇◇ 次尝试 · ◇◇': '$1$2 attempts · $3$4',
  '◇。看板服务版本过旧：请在终端运行 atb serve 自动重启过旧服务，然后刷新页面': '$1. The board service is outdated: run "atb serve" in a terminal to restart it, then reload this page',
  '◇。看板服务版本过旧：请在终端运行 atb serve 自动重启过旧服务，然后重试': '$1. The board service is outdated: run "atb serve" in a terminal to restart it, then retry',
  '◇已排入开发计划，开发启动后最旧优先自动处理；未进入开发中前可「移出计划」退回已接受。': '$1 is planned; development processes the oldest first automatically. Before it starts, "Remove from plan" reverts it to accepted.',
  '◇详情打开中（右侧抽屉正展示此条目）': '$1 detail open (this item is shown in the right drawer)',
  '◇（续跑/重试计入）': '$1 (resumes/retries included)',
  '⚑ Agent 已上报完成◇，请人工测试。': '⚑ Agent reported completion$1; please test manually.',
  '⚠ 图片加载失败：◇（超过 8MB 或读取异常）': '⚠ Image failed to load: $1 (over 8MB or read error)',
  '⚠ 文件横幅初始化失败：◇': '⚠ File banner failed to initialize: $1',
  // BUG-20260912-004：泛化兜底词条 '✓ ◇ 已◇' 移除——其英文模板 '✓ $1 $2' 无 ASCII 锚点，
  // 反向模式会命中纯中文提示并自馈叠字（「已已已…确认完成」）；具体动作标签一律用精确
  // 双向词条（✓ ◇ 已确认完成 / 已接受 / 已移出计划 / 下方两条驳回提示等），
  // 未收录标签按「未命中保持原文」降级原则处理（该源码模板片段见 ALLOWLIST 豁免说明）。
  '✓ ◇ 已接受': '✓ $1 accepted',
  '✓ ◇ 已移出计划': '✓ $1 removed from plan',
  '✓ ◇ 已驳回完成（退回开发）': '✓ $1 rejected completion (back to development)',
  '✓ ◇ 已驳回接受（退回待接受）': '✓ $1 rejected acceptance (back to pending)',
  '✓ ◇ 标题与描述已更新': '✓ $1 title & description updated',
  '✓ 任务已创建、提示词已复制，请在对应项目会话粘贴发送（候选 ◇，子代理模式；状态：待启动）': '✓ Task created and prompt copied; paste it into a session of the corresponding project ($1 candidates, subagent mode; status: prepared)',
  '✓ 任务已创建、提示词已复制，请在对应项目会话粘贴发送（候选 ◇，受阻 ◇；状态：待启动）': '✓ Task created and prompt copied; paste it into a session of the corresponding project ($1 candidates, $2 blocked; status: prepared)',
  '✓ 已以新配置启动 ◇（关联原执行 ◇）': '✓ Started $1 with the new config (linked to original run $2)',
  '✓ 已保存 ◇ 的批量执行依赖（◇ 项）': '✓ Saved batch dependencies for $1 ($2 items)',
  '✓ 已保存 ◇ 的模型设置：将用于后续新执行；当前执行与续跑保持原设置': '✓ Saved model settings for $1: applied to future runs; the current run and its resumes keep the original settings',
  '✓ 已创建 ◇（已接受）': '✓ Created $1 (accepted)',
  '✓ 已创建 ◇（待接受）': '✓ Created $1 (pending)',
  '✓ 已创建 ◇（讨论中，无关联需求），请复制启动提示词到 Agent 新会话': '✓ Created $1 (open discussion, no linked requirement); copy the launch prompt into a new Agent session',
  '✓ 已初始化并切换到 ◇（◇）': '✓ Initialized and switched to $1 ($2)',
  '✓ 已删除 ◇': '✓ Deleted $1',
  '✓ 已导入并切换到 ◇（条目与状态保持原样）': '✓ Imported and switched to $1 (items and statuses untouched)',
  '✓ 已按原配置恢复执行：◇': '✓ Resumed with the original config: $1',
  '✓ 已终止完善任务：◇': '✓ Refine task aborted: $1',
  '✓ 已终止开发任务：◇': '✓ Develop task aborted: $1',
  '「◇」仍在待接受阶段；删除将移除整个条目目录（含全部文档），看板层面不可恢复。': '"$1" is still pending; deleting removes the whole item directory (including all documents) and cannot be undone on the board.',
  '「◇」模块已暂时隐藏，已回到需求模块': 'The "$1" module is temporarily hidden; returned to Requirements',
  '下属 Bug（◇，未完成 ◇）': 'Child bugs ($1, $2 unfinished)',
  '仅待接受条目可改；保存后标题与条目文档首行同步，描述整体替换 README「◇」节。': 'Only pending items can be edited; after saving, the title syncs with the first line of the item document and the description replaces the "$1" section of the README.',
  '仅支持 ◇：◇': 'Supports only $1: $2',
  '任务已创建、提示词已复制，请在对应项目会话粘贴发送（◇，条目 ◇；状态：待启动）': 'Task created and prompt copied; paste it into a session of the corresponding project ($1, item $2; status: prepared)',
  '会话 ◇': 'Session $1',
  '依赖阻塞：◇ 项已计划条目因前置条目未完成暂不派发◇ —— ◇。这与队列已空不同：前置条目完成人工验收后将自动继续派发。': 'Dependency block: $1 planned item(s) not dispatched because prerequisites are unfinished$2 — $3. Unlike an empty queue, dispatch resumes automatically once the prerequisites pass manual acceptance.',
  '任务设置加载失败：◇': 'Failed to load task settings: $1',
  '保存失败：◇': 'Save failed: $1',
  '保存失败：◇（草稿已保留，可重试）': 'Save failed: $1 (draft kept; you can retry)',
  '全局任务加载失败：◇。正在随轮询自动重试；也可刷新页面重试。': 'Failed to load global tasks: $1. Retrying automatically on each poll; you can also reload the page.',
  '全局执行中（首期全服务并发 1）：等待 ◇': 'Global dispatch running (initial concurrency: 1 per service): waiting for $1',
  '共 ◇': 'Total $1',
  '共 ◇ 条': '$1 in total',
  '共 ◇ 项候选。': '$1 candidates in total.',
  '共 ◇ 项，不存在 ◇ 项，检测失败 ◇ 项。': '$1 in total, $2 missing, $3 failed to check.',
  '共 ◇ 项，不存在 ◇ 项，检测失败 ◇ 项。 未发现不存在的目录。': '$1 in total, $2 missing, $3 failed to check. No missing directories found.',
  '共 ◇◇': 'Total $1$2',
  '共 ◇ · 出局 ◇': 'Total $1 · $2 out',
  '出局 ◇': '$1 out',
  '切换失败：◇': 'Switch failed: $1',
  '创建 ◇': 'Create $1',
  '创建失败：◇': 'Create failed: $1',
  '初始化失败：◇': 'Initialize failed: $1',
  '删除 ◇？': 'Delete $1?',
  '刷新失败，正在重试：◇（已保留上一次数据）': 'Refresh failed, retrying: $1 (previous data kept)',
  '加载更多（◇/◇）': 'Load more ($1/$2)',
  '原始值 ◇': 'Original value $1',
  '原执行（◇，模型 ◇）与记录保留；本操作为本项建立关联的新执行，仍受互斥与会话恢复检查约束，重复点击只产生一次执行。': 'The original run ($1, model $2) and its records are kept; this action starts a new linked run for the item, still subject to the mutex and session-recovery checks. Repeated clicks start only one run.',
  '受阻待处理 ◇': 'Blocked, pending $1',
  '命中 ◇ / 共 ◇（当前筛选可见 ◇）': '$1 hit / $2 total ($3 visible under current filter)',
  '图片无法加载：◇': 'Image failed to load: $1',
  '在◇中搜索': 'Search in $1',
  '复制 ◇ 到剪贴板': 'Copy $1 to clipboard',
  '失败 ◇（◇）': 'Failed $1 ($2)',
  '子代理会话 ◇': 'Subagent session $1',
  '将写入：◇': 'Will write to: $1',
  '将移出 ◇ 个不存在的目录（仅从列表移出，不删除目录与文档，不停止任务；目录恢复后可重新导入）：◇': 'Will remove $1 missing directorie(s) from the list (directories and documents are not deleted; tasks are not stopped; they can be re-imported once restored): $2',
  '已切换模型：原强度 ◇ 不被 ◇ 支持，请重新选择（支持：◇）': 'Model switched: the previous effort $1 is not supported by $2; pick again (supported: $3)',
  '已切换：◇': 'Switched: $1',
  '已加载 ◇ 字符（增量读取，不整载全量）': '$1 characters loaded (incremental; full content is not loaded at once)',
  '已在列表中，已切换到 ◇': 'Already in the list; switched to $1',
  '已复制 ◇': 'Copied $1',
  '已复制 引用：◇ ◇': 'Copied reference: $1 $2',
  '✓ 已复制提示词并请求打开 ◇（◇）：请在新建会话中粘贴发送': '✓ Prompt copied and requested opening $1 ($2): paste and send it in the new session',
  '复制失败：已请求打开 ◇（◇），请回任务面板点「重新复制」后再粘贴': 'Copy failed: requested opening $1 ($2); use "Recopy" in the task panel, then paste',
  '提示词获取失败（◇）：已请求打开 ◇，请回任务面板点「重新复制」后再粘贴': 'Failed to fetch the prompt ($1): requested opening $2; use "Recopy" in the task panel, then paste',
  '当前面板暂无任务提示词，请先创建任务；已请求打开 ◇（◇），可稍后从提示词分区「重新复制」': 'No dispatch prompt in this panel yet — create a task first; requested opening $1 ($2). You can use "Recopy" in the prompt section later',
  '已用时 ◇': 'Elapsed $1',
  '已移出 ◇（目录与文档保留，可重新导入）': 'Removed $1 (directory and documents kept; can be re-imported)',
  '已移出 ◇：仅从列表移出，目录与文档保留': 'Removed $1: list entry only; directory and documents are kept',
  '已计划队列（最旧优先）：◇——运行中新置计划的条目自动进入队列。启动 = 创建任务并复制调度提示词（复制成功 ≠ 执行中，登记运行后才算执行中）；提示词通用，可在任意一种 Agent 会话粘贴执行。': 'Planned queue (oldest first): $1 — items planned while running join automatically. Start = create the task and copy the dispatch prompt (copied ≠ running; it counts as running only after the run is registered). The prompt is agent-agnostic and can run in any Agent session.',
  '自动复制当前面板最新主调度提示词后打开 Codex 新会话（◇）：深链不传提示词，不会自动发送，请粘贴发送': 'Copy this panel\'s latest dispatch prompt automatically, then open a new Codex session at $1: the deep link carries no prompt and never auto-sends — paste and send it yourself',
  '自动复制当前面板最新主调度提示词后打开 Zcode（◇）：深链只打开工作区，会话需手动新建并粘贴提示词': 'Copy this panel\'s latest dispatch prompt automatically, then open Zcode at $1: the deep link only opens the workspace; create the session manually and paste the prompt',
  // BUG-20260913-005：版本回填弹窗「去新建 XX 会话」（先复制本弹窗版本提示词后跳深链，口径同任务面板）
  '✓ 已复制提示词并请求打开 ◇（◇）：请在新建会话中粘贴发送；回答仍粘贴回本弹窗': '✓ Prompt copied and requested opening $1 ($2): paste and send it in the new session; paste the answer back into this modal',
  '复制失败：已请求打开 ◇（◇），请点弹窗内「复制提示词」手动复制后再粘贴；回答仍粘贴回本弹窗': 'Copy failed: requested opening $1 ($2); use "Copy prompt" in this modal to copy manually, then paste; the answer goes back into this modal',
  '自动复制本弹窗版本提示词后打开 Zcode（◇）：深链只打开工作区，会话需手动新建并粘贴提示词': 'Copy this modal\'s version prompt automatically, then open Zcode at $1: the deep link only opens the workspace; create the session manually and paste the prompt',
  '自动复制本弹窗版本提示词后打开 Codex 新会话（◇）：深链不传提示词，不会自动发送，请粘贴发送': 'Copy this modal\'s version prompt automatically, then open a new Codex session at $1: the deep link carries no prompt and never auto-sends — paste and send it yourself',
  '当前弹窗暂无版本提示词；已请求打开 ◇（◇）': 'No version prompt in this modal; requested opening $1 ($2)',
  '待处理 ◇': '$1 pending',
  '待处理队列◇': 'Pending queue$1',
  '成功 ◇ 项，跳过 ◇ 项，失败 ◇ 项。': '$1 succeeded, $2 skipped, $3 failed.',
  '截图 ◇ 无法加载（文件可能被移动、删除或超过 8MB 上限）': 'Screenshot $1 failed to load (file may have been moved or deleted, or exceeds the 8MB limit)',
  '截图 ◇MB 超过 8MB 上限（◇）': 'Screenshot is $1MB, over the 8MB limit ($2)',
  '截图最多 ◇ 张，已达上限': 'Up to $1 screenshots; limit reached',
  '执行 Agent ◇（子代理模式）': 'Run Agent $1 (subagent mode)',
  '执行器已暂停：◇': 'Executor paused: $1',
  '执行记录◇': 'Run records$1',
  '执行详情 · ◇': 'Run detail · $1',
  '批量执行设置（依赖 ◇ 项）': 'Batch execution settings ($1 dependencies)',
  '批量移出失败：◇': 'Batch removal failed: $1',
  '批量移出完成：成功 ◇，跳过 ◇，失败 ◇': 'Batch removal done: $1 succeeded, $2 skipped, $3 failed',
  '接受完成：成功 ◇ 条，失败 ◇ 条': 'Acceptance done: $1 succeeded, $2 failed',
  '推断为◇': 'inferred as $1',
  '搜索命中条目 ◇ 项（当前档可见 0 项）：当前档无可见命中，切换状态筛选可查看其他档命中': 'Search hit $1 item(s) (0 visible in this lane): switch the status filter to see hits in other lanes',
  '搜索命中条目 ◇ 项（当前档可见 ◇ 项）': 'Search hit $1 item(s) ($2 visible in this lane)',
  '搜索失败：◇': 'Search failed: $1',
  '撤销失败：◇': 'Undo failed: $1',
  '放大查看 ◇': 'View $1 enlarged',
  '文件 ◇': 'File $1',
  '文件 ◇ · 在文件查看': 'File $1 · view in Files',
  '文档 ◇': 'Document $1',
  '文档：◇': 'Document: $1',
  '无法解析继承值（缺失：◇）。已阻止依赖该配置的新派发；可刷新配置或改为显式选择，不猜测默认模型。': 'Cannot resolve inherited values (missing: $1). New dispatches depending on this config are blocked; refresh the config or choose explicitly — the default model is never guessed.',
  '未完成 ◇': '$1 unfinished',
  '未新建完善任务：已有未结束的完善任务（幂等返回）◇': 'No new refine task: an unfinished one already exists (idempotent return)$1',
  '未新建任务：当前任务尚未结束◇': 'No new task: the current task has not finished$1',
  '未自动转入计划（条目当前为 ◇）': 'Not auto-planned (item is currently $1)',
  '最近 Codex 执行：◇ · ◇◇ ·': 'Latest Codex run: $1 · $2$3 ·',
  '最近 Zcode 执行：◇ · ◇ ·': 'Latest Zcode run: $1 · $2 ·',
  '最近 ◇ 条 / 共 ◇ 条': 'Latest $1 / $2 in total',
  '本轮处理记录◇': 'Records of this round$1',
  '本轮处理记录（◇ 条被搜索过滤）': 'Records of this round ($1 hidden by search)',
  '状态已变化（当前 ◇），不再需要本批完善': 'Status changed (now $1); no longer needs this refine round',
  '状态已变化（当前 ◇…': 'Status changed (now $1…',
  '条目 ◇': 'Item $1',
  '模型目录加载失败：◇。可手动输入模型 ID（标注尚未验证）。': 'Failed to load the model catalog: $1. You can still type a model ID (marked unverified).',
  '模型配置待处理（◇）': 'Model config pending ($1)',
  '模型配置待处理：◇ —— ◇。请到「设置 → 模型与推理强度」处理。': 'Model config pending: $1 — $2. Handle it in Settings → Model & reasoning effort.',
  '模型验证◇：◇◇◇': 'Model verification$1: $2$3$4',
  '正在接受 0 / ◇…': 'Accepting 0 / $1…',
  '正在接受 ◇ / ◇…': 'Accepting $1 / $2…',
  '正在移入计划 0 / ◇…': 'Planning 0 / $1…',
  '正在移入计划 ◇ / ◇…': 'Planning $1 / $2…',
  '正在移出计划 0 / ◇…': 'Unplanning 0 / $1…',
  '正在移出计划 ◇ / ◇…': 'Unplanning $1 / $2…',
  '正在驳回待接受 0 / ◇…': 'Rejecting 0 / $1…',
  '正在驳回待接受 ◇ / ◇…': 'Rejecting $1 / $2…',
  '检测失败◇': 'Check failed$1',
  '检测失败：◇——不使用旧结果，请重新检测。': 'Check failed: $1 — stale results are not used; check again.',
  '检测失败：◇（批量移出不可用，请重新检测）': 'Check failed: $1 (batch removal unavailable; check again)',
  '目录 ◇ 个模型（CLI 只读能力，◇）；账户可用性以真实验证与实际运行为准。': 'Catalog of $1 models (CLI read-only capability, $2); account availability is only proven by real verification and actual runs.',
  '目标：◇ 新执行 · 模型 ◇ / 强度 ◇': 'Target: $1 new run(s) · model $2 / effort $3',
  '目标：◇ 新执行 · 继承项目设置（保存后影响本项后续新执行）': 'Target: $1 new run(s) · inherit project settings (saving affects this item\'s future runs)',
  '确定「◇」 ◇？': 'Confirm "$1" $2?',
  '移入计划完成：成功 ◇ 条，失败 ◇ 条': 'Planning done: $1 succeeded, $2 failed',
  '移出 ◇？◇仅从列表移出，目录及需求、Bug 文档保留；之后可重新导入。': 'Remove $1? $2 Only the list entry is removed; the directory and requirement/bug documents are kept and can be re-imported.',
  '移出失败：◇': 'Remove failed: $1',
  '移出所有不存在目录（◇）': 'Remove all missing directories ($1)',
  '移出计划完成：成功 ◇ 条，失败 ◇ 条': 'Unplanning done: $1 succeeded, $2 failed',
  '第 ◇ 次': 'Attempt #$1',
  '第 ◇ 行': 'Line $1',
  '第 ◇–◇ 行': 'Lines $1–$2',
  '等 ◇ 项': 'and $1 more',
  '简报类型字段缺失或未知（◇），已按账本标识前缀◇。常驻看板服务的路由在启动时固化而静态前端实时读盘，服务进程可能旧于前端：请重启看板服务（atb serve / npm run app）后刷新；若重启后仍出现请按 BUG-20260911-007 反馈': 'The kind field is missing or unknown ($1); the ledger-ID prefix was used$2. The resident board service fixes its routes at startup while the static frontend reads from disk live, so the service process may be older than the frontend: restart the board service (atb serve / npm run app) and reload; if it persists, report it as BUG-20260911-007',
  '编辑 ◇': 'Edit $1',
  '自动转入计划失败（◇◇）：请人工移入计划': 'Auto-planning failed ($1$2): plan the item manually',
  '读取 ◇ 失败，请重试': 'Failed to read $1; retry',
  '读取失败：◇（随下轮轮询自动重试）': 'Read failed: $1 (auto-retried on the next poll)',
  '读取描述失败：◇': 'Failed to read description: $1',
  '读取目录失败：◇': 'Failed to read directory: $1',
  '跳过 ◇（◇）': 'Skipped $1 ($2)',
  '配置层：◇ · 解析时间 ◇': 'Config layers: $1 · resolved at $2',
  '该模型支持：◇◇': 'This model supports: $1$2',
  '需求 / Bug / 文档命中 ◇ · 在需求查看': 'Requirements / bugs / docs hit $1 · view in Requirements',
  '解析失败：◇': 'Resolve failed: $1',
  '设置加载失败：◇': 'Failed to load settings: $1',
  '项目被占用：◇（核对后自动继续）': 'Project busy: $1 (continues automatically after review)',
  '驳回待接受完成：成功 ◇ 条，失败 ◇ 条': 'Reject-to-pending done: $1 succeeded, $2 failed',
  '验证失败 · ◇◇': 'Verification failed · $1$2',
  '验证通过 · ◇◇': 'Verification passed · $1$2',
  '（◇ 条被搜索过滤）': '($1 items hidden by search)',
  '（仅列前 ◇ 项，共 ◇ 项）': '(top $1 of $2 shown)',
  '（另 ◇ 条已进入开发中，不能移出计划）': '(another $1 item(s) already in development and cannot be unplanned)',
  '（目录位于 git 仓库内，数据写入仓库根；输入：◇）': '(directory is inside a git repo; data goes to the repo root; input: $1)',
  '（覆盖率 ◇%）': '(coverage $1%)',
  '（默认 ◇）': '(default $1)',
  '◇ · 双击查看大图': '$1 · double-click to enlarge',
  '◇下的条目': 'Items under $1',
  '删除 ◇': 'Delete $1',
  '复制单号 ◇': 'Copy ID $1',
  // BUG-20260912-003：提交号 5 位短号直显、双击复制完整值——新增悬停提示与成功 toast 词条；
  // 旧「已提交」徽标、「◇ 个提交号」折叠 summary、「复制提交号 ◇」按钮 aria 词条随 UI 移除清理
  '完整提交号：◇（双击复制完整值）': 'Full commit hash: $1 (double-click to copy)',
  '✓ 已复制完整提交号 ◇…': '✓ Copied full commit hash $1…',
  '提交状态查询失败：◇。点击重试；已加载的成功记录保留。': 'Commit status query failed: $1. Click to retry; loaded success records are kept.',
  '查看条目 ◇': 'View item $1',
  '点击进入该项目任务模块（◇）': 'Open this project\'s task module ($1)',
  '任务已创建、提示词已复制，请在对应项目会话粘贴发送（条目 ◇；状态：待启动）': 'Task created and prompt copied; paste it into a session of the corresponding project (item $1; status: prepared)',
  '移除 ◇': 'Remove $1',
  '编辑 ◇ 标题与描述': 'Edit $1 title & description',
  '选择 ◇': 'Select $1',
  '查看大图 ◇': 'View image $1',
  '导入失败：◇': 'Import failed: $1',
  '旧结果（「◇」）': 'Previous result ("$1")',
  '活动 ◇': 'Active $1',
};

// ---------- 豁免清单（不翻译的源码中文片段：键 = 片段，值 = 豁免原因） ----------
const ALLOWLIST = {
  '## 描述': 'markdown 章节定位逻辑键（编辑面板提取/替换 README 节），非界面展示文案',
  '## 现象': 'markdown 章节定位逻辑键（Bug README 节），非界面展示文案',
  'Switch to English · 当前：中文': '语言按钮初始悬浮提示本身即双语；运行时由 applyLang 直接改写，无需词典',
  // BUG-20260912-004：app.js「✓ ${id} 已${label}」toast 模板的源码形态，键值随 label 动态实例化，
  // 不作为词典键直译。具体标签均有精确 EN_DYNAMIC 词条（已确认完成 / 已接受 / 已移出计划 /
  // 已驳回完成（退回开发） / 已驳回接受（退回待接受））；原泛化兜底键 '✓ ◇ 已◇' 因反向模式
  // 无英文锚点会自匹配中文提示叠字而移除，新增未收录标签按「未命中保持原文」降级。
  '✓ ◇ 已◇': 'toast 动态模板源码形态（label 动态），具体标签各有精确词条；泛化兜底键因反向自匹配叠字移除（BUG-20260912-004）',
};

// ---------- 运行时 ----------
const STORAGE_KEY = 'atb.lang';
const TRANSLATABLE_ATTRS = ['title', 'placeholder', 'aria-label', 'aria-placeholder'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE']);

let lang = 'zh';
let langFrom = 'auto';
let baseTitle = null; // 初始（中文）文档标题，zh 模式还原用

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function detect(nav) {
  const n = nav || (typeof navigator !== 'undefined' ? navigator : null);
  if (!n) return 'zh';
  const langs = (n.languages && n.languages.length ? n.languages : [n.language]).filter(Boolean);
  return langs.some((l) => /^en[-_]/i.test(l) || /^en$/i.test(l)) ? 'en' : 'zh';
}

function initLang(nav) {
  const saved = storage()?.getItem(STORAGE_KEY);
  if (saved === 'en' || saved === 'zh') {
    lang = saved;
    langFrom = 'manual';
  } else {
    lang = detect(nav);
    langFrom = 'auto';
  }
  return lang;
}

function getLang() { return lang; }
function langSource() { return langFrom; }

function setLang(next) {
  if (next !== 'en' && next !== 'zh') return lang;
  lang = next;
  langFrom = 'manual';
  storage()?.setItem(STORAGE_KEY, next);
  return lang;
}

// 动态词典编译：'已选 ◇ 项' → /^已选 (.+?) 项$/（◇ 贪婪度用懒惰组，全文锚定）。
// 键长降序编译：字面量更多的长模板优先，避免 '编辑 ◇' 抢先吞掉 '编辑 ◇ 标题与描述'。
const DYNAMIC_COMPILED = Object.entries(EN_DYNAMIC)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([key, tpl]) => {
    const source = '^' + key.split('◇').map(escapeRe).join('(.+?)') + '$';
    return { re: new RegExp(source), tpl };
  });

// 反向词典（en → zh）：切换回中文时把已渲染的英文译回中文，保证双语往返。
// 精确表 = EN 的逆映射；动态表 = 英文模板（$N 占位）→ 锚定正则，替换回中文键
//（◇ 依次替换为 $1、$2…；英文模板不重排捕获组次序，往返拼接结果一致）。
const ZH_EXACT = {};
for (const [k, v] of Object.entries(EN)) ZH_EXACT[v] = k;
const ZH_PATTERNS = Object.entries(EN_DYNAMIC)
  .sort((a, b) => b[1].length - a[1].length)
  .map(([zhKey, enTpl]) => {
  const parts = enTpl.split(/\$(\d+)/);
  let source = '^';
  for (let i = 0; i < parts.length; i += 2) {
    source += escapeRe(parts[i]);
    if (i + 1 < parts.length) source += '(.+?)';
  }
  source += '$';
  let n = 0;
  const back = zhKey.replace(/◇/g, () => '$' + ++n);
  return { re: new RegExp(source), tpl: back };
});

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function t(s) {
  if (typeof s !== 'string') return s;
  if (lang === 'en') {
    if (Object.prototype.hasOwnProperty.call(EN, s)) return EN[s];
    for (const { re, tpl } of DYNAMIC_COMPILED) {
      if (re.test(s)) return s.replace(re, tpl);
    }
    return s;
  }
  // zh：已是中文的文本不命中英文模式、原样返回；已译成英文的文本译回中文（往返）
  if (Object.prototype.hasOwnProperty.call(ZH_EXACT, s)) return ZH_EXACT[s];
  for (const { re, tpl } of ZH_PATTERNS) {
    if (re.test(s)) return s.replace(re, tpl);
  }
  return s;
}

// 翻译一棵子树：文本节点全文命中才替换（保留前后空白）；四个属性同口径；
// 跳过 SCRIPT/STYLE/CODE/PRE 与 data-i18n-skip 子树。只用 childNodes 递归，
// 便于测试以假 DOM 驱动。
function translateTree(root, skip) {
  if (!root) return;
  if (root.nodeType === 1) {
    const el = root;
    if (el.getAttribute && el.getAttribute('data-i18n-skip') != null) return;
    if (SKIP_TAGS.has(el.tagName)) return;
    if (!skip) {
      for (const attr of TRANSLATABLE_ATTRS) {
        const v = el.getAttribute && el.getAttribute(attr);
        if (typeof v === 'string' && v.trim()) {
          const out = t(v.trim());
          if (out !== v.trim()) el.setAttribute(attr, out);
        }
      }
    }
    for (const child of el.childNodes || []) translateTree(child, skip);
    return;
  }
  if (root.nodeType === 3) {
    const raw = root.nodeValue || '';
    if (!raw.trim()) return;
    const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m) return;
    let out = t(m[2]);
    if (out === m[2] && m[3]) {
      // BUG-20260912-001：词典值尾随空白（如 'Current branch: '）会被此处剥离的
      // 外侧空白吞掉，反向（en→zh）查不中；把空白贴回键里重试一次（往返不留英文残段）。
      const out2 = t(m[2] + m[3]);
      if (out2 !== m[2] + m[3]) { root.nodeValue = m[1] + out2; return; }
    }
    if (out !== m[2]) root.nodeValue = m[1] + out + m[3];
  }
}

// ---------- 浏览器侧接线（Node 测试环境自动跳过） ----------
// paintLang：只做界面应用（DOM/标题/lang 属性/按钮态），不写存储、不改来源标记；
// 初始自动检测（auto）与手动切换共用同一绘制路径
function paintLang() {
  if (typeof document === 'undefined' || !document.body) return;
  if (baseTitle == null) baseTitle = document.title;
  document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
  if (lang === 'en') {
    document.title = t(baseTitle) || baseTitle;
  } else {
    document.title = baseTitle;
  }
  const btn = document.getElementById('btnLang');
  if (btn) {
    btn.textContent = lang === 'zh' ? 'EN' : '中';
    btn.title = lang === 'zh'
      ? 'Switch to English · 当前：中文'
      : '切换到中文 · current: English';
  }
  translateTree(document.body);
}

// applyLang：手动切换（写存储、标记 manual）并应用
function applyLang(next) {
  setLang(next);
  paintLang();
}

let observer = null;
let scheduled = false;

function scheduleTranslate() {
  if (scheduled || !observer) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    if (!observer) return;
    observer.disconnect(); // 自身改写不产生新记录
    try { translateTree(document.body); } finally { observeBody(); }
  }, 0);
}

function observeBody() {
  if (!observer) return;
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: TRANSLATABLE_ATTRS,
  });
}

function init() {
  initLang();
  if (typeof document === 'undefined' || !document.body) return;
  paintLang(); // 按当前语言（auto 检测或手动记忆）绘制静态界面；不写存储
  const btn = document.getElementById('btnLang');
  if (btn) {
    btn.addEventListener('click', () => {
      applyLang(lang === 'zh' ? 'en' : 'zh');
      btn.focus();
    });
  }
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(scheduleTranslate);
    observeBody();
  }
}

const ATBI18N = {
  detect, initLang, getLang, langSource, setLang, t, translateTree, applyLang, init,
  _dict: { EN, EN_DYNAMIC, ALLOWLIST },
};

if (typeof window !== 'undefined') window.ATBI18N = ATBI18N;
globalThis.ATBI18N = ATBI18N;

// 浏览器：脚本位于 body 末尾，DOM 已就绪，立即初始化；Node（测试导入）：跳过 DOM 接线
if (typeof document !== 'undefined') init();
