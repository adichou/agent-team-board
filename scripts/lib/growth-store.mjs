// REQ-20260910-022 project-growth 工作流数据层（growth-store）—— server.mjs / atb.mjs 使用。
// 事实源：<dataDir>/marketing/agent-runs/<id>/（与 REQ/BUG 状态机完全隔离）：
//   run.json     任务记录：输入引用及版本、提示词留档、状态、回执日志、草稿与候选处理
//   draft.md     回执草稿的人类可读渲染（跨会话接续的读取入口）
// 语义边界：
//   - 界面只生成可复制提示词，不自动运行任何模型；回执由外部 Agent 会话经统一 CLI/API 写入；
//     没有回执不宣称已保存（状态 waiting）。
//   - 相同任务重复回执幂等跳过（不重复保存、不覆盖首次内容，仅标记 contentChanged）。
//   - 过期输入（任务创建后档案并发更新）回执被拒绝：不写草稿、不覆盖他人更新，可按当前版本重建。
//   - 跨项目写入被拒绝：任务 ID 不在本项目 → 报错，不落入另一项目。
//   - 候选行动（定价 / 定位 / 渠道 / 实验 / 行动 / 复盘）一律先入草稿，经用户显式采纳才写正式档案；
//     候选价格不自动成为当前方案，候选渠道不自动变为已验证，内容行动不自动对外发布。
//   - 无指标场景输出「数据不足」与补采建议，不生成虚构业绩或因果结论（insufficient 草稿无候选）。
//   - 外部 skill（coreyhaines31/marketingskills 候选）未安装：只列能力缺口并给手工提示词兜底，
//     不假称已运行外部 skill；引入前须核验并固定版本与许可（见条目 design.md）。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AtbError, writeJsonAtomic } from './core.mjs';
import * as mkt from './marketing-store.mjs';

export const GROWTH_SCHEMA_VERSION = 1;

export const GROWTH_TYPES = ['positioning', 'pricing', 'channels', 'content', 'review'];
export const GROWTH_TYPE_LABEL = {
  positioning: '梳理定位', pricing: '分析定价', channels: '制定渠道计划', content: '生成内容', review: '复盘',
};
export const GROWTH_TYPE_GOAL = {
  positioning: '基于营销档案与项目 README，梳理目标受众、差异点与未决问题，输出可采纳的定位更新候选。',
  pricing: '基于营销档案、定价历史版本与指标快照，给出下一周期候选定价方案、建议理由与验证方法。',
  channels: '基于营销档案与现有渠道 / 实验，提出新渠道与实验候选，标注为待验证假设并给出验证标准。',
  content: '基于定位档案与实验目标，生成具体行动的内容草稿（人工复制发布，不自动发送）。',
  review: '基于指定观察期的指标快照与实验记录生成复盘草稿；数据不足时输出补采建议，不生成虚构结论。',
};

// 候选外部 skill（coreyhaines31/marketingskills，按入口映射）；当前未安装 → 能力缺口 + 手工兜底
export const SKILL_SOURCE = 'https://github.com/coreyhaines31/marketingskills';
export const SKILLS_BY_TYPE = {
  positioning: ['product-marketing'],
  pricing: ['pricing', 'product-marketing'],
  channels: ['marketing-plan', 'social'],
  content: ['content-strategy', 'copywriting'],
  review: ['analytics', 'attribution'],
};
export function growthSkills() {
  return {
    installed: false, // 未安装整套 skill；不默认全部加载，也不假称已运行
    source: SKILL_SOURCE,
    note: '外部 skill 未安装：仅记录候选与来源；引入前须核验并固定版本、审阅写入行为与许可（MIT/Apache-2.0 等白名单）',
    byType: SKILLS_BY_TYPE,
  };
}

