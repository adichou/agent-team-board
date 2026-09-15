// REQ-20260914-001 自动提交不完整挂起并暂停队列 / AI 分析问题挂起 —— 业务编排层（confirm-store）。
// 闭环：挂起声明（develop：finishRun 自动触发；analyze：worker 经 atb refine hold 声明）
//   → 持久呈现（listConfirms / confirmDetail，CLI + Status Board 任务页「待人工确认」）
//   → 人工操作（重新核验 verifyCommitConfirm / 保持挂起 keepConfirm / 作答 answerAnalysisConfirm，
//     均人工专属——state-guard 拦 Agent）→ 确认并继续（confirmCommitContinue / confirmAnalysisContinue）。
// 开发侧确认成功 = 绑定指纹核验 + 授权补交（git-flow.supplementCommitForRun）+ 完整性与测试复验全过
// → 记录 resolved，调用方（server/CLI）再解除队列暂停（batch.pauseBatch false）恢复派发；
// 人工确认只解除提交阻塞，不代替需求验收（条目保持 in-progress，done 仍走既有「确认完成」）。
// 分析侧确认成功 = 必答齐备 + 版本/文档指纹未过期 → 记录 confirmed，调用方经 refine-store
// 把答案回传当前条目续跑（重排队首 + retryItems），收尾 done 时随闭环 closed-done。
// 事实源：<dataDir>/confirms/confirms.json（confirm-states）+ 条目目录 confirmations.md（人读留痕）。
// 本模块可 import core / git-flow / confirm-states；不得被 core 反向引用（core 只用 confirm-states）。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  AtbError, resolveItemDir, readStatus, actor,
} from './core.mjs';
import * as gitFlow from './git-flow.mjs';
import { legacyPaths, legacyRecoveryStatus } from './legacy-recovery.mjs';
import {
  readConfirms, confirmOf, activeConfirmOf, saveConfirmRecord, archiveConfirmRecord,
  renderConfirmDoc, unansweredRequired, answeredCount, questionsVersionOf,
  REASON_MAX_CHARS, CONFIRM_TEXT_MAX_CHARS, CONFIRM_MAX_QUESTIONS,
  BLOCK_TYPE_LABEL, KIND_LABEL, CONFIRM_STATE_LABEL,
} from './confirm-states.mjs';

// 原语再导出（server / CLI 直接引用；保持调用方单一 import 源）
export { confirmOf, activeConfirmOf, unansweredRequired, answeredCount };

const cleanText = (s) => String(s ?? '').trim();
const clipped = (s) => [...cleanText(s)].length;

function event(kind, by, note = '') {
  return { at: new Date().toISOString(), kind, by: by || 'human', ...(note ? { note } : {}) };
}

// ---------- 开发侧：挂起声明（batch.finishRun 自动触发；legacy 由服务端物化） ----------

// 自动提交结果是否构成「提交不完整」挂起（design 口径 1：提交完整性是收尾与后续派发的前置）。
// 完整跳过（不挂起）：git 历史已含单号（幂等）、本单无待提交改动（可验证原因已落账）、非 git 项目。
// 挂起：failed（含部分组失败）/ pendingManual（归属不明）/ heldGroups（暂扣）/ 其余 skipped
// （无快照无法归因、变更不归属本单、状态不可读等——无法证明完整即挂起，不得放行队列）。
export function commitIncompleteReason(autoCommit) {
  if (!autoCommit || typeof autoCommit !== 'object') return null;
  if ((Array.isArray(autoCommit.pendingManual) && autoCommit.pendingManual.length)
    || autoCommit.heldGroups) {
    return '自动提交不完整：存在归属不明或暂扣待人工路径';
  }
  if (autoCommit.status === 'failed') return `自动提交失败：${String(autoCommit.reason || '').slice(0, 80)}`;
  if (autoCommit.status === 'skipped') {
    const reason = String(autoCommit.reason || '');
    if (/幂等跳过|无待提交改动|不是 git 仓库/.test(reason)) return null;
    return `提交完整性无法确认：${reason.slice(0, 80)}`;
  }
  return null;
}

// 指纹：待人工路径 + 暂扣路径的当前内容状态（clean = 已入库/不在工作区）。
// 确认请求必须携带声明时的指纹；服务端重算比对——脏→脏内容变 = 内容已变（过期），
// 脏→clean = 人工已在终端补交（允许，核验时识别）。
export function commitFingerprint(projectRoot, paths) {
  const want = [...new Set((paths || []).filter(Boolean))].sort();
  return { version: 1, files: gitFlow.pathStates(projectRoot, want) };
}

