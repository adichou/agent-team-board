// REQ-20260909-003 需求文档引用讨论、纪要归档与说明同步 —— 数据层（req-disc-store）。
// 事实源：<dataDir>/discussions/（与 oncall/ 完全隔离，不进 REQ/BUG 状态机、不占 impl.lock）：
//   settings.json               独立计数器（disc，按日重置；.locks/disc.lock 互斥）
//   DISC-YYYYMMDD-NNN/          discussion.json + readme-versions/vN.md + rounds/N/{minutes.md,readme-draft.json,PUBLISH.json}
// 流程：看板生成启动提示词（用户复制到 Agent 新会话持续讨论）→ 讨论完毕生成收尾提示词 →
//   Agent 在 rounds/N/ 成套落盘纪要与草稿并最后写发布标记 → 看板 readOutcome 检测 →
//   人工独立「确认归档」（只记 archivedAt，不写 README）与「确认应用」（基线校验后写 README，保留旧版）。
// 看板不感知 Agent 在线状态：一切以落盘文件为准，无发布标记一律 waiting。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AtbError, writeJsonAtomic, acquireLock, releaseLock, localDateStamp, resolveItemDir } from './core.mjs';

export const DISC_QUOTE_DOCS = ['README.md']; // 引用快照白名单：本项面向需求说明（README）
const DISC_LOCK_STALE_MS = 30_000;
const QUOTE_MAX_CHARS = 4000; // 引用原文快照上限（超长截断，防元数据膨胀）
const QUOTES_MAX = 100; // 引用快照条数上限（超出丢最旧）

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const nowIso = () => new Date().toISOString();

// ---------- 目录与初始化 ----------

export function discussionsDir(dataDir) {
  return path.join(dataDir, 'discussions');
}

export function discussionDir(dataDir, id) {
  assertDiscId(id);
  return path.join(discussionsDir(dataDir), id);
}

function assertDiscId(id) {
  if (typeof id !== 'string' || !/^DISC-\d{8}-\d{3}$/.test(id)) {
    throw new AtbError(`非法讨论编号：${id}（形如 DISC-YYYYMMDD-NNN）`);
  }
}

export function ensureDiscussions(dataDir) {
  fs.mkdirSync(discussionsDir(dataDir), { recursive: true });
  const settingsPath = path.join(discussionsDir(dataDir), 'settings.json');
  if (!readJson(settingsPath)) {
    writeJsonAtomic(settingsPath, { version: 1, date: localDateStamp(), counters: { disc: 0 } });
  }
}

// ---------- 编号（独立序列，按日重置） ----------

function nextDiscCounter(dataDir) {
  const lockPath = path.join(dataDir, '.locks', 'disc.lock');
  acquireLock(lockPath, DISC_LOCK_STALE_MS, { pid: process.pid, at: nowIso() });
  try {
    ensureDiscussions(dataDir);
    const settingsPath = path.join(discussionsDir(dataDir), 'settings.json');
    const cfg = readJson(settingsPath) || { version: 1, counters: {} };
    const today = localDateStamp();
    if (cfg.date !== today) {
      cfg.date = today;
      cfg.counters = { disc: 0 };
    }
    cfg.counters.disc = (cfg.counters.disc || 0) + 1;
    writeJsonAtomic(settingsPath, cfg);
    return { seq: cfg.counters.disc, date: today };
  } finally {
    releaseLock(lockPath);
  }
}

export function nextDiscId(dataDir) {
  const { seq, date } = nextDiscCounter(dataDir);
  return `DISC-${date}-${String(seq).padStart(3, '0')}`;
}

// ---------- 元数据读写 ----------

function readMeta(dataDir, id) {
  assertDiscId(id);
  const meta = readJson(path.join(discussionDir(dataDir, id), 'discussion.json'));
  if (!meta || meta.id !== id) throw new AtbError(`找不到讨论：${id}`);
  return meta;
}

function writeMeta(dataDir, meta) {
  meta.updatedAt = nowIso();
  writeJsonAtomic(path.join(discussionDir(dataDir, meta.id), 'discussion.json'), meta);
}

function pushHistory(meta, by, note) {
  meta.history = meta.history || [];
  meta.history.push({ at: nowIso(), by: by || 'board', note });
}