// 候选行动落地类型（kind → 既有营销数据层入口）
export const CANDIDATE_KINDS = ['positioning', 'pricing', 'channel', 'experiment', 'activity', 'review'];
export const CANDIDATE_KIND_LABEL = {
  positioning: '定位', pricing: '定价', channel: '渠道', experiment: '实验', activity: '行动', review: '复盘',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const nowIso = () => new Date().toISOString();

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

function strVal(v, { max = 2000 } = {}) {
  if (v == null) return '';
  return String(v).slice(0, max + 1);
}

function fieldError(message, fields) {
  const err = new AtbError(message);
  err.fields = fields;
  return err;
}

// ---------- 目录 ----------

export function agentRunsDir(dataDir) {
  return path.join(mkt.marketingDir(dataDir), 'agent-runs');
}
function runDirOf(dataDir, id) { return path.join(agentRunsDir(dataDir), id); }
function runFile(dataDir, id) { return path.join(runDirOf(dataDir, id), 'run.json'); }
function draftFile(dataDir, id) { return path.join(runDirOf(dataDir, id), 'draft.md'); }

function allocId(dataDir) {
  for (let i = 0; i < 8; i++) {
    const id = `ar-${crypto.randomBytes(4).toString('hex')}`;
    if (!fs.existsSync(runFile(dataDir, id))) return id;
  }
  return `ar-${crypto.randomBytes(6).toString('hex')}`;
}

// ---------- 输入引用及版本（任务创建时从当前档案采集） ----------

// 单个引用的当前版本：可变实体返回 revision；README / 不可变定价版本 / 复盘 → null（无版本要求）
function currentRevisionOf(dataDir, ref) {
  if (ref === 'profile.json') {
    const p = readJson(mkt.profileFile(dataDir));
    if (!p || typeof p !== 'object') return null;
    return Number(p.revision) || 1;
  }
  if (ref === 'README.md' || ref.startsWith('pricing/') || ref.startsWith('reviews/')) return null;
  let dir = null;
  if (ref.startsWith('channels/')) dir = mkt.channelsDir(dataDir);
  else if (ref.startsWith('experiments/')) dir = mkt.experimentsDir(dataDir);
  else if (ref.startsWith('activities/')) dir = mkt.activitiesDir(dataDir);
  else if (ref.startsWith('metrics/observations/')) dir = mkt.observationsDir(dataDir);
  if (!dir) return null;
  const raw = readJson(path.join(dir, path.basename(ref)));
  if (!raw || typeof raw !== 'object') return null;
  return Number(raw.revision) || 1;
}

function entityRefs(dir, kindPrefix) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith('.json')).sort()
    .map((n) => `${kindPrefix}/${n}`);
}

// 五类入口的输入集合（“外部 skill 所需上下文由适配层导出”，以 ATB 档案为唯一事实源）
export function collectGrowthInputs(dataDir, { type, observation } = {}) {
  if (!GROWTH_TYPES.includes(type)) throw new AtbError(`非法任务类型：${type}`);
  if (!fs.existsSync(mkt.profileFile(dataDir))) {
    return [{ ref: 'README.md', revision: null }]; // 空项目：仅 README 兜底
  }
  const inputs = [{ ref: 'profile.json', revision: currentRevisionOf(dataDir, 'profile.json') }];
  if (type === 'positioning') {
    inputs.push({ ref: 'README.md', revision: null });
  } else if (type === 'pricing') {
    for (const ref of entityRefs(mkt.pricingDir(dataDir), 'pricing')) inputs.push({ ref, revision: null });
  } else if (type === 'channels') {
    for (const ref of entityRefs(mkt.channelsDir(dataDir), 'channels')) inputs.push({ ref, revision: currentRevisionOf(dataDir, ref) });
    for (const ref of entityRefs(mkt.experimentsDir(dataDir), 'experiments')) inputs.push({ ref, revision: currentRevisionOf(dataDir, ref) });
  } else if (type === 'content') {
    for (const ref of entityRefs(mkt.experimentsDir(dataDir), 'experiments')) inputs.push({ ref, revision: currentRevisionOf(dataDir, ref) });
    for (const ref of entityRefs(mkt.activitiesDir(dataDir), 'activities')) inputs.push({ ref, revision: currentRevisionOf(dataDir, ref) });
  } else if (type === 'review') {
    const { from, to } = observation || {};
    if (!DATE_RE.test(String(from || '')) || !DATE_RE.test(String(to || ''))) {
      throw new AtbError('复盘任务必须指定合法观察期（YYYY-MM-DD 的 from/to）');
    }
    for (const ref of entityRefs(mkt.observationsDir(dataDir), 'metrics/observations')) {
      const o = readJson(path.join(mkt.observationsDir(dataDir), path.basename(ref)));
      if (!o || typeof o !== 'object') continue;
      if (String(o.dateStart) <= String(to) && String(o.dateEnd) >= String(from)) {
        inputs.push({ ref, revision: currentRevisionOf(dataDir, ref) });
      }
    }
    for (const ref of entityRefs(mkt.experimentsDir(dataDir), 'experiments')) inputs.push({ ref, revision: currentRevisionOf(dataDir, ref) });
    for (const ref of entityRefs(mkt.activitiesDir(dataDir), 'activities')) inputs.push({ ref, revision: currentRevisionOf(dataDir, ref) });
    for (const ref of entityRefs(mkt.reviewsDir(dataDir), 'reviews')) inputs.push({ ref, revision: null });
  }
  return inputs;
}