export function declareCommitConfirm(dataDir, { run, batch, autoCommit, projectRoot, legacy = false, by = null }) {
  const itemId = run.itemId;
  const { dir } = resolveItemDir(dataDir, itemId);
  const st = readStatus(dir);
  const reason = commitIncompleteReason(autoCommit);
  if (!reason) throw new AtbError('自动提交完整，不应声明挂起（内部错误）');
  const active = activeConfirmOf(dataDir, itemId);
  if (active) {
    throw new AtbError(`${itemId} 已有活动挂起确认（${active.state}，第 ${active.round} 轮）：请先完成或作废后再声明新一轮`);
  }
  const cur = confirmOf(dataDir, itemId);
  if (cur) archiveConfirmRecord(dataDir, itemId);
  const rounds = readConfirms(dataDir).archived[itemId] || [];
  const pendingManual = [...(autoCommit.pendingManual || [])];
  const heldPaths = autoCommit.heldGroups
    ? [...(autoCommit.heldGroups.test || []), ...(autoCommit.heldGroups.biz || [])]
    : [];
  // BUG-20260915-003：指纹覆盖全部候选（声明扫描）——不只声明账面字段；git add 阶段失败
  // 未生成 pendingManual 时，实际候选（实现/测试/全局文件）同样绑定内容指纹，
  // 确认时内容变化一律拦截（不再漏检账面之外的候选）。基线在账本/留痕写入之后取：
  // 声明自身会写 .gitignore（补 confirms/）与 confirmations.md，先取基线会让首次确认
  // 必被误判「内容已变」；候选集也以留痕后的现场为准（confirmations.md 纳入基线）。
  const now = new Date().toISOString();
  // BUG-20260915-003：失败现场保留完整原始错误（summary 短句 + full 全文，full 缺失 =
  // 历史截断无原日志，如实标记信息不足，不编造原因）。
  let error = null;
  if (autoCommit && autoCommit.status === 'failed') {
    error = {
      summary: String(autoCommit.reason || '').slice(0, 160),
      full: autoCommit.errorFull ? String(autoCommit.errorFull).slice(0, 4000) : null,
    };
  }
  const rec = {
    state: 'waiting',
    round: rounds.length + 1,
    kind: 'develop',
    blockType: 'commit',
    itemId,
    title: st.title || itemId,
    runId: run.runId,
    batchId: (batch && batch.batchId) || run.batchId || null,
    owner: run.owner || null,
    declaredAt: now,
    declaredBy: by || 'auto-commit',
    reason: reason.slice(0, REASON_MAX_CHARS),
    legacy: Boolean(legacy),
    projectRoot: projectRoot || null, // 确认/核验时重算指纹与补交的工作目录
    fingerprint: { version: 1, files: {} }, // 落账后按留痕后的现场补全（见下）
    committedGroups: (autoCommit.commits || []).map((c) => ({
      kind: 'auto', hash: c.hash, subject: c.subject, paths: [],
    })),
    pendingManual,
    heldGroups: autoCommit.heldGroups
      ? { test: [...(autoCommit.heldGroups.test || [])], biz: [...(autoCommit.heldGroups.biz || [])] }
      : null,
    ...(error ? { error } : {}),
    supplement: null,
    verify: null,
    keepNote: null,
    resolvedAt: null,
    events: [event('declared', by || 'auto-commit', reason.slice(0, 120))],
  };
  saveConfirmRecord(dataDir, itemId, rec);
  renderConfirmDoc(dataDir, itemId, dir, st.title);
  let scope = null;
  try {
    scope = gitFlow.confirmScopeForRun({ dataDir, projectRoot, run });
  } catch { scope = null; }
  const scopePathsNow = scope ? [...scope.attributed, ...scope.uncertain].map((x) => x.path) : [];
  const fpPaths = [...new Set([...pendingManual, ...heldPaths, ...scopePathsNow])];
  rec.fingerprint = commitFingerprint(projectRoot, fpPaths);
  return saveConfirmRecord(dataDir, itemId, rec);
}

// ---------- 开发侧：核验 / 保持挂起 / 确认并继续 ----------

// 项目测试运行（补交后验证「测试验证的是提交后的完整内容」）：package.json 有 scripts.test
// 才运行；无测试脚本按纯文档/无测试口径跳过（不凭空要求）。
export function runProjectTests(projectRoot, timeoutMs = 600_000) {
  let pkg = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  } catch {
    return { skipped: true, reason: '项目无 package.json，无测试脚本可运行' };
  }
  const cmd = pkg && pkg.scripts && pkg.scripts.test;
  if (!cmd) return { skipped: true, reason: '项目未配置测试脚本（npm test），按声明的文件范围核验' };
  const r = spawnSync('npm', ['test', '--silent'], {
    cwd: projectRoot, encoding: 'utf8', timeout: timeoutMs,
    env: { ...process.env, npm_config_progress: 'false', npm_config_loglevel: 'silent' },
  });
  const tail = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n').slice(-15).join('\n').slice(0, 2000);
  return {
    cmd: 'npm test',
    exitCode: r.status,
    ok: r.status === 0,
    timedOut: r.error && r.error.code === 'ETIMEDOUT' ? true : undefined,
    tail: tail || null,
  };
}

// BUG-20260915-003 统一候选范围（清单计数 / 文件表 / 核验 / 确认补交同源）：
// confirmScopeForRun 是唯一口径；本层按记录读取 run 并容错（run 缺失 / 非 git / 无快照
// 返回 null——呈现「待核对」，不显示误导性 0）。
function scopeOfRec(dataDir, projectRoot, rec) {
  const root = projectRoot || rec.projectRoot;
  if (!root || !rec.runId) return null;
  let run = null;
  try {
    run = JSON.parse(fs.readFileSync(path.join(dataDir, 'dispatch', 'runs', rec.runId, 'run.json'), 'utf8'));
  } catch { return null; }
  try {
    return gitFlow.confirmScopeForRun({ dataDir, projectRoot: root, run });
  } catch { return null; }
}

const scopePaths = (scope) => (scope ? [...scope.attributed, ...scope.uncertain] : []);

