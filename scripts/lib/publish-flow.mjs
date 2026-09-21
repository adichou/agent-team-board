// REQ-20260920-003 构建和发布流程整改 —— 发布流程纯逻辑层（publish-flow）。
// 只做无副作用计算与可注入读取的求值（fs 读取经注入函数传入），供 server.mjs / build-store /
// 前端提示词装配复用；不直写任何 git / 状态文件。
// 覆盖口径（README 落定）：
//   - 版本号：从计划编号后两段提取（BLD-20260920-001 → 20260920-001），保留前导零，
//     界面各处复用同一提取，不另让用户重复输入；
//   - 发布文档：README / CHANGELOG / FEATURES / AGENTS 四类 × 中英共八个文件；README 按
//     语言链接 CHANGELOG 与 FEATURES（双语互链）；
//   - AI 写作提示词：技术写作人员角色 + 子代理流程 + 项目路径 / 计划号 / 版本号 / 关联范围 /
//     文档清单 / 写作约束（简练通俗、不罗列原文、不编造）；
//   - 官网提示词：在官网仓库执行、读已发布版本 CHANGELOG / FEATURES 双语材料、提交消息带
//     完整计划号，不强制官网技术栈；
//   - 计划号匹配：完整计划号 + 标识边界（BLD-20260920-0010 不冒充 BLD-20260920-001）；
//   - 官网检测：仅提交者时间不早于推送成功时间（含等于边界）的提交参与匹配；起点缺失 →
//     waiting（缺少推送完成时间，待核对），不做全历史扫描；预算未读完窗口 → scanning
//     （本轮检测未完成，不当未命中）；窗口读完无命中 → missed；命中 → hit 带证据；
//   - 文档状态机 / 五步门禁：见 evaluateDocsState / publishStepsState 注释。

import crypto from 'node:crypto';

// ---------- 版本号提取 ----------