// ---------- 提示词（可复制到外部 Agent 会话；只复制不执行） ----------

function inputLine(i) {
  return `  · ${i.ref}${i.revision == null ? '（无版本要求）' : ` @ r${i.revision}`}`;
}

export function buildGrowthPrompt({
  projectRoot, atbPath, type, inputs, runId, observation = null, continueOf = null, archiveMissing = false,
}) {
  const marketingDir = path.join(projectRoot, 'docs', 'agent-team-board', 'marketing');
  const lines = [
    `# project-growth 任务提示词（${GROWTH_TYPE_LABEL[type]}）`,
    `- 项目：${projectRoot}（只允许访问该项目授权范围内的路径，不得读取其他项目）。`,
    '- 执行方式：本提示词由看板复制而来，请在可访问上述项目文件的 Agent 会话中人工执行；看板不会自动运行任何模型。',
    `- 营销资料目录：${marketingDir}`,
  ];
  if (archiveMissing) {
    lines.push('- 输入：营销档案不存在（marketing/ 未初始化）。档案缺失，仅基于 README 与通用方法分析，输出须标注「档案缺失，仅基于 README 与通用方法」。');
  } else {
    lines.push('- 输入（请严格按引用版本读取，不得读取其他项目）：', ...inputs.map(inputLine));
  }
  if (continueOf) {
    lines.push(`- 历史结果（接续任务，务必先读取后再继续）：agent-runs/${continueOf}/draft.md 及其采纳记录（见该任务 run.json），不要重复已采纳内容。`);
  }
  lines.push(`- 目标任务：${GROWTH_TYPE_GOAL[type]}`);
  if (type === 'review') {
    lines.push(`- 观察期：${observation.from} ~ ${observation.to}（复盘结论必须引用该期实际指标快照；该期无数据时输出「数据不足」与补采建议，不生成虚构业绩或因果结论）。`);
  }
  lines.push(
    '- 输出要求：区分 事实 / 假设 / 待确认；每条结论附证据引用及版本；列出缺失信息、建议理由与验证方法；',
    '  候选价格不得写成已生效，候选渠道不得写成已验证；不自动对外发布、发送或付费（需用户明确授权）。',
    '- 保存协议：完成后把草稿写入 JSON 临时文件，通过统一 CLI 写回（在任意目录执行均可）：',
    `    node ${atbPath} growth receipt ${runId} --file <草稿JSON文件> --dir ${projectRoot} [--session <来源会话标识>]`,
    '  草稿 JSON 结构：{ "facts": [], "assumptions": [], "toConfirm": [], "evidence": [], "missing": [], "advice": [], "insufficient": false,',
    '    "candidates": [{ "id": "c1", "kind": "positioning|pricing|channel|experiment|activity|review", "title": "…", "reason": "…", "verify": "…", "adoptTo": "…", "data": { … } }] }',
    '  （kind 的 data 结构与看板对应新建表单一致；insufficient=true 时不得携带 candidates，只给 advice 补采建议。）',
    '  未收到写入回执不得宣称已保存；不要直接修改 pricing/、channels/、experiments/、activities/、reviews/ 等正式档案；',
    '  候选行动一律先入草稿，由用户在看板中逐项编辑并显式采纳。',
  );
  lines.push(
    '- 技能调用：（兜底模式）外部 skill 未安装：'
    + `${SKILLS_BY_TYPE[type].join('、')}（来源 ${SKILL_SOURCE}，仅记录候选，未引入）。`
    + '请以通用营销方法人工完成分析，并在输出中注明「未经外部 skill」；看板不会假称已运行外部 skill。',
  );
  return lines.join('\n');
}

// ---------- 任务创建（复制提示词时登记；状态 waiting = 尚未收到结果） ----------

