// REQ-20260924-001 发布文档 AI 校对执行账本（docs-check-store）。
// 「AI 校对」是整体审查步骤的提示词派发检查：主会话把校对提示词交给校对子代理，逐文件
// 核查**默认语言**（语言集首语言）发布文档的错别字与语言习惯行文规范；子代理经
// atb docscheck CLI 逐文件回执结果（pass / fail + issues），本账本落盘供看板（文档编写页 /
// 整体审查对话框 / 任务模块 / 全局任务面板）轮询展示——核查结果自动上报。
// 隔离口径（对齐 docs-summary-store）：
//   - 独立锁 .locks/docscheck.lock：与 AI 总结（summary.lock）/ AI 翻译（translate.lock）/
//     AI 开发（impl.lock）/ AI 分析（refine.lock）互不占用；
//   - 不并入 TASK_KINDS、不进 REQ/BUG 状态机、不占条目状态——只服务于版本发布文档。
// 事实源：<dataDir>/runtime/docs-check/runs/<runId>/run.json（runId 形如 chk-YYYYMMDD-HHMMSS-xxxx）。
// 校对只读不改文档（提示词约束）；账本只记录核查结论与问题清单，不改审核状态、不设门禁。
// BUG-20260925-002：建议决断（接受 / 拒绝 / 过期）持久化到 run.decisions（键 'file|idx'
// → accepted/rejected/stale）——决断随 run 落盘（runtime 应用数据），整页刷新 / 换浏览器
// 重进后前端从视图 decisions 重播种，决断不丢；旧 run 无 decisions 字段首次落库时补空。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AtbError, acquireLock, writeJsonAtomic } from './core.mjs';
import { publishDocFiles, docLangsOf } from './publish-flow.mjs';

export const DOCS_CHECK_FILE_STATES = ['pending', 'checking', 'pass', 'fail'];
export const DOCS_CHECK_PHASES = ['running', 'done', 'failed'];
export const DOCS_CHECK_SUMMARY_MAX_CHARS = 200;
export const DOCS_CHECK_ISSUES_MAX_CHARS = 2000;

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const nowIso = () => new Date().toISOString();

export function docsCheckDir(dataDir) {
  return path.join(dataDir, 'runtime', 'docs-check');
}
export function docsCheckRunsDir(dataDir) {
  return path.join(docsCheckDir(dataDir), 'runs');
}
export function docsCheckRunDir(dataDir, runId) {
  if (!/^chk-\d{8}-\d{6}-[0-9a-f]{4,}$/.test(String(runId))) throw new AtbError(`非法 runId：${runId}`);
  return path.join(docsCheckRunsDir(dataDir), runId);
}

// 幂等初始化：目录 + .gitignore（执行账本不进版本控制）
export function ensureDocsCheck(dataDir) {
  fs.mkdirSync(docsCheckRunsDir(dataDir), { recursive: true });
  const gi = path.join(dataDir, 'runtime', '.gitignore');
  const wanted = 'docs-check/runs/';
  let cur = '';
  try { cur = fs.readFileSync(gi, 'utf8'); } catch {}
  if (!cur.split('\n').includes(wanted)) fs.writeFileSync(gi, cur.replace(/\n*$/, '\n') + wanted + '\n');
}

function newRunId() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  const rand = crypto.randomBytes(2).toString('hex');
  return `chk-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${rand}`;
}

// ---------- 独立锁（.locks/docscheck.lock） ----------

function checkLockPath(dataDir) {
  return path.join(dataDir, 'runtime', '.locks', 'docscheck.lock');
}
function readCheckLock(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(checkLockPath(dataDir), 'utf8'));
  } catch {
    return null;
  }
}
function releaseCheckLockIf(dataDir, pred) {
  const lock = readCheckLock(dataDir);
  if (lock && pred(lock)) {
    try { fs.unlinkSync(checkLockPath(dataDir)); } catch { /* 已释放 */ }
  }
}

// ---------- 账本读写 ----------

export function getCheckRun(dataDir, runId) {
  const r = readJson(path.join(docsCheckRunDir(dataDir, runId), 'run.json'));
  if (!r || r.runId !== runId) throw new AtbError(`找不到 AI 校对执行：${runId}`);
  return r;
}

function saveCheckRun(dataDir, run) {
  run.updatedAt = nowIso();
  writeJsonAtomic(path.join(docsCheckRunDir(dataDir, run.runId), 'run.json'), run);
  return run;
}