// reqId 校验：仅接受 REQ- 编号且条目存在（与 oncall normalizeReqId 同口径）
function normalizeReqId(dataDir, req) {
  const id = String(req == null ? '' : req).trim();
  if (!id) throw new AtbError('文档讨论必须绑定需求（REQ-… 编号）');
  const { type } = resolveItemDir(dataDir, id);
  if (type !== 'requirement') throw new AtbError(`仅支持关联需求（REQ-… 编号）：${id}`);
  return id;
}

// ---------- 创建 / 查询 ----------

export function createDiscussion(dataDir, { reqId, by = 'board' }) {
  ensureDiscussions(dataDir);
  const req = normalizeReqId(dataDir, reqId);
  const id = nextDiscId(dataDir);
  const dir = discussionDir(dataDir, id);
  fs.mkdirSync(path.join(dir, 'rounds', '1'), { recursive: true });
  const now = nowIso();
  const meta = {
    version: 1,
    id,
    reqId: req,
    readmeVersion: 1, // 本讨论视角的 README 版本计数（应用 +1；旧版存 readme-versions/vN.md）
    createdAt: now,
    updatedAt: now,
    rounds: [{ no: 1, startedAt: now, finishPromptAt: null, publishedAt: null, archivedAt: null, applied: null }],
    quotes: [],
    history: [{ at: now, by: by || 'board', note: '创建讨论并绑定需求' }],
  };
  writeMeta(dataDir, meta);
  return meta;
}

export function getDiscussion(dataDir, id) {
  return readMeta(dataDir, id);
}

export function listDiscussions(dataDir, { reqId = null } = {}) {
  ensureDiscussions(dataDir);
  const dir = discussionsDir(dataDir);
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/^DISC-\d{8}-\d{3}$/.test(name)) continue;
    const meta = readJson(path.join(dir, name, 'discussion.json'));
    if (meta && meta.id === name) out.push(meta);
  }
  out.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id));
  if (reqId) return out.filter((x) => x.reqId === reqId);
  return out;
}

// 需求当前（最新）讨论：需求抽屉区块数据源；无讨论返回 null
export function latestDiscussion(dataDir, reqId) {
  const list = listDiscussions(dataDir, { reqId });
  return list.length ? list[list.length - 1] : null;
}

function latestRound(meta) {
  return meta.rounds[meta.rounds.length - 1];
}

function roundDirOf(dataDir, id, no) {
  return path.join(discussionDir(dataDir, id), 'rounds', String(no));
}

// ---------- 提示词（启动 / 收尾；同一讨论/需求/轮次标识） ----------

const projectRootOf = (dataDir) => path.resolve(dataDir, '..', '..');

function reqDocEntry(dataDir, meta) {
  const reqDir = coreResolveItemDir(dataDir, meta.reqId);
  return ['README.md', 'design.md', 'test-cases.md'].map((n) => path.join(reqDir, n));
}

// resolveItemDir 是函数引用导入，这里单独包一层便于测试内替换（无 mock 也可直接用）
function coreResolveItemDir(dataDir, reqId) {
  return resolveItemDir(dataDir, reqId).dir;
}

export function buildStartPrompt(dataDir, id) {
  const meta = readMeta(dataDir, id);
  const round = latestRound(meta);
  const docs = reqDocEntry(dataDir, meta);
  const rd = roundDirOf(dataDir, id, round.no);
  const reqTitle = safeReqTitle(dataDir, meta);
  return [
    `你是本项目的需求文档讨论参与者。请在当前会话与我持续讨论需求 ${meta.reqId}（${reqTitle}），讨论编号 ${meta.id}（第 ${round.no} 轮）。`,
    `项目根：${projectRootOf(dataDir)}`,
    '',
    '文档读取入口（只读，存在即可直接读取）：',
    ...docs.map((p) => `- ${p}`),
    '',
    '讨论约定：',
    '- 区分「明确共识」「Agent 建议（待确认）」「未决问题」，不要混在一起；',
    '- 讨论期间不修改上述文档、不改项目代码、不改变看板需求状态；结论涉改代码请建议另建需求。',
    '',
    '落盘约定（只在收到收尾提示词后使用，本轮产物目录）：',
    `- 纪要：${path.join(rd, 'minutes.md')}`,
    `- 说明修改草稿：${path.join(rd, 'readme-draft.json')}`,
    `- 发布标记（最后写）：${path.join(rd, 'PUBLISH.json')}`,
    '三件都完整写完才算发布；看板检测到发布标记后才会读取展示，半成品不会被读取。',
    // BUG-20260915-010：提示词末尾恰追加一个换行（与 buildDocRef 口径一致），粘贴后光标落在新行
  ].join('\n') + '\n';
}