export function createAgentRun(dataDir, { projectRoot, atbPath, type, observation = null, continueOf = null, by = 'board' }) {
  if (!projectRoot || !atbPath) throw new AtbError('缺少项目根或 CLI 路径，无法生成任务提示词');
  if (!GROWTH_TYPES.includes(type)) throw fieldError('任务创建校验失败', { type: '任务类型必须是 梳理定位 / 分析定价 / 制定渠道计划 / 生成内容 / 复盘' });
  let obs = null;
  if (type === 'review') {
    const { from, to } = observation || {};
    if (!DATE_RE.test(String(from || '')) || !DATE_RE.test(String(to || '')) || String(from) > String(to)) {
      throw fieldError('任务创建校验失败', { observation: '复盘任务需要合法观察期（from ≤ to，YYYY-MM-DD）' });
    }
    obs = { from: String(from), to: String(to) };
  }
  if (continueOf != null && !fs.existsSync(runFile(dataDir, String(continueOf)))) {
    throw fieldError('任务创建校验失败', { continueOf: `接续的任务不存在：${continueOf}` });
  }
  const archiveMissing = !fs.existsSync(mkt.profileFile(dataDir));
  const inputs = collectGrowthInputs(dataDir, { type, observation: obs });

  const id = allocId(dataDir);
  const ts = nowIso();
  let adoptedNote = '';
  if (continueOf) {
    const prev = readJson(runFile(dataDir, String(continueOf)));
    const settled = (prev?.draft?.candidates || [])
      .filter((c) => c.state === 'adopted').map((c) => c.title);
    if (settled.length) adoptedNote = `\n- 采纳记录（不要重复）：${settled.join('；')}`;
  }
  const prompt = buildGrowthPrompt({ projectRoot, atbPath, type, inputs, runId: id, observation: obs, continueOf, archiveMissing })
    + (continueOf ? adoptedNote : '');
  const run = {
    schemaVersion: GROWTH_SCHEMA_VERSION,
    id, type,
    createdAt: ts, updatedAt: ts, revision: 1,
    inputs,
    continueOf: continueOf || null,
    observation: obs,
    prompt,
    status: 'waiting',     // waiting（尚未收到结果）| received（草稿待处理）| done（候选全部处理完）
    session: null,
    receiptAt: null,
    summary: null,
    draftRef: null,
    draft: null,
    receipts: [],
  };
  fs.mkdirSync(runDirOf(dataDir, id), { recursive: true });
  writeJsonAtomic(runFile(dataDir, id), run);
  return { run, prompt };
}

// ---------- 读取 ----------

function normalizeRun(raw, id) {
  const r = raw || {};
  return {
    schemaVersion: GROWTH_SCHEMA_VERSION,
    id: String(r.id || id || ''),
    type: GROWTH_TYPES.includes(r.type) ? r.type : 'positioning',
    createdAt: r.createdAt || '',
    updatedAt: r.updatedAt || '',
    revision: Number(r.revision) || 1,
    inputs: Array.isArray(r.inputs)
      ? r.inputs.filter((i) => i && typeof i === 'object')
        .map((i) => ({ ref: String(i.ref || ''), revision: i.revision == null ? null : Number(i.revision) }))
      : [],
    continueOf: typeof r.continueOf === 'string' && r.continueOf ? r.continueOf : null,
    observation: r.observation && DATE_RE.test(String(r.observation.from)) && DATE_RE.test(String(r.observation.to))
      ? { from: String(r.observation.from), to: String(r.observation.to) }
      : null,
    prompt: strVal(r.prompt),
    status: ['waiting', 'received', 'done'].includes(r.status) ? r.status : 'waiting',
    session: typeof r.session === 'string' && r.session ? r.session : null,
    receiptAt: r.receiptAt || null,
    summary: strVal(r.summary, { max: 500 }),
    draftRef: typeof r.draftRef === 'string' && r.draftRef ? r.draftRef : null,
    draft: normalizeDraft(r.draft),
    receipts: Array.isArray(r.receipts)
      ? r.receipts.filter((x) => x && typeof x === 'object')
        .map((x) => ({ at: x.at || '', result: String(x.result || ''), reason: strVal(x.reason, { max: 500 }) }))
      : [],
  };
}

