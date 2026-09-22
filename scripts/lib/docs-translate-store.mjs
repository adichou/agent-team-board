// REQ-20260921-012 文档编写三阶段流程 —— AI 翻译执行账本（docs-translate-store）。
// 「AI 翻译」是文档编写第二阶段：默认语言四文件全部人工审核后，主会话把翻译提示词交给
// 技术翻译子代理，以已审核的默认语言文档为唯一基准逐文件产出剩余语言文档（4 × (N−1)）；
// 子代理经 atb translate CLI 逐文件回执进度，本账本落盘供看板（文档编写页 / 任务模块 /
// 全局任务面板）轮询展示。
// 隔离口径（镜像 docs-summary-store，README 设计待确认点落定）：
//   - 独立锁 .locks/translate.lock：与 AI 总结（summary.lock）、AI 开发（impl.lock）、
//     AI 分析（refine.lock）互不占用；
//   - 不并入 TASK_KINDS（无 Agent / 模型分路配置诉求，不进任务设置）；
//   - 不进 REQ/BUG 状态机、不占条目状态——只服务于版本发布文档。
// 事实源：<dataDir>/runtime/docs-translate/runs/<runId>/run.json（runId 形如 tr-YYYYMMDD-HHMMSS-xxxx）。
// 锁生命周期：start 占用 → done/fail 释放；无超时自动接管，中断悬挂由任务面板暴露 owner
// 人工核对后 fail 收尾再重启（已 translated 文件跨 run 保留，可续跑）。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AtbError, acquireLock, writeJsonAtomic } from './core.mjs';
import { publishDocFiles, docLangsOf } from './publish-flow.mjs';

export const TRANSLATE_FILE_STATES = ['pending', 'translating', 'translated'];
export const TRANSLATE_RUN_PHASES = ['running', 'done', 'failed'];
export const TRANSLATE_REASON_MAX_CHARS = 200;

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const nowIso = () => new Date().toISOString();

export function docsTranslateDir(dataDir) {
  return path.join(dataDir, 'runtime', 'docs-translate');
}
export function docsTranslateRunsDir(dataDir) {
  return path.join(docsTranslateDir(dataDir), 'runs');
}
export function docsTranslateRunDir(dataDir, runId) {
  if (!/^tr-\d{8}-\d{6}-[0-9a-f]{4,}$/.test(String(runId))) throw new AtbError(`非法 runId：${runId}`);
  return path.join(docsTranslateRunsDir(dataDir), runId);
}

// 幂等初始化：目录 + .gitignore（执行账本不进版本控制）
export function ensureDocsTranslate(dataDir) {
  fs.mkdirSync(docsTranslateRunsDir(dataDir), { recursive: true });
  const gi = path.join(dataDir, 'runtime', '.gitignore');
  const wanted = 'docs-translate/runs/';
  let cur = '';
  try { cur = fs.readFileSync(gi, 'utf8'); } catch {}
  if (!cur.split('\n').includes(wanted)) fs.writeFileSync(gi, cur.replace(/\n*$/, '\n') + wanted + '\n');
}

function newRunId() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  const rand = crypto.randomBytes(2).toString('hex');
  return `tr-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${rand}`;
}

// ---------- 独立锁（.locks/translate.lock） ----------

function translateLockPath(dataDir) {
  return path.join(dataDir, 'runtime', '.locks', 'translate.lock');
}
function readTranslateLock(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(translateLockPath(dataDir), 'utf8'));
  } catch {
    return null;
  }
}
function releaseTranslateLockIf(dataDir, pred) {
  const lock = readTranslateLock(dataDir);
  if (lock && pred(lock)) {
    try { fs.unlinkSync(translateLockPath(dataDir)); } catch { /* 已释放 */ }
  }
}

// ---------- 账本读写 ----------

export function getTranslateRun(dataDir, runId) {
  const r = readJson(path.join(docsTranslateRunDir(dataDir, runId), 'run.json'));
  if (!r || r.runId !== runId) throw new AtbError(`找不到 AI 翻译执行：${runId}`);
  return r;
}

function saveTranslateRun(dataDir, run) {
  run.updatedAt = nowIso();
  writeJsonAtomic(path.join(docsTranslateRunDir(dataDir, run.runId), 'run.json'), run);
}

