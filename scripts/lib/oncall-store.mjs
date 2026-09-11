// REQ-20260907-001 Oncall 咨询看板数据层（oncall-store）—— atb.mjs（CLI）与 server.mjs 共用。
// 事实源：<dataDir>/oncall/（与 requirements/bugs 完全隔离，不进 REQ/BUG 状态机、不占 impl.lock）：
//   settings.json            独立计数器（ask/run，按日重置；.locks/oncall.lock 互斥）
//   tickets/ASK-YYYYMMDD-NNN/ ticket.json + question.md + attachments/ + rounds/<N>/{question,answer}.md
//   runs/<runId>/            codex 派发执行账本（run.json + events.jsonl + stderr.log + prompt.md + final-message.md）
// 状态：pending → answering → answered；answered --ask--> pending；answering --fail--> failed --重派--> answering。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  AtbError, writeJsonAtomic, writeStatus, createItem, acquireLock, releaseLock,
  localDateStamp, resolveItemDir, readStatus,
  // REQ-20260909-009：附件白名单 / 大小 / 落盘 / 读取口径上收 core（条目截图与讨论单附件同一真源）
  ATTACHMENT_MAX_BYTES, ATTACHMENT_IMAGE_MIME, attachmentMime, saveItemAttachment, readItemAttachment,
  parseItemAttachments,
} from './core.mjs';

export const ONCALL_STATUS = ['pending', 'answering', 'answered', 'failed'];
export const STAFF_MAX_CHARS = 30; // 与 REQ-20260907-002 开发人员长度限制对齐
export const TITLE_MAX_CHARS = 120; // 与 core.createItem 标题限制一致
export { ATTACHMENT_MAX_BYTES, ATTACHMENT_IMAGE_MIME, attachmentMime }; // 兼容既有引用（server.mjs / 测试）

const ONCALL_LOCK_STALE_MS = 30_000;

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const nowIso = () => new Date().toISOString();

// ---------- 目录与初始化 ----------

export function oncallDir(dataDir) {
  return path.join(dataDir, 'oncall');
}
export function ticketsDir(dataDir) {
  return path.join(oncallDir(dataDir), 'tickets');
}
export function oncallRunsDir(dataDir) {
  return path.join(oncallDir(dataDir), 'runs');
}
export function ticketDir(dataDir, id) {
  assertAskId(id);
  return path.join(ticketsDir(dataDir), id);
}
export function oncallRunDir(dataDir, runId) {
  if (!/^run-\d{8}-\d{6}-[0-9a-f]{4}$/.test(String(runId))) throw new AtbError(`非法 runId：${runId}`);
  return path.join(oncallRunsDir(dataDir), runId);
}

function assertAskId(id) {
  if (typeof id !== 'string' || !/^ASK-\d{8}-\d{3}$/.test(id)) {
    throw new AtbError(`非法咨询单号：${id}（形如 ASK-YYYYMMDD-NNN）`);
  }
}

// 幂等初始化：目录 + 计数器 + .gitignore（执行账本不进版本控制；咨询单正文与附件随项目走）
export function ensureOncall(dataDir) {
  fs.mkdirSync(ticketsDir(dataDir), { recursive: true });
  fs.mkdirSync(oncallRunsDir(dataDir), { recursive: true });
  const settingsPath = path.join(oncallDir(dataDir), 'settings.json');
  if (!readJson(settingsPath)) {
    writeJsonAtomic(settingsPath, { version: 1, date: localDateStamp(), counters: { ask: 0, run: 0 } });
  }
  const gi = path.join(dataDir, '.gitignore');
  const wanted = ['oncall/runs/'];
  let cur = '';
  try { cur = fs.readFileSync(gi, 'utf8'); } catch {}
  const add = wanted.filter((l) => !cur.split('\n').includes(l));
  if (add.length) fs.writeFileSync(gi, cur.replace(/\n*$/, '\n') + add.join('\n') + '\n');
}

// ---------- 编号（独立序列，按日重置） ----------

function nextOncallCounter(dataDir, kind) {
  const lockPath = path.join(dataDir, '.locks', 'oncall.lock');
  acquireLock(lockPath, ONCALL_LOCK_STALE_MS, { pid: process.pid, at: nowIso() });
  try {
    ensureOncall(dataDir);
    const settingsPath = path.join(oncallDir(dataDir), 'settings.json');
    const cfg = readJson(settingsPath) || { version: 1, counters: {} };
    const today = localDateStamp();
    if (cfg.date !== today) {
      cfg.date = today;
      cfg.counters = { ask: 0, run: 0 };
    }
    cfg.counters[kind] = (cfg.counters[kind] || 0) + 1;
    writeJsonAtomic(settingsPath, cfg);
    return { seq: cfg.counters[kind], date: today };
  } finally {
    releaseLock(lockPath);
  }
}

export function nextAskId(dataDir) {
  const { seq, date } = nextOncallCounter(dataDir, 'ask');
  return `ASK-${date}-${String(seq).padStart(3, '0')}`;
}

// ---------- 工具 ----------

function readTicketMeta(dataDir, id) {
  assertAskId(id);
  const meta = readJson(path.join(ticketDir(dataDir, id), 'ticket.json'));
  if (!meta || meta.id !== id) throw new AtbError(`找不到咨询单：${id}（可用 atb oncall list 查看）`);
  return meta;
}

function writeTicketMeta(dataDir, meta) {
  meta.updatedAt = nowIso();
  writeJsonAtomic(path.join(ticketDir(dataDir, meta.id), 'ticket.json'), meta);
}

function pushHistory(meta, from, to, by, note = '') {
  meta.history = meta.history || [];
  meta.history.push({ at: nowIso(), from, to, by: by || 'atb', note });
}

// 轮次文件定位：第 1 轮问题在根 question.md（创建即正文），第 N≥2 轮在 rounds/N/question.md；
// 回答统一在 rounds/N/answer.md。
function roundQuestionFile(dir, no) {
  return no === 1 ? path.join(dir, 'question.md') : path.join(dir, 'rounds', String(no), 'question.md');
}
function roundAnswerFile(dir, no) {
  return path.join(dir, 'rounds', String(no), 'answer.md');
}

// ---------- 附件 ----------
// REQ-20260909-009：白名单 / 大小 / 防穿越 / 同名去重口径上收 core（saveItemAttachment /
// readItemAttachment），此处仅绑定讨论单目录（ticketDir）与 ASK 编号校验，行为不变。

export function saveAttachment(dataDir, id, name, buf) {
  assertAskId(id);
  return saveItemAttachment(ticketDir(dataDir, id), name, buf);
}

export function readAttachment(dataDir, id, name) {
  assertAskId(id);
  return readItemAttachment(ticketDir(dataDir, id), name);
}

// ---------- 需求绑定（REQ-20260908-022） ----------

// reqId 校验：仅接受 REQ- 编号且条目存在（Bug 不支持绑定）；空值归一为 null（老单语义）
function normalizeReqId(dataDir, req) {
  const id = String(req == null ? '' : req).trim();
  if (!id) return null;
  const { type } = resolveItemDir(dataDir, id); // 非法格式 / 不存在在此抛错
  if (type !== 'requirement') throw new AtbError(`仅支持关联需求（REQ-… 编号）：${id}`);
  return id;
}

// 上下文文档白名单（与 core.DOC_ORDER 前三份对齐：回答所需的说明 / 方案 / 用例）
const REQ_CONTEXT_DOCS = ['README.md', 'design.md', 'test-cases.md'];

// 需求文档上下文：元信息（id/标题/状态）+ 三文档全文（存在才带）。
// 需求目录已删除 → missing: true 且 docs 为空，不抛错（讨论单保留回溯价值）。
export function reqContext(dataDir, reqId) {
  const out = { id: reqId, title: null, status: null, missing: false, docs: [] };
  try {
    const { dir, type } = resolveItemDir(dataDir, reqId);
    if (type !== 'requirement') {
      out.missing = true;
      return out;
    }
    const st = readStatus(dir);
    out.title = st.title || null;
    out.status = st.status || null;
    for (const name of REQ_CONTEXT_DOCS) {
      try {
        out.docs.push({ name, content: fs.readFileSync(path.join(dir, name), 'utf8') });
      } catch { /* 单份缺失跳过 */ }
    }
  } catch {
    out.missing = true;
  }
  return out;
}

