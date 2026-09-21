// REQ-20260921-008 发布模块文档编写页优化 —— AI 总结执行账本（docs-summary-store）。
// 「AI 总结」是发布文档流水线（总结 → 审查 → 提交）的第一段：主会话把提示词交给技术写作
// 子代理逐文件总结八个发布文档；子代理经 atb summary CLI 逐文件回执进度，本账本落盘供
// 看板（文档编写页 / 任务模块 / 全局任务面板）轮询展示。
// 隔离口径（README 需求 5）：
//   - 独立锁 .locks/summary.lock：与 AI 开发（impl.lock）、AI 分析（refine.lock）互不占用；
//   - 不并入 TASK_KINDS（AI 总结无 Agent / 模型分路配置诉求，不进任务设置）；
//   - 不进 REQ/BUG 状态机、不占条目状态——只服务于版本发布文档。
// 事实源：<dataDir>/runtime/docs-summary/runs/<runId>/run.json（runId 形如 sum-YYYYMMDD-HHMMSS-xxxx）。
// 锁生命周期：start 占用 → done/fail 释放；无超时自动接管（与 impl/refine 锁同口径），
// 中断悬挂由任务面板暴露 owner 人工核对后 fail 收尾再重启。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AtbError, acquireLock, writeJsonAtomic } from './core.mjs';
import { publishDocFiles, docLangsOf } from './publish-flow.mjs';

export const SUMMARY_FILE_STATES = ['pending', 'summarizing', 'summarized'];
export const SUMMARY_RUN_PHASES = ['running', 'done', 'failed'];
export const SUMMARY_REASON_MAX_CHARS = 200;

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const nowIso = () => new Date().toISOString();

export function docsSummaryDir(dataDir) {
  return path.join(dataDir, 'runtime', 'docs-summary');
}
export function docsSummaryRunsDir(dataDir) {
  return path.join(docsSummaryDir(dataDir), 'runs');
}
export function docsSummaryRunDir(dataDir, runId) {
  if (!/^sum-\d{8}-\d{6}-[0-9a-f]{4,}$/.test(String(runId))) throw new AtbError(`非法 runId：${runId}`);
  return path.join(docsSummaryRunsDir(dataDir), runId);
}

// 幂等初始化：目录 + .gitignore（执行账本不进版本控制）
export function ensureDocsSummary(dataDir) {
  fs.mkdirSync(docsSummaryRunsDir(dataDir), { recursive: true });
  const gi = path.join(dataDir, 'runtime', '.gitignore');
  const wanted = 'docs-summary/runs/';
  let cur = '';
  try { cur = fs.readFileSync(gi, 'utf8'); } catch {}
  if (!cur.split('\n').includes(wanted)) fs.writeFileSync(gi, cur.replace(/\n*$/, '\n') + wanted + '\n');
}

function newRunId() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  const rand = crypto.randomBytes(2).toString('hex');
  return `sum-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${rand}`;
}

// ---------- 独立锁（.locks/summary.lock） ----------

function summaryLockPath(dataDir) {
  return path.join(dataDir, 'runtime', '.locks', 'summary.lock');
}
function readSummaryLock(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(summaryLockPath(dataDir), 'utf8'));
  } catch {
    return null;
  }
}
function releaseSummaryLockIf(dataDir, pred) {
  const lock = readSummaryLock(dataDir);
  if (lock && pred(lock)) {
    try { fs.unlinkSync(summaryLockPath(dataDir)); } catch { /* 已释放 */ }
  }
}

// ---------- 账本读写 ----------

export function getSummaryRun(dataDir, runId) {
  const r = readJson(path.join(docsSummaryRunDir(dataDir, runId), 'run.json'));
  if (!r || r.runId !== runId) throw new AtbError(`找不到 AI 总结执行：${runId}`);
  return r;
}

function saveSummaryRun(dataDir, run) {
  run.updatedAt = nowIso();
  writeJsonAtomic(path.join(docsSummaryRunDir(dataDir, run.runId), 'run.json'), run);
}

