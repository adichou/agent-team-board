// REQ-20260920-004 命令模块命令注册表 —— 看板「命令」页的唯一事实源。
// 设计（条目 design.md）：命令清单采用集中注册表而非 `atb help` 文本解析——help 面向人读
//（折行 / 散文说明），解析脆弱；注册表是结构化数据，服务端白名单校验与前端表单渲染直接消费，
// 与 CLI 的同步性由测试兜底（scripts/tests/req-20260920-004.test.mjs C1：注册表与 atb.mjs
// 实际命令面双向比对，无虚构无遗漏）。
// 范围恒定排除三组（README「已核实的现状与范围」）：Oncall 咨询（oncall）、讨论（disc）、
// 增长（growth）——由专用深链视图与专用回执流程承载，不经通用命令模块下发。
// 命令名与参数保持 CLI 原文不翻译；分组名 / 说明 / 参数标签为中文原文，前端经 i18n.js
// 词典翻译（BUG-20260912-001 口径，词条同步维护在 scripts/web/i18n.js）。
//
// REQ-20260922-001 AI Agent 工作流命令在看板隐藏：agentOnly 标记（组级或命令级）的命令
// 由 Agent 会话创建 / 领取 / 回执 / 调度（RUN-ID / 批次 ID / 会话标识等上下文只存在于
// Agent 会话），人工经界面执行无意义或无上下文。隐藏仅看板展示层：注册表仍包含全部命令
//（findCommand 白名单查找、CLI 同步测试口径不变，隐藏不得以「从注册表删除命令」实现）；
// 看板命令清单（visibleGroups → GET /api/cli/commands）与网页下发（validateRunRequest
// 拒绝 agentOnly）双过滤，Agent 在终端 / 各会话中以 CLI 照常使用。

// 排除组前缀：生成与校验恒定排除，任何命令 token 序列不得以此开头
const EXCLUDED_PREFIXES = ['oncall', 'disc', 'growth'];