// 计划编号 → 版本号：取后两段（YYYYMMDD-NNN），前导零保留；非法（长度 / 前缀）返回 null。
export function versionNumberOf(planId) {
  const m = /^BLD-(\d{8})-(\d{3})$/.exec(String(planId || ''));
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

// ---------- 发布文档清单 ----------

export const PUBLISH_DOC_KEYS = ['README', 'CHANGELOG', 'FEATURES', 'AGENTS'];
export const PUBLISH_DOC_LANGS = ['zh', 'en'];

// 八个已确认文件（人工确认：中文 <KEY>.md、英文 <KEY>.en.md；CHANGEME.log /「三个文档」为笔误）。
export function publishDocFiles() {
  const out = [];
  for (const key of PUBLISH_DOC_KEYS) {
    for (const lang of PUBLISH_DOC_LANGS) {
      out.push({ key, lang, file: `${key}${lang === 'en' ? '.en' : ''}.md` });
    }
  }
  return out;
}

export function docFileOf(key, lang) {
  const k = String(key || '').trim().toUpperCase();
  const l = String(lang || '').trim().toLowerCase();
  if (!PUBLISH_DOC_KEYS.includes(k) || !PUBLISH_DOC_LANGS.includes(l)) return null;
  return `${k}${l === 'en' ? '.en' : ''}.md`;
}

export function isPublishDocFile(file) {
  const name = String(file || '').trim();
  return publishDocFiles().some((f) => f.file === name);
}

// README 按语言链接 CHANGELOG 与 FEATURES（同语言互链）；其余文档无链接要求。
export function readmeDocLinks(file) {
  const name = String(file || '').trim();
  if (name === 'README.md') return ['CHANGELOG.md', 'FEATURES.md'];
  if (name === 'README.en.md') return ['CHANGELOG.en.md', 'FEATURES.en.md'];
  return [];
}

// ---------- 提示词装配 ----------

const shortHash = (h) => String(h || '').slice(0, 12);

// AI 总结提示词（REQ-20260921-008，原 buildDocWritingPrompt 更名并按新工作流调整）：
// 主会话派发给「技术写作人员」角色的子代理，逐文件总结当前版本八个发布文档；子代理经
// atb summary CLI 逐文件回执进度（正在总结 → 已总结待审核），完成后交短回执。
// 必带：项目路径、计划号、版本号、关联范围（条目 + 实际提交）、文档清单、进度回执指令、写作约束。
export function buildDocSummaryPrompt({ projectRoot, planId, items = [], runId = null, atbPath = 'node scripts/atb.mjs' } = {}) {
  const version = versionNumberOf(planId) || planId;
  const lines = [];
  lines.push(`你是技术写作人员，以子代理身份完成「${planId}」（版本号 ${version}）的发布文档 AI 总结任务；主会话只派发本提示词并接收短回执，不在此展开代码修改。`);
  lines.push('');
  lines.push(`项目路径：${projectRoot || '（未提供）'}`);
  lines.push(`发布计划号：${planId}（版本号 ${version}）`);
  if (runId) lines.push(`执行编号：${runId}`);
  lines.push('关联范围（按实际代码与提交核实变化，不简单罗列需求 / Bug 原文）：');
  for (const it of items) lines.push(`- ${it.itemId}（commit ${shortHash(it.commit)}）${it.title || ''}`);
  lines.push('');
  lines.push('请逐个总结以下八个文档（中文 / 英文各四类），每个文件总结完成后其状态变为「已总结待审核」，等待人工审查：');
  for (const f of publishDocFiles()) lines.push(`- ${f.file}（${f.lang === 'zh' ? '中' : '英'}文 / ${f.key}）`);
  lines.push('');
  if (runId) {
    lines.push('逐文件进度回执（在项目根执行；atb 指 ' + atbPath + '，下同）：');
    lines.push(`1. 开始总结某文件：atb summary file ${runId} --file <文件名> --state summarizing`);
    lines.push(`2. 该文件总结完成：atb summary file ${runId} --file <文件名> --state summarized`);
    lines.push(`3. 全部完成：atb summary done ${runId} --summary "<一两句要点>"`);
    lines.push(`4. 中断 / 无法完成：atb summary fail ${runId} --reason "<短句原因>"`);
    lines.push('已审核（reviewed）的文件跳过不再总结；不修改八个文档以外的任何文件。');
    lines.push('');
  }
  lines.push('写作约束：');
  lines.push('- 文字简练、通俗易懂：说明用户能做什么、使用方式与本次变化；不得编造已实现能力。');
  lines.push('- README 按语言链接同语言 CHANGELOG 与 FEATURES（README.md → CHANGELOG.md / FEATURES.md；README.en.md → CHANGELOG.en.md / FEATURES.en.md），链接必须真实可达。');
  lines.push('- AGENTS 只描述适用协作规则，不把营销说明写成执行规则。');
  lines.push('- 文档与当前版本范围一致：未纳入本版发布的功能不得写成已发布。');
  lines.push('- 完成后以短回执汇报（哪些文件已总结 / 关键结论），不粘贴全文。');
  return lines.join('\n');
}

// 官网 AI 写作提示词：在官网仓库执行；读取本项目已发布版本的 CHANGELOG / FEATURES 中英文
// 材料，按官网自身架构更新内容；完成提交消息带完整计划号。不强制官网技术栈 / 目录 / 构建。
export function buildSiteWritingPrompt({ projectRoot, siteRoot, planId, baseline = null } = {}) {
  const version = versionNumberOf(planId) || planId;
  const lines = [];
  lines.push(`你是技术写作人员，在官网仓库（${siteRoot || '（未提供）'}）内完成「${planId}」（版本号 ${version}）的官网同步。`);
  lines.push('');
  lines.push(`项目仓库（已发布基准${baseline ? ` ${shortHash(baseline)}` : ''}）：${projectRoot || '（未提供）'}`);
  lines.push(`发布计划号：${planId}（版本号 ${version}）`);
  lines.push('');
  lines.push('要求：');
  lines.push('- 只读取项目仓库已发布版本（上述基准）中的 CHANGELOG 与 FEATURES 中英文材料，不要读取 dev 分支尚未发布的内容。');
  lines.push('- 按官网仓库自身架构与目录组织更新相应内容；本提示词不假定官网技术栈、目录或构建命令。');
  lines.push('- 完成后请在官网仓库提交，提交消息必须包含完整计划号「' + planId + '」。');
  lines.push('- 以短回执汇报（改动位置与提交号），不粘贴全文。');
  return lines.join('\n');
}

// ---------- 计划号精确匹配 ----------

// 完整计划号 + 标识边界：命中位置左右不得紧邻 [A-Za-z0-9_-]（防 BLD-…-0010 / XBLD-… 冒充）。
export function planIdTokenMatches(text, planId) {
  const s = String(text || '');
  const id = String(planId || '');
  if (!s || !/^BLD-\d{8}-\d{3,}$/.test(id)) return false;
  const word = (ch) => /[A-Za-z0-9_-]/.test(ch);
  let i = s.indexOf(id);
  while (i !== -1) {
    const before = i > 0 ? s[i - 1] : '';
    const after = s[i + id.length] || '';
    if (!word(before) && !word(after)) return true;
    i = s.indexOf(id, i + 1);
  }
  return false;
}

// ---------- 官网时间窗扫描（纯函数） ----------

// commits：官网本地主分支提交（新→旧）[{ hash, subject, committerDate }]（读取方负责
// 按 limit+1 预算取数）；sinceIso：推送成功时间（null → waiting，不猜测起点）。
// 口径：仅提交者时间不早于起点（含等于边界）的提交参与匹配；budget 为本轮读取预算，
// 给入提交数超预算且未在预算内读完窗口 / 命中 → scanning（本轮检测未完成，可继续检测，
// 不当作未命中）；窗口读完无命中 → missed；命中 → hit（证据含 hash / subject / 匹配时间）。
export function scanSiteCommitsForPlan(commits, { planId, sinceIso, budget = 200 } = {}) {
  const list = Array.isArray(commits) ? commits : [];
  if (!sinceIso) return { status: 'waiting', scanned: 0, windowCount: 0, reason: '缺少推送完成时间，待核对（不使用猜测值，不做全历史扫描）' };
  const sinceMs = Date.parse(sinceIso);
  if (!Number.isFinite(sinceMs)) return { status: 'waiting', scanned: 0, windowCount: 0, reason: '推送完成时间无效，待核对' };
  const n = Math.max(1, Math.floor(Number(budget) || 200));
  let windowCount = 0;
  let scanned = 0;
  for (const c of list) {
    if (scanned >= n) break; // 预算用尽：后续未读
    scanned++;
    const t = Date.parse(c.committerDate || '');
    if (!Number.isFinite(t)) continue; // 时间不可解析：不参与匹配，也不终止窗口
    if (t < sinceMs) continue; // 早于起点：不参与（非单调历史继续向后读，防漏检）
    windowCount++;
    if (planIdTokenMatches(c.subject, planId)) {
      return {
        status: 'hit',
        scanned,
        windowCount,
        evidence: { hash: c.hash, subject: String(c.subject || ''), matchedAt: new Date().toISOString() },
      };
    }
  }
  if (list.length > n) {
    return { status: 'scanning', scanned, windowCount, reason: '本轮检测未完成，可继续检测（未读完时间窗口，不当未命中）' };
  }
  return { status: 'missed', scanned, windowCount };
}

// ---------- REQ-20260921-008 文档流水线四态（总结 → 审查 → 提交） ----------

// 四态（本页签展示口径，替代旧的 未编写/未提交/已提交/需重新编写）：
//   未总结 ──(AI 总结执行中)──▶ 正在总结 ──(该文件总结完成)──▶ 已总结待审核
//      │                                                        │
//      └──────(不经 AI 总结，直接审查修改后人工通过)────────────┤
//                                                               ▼
//      已总结待审核 ──(人工通过审核)──▶ 已审核 ──(再次编辑修改)──▶ 回到已总结待审核
export const DOCS_FLOW_STATES = ['unsummarized', 'summarizing', 'summarized', 'reviewed'];
export const DOCS_FLOW_LABEL = {
  unsummarized: '未总结', summarizing: '正在总结', summarized: '已总结待审核', reviewed: '已审核',
};

// 四态求值（纯函数；发布文档流水线的唯一状态事实源，前端复用同口径渲染）：
//   - v.review.files[file].hash：人工「通过审核」时点的磁盘内容 sha256（build-store.recordDocsReview）；
//   - readFile(file)：当前磁盘内容（注入解耦 fs）；
//   - marks = { summarizing: [...], summarized: [...] }：AI 总结账本聚合标记
//     （docs-summary-store.summaryMarksForVer：活动 run 的正在总结 + 任一 run 曾完成的已总结）。
// 判定优先级：正在总结 > 已审核（hash 一致且未 scopeStale）> 已总结待审核（任一 run 曾标记完成，
// 或审核记录存在但内容已变——再次编辑 / 外部 IDE 修改自动回退）> 未总结。
// scopeStale 口径（design.md 落定）：发布范围变化时审核整体失效（回退待审核），不弱化提交门禁。
// 输出：files（八行恒定）、reviewedCount、canCommit（8/8 已审核）、missing（未审核文件 + 状态）。
export function evaluateDocsFlow(v, readFile, marks = {}) {
  const read = typeof readFile === 'function' ? readFile : () => null;
  const scopeStale = !!(v?.docs && v.docs.scopeStale);
  const reviewFiles = (v?.review && v.review.files) || {};
  const summarizing = new Set(marks.summarizing || []);
  const summarizedMarks = new Set(marks.summarized || []);
  const files = publishDocFiles().map((f) => {
    let text = null;
    try { text = read(f.file); } catch { text = null; }
    const diskHash = text == null ? null : hashOf(text);
    const rec = reviewFiles[f.file] || null;
    const approved = !scopeStale && !!rec && diskHash != null && rec.hash === diskHash;
    let state;
    if (summarizing.has(f.file)) state = 'summarizing';
    else if (approved) state = 'reviewed';
    else if (summarizedMarks.has(f.file) || rec) state = 'summarized';
    else state = 'unsummarized';
    return { ...f, state };
  });
  const reviewed = files.filter((f) => f.state === 'reviewed');
  const missing = files
    .filter((f) => f.state !== 'reviewed')
    .map((f) => ({ file: f.file, state: f.state }));
  return {
    files,
    reviewedCount: reviewed.length,
    canCommit: files.length > 0 && reviewed.length === files.length,
    missing,
    scopeStale,
  };
}

// ---------- 文档状态机（提交口径：evaluateDocsState，合并门禁沿用） ----------

const hashOf = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest('hex');

// 评估发布文档状态（readFile(file) → 文本 | null，注入以便测试与真实 fs 解耦）：
//   - 无提交记录（v.docs 缺失）：已有编写内容 → overall 'uncommitted'（已写未提交），
//     完全没有 → 'none'（尚未编写）；
//   - 有记录：逐文件 state：磁盘缺失 / 内容 hash 与提交记录不一致 → 'uncommitted'（外部 IDE
//     修改或再次编辑后未提交）；范围过期（v.docs.scopeStale）→ 'needs-rewrite'；否则 'committed'；
//   - overall：uncommitted > needs-rewrite > committed（最差者胜），reasons 逐条说明。
export function evaluateDocsState(v, readFile) {
  const read = typeof readFile === 'function' ? readFile : () => null;
  const record = v?.docs || null;
  const files = publishDocFiles().map((f) => {
    const text = (() => { try { return read(f.file); } catch { return null; } })();
    const exists = text != null;
    const diskHash = exists ? hashOf(text) : null;
    const committedHash = record?.files?.[f.file] || null;
    let state;
    if (!record) state = 'unwritten';
    else if (!exists) state = 'uncommitted';
    else if (committedHash && diskHash === committedHash) state = 'committed';
    else state = 'uncommitted';
    if (record && record.scopeStale && state === 'committed') state = 'needs-rewrite';
    return { ...f, exists, diskHash, committedHash, state };
  });
  const reasons = [];
  if (!record) {
    const written = files.filter((f) => f.exists).length;
    reasons.push(written
      ? `已编写 ${written}/8 个文档，尚未提交到 Git（提交后才能合并）`
      : '尚未编写发布文档（README / CHANGELOG / FEATURES / AGENTS 中英共八个文件）');
  } else {
    if (record.scopeStale) reasons.push(`发布范围已变化（${record.staleReason || '条目或提交变化'}），文档需重新核对 / 编写后重新提交`);
    for (const f of files) {
      if (f.state === 'uncommitted') {
        reasons.push(f.exists ? `${f.file} 有未提交修改（内部编辑或外部 IDE 修改后未提交）` : `${f.file} 缺失（提交后被删除，需重新编写）`);
      }
    }
  }
  const overall = files.some((f) => f.state === 'uncommitted')
    ? 'uncommitted'
    : record?.scopeStale || files.some((f) => f.state === 'needs-rewrite')
      ? 'needs-rewrite'
      : record
        ? 'committed'
        : files.some((f) => f.exists) ? 'uncommitted' : 'none';
  return {
    files,
    overall,
    reasons,
    commitHash: record?.commitHash || null,
    committedScopeFp: record?.scopeFp || null,
    scopeStale: !!record?.scopeStale,
  };
}

// 范围指纹：所选条目 + 每条提交 hash + 文档基准（当前八文件内容 hash）共同构成发布范围。
// 任一变化（增删条目 / 换 commit / 修改文档）→ 指纹变化 → 旧提交标识不放行。
export function publishScopeFingerprint(items, readFile) {
  const read = typeof readFile === 'function' ? readFile : () => null;
  const part = (Array.isArray(items) ? items : [])
    .map((it) => `${it.itemId}:${String(it.commit || '').toLowerCase()}`)
    .sort();
  const docs = publishDocFiles().map((f) => {
    let h = null;
    try { const t = read(f.file); h = t == null ? null : hashOf(t); } catch { h = null; }
    return `${f.file}:${h}`;
  });
  return hashOf(JSON.stringify({ items: part, docs }));
}

// ---------- 五步门禁 ----------

export const PUBLISH_STEPS = [
  { key: 'plan', label: '版本计划' },
  { key: 'link', label: '关联条目与提交' },
  { key: 'docs', label: '文档编写' },
  { key: 'merge', label: '合并入 main' },
  { key: 'release', label: '正式发布' },
];

const DOCS_GATE_TEXT = {
  none: '文档尚未编写提交（合并前置：所需文档已完成且最新变化已提交）',
  uncommitted: '文档有未提交修改，不得合并（请先提交文档）',
  'needs-rewrite': '发布范围已变化，文档需重新核对 / 编写并重新提交',
};

// 五步导航门禁（只读求值）：plan 恒可用；link / docs 在 merging / 推送完成（正式发布，
// BUG-20260920-005 基准后移：merged 未推送放开，供补关联后重新提交文档、重开合并）锁定；
// merge 需「有条目 + 文档 overall=committed + 状态可合并（draft/failed/merged 未推送）」；
// release 需 merged。locked 附 reason。
export function publishStepsState(v, docsEval) {
  const items = Array.isArray(v?.items) ? v.items : [];
  const status = v?.status || 'draft';
  const pushed = !!(v?.release && v?.release.pushedAt);
  const lockedScope = status === 'merging' || pushed;
  const canMerge = ['draft', 'failed', 'merged'].includes(status) && !pushed;
  const mergeReason = () => {
    if (status === 'merging') return '合并执行中';
    if (pushed) return '已正式发布，不可再合并（如需调整请新建版本）';
    if (!items.length) return '暂无关联条目：请先在「关联条目与提交」步骤关联';
    if (docsEval && docsEval.overall !== 'committed') return DOCS_GATE_TEXT[docsEval.overall] || '文档未就绪';
    return '';
  };
  const releaseReason = () => {
    if (status !== 'merged') return '合并入 main 完成后才能正式发布';
    return '';
  };
  return PUBLISH_STEPS.map((s) => {
    let locked = false;
    let reason = '';
    if (s.key === 'link' || s.key === 'docs') {
      locked = lockedScope;
      reason = locked ? (status === 'merging' ? '合并执行中' : '已正式发布，范围锁定（如需调整请新建版本）') : '';
    } else if (s.key === 'merge') {
      locked = !canMerge || !items.length || !docsEval || docsEval.overall !== 'committed';
      reason = mergeReason();
    } else if (s.key === 'release') {
      locked = status !== 'merged';
      reason = releaseReason();
    }
    return { ...s, locked, reason };
  });
}
