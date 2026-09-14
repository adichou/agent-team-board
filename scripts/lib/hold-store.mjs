// REQ-20260911-007 待人工决策承接闭环（业务编排层）：
// 声明（declareHold，worker）→ 持久呈现（listHolds / holdDetail，CLI + Status Board）
// → 人工决策（answerHold，人工专属——state-guard 拦 Agent）→ 复工（resumeHold，人工专属）/ 作废（cancelHold）。
// 条目状态机不动：hold 全程条目保持 in-progress；复工经 core.resumeItemToPlanned 专用通路回 planned。
// 事实源：holds/holds.json（hold-states）+ 条目目录 decisions.md（人读留痕，随代码进 git）。
// 与 blocked/failed 回执正交：worker 声明后仍按既有协议交 blocked 回执，历史语义零改动。

import {
  AtbError, resolveItemDir, readStatus, actor, resumeItemToPlanned,
} from './core.mjs';
import {
  readHolds, holdOf, activeHoldOf, unansweredCount, unansweredIds,
  saveHoldRecord, archiveHoldRecord, renderDecisionsDoc,
  HOLD_MAX_QUESTIONS, HOLD_TEXT_MAX_CHARS, HOLD_STATE_LABEL,
} from './hold-states.mjs';

const cleanText = (s) => String(s ?? '').trim();
const clipped = (s) => [...cleanText(s)].length;

function event(kind, by, note = '') {
  return { at: new Date().toISOString(), kind, by: by || 'human', ...(note ? { note } : {}) };
}

// ---------- 声明（worker / 人工均可：存量滞留单由人工补登记） ----------

export function declareHold(dataDir, itemId, { questions = [], reason = '', runId = null, by } = {}) {
  const { dir } = resolveItemDir(dataDir, itemId); // 不存在在此抛错
  const st = readStatus(dir);
  if (st.status !== 'in-progress') {
    throw new AtbError(`${itemId} 当前状态 ${st.status} 不能声明待人工决策（仅实施中受阻的 in-progress 条目）`);
  }
  const active = activeHoldOf(dataDir, itemId);
  if (active) {
    throw new AtbError(
      `${itemId} 已有待人工决策声明（${unansweredCount(active)} 项未答，${active.declaredBy || 'worker'} 声明）：` +
      '请先补齐决策并复工，或作废后再声明新一轮'
    );
  }
  const qs = (Array.isArray(questions) ? questions : [questions]).map(cleanText).filter(Boolean);
  if (!qs.length) throw new AtbError('声明必须携带至少一个决策问题（--question，可重复传入）');
  if (qs.length > HOLD_MAX_QUESTIONS) throw new AtbError(`决策问题最多 ${HOLD_MAX_QUESTIONS} 项（收到 ${qs.length} 项）`);
  for (const q of qs) {
    if (!clipped(q)) throw new AtbError('决策问题不能为空');
    if (clipped(q) > HOLD_TEXT_MAX_CHARS) throw new AtbError(`决策问题过长（≤${HOLD_TEXT_MAX_CHARS} 字）：${q.slice(0, 20)}…`);
  }
  reason = cleanText(reason);
  if (clipped(reason) > HOLD_TEXT_MAX_CHARS) throw new AtbError(`reason 过长（≤${HOLD_TEXT_MAX_CHARS} 字）`);
  if (runId != null) {
    runId = cleanText(runId) || null;
    if (runId && runId.length > 64) throw new AtbError('runId 过长（≤64 字符）');
  }
  const who = by || actor();
  // 上一轮已终态（resumed/cancelled/closed-done）→ 归档后开新一轮
  if (holdOf(dataDir, itemId)) archiveHoldRecord(dataDir, itemId);
  const round = (readHolds(dataDir).archived[itemId] || []).length + 1;
  const now = new Date().toISOString();
  const rec = {
    state: 'holding',
    round,
    itemId,
    declaredAt: now,
    declaredBy: who,
    runId: runId || null,
    reason: reason || null,
    questions: qs.map((text, i) => ({
      id: `q${i + 1}`, text, answer: null, answeredAt: null, answeredBy: null, note: null,
    })),
    events: [event('declared', who, reason || undefined)],
  };
  saveHoldRecord(dataDir, itemId, rec);
  renderDecisionsDoc(dataDir, itemId, dir, st.title);
  return saveHoldRecord(dataDir, itemId, rec);
}

// ---------- 人工决策作答（人工专属；支持部分作答草稿） ----------

export function answerHold(dataDir, itemId, { answers = [], by } = {}) {
  const { dir } = resolveItemDir(dataDir, itemId);
  const st = readStatus(dir);
  const rec = activeHoldOf(dataDir, itemId);
  if (!rec) throw new AtbError(`${itemId} 没有待答的待人工决策声明（atb hold list 查看）`);
  const list = Array.isArray(answers) ? answers : [answers];
  if (!list.length) throw new AtbError('作答必须携带 --q <问题号> --text <答复>（可多次调用逐项作答）');
  const who = by || 'human';
  const byId = new Map(rec.questions.map((q) => [q.id, q]));
  for (const a of list) {
    const q = byId.get(String(a.q || ''));
    if (!q) {
      throw new AtbError(`未知决策问题：${a.q}（本单问题号：${rec.questions.map((x) => x.id).join(' / ')}）`);
    }
    const text = cleanText(a.text);
    if (!text) throw new AtbError(`${q.id} 答复不能为空`);
    if (clipped(text) > HOLD_TEXT_MAX_CHARS) throw new AtbError(`${q.id} 答复过长（≤${HOLD_TEXT_MAX_CHARS} 字）`);
    const note = cleanText(a.note || '');
    if (clipped(note) > HOLD_TEXT_MAX_CHARS) throw new AtbError(`${q.id} 补充说明过长（≤${HOLD_TEXT_MAX_CHARS} 字）`);
    q.answer = text;
    q.note = note || null;
    q.answeredAt = new Date().toISOString();
    q.answeredBy = who;
    rec.events.push(event('answered', who, `${q.id} 已答`));
  }
  saveHoldRecord(dataDir, itemId, rec);
  renderDecisionsDoc(dataDir, itemId, dir, st.title);
  const unanswered = unansweredCount(rec);
  return {
    ok: true,
    itemId,
    unanswered,
    total: rec.questions.length,
    ...(unanswered ? { missing: unansweredIds(rec) } : { ready: true }),
  };
}