// 参数形态：{ label, required, placeholder, flag }
// - 无 flag：位置参数（按声明顺序拼接，如 show 的 ID）；
// - 有 flag：带值旗标（表单值渲染并下发为 `--flag 值`，如 refine done 的 --summary），
//   CLI 语义上必填的旗标在此声明 required，前端必填校验与命令预览统一走同一份数据。
const CLI_GROUPS = [
  {
    id: 'data',
    label: '数据与分发',
    commands: [
      {
        name: 'init',
        desc: '初始化 agent-team-board/（data 用户数据 + runtime 应用数据）',
        needsBoard: false,
      },
      {
        name: 'migrate',
        desc: '旧布局（docs/agent-team-board/）一键迁移到新布局（幂等，不自动提交）',
        danger: true,
        needsBoard: false,
      },
      {
        name: 'rebuild',
        desc: '从 git 历史重建条目状态（clone 后恢复看板；仅 runtime 条目状态为空时允许，对 git 只读）',
        danger: true,
        long: true,
      },
      {
        name: 'pack',
        desc: '打包插件分发产物（排除看板数据 / AGENTS.md / 依赖 / 桌面链，skills 随包）',
        args: [{ label: '输出目录', required: true, placeholder: 'dist-plugin' }],
        options: '输出目录须为空',
        danger: true,
        long: true,
        needsBoard: false,
      },
    ],
  },
  {
    id: 'item',
    label: '条目生命周期',
    commands: [
      {
        name: 'new req',
        desc: '创建需求（缺省状态 submitted）',
        args: [{ label: '标题', required: true, placeholder: '一句话标题' }],
        options: '--desc 描述 · --accept 一步创建并接受',
      },
      {
        name: 'new bug',
        desc: '创建 Bug（一律独立 Bug，引入来源写 design.md）',
        args: [{ label: '标题', required: true, placeholder: '一句话标题' }],
        options: '--desc 描述 · --accept 一步创建并接受',
      },
      {
        name: 'claim',
        desc: '认领条目（accepted/planned → in-progress，原子锁）',
        args: [{ label: 'ID', required: true, placeholder: 'REQ-20260920-004' }],
        options: '--by 会话标识',
        agentOnly: true, // REQ-20260922-001：Agent 常规状态操作（根 AGENTS.md），与人工命令同组，看板隐藏
      },
      {
        name: 'rename',
        desc: '更改待接受条目标题与描述（仅待接受；--desc - 从 stdin 读多行）',
        args: [
          { label: 'ID', required: true, placeholder: 'REQ-20260920-004' },
          { label: '新标题', required: true, placeholder: '新标题（可省略仅改描述）' },
        ],
        options: '--desc 描述',
      },
      {
        name: 'delete',
        desc: '删除待接受条目（目录整体移除，不可恢复）',
        args: [{ label: 'ID', required: true, placeholder: 'REQ-20260920-004' }],
        danger: true,
      },
      {
        name: 'status',
        desc: '变更状态；accepted/planned/done 仅限人工在终端（或本界面）执行',
        args: [
          { label: 'ID', required: true, placeholder: 'REQ-20260920-004' },
          { label: '状态', required: true, placeholder: 'submitted|accepted|planned|in-progress|done' },
        ],
        options: '--force 越过未答项的确认完成拦截',
        danger: true,
      },
      {
        name: 'report',
        desc: '写 test-report.md 并标记待人工确认完成（开发收口，提交由系统自动完成）',
        args: [{ label: 'ID', required: true, placeholder: 'REQ-20260920-004' }],
        options: '--coverage N · --framework 名称 · --summary 摘要 · --by 会话 · --run RUN-ID',
        agentOnly: true, // REQ-20260922-001：Agent 常规状态操作（根 AGENTS.md），看板隐藏
      },
      {
        name: 'move',
        desc: '移动 Bug 归属（改挂需求或改独立）',
        args: [{ label: 'BUG-ID', required: true, placeholder: 'BUG-20260920-001' }],
        options: '--req REQ-ID | --standalone',
      },
      {
        name: 'prune-locks',
        desc: '清理失效认领锁（条目不在办 / 不存在 / 已过期）',
        options: '--dry-run 预览不删除',
        danger: true,
      },
    ],
  },
  {
    id: 'batch',
    label: 'AI 开发',
    agentOnly: true, // REQ-20260922-001：主调度建批 / worker 领取回执，整组看板隐藏
    commands: [
      { name: 'batch create', desc: '创建 AI 开发批次（有未结束批次时排队接续）' },
      { name: 'batch next', desc: 'worker 领取本批一项（原子预留 + 项目实施互斥）', options: '--batch ID · --by 会话' },
      { name: 'batch check', desc: '主调度最小核对（当前项 / 计数 / nextAction）', options: '--batch ID' },
      { name: 'batch summary', desc: '批次摘要（续接 / 看板用：当前执行、计数、提示词）', options: '--batch ID' },
      { name: 'batch pause', desc: '暂停 / 恢复后续领取（不停止在途执行）', options: '--off 恢复 · --batch ID' },
      { name: 'batch records', desc: '执行记录分页', options: '--offset N --limit N' },
      {
        name: 'batch delete',
        desc: '删除未在执行的批次（在途 / 待核对会被拒绝）',
        args: [{ label: 'BATCH-ID', required: true, placeholder: 'BAT-20260920-001' }],
        danger: true,
      },
    ],
  },
  {
    id: 'run',
    label: '执行回执',
    agentOnly: true, // REQ-20260922-001：worker 上报回执（RUN-ID 只存在于 Agent 会话），整组看板隐藏
    commands: [
      {
        name: 'run receipt',
        desc: '上报回执（reported 必带 --report-ref；阻塞 / 失败必带 --reason）',
        args: [
          { label: 'RUN-ID', required: true, placeholder: 'run-20260921-001' },
          { label: '结果', required: true, flag: '--result', placeholder: 'reported|blocked|failed' },
        ],
        options: '--report-ref 文件（reported 必带） · --reason 短句',
      },
      {
        name: 'run release',
        desc: '释放未认领的预留（认领冲突换单等）',
        args: [{ label: 'RUN-ID', required: true, placeholder: 'run-20260921-001' }],
        options: '--reason 短句',
      },
      {
        name: 'run autocommit',
        desc: '重试到待测试自动提交（幂等；仅 reported 运行可重试）',
        args: [{ label: 'RUN-ID', required: true, placeholder: 'run-20260921-001' }],
        long: true,
      },
    ],
  },
  {
    id: 'hold',
    label: '人工决策',
    commands: [
      {
        name: 'hold declare',
        desc: 'worker 声明条目待人工决策（附问题清单，随后仍交 blocked 回执）',
        args: [{ label: 'ID', required: true, placeholder: 'REQ-20260920-004' }],
        options: '--question 问题（可多次） · --reason 短句 · --run RUN-ID · --by 会话',
        agentOnly: true, // REQ-20260922-001：worker 声明动作（人工入口是 hold answer/resume/cancel），看板隐藏
      },
      { name: 'hold list', desc: '待人工确认清单（等待时长 / 未答计数 / 原因）', options: '--all 全部' },
      { name: 'hold show', desc: '单条详情（问题清单 / 作答进度 / 事件留痕）', args: [{ label: 'ID', required: true, placeholder: 'REQ-20260920-004' }] },
      {
        name: 'hold answer',
        desc: '人工补决策（仅人工；支持草稿，缺项时复工禁用）',
        args: [
          { label: 'ID', required: true, placeholder: 'REQ-20260920-004' },
          { label: '问题号', required: true, placeholder: '1' },
          { label: '答复', required: true, placeholder: '答复文本' },
        ],
        options: '--note 补充 · --by 人工',
      },
      { name: 'hold resume', desc: '人工复工（决策齐备 → 条目回已计划队列重新取单）', args: [{ label: 'ID', required: true, placeholder: 'REQ-20260920-004' }], options: '--by 人工' },
      { name: 'hold cancel', desc: '人工作废声明（条目状态不变）', args: [{ label: 'ID', required: true, placeholder: 'REQ-20260920-004' }], options: '--note 说明' },
    ],
  },
  {
    id: 'confirm',
    label: '挂起确认',
    commands: [
      { name: 'confirm list', desc: '挂起确认清单（自动提交不完整 / AI 分析问题）', options: '--all 全部' },
      { name: 'confirm show', desc: '单条详情（文件状态 / 问题与作答 / 核验结果 / 事件留痕）', args: [{ label: 'ID', required: true, placeholder: 'REQ-20260920-004' }] },
    ],
  },
  {
    id: 'refine',
    label: 'AI 分析',
    agentOnly: true, // REQ-20260922-001：主调度建任务 / 子 Agent 领取回执，整组看板隐藏
    commands: [
      { name: 'refine create', desc: '创建完善任务（候选 = 已接受未完善；冻结候选与文档基线）', options: '--ids ID1,ID2' },
      { name: 'refine next', desc: '子 Agent 领取一项（refine 互斥；实时吸收新接受的单）', options: '--batch ID · --by 会话' },
      {
        name: 'refine done',
        desc: '完成回执（须真实改过条目文档）',
        args: [
          { label: 'RUN-ID', required: true, placeholder: 'run-20260921-001' },
          { label: '要点', required: true, flag: '--summary', placeholder: '补全要点' },
        ],
      },
      {
        name: 'refine fail',
        desc: '失败回执',
        args: [
          { label: 'RUN-ID', required: true, placeholder: 'run-20260921-001' },
          { label: '短句', required: true, flag: '--reason', placeholder: '失败原因短句' },
        ],
      },
      { name: 'refine release', desc: '释放未回执的预留', args: [{ label: 'RUN-ID', required: true, placeholder: 'run-20260921-001' }] },
      { name: 'refine check', desc: '主调度最小核对（≤2KiB）', options: '--batch ID' },
      { name: 'refine summary', desc: '批次摘要（当前 / 计数 / 最近记录 / 提示词）', options: '--batch ID' },
      { name: 'refine pause', desc: '暂停 / 恢复后续领取', options: '--off 恢复 · --batch ID' },
      { name: 'refine abort', desc: '终止任务（剩余项出局；在途需人工停止子代理会话）', danger: true, options: '--batch ID' },
      { name: 'refine records', desc: '执行记录分页', options: '--offset N --limit N' },
    ],
  },
  {
    id: 'summary',
    label: '发布文档 AI 总结',
    agentOnly: true, // REQ-20260922-001：发布文档 AI 总结轮次回执，整组看板隐藏
    commands: [
      {
        name: 'summary start',
        desc: '启动一轮 AI 总结（返回 runId + 提示词；独立锁 summary，与实施 / 完善互不占用）',
        args: [{ label: 'BLD-ID', required: true, flag: '--id', placeholder: 'BLD-20260921-001' }],
        options: '--by 会话',
      },
      {
        name: 'summary file',
        desc: '逐文件进度回执（正在总结 / 已总结待审核）',
        args: [
          { label: 'RUN-ID', required: true, placeholder: 'run-20260921-001' },
          { label: '文件名', required: true, flag: '--file', placeholder: 'README.md' },
          { label: '状态', required: true, flag: '--state', placeholder: 'summarizing|summarized' },
        ],
      },
      {
        name: 'summary done',
        desc: '完成回执',
        args: [
          { label: 'RUN-ID', required: true, placeholder: 'run-20260921-001' },
          { label: '要点', required: true, flag: '--summary', placeholder: '总结要点' },
        ],
      },
      {
        name: 'summary fail',
        desc: '中断回执（不悬挂「正在总结」，可重启续跑）',
        args: [
          { label: 'RUN-ID', required: true, placeholder: 'run-20260921-001' },
          { label: '短句', required: true, flag: '--reason', placeholder: '中断原因短句' },
        ],
      },
      { name: 'summary show', desc: '进度视图（x/4、当前文件、锁占用）' },
    ],
  },
  {
    id: 'translate',
    label: '发布文档 AI 翻译',
    agentOnly: true, // REQ-20260922-001：发布文档 AI 翻译轮次回执，整组看板隐藏
    commands: [
      {
        name: 'translate start',
        desc: '启动一轮 AI 翻译（默认语言 4/4 已审核才可启动；独立锁 translate，与总结 / 分析 / 开发互不占用）',
        args: [{ label: 'BLD-ID', required: true, flag: '--id', placeholder: 'BLD-20260921-001' }],
        options: '--by 会话',
      },
      {
        name: 'translate file',
        desc: '逐文件进度回执（正在翻译 / 已翻译待审核）',
        args: [
          { label: 'RUN-ID', required: true, placeholder: 'tr-20260921-001' },
          { label: '文件名', required: true, flag: '--file', placeholder: 'README_en.md' },
          { label: '状态', required: true, flag: '--state', placeholder: 'translating|translated' },
        ],
      },
      {
        name: 'translate done',
        desc: '完成回执',
        args: [
          { label: 'RUN-ID', required: true, placeholder: 'tr-20260921-001' },
          { label: '要点', required: true, flag: '--summary', placeholder: '翻译要点' },
        ],
      },
      {
        name: 'translate fail',
        desc: '中断回执（不悬挂「正在翻译」，可重启续跑）',
        args: [
          { label: 'RUN-ID', required: true, placeholder: 'tr-20260921-001' },
          { label: '短句', required: true, flag: '--reason', placeholder: '中断原因短句' },
        ],
      },
      { name: 'translate show', desc: '进度视图（x/N、当前文件、锁占用）' },
    ],
  },
  {
    id: 'query',
    label: '查询',
    commands: [
      { name: 'list', desc: '列出条目（含各状态计数）', options: '--type req|bug · --status 状态 · --json' },
      { name: 'show', desc: '查看条目详情（文档清单 / 历史 / 最近报告）', args: [{ label: 'ID', required: true, placeholder: 'REQ-20260920-004' }], options: '--json' },
      { name: 'commit log', desc: '查该单全部提交（账本与 git 历史合并，只读）', args: [{ label: 'ITEM-ID', required: true, placeholder: 'REQ-20260920-004' }] },
      { name: 'commit which', desc: '从提交反查条目（消息含单号 REQ-/BUG-）', args: [{ label: 'HASH 或消息', required: true, placeholder: 'abc1234' }] },
    ],
  },
  {
    id: 'serve',
    label: '服务',
    commands: [
      {
        name: 'serve',
        desc: '后台启动看板服务（已运行且版本一致时复用现有实例；磁盘代码较新时自动重启）',
        options: '--port N --open --log FILE',
        serve: true,
        needsBoard: false,
      },
    ],
  },
  {
    id: 'cli',
    label: '终端命令',
    commands: [
      { name: 'cli install', desc: '安装终端命令（在目标目录创建指向 bin/atb 的符号链接）', options: '--to 目录', disabled: true, needsBoard: false },
      { name: 'cli uninstall', desc: '卸载终端命令（仅删除指向本插件 bin/atb 的链接）', options: '--to 目录', disabled: true, needsBoard: false },
      { name: 'cli status', desc: '查看安装状态（包装器位置、候选目录、PATH 提示）', disabled: true, needsBoard: false },
    ],
  },
];