function normalizeDraft(d) {
  if (!d || typeof d !== 'object') return null;
  const strArr = (v, max = 50) => (Array.isArray(v) ? v.slice(0, max).map((x) => strVal(x, { max: 2000 })) : []);
  return {
    facts: strArr(d.facts),
    assumptions: strArr(d.assumptions),
    toConfirm: strArr(d.toConfirm),
    evidence: strArr(d.evidence),
    missing: strArr(d.missing),
    advice: strArr(d.advice),
    insufficient: d.insufficient === true,
    candidates: Array.isArray(d.candidates)
      ? d.candidates.filter((c) => c && typeof c === 'object').map((c) => ({
        id: String(c.id || ''),
        kind: CANDIDATE_KINDS.includes(c.kind) ? c.kind : null,
        title: strVal(c.title),
        reason: strVal(c.reason, { max: 2000 }),
        verify: strVal(c.verify, { max: 2000 }),
        adoptTo: strVal(c.adoptTo, { max: 500 }),
        data: c.data && typeof c.data === 'object' ? c.data : {},
        state: ['pending', 'adopted', 'kept'].includes(c.state) ? c.state : 'pending',
        editedAt: c.editedAt || null,
        adoptedAt: c.adoptedAt || null,
        resultRef: strVal(c.resultRef, { max: 200 }),
      }))
      : [],
  };
}

function listRunIds(dataDir) {
  let names = [];
  try {
    names = fs.readdirSync(agentRunsDir(dataDir));
  } catch {
    return [];
  }
  return names.filter((n) => fs.existsSync(runFile(dataDir, n))).sort();
}

function readRunRaw(dataDir, id) {
  const file = runFile(dataDir, String(id || ''));
  if (!fs.existsSync(file)) return null;
  const raw = readJson(file);
  if (!raw || typeof raw !== 'object') return { corrupt: true };
  return { raw };
}

// 运行记录列表（供看板列表：不含 prompt / draft 全文，详情另读）
function runSummaryOf(run) {
  return {
    id: run.id,
    type: run.type,
    typeLabel: GROWTH_TYPE_LABEL[run.type],
    status: run.status,
    session: run.session,
    inputs: run.inputs,
    continueOf: run.continueOf,
    observation: run.observation,
    summary: run.summary,
    draftRef: run.draftRef,
    receiptAt: run.receiptAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    insufficient: run.draft ? run.draft.insufficient : false,
    candidateCounts: run.draft
      ? {
        total: run.draft.candidates.length,
        adopted: run.draft.candidates.filter((c) => c.state === 'adopted').length,
        kept: run.draft.candidates.filter((c) => c.state === 'kept').length,
        pending: run.draft.candidates.filter((c) => c.state === 'pending').length,
      }
      : null,
    result: run.receipts.length ? run.receipts[run.receipts.length - 1].result : 'waiting',
    lastReceiptReason: run.receipts.length ? run.receipts[run.receipts.length - 1].reason : null,
  };
}

export function readGrowth(dataDir) {
  if (!dataDir || !fs.existsSync(mkt.profileFile(dataDir)) && !fs.existsSync(agentRunsDir(dataDir))) {
    return { initialized: false, skills: growthSkills(), runs: [] };
  }
  const runs = [];
  for (const id of listRunIds(dataDir)) {
    const got = readRunRaw(dataDir, id);
    if (!got) continue;
    if (got.corrupt) {
      runs.push({ id, corrupt: true, status: 'corrupt' });
      continue;
    }
    runs.push(runSummaryOf(normalizeRun(got.raw, id)));
  }
  runs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
  return { initialized: true, skills: growthSkills(), runs };
}

export function readAgentRun(dataDir, id) {
  const got = readRunRaw(dataDir, id);
  if (got == null) throw new AtbError(`任务不存在：${id}（请确认 --dir 指向创建该任务的项目；跨项目写入会被拒绝）`);
  if (got.corrupt) throw new AtbError(`任务记录已损坏，无法解析（请人工检查，系统不自动覆盖）：${id}`);
  return normalizeRun(got.raw, id);
}

// ---------- 回执（外部会话经统一 CLI/API 写入） ----------

function validateDraft(d, fields) {
  const strArr = (key, label) => {
    if (d[key] != null && !Array.isArray(d[key])) fields[key] = `${label}必须是文本数组`;
  };
  strArr('facts', '事实'); strArr('assumptions', '假设'); strArr('toConfirm', '待确认');
  strArr('evidence', '证据引用'); strArr('missing', '缺失信息'); strArr('advice', '补采建议');
  const insufficient = d.insufficient === true;
  if (d.insufficient != null && typeof d.insufficient !== 'boolean') {
    fields.insufficient = 'insufficient 必须是布尔值';
  }
  if (insufficient) {
    if (Array.isArray(d.candidates) && d.candidates.length) {
      fields.insufficient = '数据不足的草稿不得携带候选行动（先补采数据，再生成结论）';
    }
    if (!Array.isArray(d.advice) || !d.advice.filter((x) => String(x || '').trim()).length) {
      fields.advice = '数据不足时必须给出补采建议（advice 数组，至少一条）';
    }
  }
  const cands = Array.isArray(d.candidates) ? d.candidates : [];
  if (cands.length > 20) fields.candidates = '候选行动过多（≤20 项）';
  const seen = new Set();
  cands.forEach((c, i) => {
    const base = `candidates.${i}`;
    if (!c || typeof c !== 'object') {
      fields[base] = '候选格式非法';
      return;
    }
    if (!CANDIDATE_KINDS.includes(c.kind)) fields[`${base}.kind`] = `候选 kind 必须是 ${CANDIDATE_KINDS.join(' / ')}`;
    if (!String(c.title || '').trim()) fields[`${base}.title`] = '候选标题不能为空';
    const cid = String(c.id || '').trim();
    if (cid && seen.has(cid)) fields[`${base}.id`] = '候选 id 重复';
    if (cid) seen.add(cid);
  });
}