// 归属需求元信息行（oncall show 文本输出与 codex worker 提示词共用同一口径）
function reqContextHead(ctx) {
  return `归属需求：${ctx.id}（${ctx.missing || !ctx.title ? '需求已删除' : ctx.title}，状态 ${ctx.missing || !ctx.status ? '—' : ctx.status}）`;
}

// ---------- 咨询单 ----------

function normalizeStaff(staff) {
  const s = String(staff == null ? '' : staff).trim();
  if (!s) return null;
  if ([...s].length > STAFF_MAX_CHARS) {
    throw new AtbError(`客服人员名称过长（不超过 ${STAFF_MAX_CHARS} 字，与 REQ-20260907-002 对齐）`);
  }
  return s;
}

export function createTicket(dataDir, { title, question, attachments = [], by = 'board', req = null }) {
  ensureOncall(dataDir);
  title = String(title || '').trim();
  if (!title) throw new AtbError('标题不能为空');
  if ([...title].length > TITLE_MAX_CHARS) throw new AtbError(`标题过长（不超过 ${TITLE_MAX_CHARS} 字）`);
  question = String(question == null ? '' : question);
  // REQ-20260908-013：创建时问题正文可空——留空（含纯空白）以已 trim 的标题作为正文，
  // 保证 question.md / 详情抽屉 / 派单提示词三处恒有内容；追问（askTicket）不放开。
  if (!question.trim()) question = title;
  // REQ-20260908-022：需求绑定讨论——创建时校验 reqId（仅 REQ- 编号且存在），落 ticket.json 可选字段
  const reqId = normalizeReqId(dataDir, req);

  const id = nextAskId(dataDir);
  const dir = ticketDir(dataDir, id);
  fs.mkdirSync(path.join(dir, 'rounds', '1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'question.md'), question);

  const saved = [];
  for (const att of attachments || []) {
    if (!att || typeof att.name !== 'string') throw new AtbError('附件缺少文件名');
    let buf;
    if (typeof att.dataBase64 === 'string') buf = Buffer.from(att.dataBase64, 'base64');
    else if (Buffer.isBuffer(att.data)) buf = att.data;
    else throw new AtbError(`附件 ${att.name} 缺少数据（dataBase64）`);
    saved.push(saveAttachment(dataDir, id, att.name, buf));
  }

  const now = nowIso();
  const meta = {
    version: 1,
    id,
    title,
    reqId, // REQ-20260908-022：归属需求（null = 普通讨论，老单无此字段语义相同）
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    rounds: [{ no: 1, mode: null, staff: null, by: null, dispatchedAt: null, answeredAt: null, error: null, attachments: saved }],
    dispatches: [],
    history: [{ at: now, from: null, to: 'pending', by, note: '创建咨询单' }],
  };
  writeTicketMeta(dataDir, meta);
  return meta;
}

export function getTicket(dataDir, id) {
  return readTicketMeta(dataDir, id);
}

// 卡片视图字段（列表/看板用，不含全文）
function ticketCard(meta) {
  const last = meta.rounds[meta.rounds.length - 1] || null;
  return {
    id: meta.id,
    title: meta.title,
    reqId: meta.reqId || null, // REQ-20260908-022：卡片带归属需求
    status: meta.status,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    roundCount: meta.rounds.length,
    lastMode: last ? last.mode : null,
    lastStaff: last ? last.staff : null,
    lastDispatchedAt: last ? last.dispatchedAt : null,
    lastAnsweredAt: last ? last.answeredAt : null,
    lastError: meta.status === 'failed' && last ? last.error : null,
    attachments: [...new Set(meta.rounds.flatMap((r) => r.attachments || []))],
  };
}

export function listTickets(dataDir, { status = null, reqId = null } = {}) {
  ensureOncall(dataDir);
  const dir = ticketsDir(dataDir);
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/^ASK-\d{8}-\d{3}$/.test(name)) continue;
    const meta = readJson(path.join(dir, name, 'ticket.json'));
    if (meta && meta.id === name) out.push(meta);
  }
  out.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id));
  let cards = out.map(ticketCard);
  // REQ-20260908-022：按归属需求过滤（不校验存在性，无匹配即空——需求删除后过滤自然为空）
  if (reqId) cards = cards.filter((x) => x.reqId === reqId);
  if (!status) return cards;
  if (!ONCALL_STATUS.includes(status)) throw new AtbError(`非法状态：${status}（合法值：${ONCALL_STATUS.join(' | ')}）`);
  return cards.filter((x) => x.status === status);
}

// 全文视图：元数据 + 各轮问题/回答内容（详情页与 oncall show 用）；
// REQ-20260908-022：绑定需求的单附带 req（元信息 + 文档全文上下文），未绑定为 null
export function readTicketFull(dataDir, id) {
  const meta = readTicketMeta(dataDir, id);
  const dir = ticketDir(dataDir, id);
  const rounds = meta.rounds.map((r) => {
    const qFile = roundQuestionFile(dir, r.no);
    const aFile = roundAnswerFile(dir, r.no);
    let question = null;
    let answer = null;
    try { question = fs.readFileSync(qFile, 'utf8'); } catch {}
    try { answer = fs.readFileSync(aFile, 'utf8'); } catch {}
    return { ...r, question, answer };
  });
  const reqId = meta.reqId || null;
  return {
    ...ticketCard(meta),
    createdAt: meta.createdAt,
    dispatches: meta.dispatches,
    history: meta.history,
    rounds,
    req: reqId ? reqContext(dataDir, reqId) : null,
  };
}

export function askTicket(dataDir, id, { question, attachments = [], by = 'board' }) {
  const meta = readTicketMeta(dataDir, id);
  question = String(question == null ? '' : question);
  if (!question.trim()) throw new AtbError('追问正文不能为空');
  const dir = ticketDir(dataDir, id);
  const no = meta.rounds.length + 1;
  fs.mkdirSync(path.join(dir, 'rounds', String(no)), { recursive: true });
  fs.writeFileSync(roundQuestionFile(dir, no), question);
  const saved = [];
  for (const att of attachments || []) {
    let buf;
    if (typeof att.dataBase64 === 'string') buf = Buffer.from(att.dataBase64, 'base64');
    else if (Buffer.isBuffer(att.data)) buf = att.data;
    else throw new AtbError(`附件 ${att && att.name} 缺少数据（dataBase64）`);
    saved.push(saveAttachment(dataDir, id, att.name, buf));
  }
  meta.rounds.push({ no, mode: null, staff: null, by: null, dispatchedAt: null, answeredAt: null, error: null, attachments: saved });
  const from = meta.status;
  meta.status = 'pending';
  pushHistory(meta, from, 'pending', by, `第 ${no} 轮追问`);
  writeTicketMeta(dataDir, meta);
  return meta;
}

// 派单（批量/单条共用）：把待回复单转回复中，写轮次派单信息与派单账本；
// zcode 模式返回主调度提示词（人复制到 Zcode 新会话），codex 模式由服务端入队执行。
export function dispatchTickets(dataDir, { ids, mode, staff = '', by = 'board', kind = 'batch' }) {
  if (mode !== 'zcode' && mode !== 'codex') throw new AtbError(`派单模式必须是 zcode 或 codex（得到：${mode}）`);
  if (!Array.isArray(ids) || !ids.length) throw new AtbError('ids 必须是非空编号数组');
  const staffNorm = normalizeStaff(staff);
  const metas = ids.map((id) => {
    const meta = readTicketMeta(dataDir, id);
    if (meta.status !== 'pending') {
      throw new AtbError(`${id} 当前状态 ${meta.status}，仅「待回复」可派单（追问后回待回复；失败单请用重派）`);
    }
    return meta;
  });
  const now = nowIso();
  for (const meta of metas) {
    const round = meta.rounds[meta.rounds.length - 1];
    round.mode = mode;
    round.staff = staffNorm;
    round.dispatchedAt = now;
    round.error = null;
    const from = meta.status;
    meta.status = 'answering';
    pushHistory(meta, from, 'answering', by, `派单（${mode}${staffNorm ? ` · 客服 ${staffNorm}` : ''}）`);
    writeTicketMeta(dataDir, meta);
  }
  // 派单账本（zcode/codex 一致记录客服人员；未填为 null，展示「未指定」）
  const ledger = readDispatchLedger(dataDir);
  ledger.records.push({ at: now, mode, staff: staffNorm, ids: [...ids], kind, by });
  writeDispatchLedger(dataDir, ledger);
  const out = { dispatched: [...ids], mode, staff: staffNorm, at: now };
  if (mode === 'zcode') {
    out.prompt = buildOncallPrompt({ projectRoot: projectRootOf(dataDir), ids: [...ids], staff: staffNorm, atbPath: atbPathOf() });
  }
  return out;
}