// 扁平命令清单（生成 / 测试 / 白名单查找共用）。
// agentOnly 归一化：组级或命令级任一标记即视为 AI Agent 工作流命令（REQ-20260922-001），
// findCommand / validateRunRequest / 前端表单消费同一口径。
function allCommands() {
  return CLI_GROUPS.flatMap((g) => g.commands.map((c) => ({ ...c, agentOnly: !!(c.agentOnly || g.agentOnly), group: g.id, groupLabel: g.label })));
}

// 按完整命令名精确查找（'batch delete'；白名单不接受前缀或别名）
function findCommand(name) {
  const n = String(name || '').trim();
  return allCommands().find((c) => c.name === n) || null;
}

// 看板可见清单（REQ-20260922-001）：过滤 agentOnly 分组 / 命令，返回副本（不改注册表本体）。
// 服务端 GET /api/cli/commands 的唯一分组来源——整组隐藏的分组不出现（无空分组标题残留），
// 组内隐藏的命令从所属分组消失、分组标题与其余命令保留。
function visibleGroups() {
  return CLI_GROUPS
    .filter((g) => !g.agentOnly)
    .map((g) => ({ ...g, commands: g.commands.filter((c) => !c.agentOnly) }));
}

// 白名单校验（服务端 /api/cli/run 的唯一放行口径）：
// - 命令必须精确命中注册表（未注册一律拒绝——本模块不得成为任意命令执行通道）；
// - agentOnly 命令（REQ-20260922-001）白名单内也拒绝网页下发：RUN-ID / 批次 ID / 会话标识
//   等上下文只存在于 Agent 会话，网页（人工入口）执行无意义，防绕过界面直接调接口；
// - disabled 命令（cli 组等）白名单内也拒绝执行；
// - args 必须是字符串数组（逐个传递给子进程，不经 shell 拼接）；
// - args 携带 --dir 拒绝：项目根由服务端统一注入，不允许篡改下发目标。
function validateRunRequest(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: '请求体必须是 JSON 对象' };
  const { command, args } = body;
  if (typeof command !== 'string' || !command.trim()) {
    return { ok: false, error: 'command 必须是非空命令名字符串' };
  }
  const spec = findCommand(command);
  if (!spec) {
    return { ok: false, error: `未注册命令：${command.trim()}（白名单仅接受命令清单内命令）` };
  }
  if (spec.agentOnly) {
    return { ok: false, error: `命令 ${spec.name} 属 AI Agent 会话工作流命令（RUN-ID / 批次 ID / 会话标识只存在于 Agent 会话），不提供网页下发` };
  }
  if (spec.disabled) {
    return { ok: false, error: `命令 ${spec.name} 不提供界面下发（本机终端操作），请在终端执行` };
  }
  if (!Array.isArray(args)) {
    return { ok: false, error: 'args 必须是字符串数组（参数逐个传递给子进程，不经 shell 拼接）' };
  }
  for (const a of args) {
    if (typeof a !== 'string') {
      return { ok: false, error: 'args 中每一项都必须是字符串' };
    }
    if (a === '--dir' || a.startsWith('--dir=')) {
      return { ok: false, error: '不允许在参数中携带 --dir：项目根由服务端统一注入' };
    }
  }
  // 必填参数校验（前端表单就近提示为主，服务端再拦一层，防绕过表单直接调接口）：
  // 位置参数按声明顺序计数；带值旗标要求 args 中出现该旗标且带值（--flag 值 或 --flag=值）。
  const requiredPos = (spec.args || []).filter((a) => !a.flag && a.required);
  if (args.length < requiredPos.length) {
    return { ok: false, error: `缺少必填位置参数：${requiredPos.map((a) => a.label).join('、')}` };
  }
  for (const a of (spec.args || [])) {
    if (!a.flag || !a.required) continue;
    const i = args.indexOf(a.flag);
    const eqForm = args.some((x) => x.startsWith(`${a.flag}=`));
    if ((i === -1 && !eqForm) || (i !== -1 && !eqForm && i === args.length - 1)) {
      return { ok: false, error: `缺少必填选项 ${a.flag}（${a.label}）` };
    }
  }
  return { ok: true, spec, tokens: spec.name.split(' '), args };
}

export { CLI_GROUPS, EXCLUDED_PREFIXES, allCommands, findCommand, visibleGroups, validateRunRequest };