// 过期输入检查：可变引用 revision 变化 / 文件缺失 → stale；复盘另要求观察期输入集合不变（新增观察同样改变基线）
function staleReason(dataDir, run) {
  const problems = [];
  for (const i of run.inputs) {
    if (i.revision == null) continue; // README / 不可变定价版本 / 复盘：无版本要求
    const cur = currentRevisionOf(dataDir, i.ref);
    if (cur == null || cur !== i.revision) {
      problems.push(`${i.ref} 任务输入 r${i.revision} < 当前 r${cur == null ? '（缺失）' : cur}`);
    }
  }
  if (run.type === 'review' && run.observation) {
    const curRefs = collectGrowthInputs(dataDir, { type: 'review', observation: run.observation })
      .map((i) => i.ref).sort().join('|');
    const oldRefs = run.inputs.map((i) => i.ref).sort().join('|');
    if (curRefs !== oldRefs) problems.push('观察期输入集合已变化（观察记录新增或删除）');
  }
  return problems.length ? `输入基线过期：${problems.join('；')}。未写入草稿（不覆盖他人更新），请按当前版本重建任务` : null;
}

function draftMarkdown(run, d) {
  const sec = (title, arr) => `## ${title}\n${(arr || []).length ? arr.map((x) => `- ${x}`).join('\n') : '-（无）'}\n`;
  const lines = [
    `# project-growth 草稿 · ${run.id}（${GROWTH_TYPE_LABEL[run.type]}）`,
    '',
    `- 来源会话：${run.session || '—'}`,
    `- 回执时间：${run.receiptAt || ''}`,
    `- 输入引用及版本：${run.inputs.map((i) => `${i.ref}${i.revision == null ? '' : `@r${i.revision}`}`).join(' · ')}`,
    run.observation ? `- 观察期：${run.observation.from} ~ ${run.observation.to}` : '',
    '',
    sec('事实', d.facts),
    sec('假设', d.assumptions),
    sec('待确认', d.toConfirm),
    sec('证据引用', d.evidence),
  ];
  if (d.insufficient) {
    lines.push('## 数据不足\n本观察期数据不足（未录入 ≠ 0）：不生成业绩结论或因果判断；先补采再生成复盘。\n');
    lines.push(sec('补采建议', d.advice));
  } else {
    lines.push(sec('缺失信息', d.missing));
    lines.push('## 候选行动（逐项处理：编辑 → 采纳 / 保留草稿）\n');
    for (const c of d.candidates) {
      lines.push(`### [${c.id}] ${CANDIDATE_KIND_LABEL[c.kind] || c.kind} · ${c.title}`);
      if (c.reason) lines.push(`- 建议理由：${c.reason}`);
      if (c.verify) lines.push(`- 验证方法：${c.verify}`);
      if (c.adoptTo) lines.push(`- 显式采纳后写入：${c.adoptTo}`);
      lines.push('');
    }
  }
  return lines.filter((x) => x !== '').join('\n');
}

function summarizeDraft(d) {
  if (d.insufficient) return '数据不足：仅输出补采建议，未生成结论（不虚构业绩或因果）。';
  return `输出 ${d.facts.length} 条事实、${d.assumptions.length} 条假设；候选 ${d.candidates.length} 项待逐项处理。`;
}