// 已加载 run 的直接扫描（verify / continue 用；异常吞掉按无法扫描处理）
function scopeOfRun(dataDir, run, root) {
  try {
    return gitFlow.confirmScopeForRun({ dataDir, projectRoot: root, run });
  } catch { return null; }
}

// 核验原因（与面板分组计数同源）：先说总数与分组，再说归属待确认的处理要求。
function scopeReasons(scope) {
  const a = scope.attributed.length;
  const u = scope.uncertain.length;
  if (!a && !u) return [];
  const all = scopePaths(scope);
  const shown = all.slice(0, 5).map((x) => x.path).join('、');
  const reasons = [
    `仍有 ${a + u} 个候选路径未入库（本单可归属 ${a} · 归属待确认 ${u}）：${shown}${all.length > 5 ? ` 等 ${all.length} 个` : ''}——与面板计数同源`,
  ];
  if (u) reasons.push(`归属待确认 ${u} 个路径需人工选择「计入本次补交 / 排除」后才能确认补交范围（看板面板逐项选择）`);
  return reasons;
}

// 重新核验（人工入口，幂等可重试）：重算候选范围 + 可选跑测试；结果落账本与卡片。
// 「人工已在终端补交」在此被识别：剩余路径为空且 git 历史含本单号提交即核验通过方向。
// BUG-20260915-003：重新核验 = 人工重新核对——指纹基线刷新为当前候选内容，其后的确认
// 绑定最新所见（内容变化 → 确认拦截 → 重新核验 → 确认 的闭环入口）。
export function verifyCommitConfirm(dataDir, itemId, { projectRoot, runTests = false, by = 'human' } = {}) {
  const rec = requireDevelopWaiting(dataDir, itemId);
  const run = requireRun(dataDir, rec);
  const root = projectRoot || rec.projectRoot;
  const scope = root ? scopeOfRun(dataDir, run, root) : null;
  const paths = scopePaths(scope);
  const reasons = scope ? scopeReasons(scope)
    : ['无法归因核验（非 git 仓库 / 缺少预留时工作区快照）：请人工在终端核对提交后重试'];
  let test = null;
  if (scope && !paths.length && runTests) {
    test = runProjectTests(root);
    if (!test.skipped && !test.ok) {
      reasons.push(`测试未通过（${test.cmd} 退出码 ${test.exitCode}）：提交后内容验证失败`);
    }
  }
  const ok = reasons.length === 0;
  rec.verify = {
    lastCheckAt: new Date().toISOString(),
    ok,
    reasons,
    remaining: paths.map((x) => x.path),
    test: test || undefined,
  };
  if (scope) {
    rec.fingerprint = { version: 1, files: gitFlow.pathStates(root, paths.map((x) => x.path)) };
  }
  rec.events.push(event('verified', by, ok
    ? '核验通过（指纹基线刷新为当前内容）'
    : `核验未通过（${reasons.length} 项；指纹基线刷新为当前内容）`));
  saveConfirmRecord(dataDir, itemId, rec);
  renderConfirmDoc(dataDir, itemId, resolveItemDir(dataDir, itemId).dir, rec.title);
  if (scope) {
    // 指纹基线在留痕写入之后刷新：verify 事件写 confirmations.md，先刷新会被自身
    // 留痕污染成「内容已变」，导致重新核验后的确认被误拦截。
    rec.fingerprint = { version: 1, files: gitFlow.pathStates(root, paths.map((x) => x.path)) };
    saveConfirmRecord(dataDir, itemId, rec);
  }
  return { ok, reasons, remaining: paths.map((x) => x.path), test };
}

// 保持挂起（人工专属）：保留现场与队列暂停，记录处理说明；取消队列须另走显式终止/恢复。
export function keepConfirm(dataDir, itemId, { note = '', by = 'human' } = {}) {
  const rec = requireWaiting(dataDir, itemId);
  note = cleanText(note);
  if (clipped(note) > CONFIRM_TEXT_MAX_CHARS) throw new AtbError(`处理说明过长（≤${CONFIRM_TEXT_MAX_CHARS} 字）`);
  rec.keepNote = note || null;
  rec.events.push(event('kept', by, note || '保持挂起：现场与队列暂停保留'));
  saveConfirmRecord(dataDir, itemId, rec);
  renderConfirmDoc(dataDir, itemId, resolveItemDir(dataDir, itemId).dir, rec.title);
  return { ok: true, itemId, state: rec.state };
}