export function buildFinishPrompt(dataDir, id) {
  const meta = readMeta(dataDir, id);
  const round = latestRound(meta);
  const rd = roundDirOf(dataDir, id, round.no);
  return [
    `请收尾需求 ${meta.reqId} 的文档讨论（讨论编号 ${meta.id}，第 ${round.no} 轮），在当前会话内按顺序完成：`,
    '',
    `1. 完整落盘纪要到 ${path.join(rd, 'minutes.md')}，Markdown 六节：明确共识 / Agent 建议（待确认）/ 未决问题 / 原文引用（注明文档与源行）/ 建议修改 / 后续行动。`,
    `2. 完整落盘说明修改草稿到 ${path.join(rd, 'readme-draft.json')}，JSON 结构：`,
    '{',
    `  "discussionId": "${meta.id}", "reqId": "${meta.reqId}", "round": ${round.no},`,
    '  "baseline": "<你起草时该需求 README.md 内容的 SHA-256（64 位十六进制，可用 shasum -a 256 算得）>",',
    '  "changes": [ { "id": "c1", "title": "小标题", "before": "README 中要被替换的原文（须在文中唯一）", "after": "替换后的新文本", "basis": "明确共识第 X 项" } ]',
    '}',
    '只有「明确共识」支撑的修改才进入 changes；Agent 建议与未决问题不得纳入；无明确修改时 changes 为空数组。',
    `3. 最后写发布标记 ${path.join(rd, 'PUBLISH.json')}：{ "discussionId": "${meta.id}", "reqId": "${meta.reqId}", "round": ${round.no}, "publishedAt": "<ISO 时间>" }。`,
    '',
    '看板只认发布标记与成套文件；不要直接修改 README.md、不要覆盖已归档纪要、不要改变需求状态。',
  ].join('\n') + '\n';
}

function safeReqTitle(dataDir, meta) {
  try {
    const { dir } = resolveItemDir(dataDir, meta.reqId);
    const st = readJson(path.join(dir, 'status.json'));
    return (st && st.title) || meta.reqId;
  } catch {
    return '需求已删除';
  }
}

// 讨论完毕：置 finishPromptAt（可重复查看收尾提示词，不另开轮）
export function requestFinish(dataDir, id, { by = 'board' } = {}) {
  const meta = readMeta(dataDir, id);
  const round = latestRound(meta);
  round.finishPromptAt = round.finishPromptAt || nowIso();
  pushHistory(meta, by, `第 ${round.no} 轮生成收尾提示词`);
  writeMeta(dataDir, meta);
  return meta;
}

// 继续讨论：同一讨论开新轮（旧轮归档/应用记录保留，不覆盖）
export function continueDiscussion(dataDir, id, { by = 'board' } = {}) {
  const meta = readMeta(dataDir, id);
  const no = meta.rounds.length + 1;
  fs.mkdirSync(roundDirOf(dataDir, id, no), { recursive: true });
  meta.rounds.push({ no, startedAt: nowIso(), finishPromptAt: null, publishedAt: null, archivedAt: null, applied: null });
  pushHistory(meta, by, `继续讨论：开第 ${no} 轮`);
  writeMeta(dataDir, meta);
  return meta;
}

// ---------- 成果读取（发布协议） ----------

function validateDraft(draft, meta, no) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return '草稿不是合法 JSON 对象';
  if (String(draft.discussionId || '') !== meta.id || String(draft.reqId || '') !== meta.reqId || Number(draft.round) !== no) {
    return `草稿绑定不符（discussionId/reqId/round 与当前讨论不匹配），已拒绝读取为当前成果`;
  }
  if (!Array.isArray(draft.changes)) return '草稿缺少 changes 数组';
  const seen = new Set();
  for (const c of draft.changes) {
    if (!c || typeof c !== 'object') return 'changes 含非法条目';
    const id = String(c.id || '').trim();
    const before = String(c.before ?? '');
    const after = String(c.after ?? '');
    if (!id || !before || !after) return `changes 条目缺少 id/before/after 字段（id=${c.id || '空'}）`;
    if (seen.has(id)) return `changes 存在重复 id：${id}`;
    seen.add(id);
  }
  if (draft.changes.length && !/^[0-9a-f]{64}$/i.test(String(draft.baseline || ''))) {
    return '草稿缺少合法 baseline（README 的 SHA-256，64 位十六进制）';
  }
  return null;
}