// 失败重派：failed 单按新模式重派（回答轮次沿用当前未答轮）
export function redispatchTicket(dataDir, id, { mode, staff = '', by = 'board' }) {
  if (mode !== 'zcode' && mode !== 'codex') throw new AtbError(`派单模式必须是 zcode 或 codex（得到：${mode}）`);
  const staffNorm = normalizeStaff(staff);
  const meta = readTicketMeta(dataDir, id);
  if (meta.status !== 'failed') throw new AtbError(`${id} 当前状态 ${meta.status}，仅失败单可重派`);
  const now = nowIso();
  const round = meta.rounds[meta.rounds.length - 1];
  round.mode = mode;
  round.staff = staffNorm;
  round.dispatchedAt = now;
  round.error = null;
  meta.status = 'answering';
  pushHistory(meta, 'failed', 'answering', by, `重派（${mode}${staffNorm ? ` · 客服 ${staffNorm}` : ''}）`);
  writeTicketMeta(dataDir, meta);
  const ledger = readDispatchLedger(dataDir);
  ledger.records.push({ at: now, mode, staff: staffNorm, ids: [id], kind: 'redispatch', by });
  writeDispatchLedger(dataDir, ledger);
  const out = { dispatched: [id], mode, staff: staffNorm, at: now };
  if (mode === 'zcode') {
    out.prompt = buildOncallPrompt({ projectRoot: projectRootOf(dataDir), ids: [id], staff: staffNorm, atbPath: atbPathOf() });
  }
  return out;
}

// 回答回传（受控入口，zcode 子 Agent / codex 服务自动回传共用）：
// 落 rounds/N/answer.md，转已回复。最新轮未 answered 即可回传：
// answering（派单后回传）/failed（失败单收到有效回答即转已回复）/pending（未派单直接补录）。
export function answerTicket(dataDir, id, { answer, by, mode = 'zcode', staff = '' }) {
  const meta = readTicketMeta(dataDir, id);
  const pendingRound = meta.rounds[meta.rounds.length - 1];
  if (pendingRound.answeredAt) {
    throw new AtbError(`${id} 最新轮（第 ${pendingRound.no} 轮）已回复；如需继续请先追问（oncall ask）`);
  }
  answer = String(answer == null ? '' : answer);
  if (!answer.trim()) throw new AtbError('回答内容不能为空');
  const round = meta.rounds[meta.rounds.length - 1];
  const dir = ticketDir(dataDir, id);
  fs.mkdirSync(path.join(dir, 'rounds', String(round.no)), { recursive: true });
  fs.writeFileSync(roundAnswerFile(dir, round.no), answer);
  const now = nowIso();
  round.answeredAt = now;
  round.by = by || round.by || 'oncall';
  if (mode === 'zcode' || mode === 'codex') round.mode = round.mode || mode;
  const staffNorm = normalizeStaff(staff);
  if (staffNorm) round.staff = staffNorm;
  const from = meta.status;
  meta.status = 'answered';
  pushHistory(meta, from, 'answered', by || 'oncall', `第 ${round.no} 轮回答回传（${round.mode || mode}）`);
  writeTicketMeta(dataDir, meta);
  return meta;
}

// 失败落账：回复中 → 失败，原因记在当前轮（详情页展示原因与重派入口）
export function failRound(dataDir, id, { error, by = 'server' }) {
  const meta = readTicketMeta(dataDir, id);
  if (meta.status !== 'answering') {
    throw new AtbError(`${id} 当前状态 ${meta.status}，仅回复中可记失败`);
  }
  const round = meta.rounds[meta.rounds.length - 1];
  round.error = String(error || '未知原因').slice(0, 800);
  const from = meta.status;
  meta.status = 'failed';
  pushHistory(meta, from, 'failed', by, `执行失败：${round.error.slice(0, 120)}`);
  writeTicketMeta(dataDir, meta);
  return meta;
}

// ---------- 派单账本 ----------

function dispatchLedgerPath(dataDir) {
  return path.join(oncallDir(dataDir), 'dispatches.json');
}

function readDispatchLedger(dataDir) {
  ensureOncall(dataDir);
  const saved = readJson(dispatchLedgerPath(dataDir));
  return saved && Array.isArray(saved.records) ? saved : { version: 1, records: [] };
}

function writeDispatchLedger(dataDir, ledger) {
  writeJsonAtomic(dispatchLedgerPath(dataDir), ledger);
}

export function listDispatches(dataDir) {
  return [...readDispatchLedger(dataDir).records].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// ---------- 提示词 ----------

// atb CLI 与项目根定位（提示词内命令用绝对路径；插件根 = 本文件 ../..）
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB_PATH = path.join(pluginRoot, 'scripts', 'atb.mjs');
const atbPathOf = () => ATB_PATH;
const projectRootOf = (dataDir) => path.resolve(dataDir, '..', '..');

export function oncallSessionName({ staff = null, date = null } = {}) {
  const stamp = date || localDateStamp();
  return `oncall-${stamp}-${staff || '未指定'}`;
}

// zcode 主调度提示词（复制到 Zcode 本项目新会话；参考批次实施主调度模式）
export function buildOncallPrompt({ projectRoot, ids, staff = null, atbPath = ATB_PATH }) {
  const session = oncallSessionName({ staff });
  return [
    '你是当前项目的 Oncall 咨询调度员，只负责派发与接收短回执。',
    `项目：${projectRoot}`,
    `客服人员：${staff || '未指定'}`,
    `咨询单（共 ${ids.length} 单）：${ids.join(' ')}`,
    '',
    '每轮新启动一个 general-purpose 子 Agent，回答一个咨询单，经受控入口回传后继续下一单。',
    '同一时间只运行一个；不要让子 Agent 再派发子 Agent。',
    '只传项目路径、单号与入口命令，不复制本会话的历史问答。',
    '',
    '子 Agent 流程（每单一个）：',
    // REQ-20260908-022：绑定需求的讨论单，读单输出自动附带该需求 README/design/test-cases 全文与状态元信息
    `1. 读单：node ${JSON.stringify(atbPath)} oncall show <ASK-ID> --dir ${JSON.stringify(projectRoot)}（含问题正文、截图附件路径与历轮问答；绑定需求的单自动附带该需求文档全文上下文）`,
    '2. 只读回答：可读项目代码与文档分析问题；不要修改代码、不执行 git commit、不改看板 REQ/BUG 状态；',
    '   若结论涉及改代码，请在回答中建议另建需求（/req）。',
    `3. 回传：把完整 Markdown 回答写入临时文件后执行 node ${JSON.stringify(atbPath)} oncall answer <ASK-ID> --by ${JSON.stringify(session)} --mode zcode --file <回答文件> --dir ${JSON.stringify(projectRoot)}`,
    '',
    `会话命名：请将当前会话名改为：${session}。`,
    '回答按单落位不串单；全部单已回传后输出简短清单并结束，不代替人工处理 REQ/BUG。',
  ].join('\n');
}

// codex 单单提示词：把问题全文与历轮问答放进上下文，要求把完整回答作为最终回复输出
// （服务在执行结束后把 final-message.md 自动回传看板，无需会话内调用 CLI）。
export function buildOncallWorkerPrompt(dataDir, id) {
  const full = readTicketFull(dataDir, id);
  const dir = ticketDir(dataDir, id);
  const lines = [
    `请将当前会话名改为 ${id}。`,
    `你是本项目的 Oncall 咨询回答者，处理咨询单 ${id}：${full.title}`,
    `项目根：${projectRootOf(dataDir)}（codex 已以 -C 指定工作目录，请勿切换目录）。`,
    '',
  ];
  // REQ-20260908-022：绑定需求的讨论自动注入需求文档上下文（每次派单实时读盘，基于最新落盘文档回答）
  if (full.req) {
    lines.push(reqContextHead(full.req));
    if (!full.req.missing && full.req.docs.length) {
      lines.push('需求文档全文（回答须基于以下最新落盘文档，无需人工粘贴）：');
      for (const d of full.req.docs) lines.push(`【${d.name}】`, String(d.content).trim(), '');
    } else {
      lines.push('（归属需求目录已删除或文档缺失，无上下文可注入，按问题本身回答）', '');
    }
  }
  if (full.rounds.length > 1) {
    lines.push('历轮问答：');
    for (const r of full.rounds.slice(0, -1)) {
      lines.push(`【第 ${r.no} 轮问题】`, String(r.question || '').trim(), '', `【第 ${r.no} 轮回答】`, String(r.answer || '（未回答）').trim(), '');
    }
  }
  const cur = full.rounds[full.rounds.length - 1];
  lines.push(`当前待答问题（第 ${cur.no} 轮）：`, String(cur.question || '').trim());
  if ((cur.attachments || []).length) {
    lines.push('', `（问题附带 ${cur.attachments.length} 张截图，位于 ${dir}/attachments/ 下：${cur.attachments.join('、')}，可按需读取查看）`);
  }
  lines.push(
    '',
    '要求：只读回答——可读项目代码与文档分析问题；不要修改代码、不执行 git commit、不改看板状态；',
    '若结论涉及改代码，建议另建需求（/req）。',
    '请把对问题的完整回答以 Markdown 格式作为最终回复直接输出（服务会把最终回复自动回传看板）。',
  );
  return lines.join('\n');
}

// ---------- codex 派发执行账本（oncall/runs；不占 impl.lock，与实施账本隔离） ----------

function newOncallRunId() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `run-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${crypto.randomBytes(2).toString('hex')}`;
}

