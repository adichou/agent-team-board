// REQ-20260911-007 受阻待人工决策条目的执行层账本（hold 三段：声明 → 人工决策 → 复工）。
// 存储：<dataDir>/holds/holds.json → { version, items: { [itemId]: rec }, archived: { [itemId]: rec[] } }
// 约束：只落执行账本（holds/，不进版本控制），不写条目 status.json（状态机铁律，state-guard 保护）；
// 条目状态保持 in-progress，复工（in-progress → planned）走 hold-store → core.resumeItemToPlanned
// 专用通路（人工触发，不进通用 TRANSITIONS）。本模块被 core.mjs 引用（claim / 确认完成防呆钩子），
// 故不得反向 import core（避免循环依赖）——与 refine-states.mjs 同构的最小自包含实现。

import fs from 'node:fs';
import path from 'node:path';

// 记录状态：holding=活动（待人工决策）→ resumed（已复工）/ cancelled（已作废）/ closed-done（答完或 force 后随确认完成闭环）
export const HOLD_STATES = ['holding', 'resumed', 'cancelled', 'closed-done'];
export const HOLD_STATE_LABEL = {
  holding: '待人工决策',
  resumed: '已复工',
  cancelled: '已作废',
  'closed-done': '随完成闭环',
};
export const HOLD_MAX_QUESTIONS = 20;
export const HOLD_TEXT_MAX_CHARS = 200; // 问题 / 原因 / 答复共用短文本上限（与 REASON_MAX_CHARS 同口径）

function holdsFile(dataDir) {
  return path.join(dataDir, 'holds', 'holds.json');
}

function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// 幂等初始化：目录 + .gitignore（执行账本不进版本控制；与 refine 同口径）
function ensureLedger(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'holds'), { recursive: true });
  const gi = path.join(dataDir, '.gitignore');
  let cur = '';
  try { cur = fs.readFileSync(gi, 'utf8'); } catch {}
  if (!cur.split('\n').includes('holds/')) {
    fs.writeFileSync(gi, cur.replace(/\n*$/, '\n') + 'holds/\n');
  }
}

export function readHolds(dataDir) {
  try {
    const j = JSON.parse(fs.readFileSync(holdsFile(dataDir), 'utf8'));
    if (j && typeof j === 'object') {
      return {
        version: 1,
        items: j.items && typeof j.items === 'object' ? j.items : {},
        archived: j.archived && typeof j.archived === 'object' ? j.archived : {},
      };
    }
  } catch { /* 缺失/损坏：视为无记录 */ }
  return { version: 1, items: {}, archived: {} };
}

function writeHolds(dataDir, holds) {
  ensureLedger(dataDir);
  writeJsonAtomic(holdsFile(dataDir), holds);
}

// 条目当前（最近一轮）hold 记录；无记录返回 null
export function holdOf(dataDir, itemId) {
  return readHolds(dataDir).items[itemId] || null;
}

// 活动记录（state=holding）：claim 防呆 / 确认完成防呆 / 聚合视图的判定口径
export function activeHoldOf(dataDir, itemId) {
  const rec = holdOf(dataDir, itemId);
  return rec && rec.state === 'holding' ? rec : null;
}

export function unansweredCount(rec) {
  if (!rec || !Array.isArray(rec.questions)) return 0;
  return rec.questions.filter((q) => q.answer == null || !String(q.answer).trim()).length;
}

export function unansweredIds(rec) {
  if (!rec || !Array.isArray(rec.questions)) return [];
  return rec.questions.filter((q) => q.answer == null || !String(q.answer).trim()).map((q) => q.id);
}

// 保存（整体替换该条目记录；调用方保证结构合法——hold-store 负责校验）
export function saveHoldRecord(dataDir, itemId, rec) {
  const holds = readHolds(dataDir);
  holds.items[itemId] = { ...rec, updatedAt: new Date().toISOString() };
  writeHolds(dataDir, holds);
  return holds.items[itemId];
}