// 读取某轮成果：waiting（未发布）/ error（发布但不成套、非法或绑定不符）/ published（成套）
// 默认读最新轮；published 首次读到时回写 round.publishedAt（幂等，后续沿用首见时间）。
export function readOutcome(dataDir, id, roundNo = null) {
  const meta = readMeta(dataDir, id);
  const no = roundNo == null ? latestRound(meta).no : Number(roundNo);
  const round = meta.rounds.find((r) => r.no === no);
  if (!round) throw new AtbError(`不存在第 ${no} 轮`);
  const rd = roundDirOf(dataDir, id, no);
  const out = { round: no, state: 'waiting', reason: null, minutes: null, draft: null, publishedAt: null };

  if (!fs.existsSync(path.join(rd, 'PUBLISH.json'))) return out; // 未发布：一律等待（含半成品）

  const marker = readJson(path.join(rd, 'PUBLISH.json')) || {};
  if (String(marker.discussionId || '') !== id || String(marker.reqId || '') !== meta.reqId || Number(marker.round) !== no) {
    out.state = 'error';
    out.reason = '发布标记与当前讨论不匹配（项目/讨论/轮次），已拒绝读取为当前成果';
    return out;
  }
  let minutes = null;
  try {
    minutes = fs.readFileSync(path.join(rd, 'minutes.md'), 'utf8');
  } catch { /* below */ }
  if (minutes == null) {
    out.state = 'error';
    out.reason = `已发布但缺少纪要（${path.join(rd, 'minutes.md')}）`;
    return out;
  }
  const draftRaw = readJson(path.join(rd, 'readme-draft.json'));
  if (draftRaw == null) {
    out.state = 'error';
    out.reason = `已发布但缺少说明修改草稿或草稿 JSON 非法（${path.join(rd, 'readme-draft.json')}）`;
    return out;
  }
  const invalid = validateDraft(draftRaw, meta, no);
  if (invalid) {
    out.state = 'error';
    out.reason = invalid;
    return out;
  }
  out.state = 'published';
  out.minutes = minutes;
  out.draft = draftRaw;
  if (round.publishedAt) {
    out.publishedAt = round.publishedAt;
  } else {
    out.publishedAt = nowIso();
    round.publishedAt = out.publishedAt;
    pushHistory(meta, 'board', `第 ${no} 轮成果已发布并读取`);
    writeMeta(dataDir, meta);
  }
  return out;
}

// ---------- 引用快照 ----------

export function saveQuote(dataDir, id, { doc, startLine, endLine, version, text, by = 'board' }) {
  const meta = readMeta(dataDir, id);
  const name = String(doc || '').trim();
  if (!DISC_QUOTE_DOCS.includes(name)) throw new AtbError(`引用文档仅支持：${DISC_QUOTE_DOCS.join(' / ')}（得到：${doc}）`);
  const s = Number(startLine);
  const e = Number(endLine == null ? startLine : endLine);
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 1 || e < s) {
    throw new AtbError(`非法源行范围：${startLine}-${endLine}`);
  }
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) throw new AtbError(`非法版本号：${version}`);
  const snapshot = String(text == null ? '' : text).slice(0, QUOTE_MAX_CHARS);
  if (!snapshot.trim()) throw new AtbError('引用原文不能为空');
  meta.quotes.push({ at: nowIso(), by: by || 'board', doc: name, startLine: s, endLine: e, version: v, text: snapshot });
  if (meta.quotes.length > QUOTES_MAX) meta.quotes = meta.quotes.slice(-QUOTES_MAX);
  pushHistory(meta, by || 'board', `复制引用（${name} 第 ${s}${e > s ? `-${e}` : ''} 行 · v${v}）`);
  writeMeta(dataDir, meta);
  return meta;
}

// ---------- 归档（只记标记，不写 README） ----------

export function archiveRound(dataDir, id, { by = 'board', round = null } = {}) {
  const meta = readMeta(dataDir, id);
  const r = round == null ? latestRound(meta) : meta.rounds.find((x) => x.no === Number(round));
  if (!r) throw new AtbError(`不存在第 ${round} 轮`);
  if (!r.publishedAt) throw new AtbError(`第 ${r.no} 轮尚未发布纪要，暂不能归档`);
  if (!r.archivedAt) {
    r.archivedAt = nowIso();
    pushHistory(meta, by, `归档第 ${r.no} 轮纪要（不改说明）`);
    writeMeta(dataDir, meta);
  }
  return meta;
}