const ONCALL_RUN_PHASES = ['queued', 'running', 'answered', 'failed', 'skipped'];

export function newOncallRun(dataDir, { ticketId, roundNo, projectRoot, prompt, staff = null, by = null, config = {} }) {
  ensureOncall(dataDir);
  const { seq } = nextOncallCounter(dataDir, 'run');
  const runId = newOncallRunId();
  const now = nowIso();
  const run = {
    version: 1,
    runId,
    seq,
    ticketId,
    roundNo,
    mode: 'codex',
    staff,
    by,
    phase: 'queued',
    projectRoot,
    prompt: String(prompt || ''),
    timeoutMin: config.timeoutMin ?? 60,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    endedAt: null,
    threadId: null,
    attempts: [],
    result: null,
  };
  const dir = oncallRunDir(dataDir, runId);
  fs.mkdirSync(dir, { recursive: true });
  writeJsonAtomic(path.join(dir, 'run.json'), run);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'stderr.log'), '');
  fs.writeFileSync(path.join(dir, 'prompt.md'), run.prompt);
  return run;
}

export function getOncallRun(dataDir, runId) {
  const run = readJson(path.join(oncallRunDir(dataDir, runId), 'run.json'));
  if (!run || run.runId !== runId) throw new AtbError(`找不到 oncall 执行记录：${runId}`);
  return run;
}

export function updateOncallRun(dataDir, runId, patch) {
  const cur = getOncallRun(dataDir, runId);
  if (patch.phase && !ONCALL_RUN_PHASES.includes(patch.phase)) {
    throw new AtbError(`非法 oncall 执行阶段：${patch.phase}（合法值：${ONCALL_RUN_PHASES.join(' | ')}）`);
  }
  const next = { ...cur, ...patch, runId, updatedAt: nowIso() };
  writeJsonAtomic(path.join(oncallRunDir(dataDir, runId), 'run.json'), next);
  return next;
}

export function listOncallRuns(dataDir) {
  ensureOncall(dataDir);
  const dir = oncallRunsDir(dataDir);
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const r = readJson(path.join(dir, name, 'run.json'));
    if (r && r.runId) out.push(r);
  }
  out.sort((a, b) => (b.seq || 0) - (a.seq || 0));
  return out;
}

export function appendOncallEvent(dataDir, runId, event) {
  fs.appendFileSync(path.join(oncallRunDir(dataDir, runId), 'events.jsonl'), JSON.stringify(event) + '\n');
}

export function appendOncallStderr(dataDir, runId, chunk) {
  fs.appendFileSync(path.join(oncallRunDir(dataDir, runId), 'stderr.log'), chunk);
}

export function readOncallFinalMessage(dataDir, runId) {
  try {
    return fs.readFileSync(path.join(oncallRunDir(dataDir, runId), 'final-message.md'), 'utf8');
  } catch {
    return '';
  }
}

// ========== 开放式讨论（REQ-20260909-004）：Agent 外部会话讨论 + 看板沉淀成果 ==========
// 沿用 oncall/tickets/ASK-… 目录与 ticket.json，新增讨论语义：
//   两态状态 discussing | archived（旧执行状态读时归一为 discussing，不改写旧记录）
//   question.md = 讨论背景；成果落盘协议三件套在单目录根：
//   minutes.md（纪要）、candidates.json（候选草稿）、PUBLISH.json（发布标记，最后写）
// 讨论不绑定需求（reqId 恒 null）；旧单 reqId 字段保留只读兼容。

export const DISCUSSION_STATUS = ['discussing', 'archived'];

const DISC_MINUTES_FILE = 'minutes.md';
const DISC_CANDIDATES_FILE = 'candidates.json';
const DISC_PUBLISH_FILE = 'PUBLISH.json';
// REQ-20260910-018 逐轮记录与纪要版本：rounds/r0001.json 一轮一文件（与旧单 rounds/<N>/ 子目录
// 共存互不影响——旧子目录名不匹配 rNNNN.json）；minutes.meta.json 为纪要乐观版本。
const DISC_ROUNDS_DIR = 'rounds';
const DISC_MINUTES_META_FILE = 'minutes.meta.json';
const DISC_ROUND_FILE_RE = /^r\d{4}\.json$/;

// 两态归一：archived 为已归档，其余（含旧 pending/answering/answered/failed）一律讨论中
export function discussionStatusOf(meta) {
  return meta && meta.status === 'archived' ? 'archived' : 'discussing';
}

// 创建开放式讨论：标题必填 ≤120、背景可选（空背景允许，question.md 允许为空串）。
// REQ-20260910-028：创建时支持截图附件（与需求 / Bug 口径一致）——attachments = [{ name, dataBase64 }]，
// 先全量校验（core.parseItemAttachments：张数 ≤9 / 白名单 / 单张 ≤8MB / 数据形态）再占号落盘，
// 任一非法整单拒绝不留半成品；附件落 <讨论目录>/attachments/（复用讨论单既有口径），最终文件名记
// ticket.json 顶层 attachments 字段（仅新讨论写；旧单轮次附件仍在 rounds[].attachments 不受影响）；
// question.md（背景）末尾按添加顺序追加 ![截图](attachments/…) 引用行（对齐 createItem README 口径）。
export function createDiscussion(dataDir, { title, background = '', by = 'board', attachments = [] }) {
  ensureOncall(dataDir);
  title = String(title || '').trim();
  if (!title) throw new AtbError('标题不能为空');
  if ([...title].length > TITLE_MAX_CHARS) throw new AtbError(`标题过长（不超过 ${TITLE_MAX_CHARS} 字）`);
  background = String(background == null ? '' : background);
  const atts = parseItemAttachments(attachments); // 先全量校验再占号（不合规不消耗单号）
  const id = nextAskId(dataDir);
  const dir = ticketDir(dataDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const saved = atts.map((a) => saveAttachment(dataDir, id, a.name, a.buf));
  const backgroundBody = saved.length
    ? (background.trim()
        ? `${background.trim()}\n\n${saved.map((n) => `![截图](attachments/${encodeURIComponent(n)})`).join('\n')}`
        : saved.map((n) => `![截图](attachments/${encodeURIComponent(n)})`).join('\n'))
    : background;
  fs.writeFileSync(path.join(dir, 'question.md'), backgroundBody);
  const now = nowIso();
  const meta = {
    version: 1,
    id,
    title,
    reqId: null, // 开放式讨论不绑定需求（旧单的 reqId 保留展示）
    status: 'discussing',
    createdAt: now,
    updatedAt: now,
    finishPromptAt: null, // 收尾提示词首见时间（幂等；仅阶段反馈）
    publishedAt: null,    // 首次合法读到发布成果的时间
    created: {},          // draftId → { itemId, type, title, at }（防重复创建）
    rounds: [],           // 新讨论无轮次；旧单旧轮问答保留展示
    ...(saved.length ? { attachments: saved } : {}), // REQ-20260910-028：创建时随单保存的截图清单
    history: [{ at: now, by: by || 'board', note: '创建开放式讨论' }],
  };
  writeTicketMeta(dataDir, meta);
  return meta;
}

// ---------- 成果读取（发布协议：只认 PUBLISH.json，拒绝半成品） ----------

function discFilePath(dataDir, id, name) {
  return path.join(ticketDir(dataDir, id), name);
}

// 候选草稿结构校验：绑定编号、items 数组、逐条 id/type/title（失败返回可读原因）
function validateCandidates(raw, id) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return `候选草稿 ${DISC_CANDIDATES_FILE} 不是合法 JSON 对象`;
  if (String(raw.discussionId || '') !== id) return `候选草稿绑定编号不符（discussionId 应为 ${id}），已拒绝读取为当前成果`;
  if (!Array.isArray(raw.items)) return `候选草稿缺少 items 数组`;
  const seen = new Set();
  for (const it of raw.items) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return '候选条目不是合法对象';
    const cid = String(it.id || '').trim();
    if (!cid) return '候选条目缺少 id';
    if (seen.has(cid)) return `候选条目存在重复 id：${cid}`;
    seen.add(cid);
    if (it.type !== 'requirement' && it.type !== 'bug') return `候选条目 ${cid} 的 type 必须是 requirement 或 bug（得到：${it.type}）`;
    const title = String(it.title || '').trim();
    if (!title) return `候选条目 ${cid} 缺少标题`;
    if ([...title].length > TITLE_MAX_CHARS) return `候选条目 ${cid} 标题过长（不超过 ${TITLE_MAX_CHARS} 字）`;
  }
  return null;
}