// 当前轮终态归档（新一轮声明前调用）：旧记录移入 archived[itemId]（保留全部历史轮次）
export function archiveHoldRecord(dataDir, itemId) {
  const holds = readHolds(dataDir);
  const cur = holds.items[itemId];
  if (!cur) return holds;
  holds.archived[itemId] = [...(holds.archived[itemId] || []), cur];
  delete holds.items[itemId];
  writeHolds(dataDir, holds);
  return holds;
}

// 活动记录条数（聚合视图计数用）
export function activeHoldCount(dataDir) {
  return Object.values(readHolds(dataDir).items).filter((r) => r.state === 'holding').length;
}

// ---------- 条目决策记录文档（<itemDir>/decisions.md，随代码进 git 的人读留痕） ----------
// 由 hold 机制在每次声明 / 作答 / 复工 / 作废 / 闭环后整体重渲染；调用方（core / hold-store）
// 已持有 itemDir 与标题，本模块保持自包含不 import core。

function questionRow(q) {
  const answered = q.answer != null && String(q.answer).trim();
  const cells = [
    q.id,
    String(q.text || ''),
    answered ? '✓ 已答' : '○ 未答',
    answered ? String(q.answer) : '（待人工答复）',
    q.note ? String(q.note) : '—',
    answered ? `${String(q.answeredAt || '').slice(0, 16).replace('T', ' ')} · ${q.answeredBy || '?'}` : '—',
  ];
  return `| ${cells.join(' | ')} |`;
}

function roundSection(rec, { current = false } = {}) {
  const lines = [];
  const label = HOLD_STATE_LABEL[rec.state] || rec.state;
  lines.push(`## 第 ${rec.round || 1} 轮${current ? '（当前）' : ''} · ${label}`);
  lines.push('');
  lines.push(`- 声明：${rec.declaredAt || '?'}（${rec.declaredBy || '?'}）${rec.runId ? ` · 运行 ${rec.runId}` : ''}`);
  if (rec.reason) lines.push(`- 原因：${rec.reason}`);
  const n = unansweredCount(rec);
  lines.push(`- 问题 ${rec.questions.length} 项：已答 ${rec.questions.length - n} · 未答 ${n}`);
  lines.push('');
  lines.push('| # | 问题 | 状态 | 人工答复 | 补充说明 | 作答 |');
  lines.push('| -- | ---- | ---- | -------- | -------- | ---- |');
  for (const q of rec.questions) lines.push(questionRow(q));
  lines.push('');
  if (Array.isArray(rec.events) && rec.events.length) {
    lines.push('事件留痕：');
    for (const e of rec.events) {
      lines.push(`- ${String(e.at || '').slice(0, 19).replace('T', ' ')} ${e.kind}${e.by ? `（${e.by}）` : ''}${e.note ? `：${e.note}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function renderDecisionsDoc(dataDir, itemId, itemDir, title) {
  const holds = readHolds(dataDir);
  const cur = holds.items[itemId] || null;
  const past = holds.archived[itemId] || [];
  if (!cur && !past.length) return false;
  const parts = [
    `# 人工决策记录 — ${itemId} ${title || ''}`,
    '',
    '> 由 atb hold 机制维护（REQ-20260911-007）：worker 声明待人工决策 → 人工补决策 → 复工 / 闭环全程留痕。请勿手改。',
    '',
  ];
  if (cur) parts.push(roundSection(cur, { current: true }));
  if (past.length) {
    parts.push('## 历史轮次');
    parts.push('');
    for (const rec of past) parts.push(roundSection(rec), '');
  }
  try {
    fs.writeFileSync(path.join(itemDir, 'decisions.md'), parts.join('\n').replace(/\n*$/, '\n'));
    return true;
  } catch {
    return false; // 文档写失败不阻断账本操作（账本是事实源）
  }
}
