// REQ-20260914-001 自动提交不完整挂起 / AI 分析挂起 —— 挂起确认账本原语（confirm-states）。
// 自包含最小实现（仅 fs/path，不 import core），与 hold-states.mjs 同构：本模块被
// core.mjs（claim 防呆钩子）引用，故不得反向 import core / batch / refine（避免循环依赖）。
// 存储：<dataDir>/confirms/confirms.json → { version, items: { [itemId]: rec }, archived: { [itemId]: rec[] } }
// 约束：只落执行账本（confirms/，不进版本控制），不写条目 status.json（状态机铁律）；
// 挂起期间条目保持 in-progress（开发，已上报待人工确认）或 accepted（分析），状态机零改动。
//
// 记录两型（kind / blockType）：
//   develop / commit   —— 自动提交不完整（归属不明 pendingManual、test/业务组暂扣 heldGroups、
//                         提交失败、无快照无法归因等）：挂起当前条目并暂停开发队列，人工
//                         「重新核验 / 保持挂起 / 确认并继续」闭环后恢复；
//   analyze / analysis —— AI 分析遇到必须人工确认的问题（歧义/方案选择/信息缺失）：挂起当前
//                         条目并暂停分析队列，人工逐项作答（支持草稿）后「确认并继续」把答案
//                         回传当前条目续跑。
// 状态机：waiting（活动：待人工确认）→ resolved（开发：确认+补交+核验通过闭环）/
//   confirmed（分析：答案齐备已回传续跑）→ closed-done（分析收尾闭环）；
//   cancelled 为人工作废。新一轮声明前旧记录整体归档（保留全部历史轮次）。

import fs from 'node:fs';
import path from 'node:path';

export const CONFIRM_KINDS = ['develop', 'analyze'];
export const BLOCK_TYPES = { develop: 'commit', analyze: 'analysis' };
export const CONFIRM_STATES = ['waiting', 'confirmed', 'resolved', 'closed-done', 'cancelled'];
export const CONFIRM_STATE_LABEL = {
  waiting: '待人工确认',
  confirmed: '已确认续跑',
  resolved: '已确认恢复',
  'closed-done': '随完成闭环',
  cancelled: '已作废',
};
export const BLOCK_TYPE_LABEL = {
  commit: '待人工确认提交',
  analysis: '待人工确认分析',
};
export const KIND_LABEL = { develop: 'AI 开发', analyze: 'AI 分析' };
export const REASON_MAX_CHARS = 200; // 挂起原因短句上限（与批次回执 reason 同口径）
export const CONFIRM_TEXT_MAX_CHARS = 400; // 问题 / 背景 / 处理说明共用短文本上限
export const CONFIRM_MAX_QUESTIONS = 20;

function confirmsFile(dataDir) {
  return path.join(dataDir, 'confirms', 'confirms.json');
}

function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// 幂等初始化：目录 + .gitignore（执行账本不进版本控制；与 holds/refine 同口径）
function ensureLedger(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'confirms'), { recursive: true });
  const gi = path.join(dataDir, '.gitignore');
  let cur = '';
  try { cur = fs.readFileSync(gi, 'utf8'); } catch {}
  if (!cur.split('\n').includes('confirms/')) {
    fs.writeFileSync(gi, cur.replace(/\n*$/, '\n') + 'confirms/\n');
  }
}