function normalizeCandidates(raw) {
  const items = (raw.items || []).map((it) => ({
    id: String(it.id || '').trim(),
    type: it.type,
    title: String(it.title || '').trim(),
    description: String(it.description ?? ''),
    repro: String(it.repro ?? ''),
    actual: String(it.actual ?? ''),
    expected: String(it.expected ?? ''),
    acceptance: String(it.acceptance ?? ''),
  }));
  return { discussionId: String(raw.discussionId || ''), items };
}

// 读取讨论成果：waiting（未发布，含半成品）/ error（发布但不成套或非法，带原因）/ published。
// published 首次读到时把 publishedAt 回写 ticket.json（幂等，后续沿用首见时间）。
export function readOutcome(dataDir, id) {
  const meta = readTicketMeta(dataDir, id);
  const out = { state: 'waiting', reason: null, minutes: null, candidates: null, publishedAt: meta.publishedAt || null };
  if (!fs.existsSync(discFilePath(dataDir, id, DISC_PUBLISH_FILE))) return out;

  const marker = readJson(discFilePath(dataDir, id, DISC_PUBLISH_FILE)) || {};
  if (String(marker.discussionId || '') !== id) {
    out.state = 'error';
    out.reason = `发布标记与当前讨论不匹配（应为 ${id}），已拒绝读取为当前成果`;
    return out;
  }
  let minutes = null;
  try {
    minutes = fs.readFileSync(discFilePath(dataDir, id, DISC_MINUTES_FILE), 'utf8');
  } catch { /* below */ }
  if (minutes == null || !minutes.trim()) {
    out.state = 'error';
    out.reason = `已发布但缺少纪要（${discFilePath(dataDir, id, DISC_MINUTES_FILE)}）`;
    return out;
  }
  const raw = readJson(discFilePath(dataDir, id, DISC_CANDIDATES_FILE));
  if (raw == null) {
    out.state = 'error';
    out.reason = `已发布但缺少候选草稿或草稿 JSON 非法（${discFilePath(dataDir, id, DISC_CANDIDATES_FILE)}）`;
    return out;
  }
  const invalid = validateCandidates(raw, id);
  if (invalid) {
    out.state = 'error';
    out.reason = invalid;
    return out;
  }
  out.state = 'published';
  out.minutes = minutes;
  out.candidates = normalizeCandidates(raw);
  if (!meta.publishedAt) {
    out.publishedAt = nowIso();
    meta.publishedAt = out.publishedAt;
    pushHistory(meta, 'board', '成果已发布并读取');
    writeTicketMeta(dataDir, meta);
  }
  return out;
}

// ---------- 列表卡片（两态 + 阶段提示） ----------

// 阶段（非状态）：recording 逐轮记录中（REQ-20260910-018）| waiting 等待纪要（旧收尾口径）|
// ready 纪要已生成（含零候选）| drafts 有待创建草稿 | error 读取失败 | none 外部会话中 | archived 已归档
function discussionPhase(meta, outcome, savedRounds = 0) {
  const st = discussionStatusOf(meta);
  if (st === 'archived') return 'archived';
  if (outcome.state === 'error') return 'error';
  if (outcome.state === 'published') {
    const total = outcome.candidates.items.length;
    const created = Object.keys(meta.created || {}).length;
    return created < total ? 'drafts' : 'ready';
  }
  if (savedRounds > 0) return 'recording';
  return meta.finishPromptAt ? 'waiting' : 'none';
}

// 卡片公共字段（REQ-20260910-018：逐轮记录数 / 最近轮时间 / 最新回复摘要 / 纪要待更新；
// 旧问答计数迁移 legacyRoundCount 只读保留，不冒充逐轮记录）
function discussionCard(dataDir, meta) {
  let outcome;
  try {
    outcome = readOutcome(dataDir, meta.id);
  } catch {
    outcome = { state: 'error', reason: '成果读取失败（讨论目录可能被移动或删除）', minutes: null, candidates: { items: [] }, publishedAt: null };
  }
  let rounds = [];
  let minutes = { content: null, version: 0, updatedAt: null };
  try {
    rounds = listDiscussionRounds(dataDir, meta.id);
    minutes = readDiscussionMinutes(dataDir, meta.id);
  } catch { /* 读侧容错：按零轮处理 */ }
  const lastRound = rounds.length ? rounds[rounds.length - 1] : null;
  const created = meta.created || {};
  return {
    id: meta.id,
    title: meta.title,
    reqId: meta.reqId || null,
    status: discussionStatusOf(meta),
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    roundCount: rounds.length,
    legacyRoundCount: (meta.rounds || []).length,
    lastRoundAt: lastRound ? lastRound.at : null,
    lastSummary: lastRound ? lastRound.summary : null,
    minutesStale: !!(lastRound && (!minutes.updatedAt || String(minutes.updatedAt) < String(lastRound.at))),
    finishPromptAt: meta.finishPromptAt || null,
    publishedAt: outcome.publishedAt,
    phase: discussionPhase(meta, outcome, rounds.length),
    waiting: !meta.finishPromptAt ? false : outcome.state === 'waiting',
    lastError: outcome.state === 'error' ? outcome.reason : null,
    draftCount: outcome.state === 'published' ? outcome.candidates.items.length : 0,
    createdCount: Object.keys(created).length,
  };
}

export function listDiscussions(dataDir, { status = null } = {}) {
  ensureOncall(dataDir);
  const dir = ticketsDir(dataDir);
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/^ASK-\d{8}-\d{3}$/.test(name)) continue;
    const meta = readJson(path.join(dir, name, 'ticket.json'));
    if (meta && meta.id === name) out.push(meta);
  }
  if (status) {
    if (!DISCUSSION_STATUS.includes(status)) {
      throw new AtbError(`非法状态：${status}（合法值：${DISCUSSION_STATUS.join(' | ')}）`);
    }
  }
  const filtered = status ? out.filter((meta) => discussionStatusOf(meta) === status) : out;
  return filtered
    .map((meta) => discussionCard(dataDir, meta))
    .sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) ||
      String(b.id || '').localeCompare(String(a.id || '')));
}

// ---------- 提示词（服务端拼装；复制只代表已生成，不代表 Agent 已连接） ----------