export function saveAgentRunReceipt(dataDir, { id, draft, session, by = 'board' }) {
  const runId = String(id || '');
  const got = readRunRaw(dataDir, runId);
  if (got == null) {
    throw new AtbError(`任务不存在：${runId}（请确认 --dir 指向创建该任务的项目；跨项目写入会被拒绝）`);
  }
  if (got.corrupt) throw new AtbError(`任务记录已损坏，无法解析（请人工检查，系统不自动覆盖）：${runId}`);
  const run = normalizeRun(got.raw, runId);

  // 幂等：相同任务重复回执跳过（不重复保存、不覆盖首次内容）
  if (run.status === 'received' || run.status === 'done') {
    const d = draft && typeof draft === 'object' ? draft : {};
    const changed = JSON.stringify(normalizeDraft(d)) !== JSON.stringify(run.draft);
    return { duplicate: true, contentChanged: changed, run };
  }

  const d = draft && typeof draft === 'object' ? draft : {};
  const fields = {};
  validateDraft(d, fields);
  if (Object.keys(fields).length) throw fieldError('草稿校验失败（未写入）', fields);

  // 过期输入：拒绝写入，不覆盖他人更新
  const stale = staleReason(dataDir, run);
  if (stale) {
    run.receipts.push({ at: nowIso(), result: 'rejected:stale', reason: stale });
    run.updatedAt = nowIso();
    run.revision += 1;
    writeJsonAtomic(runFile(dataDir, run.id), run);
    throw new AtbError(stale);
  }

  // 归一化候选（缺 id 顺延分配）
  const nextSeq = { n: 0 };
  const candidates = (Array.isArray(d.candidates) ? d.candidates : []).map((c) => {
    const cid = String(c.id || '').trim() || `c${++nextSeq.n}`;
    return {
      id: cid,
      kind: CANDIDATE_KINDS.includes(c.kind) ? c.kind : null,
      title: strVal(c.title),
      reason: strVal(c.reason, { max: 2000 }),
      verify: strVal(c.verify, { max: 2000 }),
      adoptTo: strVal(c.adoptTo, { max: 500 }),
      data: c.data && typeof c.data === 'object' ? c.data : {},
      state: 'pending', editedAt: null, adoptedAt: null, resultRef: '',
    };
  });
  const normalized = normalizeDraft({
    facts: d.facts, assumptions: d.assumptions, toConfirm: d.toConfirm,
    evidence: d.evidence, missing: d.missing, advice: d.advice,
    insufficient: d.insufficient === true, candidates,
  });

  const ts = nowIso();
  run.status = 'received';
  run.session = strVal(session, { max: 100 }) || null;
  run.receiptAt = ts;
  run.updatedAt = ts;
  run.summary = summarizeDraft(normalized);
  run.draftRef = `agent-runs/${run.id}/draft.md`;
  run.draft = normalized;
  run.receipts.push({ at: ts, result: 'success', reason: '' });
  run.revision += 1;
  writeJsonAtomic(runFile(dataDir, run.id), run);
  fs.writeFileSync(draftFile(dataDir, run.id), draftMarkdown(run, normalized), 'utf8');
  return { duplicate: false, contentChanged: false, run };
}

// ---------- 候选处理（编辑 / 显式采纳 / 保留草稿） ----------

function loadWritableRun(dataDir, id) {
  const run = readAgentRun(dataDir, id);
  if (run.status === 'waiting') throw new AtbError('尚未收到结果：回执由外部会话写入后才能处理草稿');
  return run;
}

function persistRun(dataDir, run) {
  run.updatedAt = nowIso();
  run.revision += 1;
  writeJsonAtomic(runFile(dataDir, run.id), run);
  if (run.draft) fs.writeFileSync(draftFile(dataDir, run.id), draftMarkdown(run, run.draft), 'utf8');
  return run;
}

function settleRun(run) {
  const cands = run.draft?.candidates || [];
  if (cands.length && cands.every((c) => c.state === 'adopted' || c.state === 'kept')) {
    run.status = 'done';
    run.summary = `候选 ${cands.length} 项：采纳 ${cands.filter((c) => c.state === 'adopted').length} 项，`
      + `保留草稿 ${cands.filter((c) => c.state === 'kept').length} 项。`;
  }
}

export function editAgentRunCandidate(dataDir, { id, candidateId, data, by = 'board' }) {
  const run = loadWritableRun(dataDir, id);
  const cand = run.draft.candidates.find((c) => c.id === String(candidateId || ''));
  if (!cand) throw new AtbError(`候选不存在：${candidateId}`);
  if (cand.state !== 'pending') throw new AtbError(`候选已${cand.state === 'adopted' ? '采纳' : '保留草稿'}，不能再编辑`);
  const fields = {};
  const title = strVal(data?.title, { max: 500 });
  if (!title.trim()) fields.title = '候选标题不能为空';
  if (Object.keys(fields).length) throw fieldError('候选编辑校验失败', fields);
  cand.title = title;
  if (data?.verify != null) cand.verify = strVal(data.verify, { max: 2000 });
  if (data?.reason != null) cand.reason = strVal(data.reason, { max: 2000 });
  cand.editedAt = nowIso();
  return { run: persistRun(dataDir, run) };
}