// ---------- 应用草稿（写入 README；保留旧版；幂等；无部分成功） ----------

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function writeTextAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function readReqReadme(dataDir, reqId) {
  const { dir } = resolveItemDir(dataDir, reqId);
  const file = path.join(dir, 'README.md');
  if (!fs.existsSync(file)) throw new AtbError(`需求 ${reqId} 缺少 README.md，无法应用说明修改`);
  return { file, content: fs.readFileSync(file, 'utf8') };
}

export function applyDraft(dataDir, id, { selected, by = 'board' }) {
  const meta = readMeta(dataDir, id);
  const round = latestRound(meta);
  const outcome = readOutcome(dataDir, id);
  if (outcome.state !== 'published') {
    throw new AtbError(`第 ${round.no} 轮尚未发布成套成果（${outcome.state === 'waiting' ? '等待纪要与草稿' : outcome.reason}），不能应用`);
  }
  if (round.applied) {
    return { ...round.applied, alreadyApplied: true }; // 幂等：刷新/重复点击不二次写入
  }
  const changes = outcome.draft.changes || [];
  if (!Array.isArray(selected) || !selected.length) throw new AtbError('未选择修改：请至少勾选一项后再应用');

  const byId = new Map(changes.map((c) => [String(c.id), c]));
  const picks = [];
  for (const sid of selected) {
    const c = byId.get(String(sid));
    if (!c) throw new AtbError(`草稿中不存在修改项：${sid}（请在勾选范围内应用）`);
    picks.push(c);
  }
  if (!changes.length) throw new AtbError('本次无说明修改（草稿 changes 为空），无需应用');

  const { file, content } = readReqReadme(dataDir, meta.reqId);
  // 基线校验：README 已被手动编辑 → 保留草稿与快照，阻止覆盖
  if (sha256(content) !== String(outcome.draft.baseline || '').toLowerCase()) {
    throw new AtbError('说明已变化：README 与草稿基线不一致，请在原会话重新生成草稿后再应用');
  }
  // 逐项校验 + 顺序替换：任一失败整体中止，不产生部分写入
  let next = content;
  for (const c of picks) {
    const first = next.indexOf(c.before);
    if (first < 0) throw new AtbError(`修改项 ${c.id} 的原文未在 README 中找到（可能已被应用或说明已变化）`);
    if (next.indexOf(c.before, first + 1) >= 0) throw new AtbError(`修改项 ${c.id} 的原文在 README 中出现多次，无法定位唯一替换位置`);
    next = next.slice(0, first) + c.after + next.slice(first + c.before.length);
  }

  const beforeVersion = meta.readmeVersion;
  // 保留应用前完整旧版（readme-versions/vN.md；重试场景内容一致可覆盖）
  const verDir = path.join(discussionDir(dataDir, id), 'readme-versions');
  fs.mkdirSync(verDir, { recursive: true });
  fs.writeFileSync(path.join(verDir, `v${beforeVersion}.md`), content);
  writeTextAtomic(file, next);

  const applied = {
    at: nowIso(),
    by: by || 'board',
    sourceDiscussion: id,
    round: round.no,
    items: picks.map((c) => ({ id: String(c.id), title: String(c.title || ''), before: String(c.before), after: String(c.after), basis: String(c.basis || '') })),
    beforeVersion,
    afterVersion: beforeVersion + 1,
  };
  round.applied = applied;
  meta.readmeVersion = beforeVersion + 1;
  pushHistory(meta, by, `应用 ${picks.length} 项说明修改（v${beforeVersion} → v${applied.afterVersion}，已保留旧版）`);
  writeMeta(dataDir, meta);
  return { ...applied, alreadyApplied: false };
}

// ---------- 全量视图（需求抽屉区块 / API 数据源） ----------

// 最新讨论 + 最新轮成果 + 两类提示词现算（prompt 始终基于当前轮生成）
export function discussionFull(dataDir, reqId) {
  const meta = latestDiscussion(dataDir, reqId);
  if (!meta) return null;
  let outcome;
  try {
    outcome = readOutcome(dataDir, meta.id);
  } catch {
    outcome = { round: latestRound(meta).no, state: 'error', reason: '成果读取失败（讨论目录可能被移动或删除）', minutes: null, draft: null, publishedAt: null };
  }
  return {
    ...meta,
    projectRoot: projectRootOf(dataDir),
    startPrompt: buildStartPrompt(dataDir, meta.id),
    finishPrompt: buildFinishPrompt(dataDir, meta.id),
    outcome,
  };
}