export function buildStartPrompt(dataDir, id) {
  const meta = readTicketMeta(dataDir, id);
  const dir = ticketDir(dataDir, id);
  const atb = JSON.stringify(ATB_PATH);
  const projectRoot = JSON.stringify(projectRootOf(dataDir));
  const background = String(meta.background == null ? readQuestionSafe(dataDir, id) : meta.background).trim();
  return [
    `你是本项目的开放式讨论参与者。请与我围绕主题自由讨论，讨论编号 ${meta.id}（${meta.title}）。`,
    `项目根：${projectRootOf(dataDir)}`,
    '',
    '讨论背景：',
    background || '（未填写背景）',
    // REQ-20260910-028：创建时随单保存的截图给绝对路径提示（对齐 buildOncallWorkerPrompt 口径）
    ...((meta.attachments || []).length
      ? ['', `（讨论背景附 ${meta.attachments.length} 张截图，位于 ${path.join(dir, 'attachments')} 下：${meta.attachments.join('、')}，可按需读取查看）`]
      : []),
    '',
    '开始前（上下文读取）：',
    `- 先校验项目与讨论归属并恢复上下文：node ${atb} disc show ${meta.id} --dir ${projectRoot}`,
    '- 已有纪要或轮次时先读纪要与近期轮次，按需再追溯更早原文；新会话不要仅凭聊天记忆接续。',
    '',
    '讨论约定：',
    '- 讨论不强制绑定需求或说明文档，可读项目代码与文档辅助判断；',
    '- 讨论期间不修改代码、不创建或修改需求/Bug 条目、不改变看板状态；',
    '- 区分「已确认共识」「模型建议与取舍」「未决问题」，不要把未确认的建议写成共识。',
    '',
    '逐轮保存约定（每轮必须执行，无需等待任何收尾指令）：',
    '- 一轮 = 一次用户输入（问题/补充/纠正/确认均算一轮）+ 你的完整回复；工具调用与进度播报不单独计轮；',
    `- 每轮回复完成后立即保存：把 {"user":"<用户原文>","summary":"<回复总结>","session":"<来源会话标识>","key":"<本轮唯一幂等键>"} 写入临时 JSON 文件，执行 node ${atb} disc round ${meta.id} --file <该文件> --dir ${projectRoot}`,
    '- 回复总结须忠实覆盖：关键观点、理由、取舍与未决问题；用户原文原样保存，不保存内部推理；',
    '- 命令输出「已保存第 N 轮」才算保存成功，此时才向用户确认已记录；失败时明确说明本轮未保存及原因，修复后用同一 key 重试（不会产生重复轮次）；',
    `- 轮次记录（只追加，不覆盖旧轮）：${path.join(dir, DISC_ROUNDS_DIR)}`,
    '',
    '纪要维护（每轮检查，按需更新）：',
    `- 当前纪要与版本：${path.join(dir, DISC_MINUTES_FILE)}（版本号见 minutes.meta.json 的 minutesVersion，或 node ${atb} disc show ${meta.id} --dir ${projectRoot}）`,
    `- 需要更新时整理新纪要写入临时 md 文件，执行 node ${atb} disc minutes ${meta.id} --file <纪要文件> --base-version <当前版本> --dir ${projectRoot}`,
    '- 分节：讨论背景 / 已确认共识 / 建议与取舍 / 未决问题 / 后续行动，逐条注明支撑轮次（如 R0003）；',
    '- 版本冲突（他人已更新）时命令会报错：重新读取最新纪要与全部轮次后再整理；纪要更新失败不影响已保存的轮次。',
  ].join('\n');
}

function readQuestionSafe(dataDir, id) {
  try {
    return fs.readFileSync(path.join(ticketDir(dataDir, id), 'question.md'), 'utf8');
  } catch {
    return '';
  }
}

export function buildFinishPrompt(dataDir, id) {
  const meta = readTicketMeta(dataDir, id);
  const dir = ticketDir(dataDir, id);
  return [
    `请收尾讨论 ${meta.id}（${meta.title}），在当前会话内按顺序完成：`,
    '',
    `1. 完整落盘纪要到 ${path.join(dir, DISC_MINUTES_FILE)}，Markdown 分节：讨论背景 / 共识 / 建议与取舍 / 未决问题 / 后续行动。`,
    `2. 完整落盘候选草稿到 ${path.join(dir, DISC_CANDIDATES_FILE)}，JSON 结构：`,
    '{',
    `  "discussionId": "${meta.id}",`,
    '  "items": [',
    '    { "id": "c1", "type": "requirement" 或 "bug", "title": "标题",',
    '      "description": "需求描述 / Bug 现象",',
    '      "repro": "Bug 复现步骤（bug 适用）", "actual": "Bug 实际结果（bug 适用）", "expected": "Bug 预期结果（bug 适用）",',
    '      "acceptance": "验收标准" }',
    '  ]',
    '}',
    '只有讨论明确支撑的结论才进入 items；可以只有结论不生成条目（items 为空数组）；不自动创建或接受条目。',
    `3. 最后写发布标记 ${path.join(dir, DISC_PUBLISH_FILE)}：{ "discussionId": "${meta.id}", "publishedAt": "<ISO 时间>" }。`,
    '',
    '看板只认发布标记与成套文件；不要直接修改需求/Bug 条目、不要改变看板状态。',
  ].join('\n');
}

// 继续讨论提示词（REQ-20260910-018）：任意能访问本项目文档的新会话接续同一讨论——
// 先读文档恢复上下文（不依赖聊天记忆），轮次编号接续、来源会话标记切换、不串讨论。
export function buildContinuePrompt(dataDir, id) {
  const meta = readTicketMeta(dataDir, id);
  const dir = ticketDir(dataDir, id);
  const atb = JSON.stringify(ATB_PATH);
  const projectRoot = JSON.stringify(projectRootOf(dataDir));
  return [
    `继续讨论 ${meta.id}（${meta.title}）——你将在新会话中接续同一讨论，先读项目文档恢复上下文。`,
    `项目根：${projectRootOf(dataDir)}`,
    '',
    '接续步骤：',
    `1. 校验项目与讨论归属并恢复上下文：node ${atb} disc show ${meta.id} --dir ${projectRoot}（含背景、纪要与全部已保存轮次）；`,
    '   讨论过长时先读纪要与近期轮次，按需再追溯更早原文；不要仅凭聊天记忆接续。',
    `2. 与我继续交流，每轮按逐轮保存约定执行：把 {"user":"<用户原文>","summary":"<回复总结>","session":"<当前会话标识>","key":"<本轮唯一幂等键>"} 写入临时 JSON 文件，执行 node ${atb} disc round ${meta.id} --file <该文件> --dir ${projectRoot}`,
    '   轮次编号自动接续（新轮追加，不覆盖旧轮）；session 请改用当前会话名，不要沿用旧会话标识；',
    '   保存成功（命令输出已保存第 N 轮）才向用户确认；失败明确说明未保存及原因，同 key 重试不产生重复轮次。',
    `3. 纪要按需更新：先读当前版本，再执行 node ${atb} disc minutes ${meta.id} --file <纪要临时文件> --base-version <当前版本> --dir ${projectRoot}`,
    '   结论变化在纪要中注明变更依据与支撑轮次，保留旧轮次不回改；区分已确认共识 / 建议与取舍 / 未决问题。',
    '',
    '文档位置：',
    `- 轮次记录（只追加）：${path.join(dir, DISC_ROUNDS_DIR)}`,
    `- 纪要：${path.join(dir, DISC_MINUTES_FILE)}`,
    '',
    '约束：只写入本讨论目录，不串其他项目或讨论；不修改代码、不创建或修改需求/Bug 条目、不改变看板状态。',
  ].join('\n');
}

// 整理结论提示词（REQ-20260910-018，替代原「讨论完毕」定位）：重新汇总已保存轮次重整纪要 +
// 可选候选草稿（沿用发布协议）；整理不终止讨论、不自动创建条目、不是交流保存的前提。
export function buildOrganizePrompt(dataDir, id) {
  const meta = readTicketMeta(dataDir, id);
  const dir = ticketDir(dataDir, id);
  const atb = JSON.stringify(ATB_PATH);
  const projectRoot = JSON.stringify(projectRootOf(dataDir));
  return [
    `请整理讨论结论 ${meta.id}（${meta.title}）。讨论不因此终止，交流记录已逐轮保存，本提示词只重整纪要与可选候选草稿：`,
    '',
    `1. 重读已保存轮次与当前纪要版本：node ${atb} disc show ${meta.id} --dir ${projectRoot}（或直接读 ${path.join(dir, DISC_ROUNDS_DIR)} 与 ${path.join(dir, DISC_MINUTES_FILE)}）。`,
    `2. 从逐轮记录重新汇总纪要（不遗漏已确认共识、建议与取舍、未决问题、后续行动，逐条注明支撑轮次），写入临时 md 文件后经统一入口更新：node ${atb} disc minutes ${meta.id} --file <纪要文件> --base-version <当前版本> --dir ${projectRoot}`,
    '   版本冲突（他人已更新）时重新读取最新纪要与轮次后再整理；不把未确认的建议写成共识。',
    '3. 若讨论明确支撑后续行动，可落盘候选需求/Bug 草稿并发布（看板「后续行动」页签展示，仍需用户勾选创建）：',
    `   - 候选草稿 ${path.join(dir, DISC_CANDIDATES_FILE)}：JSON 结构 {"discussionId":"${meta.id}","items":[{"id":"c1","type":"requirement" 或 "bug","title":"…","description":"…","repro/actual/expected（bug 适用）":"…","acceptance":"…"}]}；`,
    `   - 发布标记（最后写）${path.join(dir, DISC_PUBLISH_FILE)}：{"discussionId":"${meta.id}","publishedAt":"<ISO 时间>"}；`,
    '   只有讨论明确支撑的结论才进入 items；可以只有结论不生成条目（items 为空数组）；不自动创建或接受条目。',
    '4. 整理结论不终止讨论，也不是交流保存的前提；之后仍可继续逐轮交流与更新纪要。',
  ].join('\n');
}