export function keepAgentRunCandidate(dataDir, { id, candidateId, by = 'board' }) {
  const run = loadWritableRun(dataDir, id);
  const cand = run.draft.candidates.find((c) => c.id === String(candidateId || ''));
  if (!cand) throw new AtbError(`候选不存在：${candidateId}`);
  if (cand.state === 'kept') return { already: true, run };
  if (cand.state === 'adopted') throw new AtbError('候选已采纳，不能再保留草稿');
  if (run.status === 'done') throw new AtbError('该任务候选已全部处理完（历史记录只读；如需继续请新建接续任务）');
  cand.state = 'kept';
  settleRun(run);
  return { already: false, run: persistRun(dataDir, run) };
}

// 显式采纳 → 经既有营销数据层写正式档案（校验 / 原子写 / 语义边界全部复用）
export function adoptAgentRunCandidate(dataDir, { id, candidateId, data, by = 'board' }) {
  const run = loadWritableRun(dataDir, id);
  if (run.draft.insufficient) throw new AtbError('数据不足的草稿没有候选行动可采纳（先按补采建议录入数据，再生成复盘）');
  const cand = run.draft.candidates.find((c) => c.id === String(candidateId || ''));
  if (!cand) throw new AtbError(`候选不存在：${candidateId}`);
  // 幂等：已采纳候选重复采纳不重复写入（双击 / 重试安全）
  if (cand.state === 'adopted') return { already: true, run, result: { ref: cand.resultRef } };
  if (cand.state === 'kept') throw new AtbError('候选已保留草稿；如需采纳请先编辑恢复（或重新生成候选）');
  if (run.status === 'done') throw new AtbError('该任务候选已全部处理完（历史记录只读；如需继续请新建接续任务）');

  const payload = { ...cand.data, ...(data && typeof data === 'object' ? data : {}) };
  let result;
  switch (cand.kind) {
    case 'positioning': {
      const st = mkt.readState(dataDir);
      if (!st.initialized) throw new AtbError('营销档案尚未初始化，无法采纳定位候选');
      const entry = {
        type: mkt.EVIDENCE_TYPES.includes(payload.type) ? payload.type : 'hypothesis',
        content: strVal(payload.content, { max: 2000 }) || cand.title,
        source: strVal(payload.source, { max: 500 }) || `agent-runs/${run.id}`,
        collectedAt: nowIso().slice(0, 10),
      };
      const saved = mkt.saveProfile(dataDir, {
        revision: st.profile.revision,
        positioning: st.profile.positioning,
        evidence: [...st.profile.evidence, entry],
        by,
      });
      result = { ref: `profile.json@r${saved.profile.revision}`, evidence: entry };
      break;
    }
    case 'pricing': {
      const r = mkt.savePricing(dataDir, { data: payload, by });
      result = { version: r.version.version, ref: `pricing/${r.version.version}.json` };
      break;
    }
    case 'channel': {
      const r = mkt.createChannel(dataDir, { data: payload, by });
      result = { channel: r.channel, ref: `channels/${r.channel.id}.json` };
      break;
    }
    case 'experiment': {
      const r = mkt.createExperiment(dataDir, { data: payload, by });
      result = { experiment: r.experiment, ref: `experiments/${r.experiment.id}.json` };
      break;
    }
    case 'activity': {
      const r = mkt.createActivity(dataDir, { data: payload, by });
      result = { activity: r.activity, ref: `activities/${r.activity.id}.json` };
      break;
    }
    case 'review': {
      const r = mkt.createReview(dataDir, { data: payload, by });
      result = { review: r.review, ref: `reviews/${r.review.id}.json` };
      break;
    }
    default:
      throw fieldError('候选采纳校验失败', { kind: `候选 kind 非法：${cand.kind}` });
  }
  cand.state = 'adopted';
  cand.adoptedAt = nowIso();
  cand.resultRef = strVal(result.ref, { max: 200 });
  settleRun(run);
  return { already: false, run: persistRun(dataDir, run), result };
}