function listSummaryRuns(dataDir) {
  const dir = docsSummaryRunsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((n) => readJson(path.join(dir, n, 'run.json')))
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function unfinishedSummaryRuns(dataDir) {
  return listSummaryRuns(dataDir).filter((r) => r.phase === 'running');
}

// 最新 run（任意状态）：文档编写页 / 任务模块的展示口径（进行中 / 失败 / 已完成）
export function latestSummaryRun(dataDir, verId = null) {
  const runs = verId ? listSummaryRuns(dataDir).filter((r) => r.verId === verId) : listSummaryRuns(dataDir);
  return runs.length ? runs[runs.length - 1] : null;
}

// ---------- 生命周期 ----------

// 启动一轮 AI 总结：按语言集展开文件全部 pending（REQ-20260921-010 起文档清单随语言集
// 动态，缺省 cn,en），占用独立锁。同一时间至多一个进行中的 run（锁单一，跨版本亦互斥）；
// 重复 start 报错不排队。
export function createSummaryRun(dataDir, { verId, owner, langs } = {}) {
  const id = String(verId || '').trim();
  if (!/^BLD-\d{8}-\d{3,}$/.test(id)) throw new AtbError(`版本计划号非法：${id || '（空）'}（形如 BLD-YYYYMMDD-NNN）`);
  ensureDocsSummary(dataDir);
  const active = unfinishedSummaryRuns(dataDir);
  if (active.length) {
    throw new AtbError(
      `已有进行中的 AI 总结任务（${active[0].verId}，owner ${active[0].owner}）：同一时间只有一轮执行；` +
      '请先完成或收尾当前任务后再启动',
    );
  }
  const runId = newRunId();
  const files = {};
  for (const f of publishDocFiles(docLangsOf({ langs }))) files[f.file] = 'pending';
  const run = {
    version: 1,
    runId,
    verId: id,
    owner: String(owner || 'summary').slice(0, 80),
    phase: 'running',
    files,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: null,
    summary: null,
    reason: null,
  };
  fs.mkdirSync(docsSummaryRunDir(dataDir, runId), { recursive: true });
  saveSummaryRun(dataDir, run);
  acquireLock(summaryLockPath(dataDir), Infinity, { kind: 'summary', runId, owner: run.owner, at: nowIso() });
  return run;
}

// 逐文件进度回执：summarizing（开始总结该文件）/ summarized（该文件总结完成，待人工审核）。
// REQ-20260921-010：按 run 自身 files 账本校验（语言集随版本可变，不依赖全局固定白名单）。
export function markSummaryFile(dataDir, runId, file, state) {
  if (!SUMMARY_FILE_STATES.includes(state) || state === 'pending') {
    throw new AtbError(`state 必须是 ${SUMMARY_FILE_STATES.filter((s) => s !== 'pending').join(' | ')}，得到：${state}`);
  }
  const run = getSummaryRun(dataDir, runId);
  if (!Object.prototype.hasOwnProperty.call(run.files || {}, String(file || ''))) {
    throw new AtbError(`非发布文档文件：${file}（仅语言集内发布文档可回执）`);
  }
  if (run.phase !== 'running') throw new AtbError(`运行 ${runId} 已收尾（${run.phase}）：不能再回执文件进度`);
  run.files[file] = state;
  saveSummaryRun(dataDir, run);
  return run;
}

// 收尾：done（本轮总结完成，待总结文件均进入已总结待审核）/ failed（中断，残留 summarizing
// 回退为 pending/summarized 之前的实际完成态，不悬挂「正在总结」）。收尾释放独立锁。
export function finishSummaryRun(dataDir, runId, { result, summary = '', reason = '' } = {}) {
  const run = getSummaryRun(dataDir, runId);
  if (SUMMARY_RUN_PHASES.includes(run.phase) && run.phase !== 'running') {
    throw new AtbError(`运行 ${runId} 已收尾（${run.phase}），同一运行不得重复回执`);
  }
  if (result === 'done') {
    const s = String(summary || '').trim();
    if (!s) throw new AtbError('done 回执必须携带 summary（要点，≤200 字）');
    if ([...s].length > SUMMARY_REASON_MAX_CHARS) throw new AtbError(`summary 超过 ${SUMMARY_REASON_MAX_CHARS} 字`);
    run.phase = 'done';
    run.summary = s;
    for (const f of Object.keys(run.files)) {
      if (run.files[f] === 'summarizing') run.files[f] = 'pending'; // 收尾即完成：中断文件按未完成回落
    }
  } else if (result === 'failed') {
    const rsn = String(reason || '').trim();
    if (!rsn) throw new AtbError('failed 回执必须携带简短 reason（≤200 字）');
    if ([...rsn].length > SUMMARY_REASON_MAX_CHARS) throw new AtbError(`reason 超过 ${SUMMARY_REASON_MAX_CHARS} 字`);
    run.phase = 'failed';
    run.reason = rsn;
    for (const f of Object.keys(run.files)) {
      if (run.files[f] === 'summarizing') run.files[f] = 'pending'; // 中断不悬挂「正在总结」
    }
  } else {
    throw new AtbError(`result 必须是 done | failed，得到：${result}`);
  }
  run.finishedAt = nowIso();
  saveSummaryRun(dataDir, run);
  releaseSummaryLockIf(dataDir, (l) => l.runId === runId || l.owner === run.owner);
  return run;
}

// ---------- 求值辅助（供 publish-flow.evaluateDocsFlow 的 marks 输入） ----------

// 版本聚合标记：summarized = 任一 run 曾标记完成（跨 run 保留，重启不回退已总结状态）；
// summarizing = 活动 run（phase=running）正在总结的文件（终态 run 不占——不悬挂）。
export function summaryMarksForVer(dataDir, verId) {
  const summarized = new Set();
  const summarizing = new Set();
  for (const run of listSummaryRuns(dataDir)) {
    if (run.verId !== String(verId || '')) continue;
    for (const [file, st] of Object.entries(run.files || {})) {
      if (st === 'summarized') summarized.add(file);
    }
    if (run.phase === 'running') {
      for (const [file, st] of Object.entries(run.files || {})) {
        if (st === 'summarizing') summarizing.add(file);
      }
    }
  }
  return { summarizing: [...summarizing], summarized: [...summarized] };
}

// ---------- 视图（文档编写页 / 任务模块） ----------

// 面板视图：进度计数（total 按账本文件数动态——语言集 4 × N）+ 当前文件 + 独立锁标注数据。
export function summaryRunView(run) {
  if (!run) return null;
  const files = Object.entries(run.files || {});
  const summarized = files.filter(([, s]) => s === 'summarized').length;
  const summarizingFile = files.find(([, s]) => s === 'summarizing');
  const total = files.length;
  return {
    runId: run.runId,
    verId: run.verId,
    owner: run.owner,
    phase: run.phase,
    lock: 'summary', // 独立锁标注（与 AI 分析 / AI 开发隔离）
    files: { ...(run.files || {}) },
    counts: { summarized, pending: total - summarized - (summarizingFile ? 1 : 0), total },
    currentFile: summarizingFile ? summarizingFile[0] : null,
    reason: run.reason || null,
    summary: run.summary || null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt || null,
  };
}

// 全局任务面板简报（与 batch.batchBrief / refine.refineBatchBrief 同席）：仅未收尾 run 进全局，
// 收尾（done/failed）即移出（「进行中展示、收尾移出」口径）。current 不带条目跳转挂点
// （verId 不是 REQ/BUG 编号），前端按 kind=summary 分支渲染版本号与进度。
export function summaryBrief(run) {
  const view = summaryRunView(run);
  if (!view) return null;
  return {
    kind: 'summary',
    runId: view.runId,
    verId: view.verId,
    status: 'running',
    pauseRequested: false,
    abortRequested: false,
    aborted: false,
    createdAt: view.createdAt,
    lastActivityAt: view.updatedAt,
    current: {
      itemId: view.verId,
      owner: view.owner,
      createdAt: view.createdAt,
    },
    counts: {
      done: view.counts.summarized,
      failed: 0,
      interrupted: 0,
      remaining: view.counts.total - view.counts.summarized,
      total: view.counts.total,
    },
    currentFile: view.currentFile,
  };
}