// 讨论完毕（兼容保留，REQ-20260910-018 起 UI 改为「整理结论」，不再提供本入口）：
// 置 finishPromptAt（可重复查看收尾提示词）；「等待纪要」仅为阶段反馈，状态保持讨论中
export function requestFinish(dataDir, id, { by = 'board' } = {}) {
  const meta = readTicketMeta(dataDir, id);
  if (!meta.finishPromptAt) {
    meta.finishPromptAt = nowIso();
    pushHistory(meta, by, '生成收尾提示词（等待纪要）');
    writeTicketMeta(dataDir, meta);
  }
  return meta;
}

// ---------- 逐轮记录与纪要版本（REQ-20260910-018：统一追加入口 + 乐观版本） ----------

function discRoundsDir(dataDir, id) {
  return path.join(ticketDir(dataDir, id), DISC_ROUNDS_DIR);
}

function roundFileOf(dataDir, id, no) {
  return path.join(discRoundsDir(dataDir, id), `r${String(no).padStart(4, '0')}.json`);
}

// 读取全部逐轮记录（按 no 升序）：跳过非法 JSON、结构不完整或 discussionId 不符的文件
// （不串讨论、不展示半成品轮）；rounds 目录不存在或为空返回 []。
export function listDiscussionRounds(dataDir, id) {
  readTicketMeta(dataDir, id); // 归属校验：讨论必须存在
  const dir = discRoundsDir(dataDir, id);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => DISC_ROUND_FILE_RE.test(n));
  } catch {
    return [];
  }
  const rounds = [];
  for (const name of names) {
    const raw = readJson(path.join(dir, name));
    if (!raw || typeof raw !== 'object') continue;
    if (String(raw.discussionId || '') !== id) continue;
    const no = Number(raw.no);
    if (!Number.isInteger(no) || no < 1) continue;
    rounds.push({
      discussionId: id,
      no,
      roundId: String(raw.roundId || `R${String(no).padStart(4, '0')}`),
      at: String(raw.at || ''),
      user: String(raw.user ?? ''),
      summary: String(raw.summary ?? ''),
      session: raw.session == null ? null : String(raw.session),
      key: raw.key == null ? null : String(raw.key),
    });
  }
  return rounds.sort((a, b) => a.no - b.no);
}