function listTranslateRuns(dataDir) {
  const dir = docsTranslateRunsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((n) => readJson(path.join(dir, n, 'run.json')))
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function unfinishedTranslateRuns(dataDir) {
  return listTranslateRuns(dataDir).filter((r) => r.phase === 'running');
}

// 最新 run（任意状态）：文档编写页 / 任务模块的展示口径（进行中 / 失败 / 已完成）
export function latestTranslateRun(dataDir, verId = null) {
  const runs = verId ? listTranslateRuns(dataDir).filter((r) => r.verId === verId) : listTranslateRuns(dataDir);
  return runs.length ? runs[runs.length - 1] : null;
}

// ---------- 生命周期 ----------

// 剩余语言文件清单（语言集其余语言的全部文件，4 × (N−1)）：翻译账本只装这些文件——
// 默认语言文件属阶段一（AI 总结 + 审查），不经翻译产出；单文件类（LICENSE，
// REQ-20260922-002 口径 B）不进 AI 翻译，同样排除。
function restLangFiles(langs) {
  const ls = docLangsOf({ langs });
  return publishDocFiles(ls).filter((f) => f.lang != null && f.lang !== ls[0]);
}

// 启动一轮 AI 翻译：按语言集展开**剩余语言**文件全部 pending，占用独立锁。同一时间至多
// 一个进行中的 run（锁单一，跨版本亦互斥）；重复 start 报错不排队。单语言集（无剩余语言）
// 报错——没有可翻译文件。解锁前置（默认语言 4/4 已审核）由调用方（server / atb CLI）按
// evaluateDocsFlow.canTranslate 门禁校验，账本不重复求值。
export function createTranslateRun(dataDir, { verId, owner, langs } = {}) {
  const id = String(verId || '').trim();
  if (!/^BLD-\d{8}-\d{3,}$/.test(id)) throw new AtbError(`版本计划号非法：${id || '（空）'}（形如 BLD-YYYYMMDD-NNN）`);
  ensureDocsTranslate(dataDir);
  const files = restLangFiles(langs);
  if (!files.length) {
    throw new AtbError('语言集只有一个语言：无剩余语言文档可翻译（AI 翻译服务于语言集其余语言）');
  }
  const active = unfinishedTranslateRuns(dataDir);
  if (active.length) {
    throw new AtbError(
      `已有进行中的 AI 翻译任务（${active[0].verId}，owner ${active[0].owner}）：同一时间只有一轮执行；` +
      '请先完成或收尾当前任务后再启动',
    );
  }
  const runId = newRunId();
  const ledger = {};
  for (const f of files) ledger[f.file] = 'pending';
  const run = {
    version: 1,
    runId,
    verId: id,
    owner: String(owner || 'translate').slice(0, 80),
    phase: 'running',
    files: ledger,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: null,
    summary: null,
    reason: null,
  };
  fs.mkdirSync(docsTranslateRunDir(dataDir, runId), { recursive: true });
  saveTranslateRun(dataDir, run);
  acquireLock(translateLockPath(dataDir), Infinity, { kind: 'translate', runId, owner: run.owner, at: nowIso() });
  return run;
}

// 逐文件进度回执：translating（开始翻译该文件）/ translated（该文件翻译完成，待人工审核）。
// 按 run 自身 files 账本校验（默认语言文件 / 集外文件不在翻译目标内）。
export function markTranslateFile(dataDir, runId, file, state) {
  if (!TRANSLATE_FILE_STATES.includes(state) || state === 'pending') {
    throw new AtbError(`state 必须是 ${TRANSLATE_FILE_STATES.filter((s) => s !== 'pending').join(' | ')}，得到：${state}`);
  }
  const run = getTranslateRun(dataDir, runId);
  if (!Object.prototype.hasOwnProperty.call(run.files || {}, String(file || ''))) {
    throw new AtbError(`非 AI 翻译目标文件：${file}（仅语言集剩余语言文档可回执，默认语言文件不经翻译产出）`);
  }
  if (run.phase !== 'running') throw new AtbError(`运行 ${runId} 已收尾（${run.phase}）：不能再回执文件进度`);
  run.files[file] = state;
  saveTranslateRun(dataDir, run);
  return run;
}

// 收尾：done（本轮翻译完成）/ failed（中断，残留 translating 回退 pending，不悬挂「正在
// 翻译」；已 translated 跨 run 保留可续跑）。收尾释放独立锁。
export function finishTranslateRun(dataDir, runId, { result, summary = '', reason = '' } = {}) {
  const run = getTranslateRun(dataDir, runId);
  if (TRANSLATE_RUN_PHASES.includes(run.phase) && run.phase !== 'running') {
    throw new AtbError(`运行 ${runId} 已收尾（${run.phase}），同一运行不得重复回执`);
  }
  if (result === 'done') {
    const s = String(summary || '').trim();
    if (!s) throw new AtbError('done 回执必须携带 summary（要点，≤200 字）');
    if ([...s].length > TRANSLATE_REASON_MAX_CHARS) throw new AtbError(`summary 超过 ${TRANSLATE_REASON_MAX_CHARS} 字`);
    run.phase = 'done';
    run.summary = s;
    for (const f of Object.keys(run.files)) {
      if (run.files[f] === 'translating') run.files[f] = 'pending'; // 中断文件按未完成回落
    }
  } else if (result === 'failed') {
    const rsn = String(reason || '').trim();
    if (!rsn) throw new AtbError('failed 回执必须携带简短 reason（≤200 字）');
    if ([...rsn].length > TRANSLATE_REASON_MAX_CHARS) throw new AtbError(`reason 超过 ${TRANSLATE_REASON_MAX_CHARS} 字`);
    run.phase = 'failed';
    run.reason = rsn;
    for (const f of Object.keys(run.files)) {
      if (run.files[f] === 'translating') run.files[f] = 'pending'; // 中断不悬挂「正在翻译」
    }
  } else {
    throw new AtbError(`result 必须是 done | failed，得到：${result}`);
  }
  run.finishedAt = nowIso();
  saveTranslateRun(dataDir, run);
  releaseTranslateLockIf(dataDir, (l) => l.runId === runId || l.owner === run.owner);
  return run;
}

// ---------- 求值辅助（供 publish-flow.evaluateDocsFlow 的 marks 输入） ----------

// 版本聚合标记：translated = 任一 run 曾标记完成（跨 run 保留，重启不回退已翻译状态）；
// translating = 活动 run（phase=running）正在翻译的文件（终态 run 不占——不悬挂）。
export function translateMarksForVer(dataDir, verId) {
  const translated = new Set();
  const translating = new Set();
  for (const run of listTranslateRuns(dataDir)) {
    if (run.verId !== String(verId || '')) continue;
    for (const [file, st] of Object.entries(run.files || {})) {
      if (st === 'translated') translated.add(file);
    }
    if (run.phase === 'running') {
      for (const [file, st] of Object.entries(run.files || {})) {
        if (st === 'translating') translating.add(file);
      }
    }
  }
  return { translating: [...translating], translated: [...translated] };
}

// ---------- 视图（文档编写页 / 任务模块） ----------

// 面板视图：进度计数（total 按账本文件数动态——4 × (N−1)）+ 当前文件 + 独立锁标注数据。
export function translateRunView(run) {
  if (!run) return null;
  const files = Object.entries(run.files || {});
  const translated = files.filter(([, s]) => s === 'translated').length;
  const translatingFile = files.find(([, s]) => s === 'translating');
  const total = files.length;
  return {
    runId: run.runId,
    verId: run.verId,
    owner: run.owner,
    phase: run.phase,
    lock: 'translate', // 独立锁标注（与 AI 总结 / AI 分析 / AI 开发隔离）
    files: { ...(run.files || {}) },
    counts: { translated, pending: total - translated - (translatingFile ? 1 : 0), total },
    currentFile: translatingFile ? translatingFile[0] : null,
    reason: run.reason || null,
    summary: run.summary || null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt || null,
  };
}

// 全局任务面板简报（与 summaryBrief 同席）：仅未收尾 run 进全局，收尾（done/failed）即移出。
// 前端按 kind=translate 分支渲染版本号与进度（verId 非 REQ/BUG 编号，不带条目跳转挂点）。
export function translateBrief(run) {
  const view = translateRunView(run);
  if (!view) return null;
  return {
    kind: 'translate',
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
      done: view.counts.translated,
      failed: 0,
      interrupted: 0,
      remaining: view.counts.total - view.counts.translated,
      total: view.counts.total,
    },
    currentFile: view.currentFile,
  };
}