function listCheckRuns(dataDir) {
  const dir = docsCheckRunsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((n) => readJson(path.join(dir, n, 'run.json')))
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function unfinishedCheckRuns(dataDir) {
  return listCheckRuns(dataDir).filter((r) => r.phase === 'running');
}

// 最新 run（任意状态）：文档编写页 / 任务模块的展示口径
export function latestCheckRun(dataDir, verId = null) {
  const runs = verId ? listCheckRuns(dataDir).filter((r) => r.verId === verId) : listCheckRuns(dataDir);
  return runs.length ? runs[runs.length - 1] : null;
}

// ---------- 生命周期 ----------

// 启动一轮 AI 校对：按语言集展开**默认语言**（首语言）全部非单文件文件 pending
//（标准 4 类 + 自定义文档默认语言份；单文件类 LICENSE 不进校对——许可证文本不翻译），
// 占用独立锁。同一时间至多一个进行中的 run（锁单一，跨版本亦互斥）；重复 start 报错不排队。
export function createCheckRun(dataDir, { verId, owner, langs, customDocs = [] } = {}) {
  const id = String(verId || '').trim();
  if (!/^BLD-\d{8}-\d{3,}$/.test(id)) throw new AtbError(`版本计划号非法：${id || '（空）'}（形如 BLD-YYYYMMDD-NNN）`);
  ensureDocsCheck(dataDir);
  const active = unfinishedCheckRuns(dataDir);
  if (active.length) {
    throw new AtbError(
      `已有进行中的 AI 校对任务（${active[0].verId}，owner ${active[0].owner}）：同一时间只有一轮执行；` +
      '请先完成或收尾当前任务后再启动',
    );
  }
  const runId = newRunId();
  const files = {};
  const issues = {};
  const ls = docLangsOf({ langs });
  for (const f of publishDocFiles(ls, customDocs).filter((x) => x.lang === ls[0] && !x.single)) files[f.file] = 'pending';
  const run = {
    version: 1,
    runId,
    verId: id,
    owner: String(owner || 'docscheck').slice(0, 80),
    phase: 'running',
    files,
    issues,
    decisions: {}, // BUG-20260925-002 建议决断账本（键 'file|idx' → accepted/rejected/stale）
    createdAt: nowIso(),
    updatedAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: null,
    summary: null,
    reason: null,
  };
  fs.mkdirSync(docsCheckRunDir(dataDir, runId), { recursive: true });
  saveCheckRun(dataDir, run);
  acquireLock(checkLockPath(dataDir), Infinity, { kind: 'docscheck', runId, owner: run.owner, at: nowIso() });
  return run;
}

// 逐文件结果回执：checking（开始核查该文件）/ pass（无问题）/ fail（发现问题，必须带 issues
// 问题清单文本）。按 run 自身 files 账本校验（语言集随版本可变，不依赖全局固定白名单）。
export function markCheckFile(dataDir, runId, file, state, issues = '') {
  if (!['checking', 'pass', 'fail'].includes(state)) {
    throw new AtbError(`state 必须是 checking | pass | fail，得到：${state}`);
  }
  const run = getCheckRun(dataDir, runId);
  if (!Object.prototype.hasOwnProperty.call(run.files || {}, String(file || ''))) {
    throw new AtbError(`非 AI 校对目标文件：${file}（仅默认语言发布文档可回执）`);
  }
  if (run.phase !== 'running') throw new AtbError(`运行 ${runId} 已收尾（${run.phase}）：不能再回执文件结果`);
  let text = String(issues ?? '').trim();
  if (state === 'fail') {
    if (!text) throw new AtbError('fail 回执必须携带 issues（问题清单：逐条给出行号 / 原文片段与修改建议）');
    if ([...text].length > DOCS_CHECK_ISSUES_MAX_CHARS) throw new AtbError(`issues 超过 ${DOCS_CHECK_ISSUES_MAX_CHARS} 字`);
    run.issues[file] = text;
  } else {
    if (text && [...text].length > DOCS_CHECK_ISSUES_MAX_CHARS) throw new AtbError(`issues 超过 ${DOCS_CHECK_ISSUES_MAX_CHARS} 字`);
    delete run.issues[file]; // checking / pass 清掉残留问题（本轮重查覆盖旧结论）
  }
  run.files[file] = state;
  saveCheckRun(dataDir, run);
  return run;
}

// 收尾：done（本轮校对完成）/ failed（中断，残留 checking 回落 pending 不悬挂）。
// 收尾释放独立锁。done 必带 summary，failed 必带 reason（≤200 字，与 summary/fail 口径一致）。
export function finishCheckRun(dataDir, runId, { result, summary = '', reason = '' } = {}) {
  const run = getCheckRun(dataDir, runId);
  if (run.phase !== 'running') {
    throw new AtbError(`运行 ${runId} 已收尾（${run.phase}），同一运行不得重复回执`);
  }
  if (result === 'done') {
    const s = String(summary || '').trim();
    if (!s) throw new AtbError('done 回执必须携带 summary（要点，≤200 字）');
    if ([...s].length > DOCS_CHECK_SUMMARY_MAX_CHARS) throw new AtbError(`summary 超过 ${DOCS_CHECK_SUMMARY_MAX_CHARS} 字`);
    run.phase = 'done';
    run.summary = s;
    for (const f of Object.keys(run.files)) {
      if (run.files[f] === 'checking') { run.files[f] = 'pending'; delete run.issues[f]; }
    }
  } else if (result === 'failed') {
    const rsn = String(reason || '').trim();
    if (!rsn) throw new AtbError('failed 回执必须携带简短 reason（≤200 字）');
    if ([...rsn].length > DOCS_CHECK_SUMMARY_MAX_CHARS) throw new AtbError(`reason 超过 ${DOCS_CHECK_SUMMARY_MAX_CHARS} 字`);
    run.phase = 'failed';
    run.reason = rsn;
    for (const f of Object.keys(run.files)) {
      if (run.files[f] === 'checking') { run.files[f] = 'pending'; delete run.issues[f]; }
    }
  } else {
    throw new AtbError(`result 必须是 done | failed，得到：${result}`);
  }
  run.finishedAt = nowIso();
  saveCheckRun(dataDir, run);
  releaseCheckLockIf(dataDir, (l) => l.runId === runId || l.owner === run.owner);
  return run;
}

// ---------- BUG-20260925-002 建议决断账本（接受 / 拒绝 / 过期持久化） ----------

// 建议行数（与前端 splitProofreadIssues 口径一致：按换行拆、trim、去空行）——idx 校验依据。
const proofreadIssueRows = (text) => String(text ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length;

// 逐条决断落库：UI「接受 / 拒绝 / 定位失败（过期 / 已应用）」后调用。校验：decision 三值、
// run 属本版本、file 在 run 账本、idx 在该文件 issues 行数内、run 已收尾（done）才可记
//（running / failed 的结论未定，不记决断）。同一建议后写覆盖（最后一次决断为准）。
export function recordCheckDecision(dataDir, { verId, runId, file, idx, decision } = {}) {
  if (!['accepted', 'rejected', 'stale'].includes(decision)) {
    throw new AtbError(`decision 必须是 accepted | rejected | stale，得到：${decision}`);
  }
  const run = getCheckRun(dataDir, String(runId || ''));
  if (run.verId !== String(verId || '')) throw new AtbError(`校对执行 ${run.runId} 不属于版本 ${verId || '（空）'}`);
  if (run.phase !== 'done') throw new AtbError(`运行 ${run.runId} 未收尾（${run.phase}）：建议决断仅在完成后记录`);
  const f = String(file || '');
  if (!Object.prototype.hasOwnProperty.call(run.files || {}, f)) {
    throw new AtbError(`非 AI 校对目标文件：${f}（仅默认语言发布文档可记决断）`);
  }
  const rows = proofreadIssueRows((run.issues || {})[f]);
  const i = Number(idx);
  if (!Number.isInteger(i) || i < 0 || i >= rows) {
    throw new AtbError(`建议序号越界：${idx}（${f} 共 ${rows} 条建议）`);
  }
  run.decisions = run.decisions || {}; // 旧 run（无字段）首次落库补空
  run.decisions[`${f}|${i}`] = decision;
  saveCheckRun(dataDir, run);
  return run;
}

// 上一轮已决断数（新 run 旧决断失效的前端提示依据）：同版本、创建早于当前 run 的最近一个
// 有决断的 run 的决断条数；无则 0。决断按 runId 绑定不带入新 run（口径不变），此计数让
// 界面可感知「刚处理过的建议为何回到待处理」。
export function supersededCheckDecisionCount(dataDir, verId, currentRunId) {
  const runs = listCheckRuns(dataDir).filter((r) => r.verId === String(verId || ''));
  const at = runs.findIndex((r) => r.runId === String(currentRunId || ''));
  for (let i = (at === -1 ? runs.length : at) - 1; i >= 0; i--) {
    const n = Object.keys(runs[i].decisions || {}).length;
    if (n) return n;
  }
  return 0;
}

// ---------- 视图（文档编写页 / 整体审查对话框 / 任务模块） ----------

// 面板视图：进度计数（pass / fail / pending）+ 当前核查文件 + issues 透出 + 独立锁标注。
export function checkRunView(run) {
  if (!run) return null;
  const files = Object.entries(run.files || {});
  const count = (st) => files.filter(([, s]) => s === st).length;
  const checkingFile = files.find(([, s]) => s === 'checking');
  const total = files.length;
  return {
    runId: run.runId,
    verId: run.verId,
    owner: run.owner,
    phase: run.phase,
    lock: 'docscheck', // 独立锁标注（与 AI 总结 / AI 翻译 / AI 分析 / AI 开发隔离）
    files: { ...(run.files || {}) },
    issues: { ...(run.issues || {}) },
    decisions: { ...(run.decisions || {}) }, // BUG-20260925-002 决断随视图透出（前端播种事实源）
    counts: {
      pass: count('pass'),
      fail: count('fail'),
      checking: count('checking'),
      pending: count('pending'),
      total,
    },
    currentFile: checkingFile ? checkingFile[0] : null,
    reason: run.reason || null,
    summary: run.summary || null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt || null,
  };
}

// 全局任务面板简报（与 summary / translate 同席）：仅未收尾 run 进全局，收尾即移出。
// current 不带条目跳转挂点（verId 不是 REQ/BUG 编号），前端按 kind=docscheck 渲染版本号与进度。
export function checkBrief(run) {
  const view = checkRunView(run);
  if (!view) return null;
  const done = view.counts.pass + view.counts.fail;
  return {
    kind: 'docscheck',
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
      done,
      failed: view.counts.fail,
      interrupted: 0,
      remaining: view.counts.total - done - (view.currentFile ? 1 : 0),
      total: view.counts.total,
    },
    currentFile: view.currentFile,
  };
}