// 确认并继续（人工专属，C05–C08；BUG-20260915-003 范围收口）：
// 1) 指纹绑定核验：确认携带声明/上次核验时指纹；脏→脏内容变 → 过期保持挂起；脏→clean
//    （终端已补交）放行；
// 2) 候选范围与归属选择（与核验/面板同源）：include 显式携带归属待确认中「计入」的路径；
//    未携带（CLI / 旧入口）默认只计入已声明 pendingManual/暂扣路径——全局文件不静默并入；
//    声明/上次核对后新增的归属待确认路径未经核对 → 拦截要求先重新核验（不遗漏文件）；
// 3) 授权补交：本单可归属 + 已计入的归属待确认路径整文件提交（幂等，不重复提交）；
// 4) 完整性 + 测试复验：确认范围内路径清零且（有测试脚本时）npm test 通过才放行；
// 5) 全过 → 记录 resolved（补交 hash 落账），返回 batchId 供调用方恢复队列。
// 任一失败：保持挂起并逐项说明原因（可重新核验 / 修正后重试）。幂等：已 resolved 直接成功返回。
export function confirmCommitContinue(dataDir, itemId, { projectRoot = null, fingerprint = null, note = '', by = 'human', runTests = true, include = null } = {}) {
  const rec = requireDevelopWaiting(dataDir, itemId);
  if (rec.state === 'resolved') {
    return { ok: true, idempotent: true, itemId, batchId: rec.batchId };
  }
  const root = projectRoot || rec.projectRoot;
  if (!root) throw new AtbError('确认补交需要项目根目录（projectRoot）参数');
  const run = requireRun(dataDir, rec);
  const reasons = [];
  // 指纹比对（未携带指纹 = 无效确认：必须绑定人工所见内容版本）
  const carried = fingerprint && fingerprint.files && typeof fingerprint.files === 'object'
    ? fingerprint.files : null;
  if (!carried) {
    reasons.push('确认未携带内容指纹（无效确认）：请刷新卡片核对当前差异后重试');
  } else {
    const now = gitFlow.pathStates(root, Object.keys(rec.fingerprint.files));
    const terminalSupplement = [];
    for (const [p, was] of Object.entries(rec.fingerprint.files)) {
      const cur = now[p];
      if (cur === was) continue;
      if (cur === 'clean' && was !== 'clean') { terminalSupplement.push(p); continue; } // 人工已在终端补交
      if (was === 'clean' && cur !== 'clean') reasons.push(`路径 ${p} 在确认后出现新的未提交改动（内容已变）`);
      else reasons.push(`路径 ${p} 内容已变（确认时所见与当前不一致），请重新核对差异`);
    }
    if (terminalSupplement.length) {
      rec.events.push(event('terminal-supplement', by, `人工已在终端补交：${terminalSupplement.slice(0, 5).join('、')}`));
    }
  }
  // BUG-20260915-003：候选范围与归属选择（本单可归属 + 归属待确认中计入的路径）
  const scope = scopeOfRun(dataDir, run, root);
  const declared = new Set([
    ...(rec.pendingManual || []),
    ...(rec.heldGroups ? [...(rec.heldGroups.test || []), ...(rec.heldGroups.biz || [])] : []),
  ]);
  const explicit = Array.isArray(include);
  const includeSet = new Set((explicit ? include : [...declared]).filter(Boolean));
  if (scope == null) {
    reasons.push('无法归因确认补交（非 git 仓库 / 缺少预留时工作区快照 / 状态不可读）：请人工在终端核对提交后重试');
  } else {
    // 声明/上次核对后新增的归属待确认路径：未经人工核对不得确认（防静默遗漏）
    const fpFiles = (rec.fingerprint && rec.fingerprint.files) || {};
    for (const x of scope.uncertain) {
      if (!(x.path in fpFiles)) {
        reasons.push(`路径 ${x.path} 为新的归属待确认改动（确认前未核对）：请先「重新核验」核对最新差异后再确认`);
      }
    }
  }
  // 授权补交（无指纹硬错误时也尝试补交剩余路径——人工已明确确认归属）
  let supplement = null;
  if (!reasons.length && scope != null) {
    supplement = gitFlow.supplementCommitForRun({ dataDir, projectRoot: root, run, include: [...includeSet] });
    if (supplement.status === 'failed') {
      reasons.push(`补交失败：${supplement.reason}`);
    }
  }
  // 完整性 + 测试复验（只按确认范围：本单可归属 + 已计入；排除项保留工作区不算未入库）
  let test = null;
  if (!reasons.length && scope != null) {
    const after = scopeOfRun(dataDir, run, root);
    const left = after ? [
      ...after.attributed,
      ...after.uncertain.filter((x) => includeSet.has(x.path)),
    ] : [];
    if (left.length) {
      const shown = left.slice(0, 5).map((x) => x.path).join('、');
      reasons.push(`仍有 ${left.length} 个确认范围内路径未入库：${shown}${left.length > 5 ? ` 等 ${left.length} 个` : ''}`);
    } else if (runTests) {
      test = runProjectTests(root);
      if (!test.skipped && !test.ok) {
        reasons.push(`测试未通过（${test.cmd} 退出码 ${test.exitCode}）：提交后内容验证失败`);
      }
    }
  }
  note = cleanText(note);
  if (clipped(note) > CONFIRM_TEXT_MAX_CHARS) throw new AtbError(`处理说明过长（≤${CONFIRM_TEXT_MAX_CHARS} 字）`);
  if (reasons.length) {
    rec.verify = {
      lastCheckAt: new Date().toISOString(), ok: false, reasons,
      remaining: [], test: test || undefined,
    };
    rec.events.push(event('confirm-rejected', by, reasons[0].slice(0, 120)));
    saveConfirmRecord(dataDir, itemId, rec);
    renderConfirmDoc(dataDir, itemId, resolveItemDir(dataDir, itemId).dir, rec.title);
    return { ok: false, itemId, reasons };
  }
  const nowIso = new Date().toISOString();
  if (supplement && Array.isArray(supplement.commits) && supplement.commits.length) {
    rec.supplement = { commits: supplement.commits, at: nowIso, by };
  } else if (!rec.supplement) {
    rec.supplement = { commits: [], at: nowIso, by, note: '无可归因待补交路径（可能已由人工在终端补交）' };
  }
  rec.verify = {
    lastCheckAt: nowIso, ok: true, reasons: [], remaining: [], test: test || undefined,
  };
  rec.state = 'resolved';
  rec.resolvedAt = nowIso;
  rec.events.push(event('confirmed', by, `确认并继续：${(rec.supplement.commits || []).length} 组补交，核验通过，恢复队列`));
  saveConfirmRecord(dataDir, itemId, rec);
  renderConfirmDoc(dataDir, itemId, resolveItemDir(dataDir, itemId).dir, rec.title);
  return {
    ok: true, itemId, batchId: rec.batchId,
    supplementCommits: (rec.supplement.commits || []).map((c) => c.hash),
  };
}