// 统一追加入口：保存一轮（用户原文 + 回复总结）。
// - 归属校验：讨论必须存在；轮文件带 discussionId，读侧跳过异讨论文件；
// - 并发保护：no 取最大值 +1，linkSync 独占落位（目标已存在即 EEXIST → 撞号自动递增重试），
//   一轮一文件 ⇒ 多会话并发追加互不覆盖；
// - 幂等：带 key 的追加若已存在同 key 轮次，直接返回既有轮并标记 duplicate（同轮重试不重复记录）；
// - 成功后刷新 ticket.json updatedAt（fresh 读后仅改该字段，供列表排序与最近更新）。
export function appendDiscussionRound(dataDir, id, { user, summary, session = null, key = null } = {}) {
  readTicketMeta(dataDir, id); // 归属校验（含编号合法性）
  user = String(user ?? '');
  summary = String(summary ?? '');
  if (!user.trim()) throw new AtbError('用户原文不能为空（每轮必须保存用户输入原文）');
  if (!summary.trim()) throw new AtbError('回复总结不能为空（每轮必须保存回复总结）');
  session = session == null ? null : String(session);
  key = key == null || key === '' ? null : String(key);

  const existing = listDiscussionRounds(dataDir, id);
  if (key) {
    const prev = existing.find((r) => r.key === key);
    if (prev) return { ...prev, duplicate: true };
  }
  const dir = discRoundsDir(dataDir, id);
  fs.mkdirSync(dir, { recursive: true });
  let no = existing.length ? existing[existing.length - 1].no + 1 : 1;
  const at = nowIso();
  const record = {
    version: 1,
    discussionId: id,
    no,
    roundId: `R${String(no).padStart(4, '0')}`,
    at,
    user,
    summary,
    session,
    key,
  };
  // 独占落位：tmp + linkSync（目标存在抛 EEXIST）→ 原子创建，失败不留半成品；
  // 撞号（并发会话已占）自动递增重试，最多 64 次
  let placed = false;
  for (let i = 0; i < 64 && !placed; i++) {
    record.no = no;
    record.roundId = `R${String(no).padStart(4, '0')}`;
    const tmp = path.join(dir, `.r${no}.${process.pid}.${Date.now()}.${i}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n');
    try {
      fs.linkSync(tmp, roundFileOf(dataDir, id, no));
      placed = true;
    } catch (e) {
      if (e.code === 'EEXIST') {
        no += 1;
      } else {
        throw new AtbError(`保存轮次失败：${e.message}`);
      }
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  if (!placed) throw new AtbError('保存轮次失败：编号落位持续冲突，请稍后重试（同 key 重试不会产生重复轮次）');
  touchDiscussion(dataDir, id);
  return { ...record, duplicate: false };
}

// 读取纪要：内容 + 乐观版本。旧发布协议写的 minutes.md 无 meta → 版本 0，updatedAt 回退文件 mtime。
export function readDiscussionMinutes(dataDir, id) {
  readTicketMeta(dataDir, id);
  const dir = ticketDir(dataDir, id);
  let content = null;
  try {
    content = fs.readFileSync(path.join(dir, DISC_MINUTES_FILE), 'utf8');
  } catch { /* 无纪要 */ }
  const meta = readJson(path.join(dir, DISC_MINUTES_META_FILE));
  let version = 0;
  let updatedAt = null;
  if (meta && typeof meta === 'object' && String(meta.discussionId || '') === id && Number.isInteger(meta.minutesVersion)) {
    version = meta.minutesVersion;
    updatedAt = meta.updatedAt || null;
  } else if (content != null && content.trim()) {
    try {
      updatedAt = fs.statSync(path.join(dir, DISC_MINUTES_FILE)).mtime.toISOString();
    } catch { /* 保持 null */ }
  }
  return { content, version, updatedAt };
}

// 纪要更新（乐观版本校验）：baseVersion 与当前不符（他人已更新）→ 明确冲突报错，
// 不静默覆盖；成功后 minutes.md 原子重写、版本 +1 并刷新 ticket.updatedAt。
export function saveDiscussionMinutes(dataDir, id, { minutes, baseVersion } = {}) {
  readTicketMeta(dataDir, id);
  minutes = String(minutes ?? '');
  if (!minutes.trim()) throw new AtbError('纪要内容不能为空');
  if (baseVersion == null || !Number.isInteger(Number(baseVersion))) {
    throw new AtbError('缺少纪要版本 baseVersion（先经 atb disc show 读取当前 minutesVersion 再整理）');
  }
  const cur = readDiscussionMinutes(dataDir, id);
  if (Number(baseVersion) !== cur.version) {
    throw new AtbError(`纪要版本冲突：当前版本 ${cur.version}（提交 baseVersion ${baseVersion}），请重新读取最新纪要与全部轮次后再整理`);
  }
  const dir = ticketDir(dataDir, id);
  const now = nowIso();
  const tmp = path.join(dir, `${DISC_MINUTES_FILE}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, minutes);
  fs.renameSync(tmp, path.join(dir, DISC_MINUTES_FILE));
  writeJsonAtomic(path.join(dir, DISC_MINUTES_META_FILE), {
    schema: 1,
    discussionId: id,
    minutesVersion: cur.version + 1,
    updatedAt: now,
  });
  touchDiscussion(dataDir, id);
  return { version: cur.version + 1, updatedAt: now };
}

// 轮次/纪要落盘后刷新最近更新时间（fresh 读 meta 仅改 updatedAt，减少并发覆盖面）
function touchDiscussion(dataDir, id) {
  try {
    const meta = readTicketMeta(dataDir, id);
    meta.updatedAt = nowIso();
    writeJsonAtomic(path.join(ticketDir(dataDir, id), 'ticket.json'), meta);
  } catch { /* 讨论被并发删除等：轮文件已落盘，不因此报错 */ }
}



export function archiveDiscussion(dataDir, id, { by = 'board' } = {}) {
  const meta = readTicketMeta(dataDir, id);
  if (discussionStatusOf(meta) !== 'archived') {
    const from = meta.status;
    meta.status = 'archived';
    pushHistory(meta, from, 'archived', by || 'board', '归档讨论（保留纪要与已创建条目）');
    writeTicketMeta(dataDir, meta);
  }
  return meta;
}

export function resumeDiscussion(dataDir, id, { by = 'board' } = {}) {
  const meta = readTicketMeta(dataDir, id);
  if (meta.status !== 'discussing') {
    const from = meta.status;
    meta.status = 'discussing';
    pushHistory(meta, from, 'discussing', by || 'board', '继续讨论（纪要与已生成条目不丢失）');
    writeTicketMeta(dataDir, meta);
  }
  return meta;
}

// ---------- 候选创建（逐条走 core.createItem；幂等；部分失败不中断） ----------

// 条目侧文档补写：README 元信息加来源讨论行；需求补验收标准清单；Bug 补复现步骤与期望行为
function patchCreatedItemDocs(dir, type, meta, item) {
  const readmeFile = path.join(dir, 'README.md');
  let readme = fs.readFileSync(readmeFile, 'utf8');
  const sourceLine = `- 来源讨论：${meta.id}（${meta.title}）`;
  if (!readme.includes('- 来源讨论：')) {
    readme = readme.replace(/(- 创建：[^\n]*)\n/, `$1\n${sourceLine}\n`);
  }
  if (type === 'requirement' && String(item.acceptance || '').trim()) {
    const lines = String(item.acceptance).split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => (l.startsWith('- [ ]') || l.startsWith('- [x]') ? l : `- [ ] ${l.replace(/^[-*]\s*/, '')}`));
    if (lines.length) readme = readme.replace('## 验收标准\n\n- [ ] （待补充）', `## 验收标准\n\n${lines.join('\n')}`);
  }
  if (type === 'bug') {
    if (String(item.repro || '').trim()) {
      readme = readme.replace(/## 复现步骤\n\n1\./, `## 复现步骤\n\n${String(item.repro).trim()}`);
    }
    if (String(item.expected || '').trim()) {
      readme = readme.replace(/## 期望行为\n*$/, `## 期望行为\n\n${String(item.expected).trim()}\n`);
    }
  }
  fs.writeFileSync(readmeFile, readme);
}

// 批量创建勾选草稿：已创建的直接跳过（幂等）；单条失败记入结果不中断其他条目。
// 每条成功后：条目 status.json 加 sourceDiscussion（只读字段，详情跳转用）、README 补
// 来源行与验收/复现内容；ticket.json.created 记录 draftId → 条目映射。
export function createItems(dataDir, id, { items, by = 'board' }) {
  const meta = readTicketMeta(dataDir, id);
  if (!Array.isArray(items) || !items.length) throw new AtbError('未选择草稿：请至少勾选一项后再创建');
  meta.created = meta.created || {};
  const results = [];
  let okCount = 0;
  for (const raw of items) {
    const draftId = String(raw && raw.id || '').trim();
    if (meta.created[draftId]) {
      const prev = meta.created[draftId];
      results.push({ draftId, ok: true, skipped: true, itemId: prev.itemId });
      continue;
    }
    const type = raw && raw.type;
    const title = String(raw && raw.title || '').trim();
    if (type !== 'requirement' && type !== 'bug') {
      results.push({ draftId, ok: false, error: `type 必须是 requirement 或 bug（得到：${type}）` });
      continue;
    }
    if (!title) {
      results.push({ draftId, ok: false, error: '标题不能为空（必填校验）' });
      continue;
    }
    if ([...title].length > TITLE_MAX_CHARS) {
      results.push({ draftId, ok: false, error: `标题过长（不超过 ${TITLE_MAX_CHARS} 字）` });
      continue;
    }
    const description = String(raw.description ?? '');
    const actual = String(raw.actual ?? '').trim();
    try {
      const st = createItem(dataDir, {
        type,
        title,
        // Bug 实际结果并入现象描述（现象/复现/预期分节补写见 patchCreatedItemDocs）
        description: actual ? `${description}${description.endsWith('\n') || !description ? '' : '\n\n'}实际结果：${actual}` : description,
        parent: null,
        by: by || 'board',
      });
      const item = {
        id: draftId,
        type,
        title,
        description,
        repro: String(raw.repro ?? ''),
        actual,
        expected: String(raw.expected ?? ''),
        acceptance: String(raw.acceptance ?? ''),
      };
      patchCreatedItemDocs(resolveItemDir(dataDir, st.id).dir, type, meta, item);
      // 条目侧来源讨论（双向关联；status.json 只读字段随条目走）
      const st2 = readStatus(resolveItemDir(dataDir, st.id).dir);
      st2.sourceDiscussion = { id: meta.id, title: meta.title };
      writeStatus(resolveItemDir(dataDir, st.id).dir, st2);
      meta.created[draftId] = { itemId: st.id, type, title, at: nowIso() };
      okCount++;
      results.push({ draftId, ok: true, itemId: st.id });
    } catch (e) {
      results.push({ draftId, ok: false, error: String(e.message || '创建失败') });
    }
  }
  if (okCount) {
    pushHistory(meta, by || 'board', `创建 ${okCount} 条候选条目（待接受）`);
    writeTicketMeta(dataDir, meta);
  }
  return { results, meta };
}

// ---------- 全量视图（详情数据源） ----------

// 已创建成果：draftId → 条目实时信息（条目被删时 missing 标注，记录保留）
function createdListOf(dataDir, meta) {
  const created = meta.created || {};
  return Object.entries(created).map(([draftId, rec]) => {
    const out = { draftId, itemId: rec.itemId, type: rec.type, title: rec.title, createdAt: rec.at, missing: false, itemTitle: null, itemStatus: null };
    try {
      const st = readStatus(resolveItemDir(dataDir, rec.itemId).dir);
      out.itemTitle = st.title || rec.title;
      out.itemStatus = st.status || null;
    } catch {
      out.missing = true;
    }
    return out;
  });
}

// 旧单历史问答（只读保留；新讨论 rounds 为空返回 []）
function legacyRoundsOf(dataDir, meta) {
  const dir = ticketDir(dataDir, meta.id);
  return (meta.rounds || []).map((r) => {
    let question = null;
    let answer = null;
    try { question = fs.readFileSync(roundQuestionFile(dir, r.no), 'utf8'); } catch {}
    try { answer = fs.readFileSync(roundAnswerFile(dir, r.no), 'utf8'); } catch {}
    return { ...r, question, answer };
  }).filter((r) => r.question != null || r.answer != null);
}

export function discussionFull(dataDir, id) {
  const meta = readTicketMeta(dataDir, id);
  const card = discussionCard(dataDir, meta);
  const rounds = listDiscussionRounds(dataDir, id);
  const minutes = readDiscussionMinutes(dataDir, id);
  const lastRound = rounds.length ? rounds[rounds.length - 1] : null;
  let outcome;
  try {
    outcome = readOutcome(dataDir, id);
  } catch {
    outcome = { state: 'error', reason: '成果读取失败（讨论目录可能被移动或删除）', minutes: null, candidates: { items: [] }, publishedAt: null };
  }
  const created = createdListOf(dataDir, meta);
  return {
    ...card,
    background: readQuestionSafe(dataDir, id),
    // REQ-20260910-028：创建时随单保存的截图清单（仅新讨论有；旧单轮次附件在 legacyRounds 内）
    attachments: [...(meta.attachments || [])],
    startPrompt: buildStartPrompt(dataDir, id),
    finishPrompt: buildFinishPrompt(dataDir, id), // 兼容保留（旧会话可能仍持收尾提示词）
    continuePrompt: buildContinuePrompt(dataDir, id),
    organizePrompt: buildOrganizePrompt(dataDir, id),
    minutes: {
      content: minutes.content,
      version: minutes.version,
      updatedAt: minutes.updatedAt,
      stale: !!(lastRound && (!minutes.updatedAt || String(minutes.updatedAt) < String(lastRound.at))),
    },
    rounds,
    outcome,
    candidates: outcome.state === 'published' ? outcome.candidates.items : [],
    created,
    legacyRounds: legacyRoundsOf(dataDir, meta),
    history: meta.history || [],
  };
}