export function readConfirms(dataDir) {
  try {
    const j = JSON.parse(fs.readFileSync(confirmsFile(dataDir), 'utf8'));
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

function writeConfirms(dataDir, confirms) {
  ensureLedger(dataDir);
  writeJsonAtomic(confirmsFile(dataDir), confirms);
}

// 条目当前（最近一轮）挂起确认记录；无记录返回 null
export function confirmOf(dataDir, itemId) {
  return readConfirms(dataDir).items[itemId] || null;
}

// 活动记录（waiting；分析已确认续跑的 confirmed 仍是活动轮——续跑未收尾前不得开新一轮）
export function activeConfirmOf(dataDir, itemId) {
  const rec = confirmOf(dataDir, itemId);
  return rec && (rec.state === 'waiting' || rec.state === 'confirmed') ? rec : null;
}

// 项目级活动记录（队列守卫用）：按 kind 过滤，最早声明在前
export function activeConfirms(dataDir, kind = null) {
  let recs = Object.values(readConfirms(dataDir).items)
    .filter((r) => r.state === 'waiting' || r.state === 'confirmed');
  if (kind) recs = recs.filter((r) => r.kind === kind);
  recs.sort((a, b) =>
    String(a.declaredAt || '').localeCompare(String(b.declaredAt || '')) ||
    String(a.itemId || '').localeCompare(String(b.itemId || '')));
  return recs;
}

export function activeDevelopConfirm(dataDir) {
  return activeConfirms(dataDir, 'develop')[0] || null;
}

export function activeAnalyzeConfirm(dataDir) {
  return activeConfirms(dataDir, 'analyze')[0] || null;
}

// 队列/认领守卫口径（比 active 更窄）：只看 state=waiting——
//   · develop：resolved 已闭环不阻塞；confirmed 不存在于 develop 轮；
//   · analyze：confirmed 表示答案已回传、条目已重排队首续跑——队列必须能派发该条目
//     （续跑未收尾期间下一条本就轮不到；不能因 confirmed 记录暂停整队）。
export function waitingConfirms(dataDir, kind = null) {
  let recs = Object.values(readConfirms(dataDir).items).filter((r) => r.state === 'waiting');
  if (kind) recs = recs.filter((r) => r.kind === kind);
  recs.sort((a, b) =>
    String(a.declaredAt || '').localeCompare(String(b.declaredAt || '')) ||
    String(a.itemId || '').localeCompare(String(b.itemId || '')));
  return recs;
}

export function waitingDevelopConfirm(dataDir) {
  return waitingConfirms(dataDir, 'develop')[0] || null;
}

export function waitingAnalyzeConfirm(dataDir) {
  return waitingConfirms(dataDir, 'analyze')[0] || null;
}

// 保存（整体替换该条目记录；调用方保证结构合法——confirm-store 负责校验）
export function saveConfirmRecord(dataDir, itemId, rec) {
  const confirms = readConfirms(dataDir);
  confirms.items[itemId] = { ...rec, updatedAt: new Date().toISOString() };
  writeConfirms(dataDir, confirms);
  return confirms.items[itemId];
}

// 当前轮终态归档（新一轮声明前调用）：旧记录移入 archived[itemId]
export function archiveConfirmRecord(dataDir, itemId) {
  const confirms = readConfirms(dataDir);
  const cur = confirms.items[itemId];
  if (!cur) return confirms;
  confirms.archived[itemId] = [...(confirms.archived[itemId] || []), cur];
  delete confirms.items[itemId];
  writeConfirms(dataDir, confirms);
  return confirms;
}

export function archivedRounds(dataDir, itemId) {
  return (readConfirms(dataDir).archived[itemId] || []).length;
}

// ---------- 分析问题口径 ----------

export function unansweredRequired(rec) {
  if (!rec || !Array.isArray(rec.questions)) return [];
  return rec.questions
    .filter((q) => q.required !== false)
    .filter((q) => q.answer == null || !String(q.answer).trim())
    .map((q) => q.id);
}

export function answeredCount(rec) {
  if (!rec || !Array.isArray(rec.questions)) return 0;
  return rec.questions.filter((q) => q.answer != null && String(q.answer).trim()).length;
}

// 问题与文档版本绑定（C19：新一轮声明/文档被改即过期）：轮次 + 声明时间 + 文档指纹
export function questionsVersionOf(rec) {
  return `r${rec.round || 1}@${rec.declaredAt}@${rec.docsFingerprint || ''}`;
}

// ---------- 条目确认记录文档（<itemDir>/confirmations.md，随代码进 git 的人读留痕） ----------
// 由 confirm 机制在声明 / 作答 / 核验 / 确认 / 恢复 / 作废后整体重渲染（与 hold 的 decisions.md 同口径）。

function eventLine(e) {
  return `- ${String(e.at || '').slice(0, 19).replace('T', ' ')} ${e.kind}${e.by ? `（${e.by}）` : ''}${e.note ? `：${String(e.note).slice(0, 120)}` : ''}`;
}

function commitFilesSection(rec) {
  const lines = [];
  if (Array.isArray(rec.committedGroups) && rec.committedGroups.length) {
    lines.push('- 已提交分组：');
    for (const g of rec.committedGroups) {
      lines.push(`  - ${g.kind}：${g.subject || ''}（${(g.hash || '').slice(0, 10)}，${(g.paths || []).length} 个路径）`);
    }
  }
  if (Array.isArray(rec.pendingManual) && rec.pendingManual.length) {
    lines.push(`- 待人工核对路径（${rec.pendingManual.length}）：${rec.pendingManual.join('、')}`);
  }
  if (rec.heldGroups) {
    const held = [...(rec.heldGroups.test || []), ...(rec.heldGroups.biz || [])];
    if (held.length) lines.push(`- 暂扣待补交路径（${held.length}）：${held.join('、')}`);
  }
  if (rec.supplement && Array.isArray(rec.supplement.commits) && rec.supplement.commits.length) {
    lines.push(`- 人工确认补交：${rec.supplement.commits.map((c) => `${(c.hash || '').slice(0, 10)} ${c.subject || ''}`).join('；')}`);
  }
  if (rec.verify && rec.verify.lastCheckAt) {
    lines.push(`- 最近核验：${String(rec.verify.lastCheckAt).slice(0, 19).replace('T', ' ')} ${rec.verify.ok ? '通过' : '未通过'}`);
    for (const r of rec.verify.reasons || []) lines.push(`  - ${r}`);
  }
  if (rec.keepNote) lines.push(`- 保持挂起说明：${rec.keepNote}`);
  return lines;
}

function analysisQuestionsSection(rec) {
  const lines = [];
  if (rec.background) lines.push(`- 背景：${rec.background}`);
  lines.push(`- 问题 ${rec.questions.length} 项：已答 ${answeredCount(rec)} · 必答未答 ${unansweredRequired(rec).length}`);
  lines.push('');
  lines.push('| # | 问题 | 必答 | 选项 | 人工答复 | 作答 |');
  lines.push('| -- | ---- | ---- | ---- | -------- | ---- |');
  for (const q of rec.questions) {
    const opts = (q.options || []).map((o) => o.label + (o.recommended ? '（推荐）' : '')).join(' / ');
    const answered = q.answer != null && String(q.answer).trim();
    const cells = [
      q.id,
      String(q.text || ''),
      q.required === false ? '否' : '是',
      opts || '—',
      answered ? String(q.answer) : '（待人工答复）',
      answered ? `${String(q.answeredAt || '').slice(0, 16).replace('T', ' ')} · ${q.answeredBy || '?'}` : '—',
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines;
}

function roundSection(rec, { current = false } = {}) {
  const label = CONFIRM_STATE_LABEL[rec.state] || rec.state;
  const blockLabel = BLOCK_TYPE_LABEL[rec.blockType] || rec.blockType;
  const lines = [];
  lines.push(`## 第 ${rec.round || 1} 轮${current ? '（当前）' : ''} · ${label} · ${blockLabel}`);
  lines.push('');
  lines.push(`- 声明：${rec.declaredAt || '?'}（${rec.declaredBy || '?'}）${rec.runId ? ` · 运行 ${rec.runId}` : ''}${rec.legacy ? ' · 历史账本恢复' : ''}`);
  if (rec.reason) lines.push(`- 原因：${rec.reason}`);
  if (rec.kind === 'develop') {
    lines.push('', ...commitFilesSection(rec));
  } else {
    lines.push('', ...analysisQuestionsSection(rec));
  }
  if (rec.resolvedAt) lines.push(`- 确认恢复：${rec.resolvedAt}`);
  if (rec.confirmedAt) lines.push(`- 答案确认：${rec.confirmedAt}`);
  lines.push('');
  if (Array.isArray(rec.events) && rec.events.length) {
    lines.push('事件留痕：');
    for (const e of rec.events) lines.push(eventLine(e));
    lines.push('');
  }
  return lines.join('\n');
}

export function renderConfirmDoc(dataDir, itemId, itemDir, title) {
  const confirms = readConfirms(dataDir);
  const cur = confirms.items[itemId] || null;
  const past = confirms.archived[itemId] || [];
  if (!cur && !past.length) return false;
  const parts = [
    `# 人工确认记录 — ${itemId} ${title || ''}`,
    '',
    '> 由 atb 挂起确认机制维护（REQ-20260914-001）：自动提交不完整 / 分析问题挂起 → 人工核对与确认 → 恢复闭环全程留痕。请勿手改。',
    '',
  ];
  if (cur) parts.push(roundSection(cur, { current: true }));
  if (past.length) {
    parts.push('## 历史轮次', '');
    for (const rec of past) parts.push(roundSection(rec), '');
  }
  try {
    fs.writeFileSync(path.join(itemDir, 'confirmations.md'), parts.join('\n').replace(/\n*$/, '\n'));
    return true;
  } catch {
    return false; // 文档写失败不阻断账本操作（账本是事实源）
  }
}