// ---------- 复工（人工专属：决策齐备 → 回 planned 队列） ----------

export function resumeHold(dataDir, itemId, { by } = {}) {
  const { dir } = resolveItemDir(dataDir, itemId);
  const rec = activeHoldOf(dataDir, itemId);
  if (!rec) throw new AtbError(`${itemId} 没有活动中的待人工决策声明，无需复工（atb hold list 查看）`);
  const missing = unansweredIds(rec);
  if (missing.length) {
    throw new AtbError(
      `${itemId} 尚有 ${missing.length} 项决策未答（${missing.join(' / ')}），复工前请补齐` +
      `（atb hold answer ${itemId} --q <问题号> --text <答复>；问题清单见 atb hold show ${itemId}）`
    );
  }
  const who = by || 'human';
  const st = resumeItemToPlanned(dataDir, itemId, {
    by: who,
    note: `待人工决策复工（第 ${rec.round || 1} 轮决策已补齐，回已计划队列）`,
  });
  rec.state = 'resumed';
  rec.events.push(event('resumed', who, '决策补齐，复工回已计划（planned）'));
  saveHoldRecord(dataDir, itemId, rec);
  renderDecisionsDoc(dataDir, itemId, dir, st.title);
  return { ok: true, itemId, status: st.status, runId: rec.runId || null };
}

// ---------- 作废（人工专属：按其他方式处理，声明闭环、条目状态不动） ----------

export function cancelHold(dataDir, itemId, { note = '', by } = {}) {
  const { dir } = resolveItemDir(dataDir, itemId);
  const rec = activeHoldOf(dataDir, itemId);
  if (!rec) throw new AtbError(`${itemId} 没有活动中的待人工决策声明，无需作废`);
  note = cleanText(note);
  if (clipped(note) > HOLD_TEXT_MAX_CHARS) throw new AtbError(`note 过长（≤${HOLD_TEXT_MAX_CHARS} 字）`);
  const who = by || 'human';
  rec.state = 'cancelled';
  rec.events.push(event('cancelled', who, note || '人工作废声明（条目状态不变，按其他方式处理）'));
  saveHoldRecord(dataDir, itemId, rec);
  renderDecisionsDoc(dataDir, itemId, dir, readStatus(dir).title);
  return { ok: true, itemId, state: rec.state };
}

// ---------- 呈现（CLI 清单 / Status Board 聚合，只读） ----------

function viewRecord(dataDir, rec) {
  let title = '';
  let status = '';
  try {
    const st = readStatus(resolveItemDir(dataDir, rec.itemId).dir);
    title = st.title || '';
    status = st.status;
  } catch { /* 条目已删除：按账面呈现 */ }
  return {
    itemId: rec.itemId,
    title,
    status,
    state: rec.state,
    stateLabel: HOLD_STATE_LABEL[rec.state] || rec.state,
    round: rec.round || 1,
    declaredAt: rec.declaredAt,
    declaredBy: rec.declaredBy,
    runId: rec.runId || null,
    reason: rec.reason || null,
    questions: rec.questions.map((q) => ({
      id: q.id, text: q.text,
      answer: q.answer || null, answeredAt: q.answeredAt || null, answeredBy: q.answeredBy || null, note: q.note || null,
    })),
    total: rec.questions.length,
    unanswered: unansweredCount(rec),
    updatedAt: rec.updatedAt || rec.declaredAt,
  };
}

// 活动清单（缺省仅 holding；all=true 含各终态最近一轮），最早声明在前（等待最久优先）
export function listHolds(dataDir, { all = false } = {}) {
  const holds = readHolds(dataDir);
  let recs = Object.values(holds.items);
  if (!all) recs = recs.filter((r) => r.state === 'holding');
  recs.sort((a, b) => String(a.declaredAt || '').localeCompare(String(b.declaredAt || '')) || String(a.itemId).localeCompare(b.itemId));
  return { count: recs.length, items: recs.map((r) => viewRecord(dataDir, r)) };
}

export function holdDetail(dataDir, itemId) {
  const rec = holdOf(dataDir, itemId);
  if (!rec) throw new AtbError(`${itemId} 没有待人工决策记录（atb hold list 查看全部）`);
  const view = viewRecord(dataDir, rec);
  const holds = readHolds(dataDir);
  view.events = (rec.events || []).slice();
  view.archivedRounds = (holds.archived[itemId] || []).length;
  return view;
}

// 已等待时长的可读文案（CLI / 面板共用口径）
export function waitingText(declaredAt, now = new Date()) {
  const t = Date.parse(declaredAt || '');
  if (!Number.isFinite(t)) return '—';
  let s = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (s < 60) return '刚刚';
  const m = Math.floor(s / 60); s %= 60;
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d} 天 ${h % 24} 小时`;
  if (h >= 1) return `${h} 小时 ${m % 60} 分`;
  return `${m} 分`;
}