function requireWaiting(dataDir, itemId) {
  const rec = confirmOf(dataDir, itemId);
  if (!rec) throw new AtbError(`${itemId} 没有挂起确认记录（atb confirm list 查看）`);
  if (rec.state !== 'waiting') {
    throw new AtbError(`${itemId} 挂起确认当前为 ${rec.state}（${CONFIRM_STATE_LABEL[rec.state] || rec.state}），无需人工操作`);
  }
  return rec;
}

function requireDevelopWaiting(dataDir, itemId) {
  const rec = confirmOf(dataDir, itemId);
  if (!rec || rec.kind !== 'develop') throw new AtbError(`${itemId} 没有待人工确认提交的挂起记录`);
  if (rec.state === 'resolved') return rec; // 幂等入口（continue）
  if (rec.state !== 'waiting') {
    throw new AtbError(`${itemId} 提交挂起当前为 ${rec.state}，无需确认`);
  }
  return rec;
}

// run 读取（含 projectRoot 便于核验；dispatch run 与账本解耦读取）
function requireRun(dataDir, rec) {
  const runFile = path.join(dataDir, 'dispatch', 'runs', rec.runId, 'run.json');
  let run = null;
  try {
    run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  } catch {
    throw new AtbError(`找不到挂起关联的运行记录：${rec.runId}（dispatch/runs/）`);
  }
  return run;
}

// ---------- 分析侧：声明 / 作答 / 确认 ----------

export function declareAnalysisConfirm(dataDir, { itemId, runId, batchId, reason = '', background = '', questions = [], by = null }) {
  const { dir } = resolveItemDir(dataDir, itemId);
  const st = readStatus(dir);
  const qsIn = Array.isArray(questions) ? questions : [];
  if (!qsIn.length) throw new AtbError('分析挂起必须携带至少一个待人工确认问题');
  if (qsIn.length > CONFIRM_MAX_QUESTIONS) throw new AtbError(`问题最多 ${CONFIRM_MAX_QUESTIONS} 项（收到 ${qsIn.length} 项）`);
  const seen = new Set();
  const qs = qsIn.map((q, i) => {
    const text = cleanText(q && q.text);
    if (!text) throw new AtbError(`第 ${i + 1} 项问题文本不能为空`);
    if (clipped(text) > CONFIRM_TEXT_MAX_CHARS) throw new AtbError(`问题过长（≤${CONFIRM_TEXT_MAX_CHARS} 字）：${text.slice(0, 20)}…`);
    let id = cleanText(q.id) || `q${i + 1}`;
    if (seen.has(id)) id = `q${i + 1}`;
    seen.add(id);
    const options = (Array.isArray(q.options) ? q.options : []).map((o) => {
      const label = cleanText(o && o.label);
      if (!label) throw new AtbError(`${id} 选项文本不能为空`);
      return {
        label,
        impact: cleanText(o && o.impact) || null,
        recommended: Boolean(o && o.recommended),
      };
    });
    return {
      id, text,
      required: q.required === false ? false : true,
      options,
      answer: null, answeredAt: null, answeredBy: null, note: null,
    };
  });
  reason = cleanText(reason);
  if (!reason) throw new AtbError('分析挂起必须携带 reason（≤200 字短句说明阻塞原因）');
  if (clipped(reason) > REASON_MAX_CHARS) throw new AtbError(`reason 过长（≤${REASON_MAX_CHARS} 字）`);
  background = cleanText(background);
  if (clipped(background) > CONFIRM_TEXT_MAX_CHARS) throw new AtbError(`background 过长（≤${CONFIRM_TEXT_MAX_CHARS} 字）`);
  // 活动轮（waiting 未答 / confirmed 已回传续跑未收尾）重新声明 = 问题清单更新：旧轮整体归档
  // （人工已答内容留痕可追溯），开新一轮并刷新版本绑定（旧确认自然过期，C19）。校验全部通过
  // 后才归档，非法入参不破坏在答现场。
  const cur = confirmOf(dataDir, itemId);
  if (cur) archiveConfirmRecord(dataDir, itemId);
  const rounds = readConfirms(dataDir).archived[itemId] || [];
  const now = new Date().toISOString();
  // 文档指纹绑定（C19）：确认时重算比对，声明后被编辑即过期须重新确认
  let docsFp = null;
  try {
    docsFp = fingerprintOfDocs(dir);
  } catch { docsFp = null; }
  const rec = {
    state: 'waiting',
    round: rounds.length + 1,
    kind: 'analyze',
    blockType: 'analysis',
    itemId,
    title: st.title || itemId,
    runId: runId || null,
    batchId: batchId || null,
    owner: null,
    declaredAt: now,
    declaredBy: by || actor(),
    reason: reason.slice(0, REASON_MAX_CHARS),
    legacy: false,
    background: background || null,
    questions: qs,
    docsFingerprint: docsFp,
    confirmedAt: null,
    events: [event('declared', by || actor(), reason.slice(0, 120))],
  };
  rec.questionsVersion = questionsVersionOf(rec);
  saveConfirmRecord(dataDir, itemId, rec);
  renderConfirmDoc(dataDir, itemId, dir, st.title);
  return saveConfirmRecord(dataDir, itemId, rec);
}

// 文档指纹（分析侧绑定）：README + design + test-cases + ui-demo 内容 sha1（与 refine 指纹同文件集口径）
function fingerprintOfDocs(dir) {
  const files = ['README.md', 'design.md', 'test-cases.md', 'ui-demo.html'];
  const h = crypto.createHash('sha1');
  for (const name of files) {
    let content = null;
    try { content = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { /* 缺失 */ }
    h.update(name); h.update('\u0000');
    h.update(content == null ? '<missing>' : content); h.update('\u0001');
  }
  return h.digest('hex');
}

// 作答（人工专属；支持部分作答草稿——保存草稿不解除阻塞）
export function answerAnalysisConfirm(dataDir, itemId, { answers = [], by = 'human' } = {}) {
  const rec = requireWaiting(dataDir, itemId);
  if (rec.kind !== 'analyze') throw new AtbError(`${itemId} 的挂起为提交核验型（${BLOCK_TYPE_LABEL.commit}），不作答问题`);
  const list = Array.isArray(answers) ? answers : [];
  if (!list.length) throw new AtbError('作答必须携带 answers: [{ q, text, note? }]（逐项作答，支持草稿）');
  const byId = new Map(rec.questions.map((q) => [q.id, q]));
  for (const a of list) {
    const q = byId.get(String(a && a.q || ''));
    if (!q) {
      throw new AtbError(`未知问题：${a && a.q}（本单问题号：${rec.questions.map((x) => x.id).join(' / ')}）`);
    }
    const text = cleanText(a.text);
    if (text && clipped(text) > CONFIRM_TEXT_MAX_CHARS) throw new AtbError(`${q.id} 答复过长（≤${CONFIRM_TEXT_MAX_CHARS} 字）`);
    const note = cleanText(a.note || '');
    if (clipped(note) > CONFIRM_TEXT_MAX_CHARS) throw new AtbError(`${q.id} 补充说明过长（≤${CONFIRM_TEXT_MAX_CHARS} 字）`);
    q.answer = text || null;
    q.note = note || null;
    if (text) {
      q.answeredAt = new Date().toISOString();
      q.answeredBy = by;
    } else {
      q.answeredAt = null;
      q.answeredBy = null;
    }
  }
  rec.events.push(event('answered', by, `作答 ${list.length} 项（草稿即时保存）`));
  saveConfirmRecord(dataDir, itemId, rec);
  renderConfirmDoc(dataDir, itemId, resolveItemDir(dataDir, itemId).dir, rec.title);
  const missing = unansweredRequired(rec);
  return {
    ok: true, itemId,
    answered: answeredCount(rec),
    total: rec.questions.length,
    ...(missing.length ? { missing } : { ready: true }),
  };
}

// 确认并继续（分析侧，C18–C20）：必答齐备 + 版本未过期（问题清单与文档均未被改）
// → 记录 confirmed（答案与确认时间落账可追溯），调用方经 refine-store 回传续跑。
// 幂等：已 confirmed 直接成功返回；失败保留答案与挂起并说明原因（可重试）。
export function confirmAnalysisContinue(dataDir, itemId, { version = '', by = 'human' } = {}) {
  const rec0 = confirmOf(dataDir, itemId);
  if (!rec0 || rec0.kind !== 'analyze') throw new AtbError(`${itemId} 没有待人工确认分析的挂起记录`);
  // 幂等先行（C20）：已 confirmed 的重复确认直接成功返回，不重复启动续跑
  if (rec0.state === 'confirmed') {
    return { ok: true, idempotent: true, itemId, runId: rec0.runId, batchId: rec0.batchId };
  }
  const rec = requireWaiting(dataDir, itemId);
  if (rec.kind !== 'analyze') throw new AtbError(`${itemId} 的挂起为提交核验型，不走分析确认`);
  const reasons = [];
  const missing = unansweredRequired(rec);
  if (missing.length) {
    reasons.push(`必答问题未答齐（缺 ${missing.join(' / ')}）：完成作答后才能确认并继续`);
  }
  const wantVersion = cleanText(version);
  if (!wantVersion) {
    reasons.push('确认未携带问题版本（无效确认）：请刷新面板核对当前问题清单后重试');
  } else if (wantVersion !== rec.questionsVersion) {
    reasons.push('确认已过期：问题清单或文档在确认前已更新，请按最新问题清单重新核对作答');
  }
  if (rec.docsFingerprint) {
    const nowFp = fingerprintOfDocs(resolveItemDir(dataDir, itemId).dir);
    if (nowFp !== rec.docsFingerprint) {
      reasons.push('条目文档在声明后被修改：确认过期，请重新核对（如需保留修改请重新声明问题）');
    }
  }
  if (reasons.length) {
    rec.events.push(event('confirm-rejected', by, reasons[0].slice(0, 120)));
    saveConfirmRecord(dataDir, itemId, rec);
    renderConfirmDoc(dataDir, itemId, resolveItemDir(dataDir, itemId).dir, rec.title);
    return { ok: false, itemId, reasons };
  }
  rec.state = 'confirmed';
  rec.confirmedAt = new Date().toISOString();
  rec.events.push(event('confirmed', by, '答案齐备且版本有效：回传当前条目续跑'));
  saveConfirmRecord(dataDir, itemId, rec);
  renderConfirmDoc(dataDir, itemId, resolveItemDir(dataDir, itemId).dir, rec.title);
  return { ok: true, itemId, runId: rec.runId, batchId: rec.batchId };
}

// 分析收尾闭环（refine done 时调用）：confirmed → closed-done
export function closeAnalysisConfirm(dataDir, itemId, { by = 'system' } = {}) {
  const rec = confirmOf(dataDir, itemId);
  if (!rec || rec.kind !== 'analyze' || rec.state !== 'confirmed') return false;
  rec.state = 'closed-done';
  rec.events.push(event('closed-done', by, '分析收尾完成，随完成闭环'));
  saveConfirmRecord(dataDir, itemId, rec);
  renderConfirmDoc(dataDir, itemId, resolveItemDir(dataDir, itemId).dir, rec.title);
  return true;
}

// ---------- 呈现（CLI 清单 / Status Board 聚合，只读） ----------

function viewRecord(dataDir, rec, { projectRoot = null } = {}) {
  let status = '';
  try {
    status = readStatus(resolveItemDir(dataDir, rec.itemId).dir).status;
  } catch { /* 条目已删除：按账面呈现 */ }
  const base = {
    itemId: rec.itemId,
    title: rec.title || '',
    itemStatus: status,
    kind: rec.kind,
    kindLabel: KIND_LABEL[rec.kind] || rec.kind,
    blockType: rec.blockType,
    blockTypeLabel: BLOCK_TYPE_LABEL[rec.blockType] || rec.blockType,
    state: rec.state,
    stateLabel: CONFIRM_STATE_LABEL[rec.state] || rec.state,
    round: rec.round || 1,
    declaredAt: rec.declaredAt,
    declaredBy: rec.declaredBy,
    runId: rec.runId || null,
    batchId: rec.batchId || null,
    reason: rec.reason || null,
    legacy: Boolean(rec.legacy),
    keepNote: rec.keepNote || null,
    updatedAt: rec.updatedAt || rec.declaredAt,
  };
  if (rec.kind === 'develop') {
    const heldPaths = rec.heldGroups
      ? [...(rec.heldGroups.test || []), ...(rec.heldGroups.biz || [])]
      : [];
    const supplementHashes = (rec.supplement && rec.supplement.commits || []).map((c) => c.hash);
    // BUG-20260915-003：待人工计数与文件表/核验同源（候选范围实时扫描，含 git add 失败
    // 未生成 pendingManual 的现场）；无法扫描 → pendingCount:null（呈现「待核对」，
    // 不显示误导性 0）。
    const scope = scopeOfRec(dataDir, projectRoot, rec);
    const scopeKnown = scope != null;
    const pendingList = scopeKnown
      ? scopePaths(scope).map((x) => x.path)
      : [...(rec.pendingManual || []), ...heldPaths];
    return {
      ...base,
      committedCount: (rec.committedGroups || []).length + supplementHashes.length,
      pendingCount: scopeKnown ? pendingList.length : null,
      attributedCount: scopeKnown ? scope.attributed.length : null,
      uncertainCount: scopeKnown ? scope.uncertain.length : null,
      scopeUnknown: !scopeKnown,
      pendingManual: [...(rec.pendingManual || [])],
      heldGroups: rec.heldGroups
        ? { test: [...(rec.heldGroups.test || [])], biz: [...(rec.heldGroups.biz || [])] }
        : null,
      supplementCommits: supplementHashes,
      verify: rec.verify || null,
      fingerprint: rec.fingerprint || null,
      error: rec.error
        ? { summary: rec.error.summary || null, full: rec.error.full || null }
        : null,
      partialBadge: Boolean((rec.pendingManual || []).length || heldPaths.length
        || /不完整|失败/.test(String(rec.reason || ''))),
    };
  }
  return {
    ...base,
    background: rec.background || null,
    questions: (rec.questions || []).map((q) => ({
      id: q.id, text: q.text, required: q.required !== false,
      options: (q.options || []).map((o) => ({
        label: o.label, impact: o.impact || null, recommended: Boolean(o.recommended),
      })),
      answer: q.answer || null, answeredAt: q.answeredAt || null, answeredBy: q.answeredBy || null,
      note: q.note || null,
    })),
    questionsVersion: rec.questionsVersion || null,
    answered: answeredCount(rec),
    unansweredRequired: unansweredRequired(rec),
    total: (rec.questions || []).length,
    confirmedAt: rec.confirmedAt || null,
  };
}

// 活动清单（waiting + confirmed；all=true 含各终态最近一轮），最早声明在前
export function listConfirms(dataDir, { all = false, projectRoot = null } = {}) {
  const confirms = readConfirms(dataDir);
  let recs = Object.values(confirms.items);
  if (!all) recs = recs.filter((r) => r.state === 'waiting' || r.state === 'confirmed');
  recs.sort((a, b) =>
    String(a.declaredAt || '').localeCompare(String(b.declaredAt || '')) ||
    String(a.itemId || '').localeCompare(String(b.itemId || '')));
  return { count: recs.length, items: recs.map((r) => viewRecord(dataDir, r, { projectRoot })) };
}

export function confirmDetail(dataDir, itemId, { projectRoot = null } = {}) {
  const rec = confirmOf(dataDir, itemId);
  if (!rec) throw new AtbError(`${itemId} 没有挂起确认记录（atb confirm list 查看全部）`);
  const view = viewRecord(dataDir, rec, { projectRoot });
  view.events = (rec.events || []).slice();
  view.archivedRounds = (readConfirms(dataDir).archived[itemId] || []).length;
  if (rec.kind === 'develop') {
    // BUG-20260915-003：文件表与计数/核验同源（候选范围实时扫描 + 归属分组 + 变更类型 +
    // 逐文件当前状态）；无法扫描回退声明字段口径并标记 scopeUnknown（「待核对」）。
    const scope = scopeOfRec(dataDir, projectRoot, rec);
    const root = projectRoot || rec.projectRoot;
    if (scope && root) {
      const paths = scopePaths(scope).map((x) => x.path);
      const states = gitFlow.pathStates(root, paths);
      view.files = scopePaths(scope).map((x) => ({
        path: x.path,
        group: scope.attributed.includes(x) ? 'own' : 'undetermined',
        kind: x.kind,
        why: x.why || null,
        state: states[x.path] === 'clean' ? '已入库' : '未提交',
        atDeclare: (rec.fingerprint && rec.fingerprint.files[x.path]) || null,
      }));
    } else {
      const paths = [
        ...(rec.pendingManual || []),
        ...(rec.heldGroups ? [...(rec.heldGroups.test || []), ...(rec.heldGroups.biz || [])] : []),
      ];
      const states = root ? gitFlow.pathStates(root, paths) : {};
      view.files = paths.map((p) => ({
        path: p,
        group: (rec.pendingManual || []).includes(p) ? 'undetermined' : 'own',
        kind: '修改',
        why: null,
        state: states[p] === 'clean' ? '已入库' : '未提交',
        atDeclare: (rec.fingerprint && rec.fingerprint.files[p]) || null,
      }));
    }
  }
  return view;
}

// ---------- C14 历史部分提交账本恢复 ----------

// 盘点历史 reported 运行：有效的运行级处理证据优先，避免同路径新修改复活旧记录。
// 无证据时展示仍脏的遗留/暂扣路径；证据失效时保持可见供重新核验，读取过程不写账本。
export function legacyConfirmViews(dataDir, projectRoot) {
  const runsDir = path.join(dataDir, 'dispatch', 'runs');
  let names = [];
  try { names = fs.readdirSync(runsDir); } catch { return []; }
  const out = [];
  for (const runId of names) {
    let ac = null;
    try {
      ac = JSON.parse(fs.readFileSync(path.join(runsDir, runId, 'auto-commit.json'), 'utf8'));
    } catch { continue; }
    const pending = legacyPaths(ac);
    if (!pending.length || !ac.itemId) continue;
    if (confirmOf(dataDir, ac.itemId)?.runId === runId) continue; // 仅同一运行使用已有确认记录
    let run = null;
    try {
      run = JSON.parse(fs.readFileSync(path.join(runsDir, runId, 'run.json'), 'utf8'));
    } catch { continue; }
    if (run.phase !== 'reported') continue;
    const recovery = legacyRecoveryStatus(dataDir, projectRoot, runId);
    if (recovery.valid) continue;
    const states = gitFlow.pathStates(projectRoot, pending);
    // 证据失效时即使当前文件干净也不能声称旧运行已处理。
    const stillDirty = recovery.exists ? pending : pending.filter((p) => states[p] !== 'clean');
    if (!stillDirty.length) continue; // 历史待人工路径已全部入库：不误报
    let title = ac.itemTitle || '';
    try { title = readStatus(resolveItemDir(dataDir, ac.itemId).dir).title || title; } catch {}
    out.push({
      itemId: ac.itemId,
      title,
      kind: 'develop',
      kindLabel: KIND_LABEL.develop,
      blockType: 'commit',
      blockTypeLabel: BLOCK_TYPE_LABEL.commit,
      state: 'waiting',
      stateLabel: CONFIRM_STATE_LABEL.waiting,
      round: 1,
      declaredAt: ac.createdAt || run.finishedAt || run.createdAt,
      declaredBy: 'ledger-recovery',
      runId,
      batchId: run.batchId || null,
      reason: recovery.exists ? `历史处理证据需重新核验（${runId}）：${recovery.reason}` : `历史部分提交（${runId}）：${pending.length} 个路径待人工，其中 ${stillDirty.length} 个仍未入库`,
      legacy: true,
      keepNote: null,
      committedCount: (ac.commits || []).length,
      pendingCount: stillDirty.length,
      pendingManual: stillDirty,
      heldGroups: ac.heldGroups || null,
      supplementCommits: [],
      verify: null,
      fingerprint: { version: 1, files: gitFlow.pathStates(projectRoot, stillDirty) },
      partialBadge: true,
      updatedAt: ac.createdAt || null,
    });
  }
  out.sort((a, b) => String(a.declaredAt || '').localeCompare(String(b.declaredAt || '')));
  return out;
}

// 已等待时长的可读文案（CLI / 面板共用口径，与 hold-store.waitingText 同形）
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
