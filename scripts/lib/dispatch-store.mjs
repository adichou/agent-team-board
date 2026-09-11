// REQ-20260906-003 执行账本（RunStore）—— Codex 自动派发存储层（与 REQ-20260906-002 共用 dispatch/ 规范）。
// 目录（docs/agent-team-board/dispatch/，随项目走，账本由受控函数维护）：
//   settings.json          共用：批次/run 计数器 + codex 自动派发配置（不含任何密钥）
//   policies.json          共用：条目依赖策略（deps schema，读写委托 batch.mjs，单一事实源）
//   .locks/impl.lock       共用：项目实施互斥（core 层，Zcode/Codex/手工 claim 均检查）
//   runs/<runId>/          每次执行：run.json + events.jsonl + stderr.log + final-message.md + prompt.md
// 运行阶段属于执行账本，绝不写入条目 status.json。
// 本模块创建的运行 executor 固定为 'codex-exec'；runId 含时分秒与随机后缀，与 Zcode 批次的
// 计数器序列（run-YYYYMMDD-NNN）格式不同，互不冲突；扫描接口只认领本执行器的运行。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  AtbError, writeJsonAtomic, resolveItemDir, readStatus,
  acquireLock, releaseLock, readImplLockIfExists,
} from './core.mjs';
import * as batch from './batch.mjs';
import { normalizeModelSelection } from './codex-model-config.mjs';

// 账本运行阶段（batch-execution.md §5 状态与回执）
export const RUN_PHASES = [
  'reserved', 'starting', 'running',
  'reported', 'blocked', 'failed', 'interrupted', 'cleanup_pending', 'needs_attention',
];
// 终态：不会再回到 running；cleanup_pending/needs_attention 仍占用项目（收尾待核对）
export const TERMINAL_PHASES = ['reported', 'blocked', 'failed', 'interrupted'];
export const isTerminalPhase = (p) => TERMINAL_PHASES.includes(p);
const MY_EXECUTOR = 'codex-exec';

export function dispatchRoot(dataDir) {
  return path.join(dataDir, 'dispatch');
}
export function runDir(dataDir, runId) {
  if (!/^run-\d{8}-\d{6}-[0-9a-f]{4}$/.test(String(runId))) throw new AtbError(`非法 runId：${runId}`);
  return path.join(dispatchRoot(dataDir), 'runs', runId);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// ---------- 设置（自动派发配置；禁止任何密钥类字段） ----------

const SECRET_KEY_RE = /(api[-_]?(key|token)|secret|password|credential|bearer)/i;
const SETTING_RANGE = { timeoutMin: [5, 240], retries: [0, 3] };

export function defaultSettings() {
  return {
    version: 1,
    codex: {
      enabled: false,            // 自动派发默认关闭
      cliPath: null,             // 探测结果；null = 未探测到
      cliPathExplicit: false,    // 用户是否手动指定过
      timeoutMin: 60,            // 单项时限（分钟）
      retries: 2,                // 网络自动重试次数上限
      resumeAfterRestart: false, // 重启后自动继续（默认关）
      allowNonGit: false,        // 非 Git 项目兼容必须由用户明确开启，不改变沙箱或审批
      maxResumeRounds: 2,        // 同项追加续跑轮数上限
      cancelGraceSec: 10,        // 取消宽限期（秒）
      modelSelection: { mode: 'inherit' }, // REQ-20260906-024：项目默认沿用本机配置
      lastVerification: null,    // REQ-20260906-024：最近一次真实验证结果（非敏感；绑定配置指纹）
    },
  };
}

export function loadSettings(dataDir) {
  const saved = readJson(path.join(dispatchRoot(dataDir), 'settings.json'));
  const def = defaultSettings();
  if (!saved || typeof saved !== 'object') return def;
  return { ...def, ...saved, codex: { ...def.codex, ...(saved.codex || {}) } };
}

export function saveSettings(dataDir, patch) {
  const cur = loadSettings(dataDir);
  const next = { ...cur, ...(patch || {}) };
  next.codex = { ...cur.codex, ...((patch && patch.codex) || {}) };
  // 共用字段（REQ-20260906-002 batch 层）：批次/run 计数器缺失时补结构，绝不丢弃
  // （defaults.batchLimit 已随上限设置移除，REQ-20260908-019；存量 defaults 经展开原样保留）
  next.counters = cur.counters || { batch: 0, run: 0 };
  for (const [k, v] of Object.entries(next.codex)) {
    if (SECRET_KEY_RE.test(k)) throw new AtbError(`配置不接受敏感字段：${k}（不收集密钥，沿用本机登录）`);
  }
  for (const [k, [min, max]] of Object.entries(SETTING_RANGE)) {
    const v = next.codex[k];
    if (!Number.isInteger(v) || v < min || v > max) {
      throw new AtbError(`${k} 必须是 ${min}～${max} 的整数（得到：${v}）`);
    }
  }
  for (const k of ['enabled', 'resumeAfterRestart']) {
    next.codex[k] = Boolean(next.codex[k]);
  }
  if (typeof next.codex.allowNonGit !== 'boolean') throw new AtbError('allowNonGit 必须是布尔值');
  next.codex.cliPathExplicit = Boolean(next.codex.cliPathExplicit) || (patch && patch.codex && 'cliPath' in patch.codex);
  if (next.codex.cliPath != null && (typeof next.codex.cliPath !== 'string' || !next.codex.cliPath.trim())) {
    throw new AtbError('cliPath 必须是非空字符串或 null');
  }
  // REQ-20260906-024：模型选择归一化校验（显式必须模型+强度成对；不接受敏感/未知字段）
  const sel = normalizeModelSelection(next.codex.modelSelection == null ? { mode: 'inherit' } : next.codex.modelSelection);
  if (!sel.ok) throw new AtbError(`modelSelection 非法：${sel.error}`);
  next.codex.modelSelection = sel.value;
  // 最近一次真实验证结果：只保留非敏感摘要字段（绑定模型/强度/指纹，配置变化后 UI 标注过期）
  if (next.codex.lastVerification != null) {
    const v = next.codex.lastVerification;
    if (typeof v !== 'object' || Array.isArray(v)) throw new AtbError('lastVerification 必须是对象');
    const picked = {};
    for (const k of ['modelId', 'reasoningEffort', 'configFingerprint', 'ok', 'at', 'error', 'note']) {
      if (v[k] !== undefined) picked[k] = v[k];
    }
    for (const [k, val] of Object.entries(picked)) {
      if (SECRET_KEY_RE.test(k) || (typeof val === 'string' && val.length > 2000)) {
        throw new AtbError(`lastVerification 不接受该字段/过长：${k}`);
      }
    }
    next.codex.lastVerification = picked;
  }
  next.version = 1;
  ensureDir(dispatchRoot(dataDir));
  writeJsonAtomic(path.join(dispatchRoot(dataDir), 'settings.json'), next);
  return next;
}

// ---------- 依赖策略（共用 policies.json：deps schema，委托 batch.mjs 单一事实源） ----------

export function loadPolicies(dataDir) {
  return batch.readPolicies(dataDir);
}

export function loadItemPolicy(dataDir, itemId) {
  return { dependsOn: batch.dependenciesOf(dataDir, itemId) };
}

// 保存条目依赖：先做本层语义校验（existsIds/自依赖），再走 batch.setDependencies 统一写盘（含环检测）
export function saveItemPolicy(dataDir, itemId, dependsOn, { existsIds } = {}) {
  resolveItemDir(dataDir, itemId); // 校验条目存在
  if (!Array.isArray(dependsOn) || dependsOn.some((x) => typeof x !== 'string')) {
    throw new AtbError('dependsOn 必须是条目编号数组');
  }
  const uniq = [...new Set(dependsOn)];
  if (uniq.includes(itemId)) throw new AtbError(`条目不能自依赖：${itemId}`);
  const known = existsIds || new Set(Object.keys(batch.readPolicies(dataDir).deps));
  for (const id of uniq) {
    if (!known.has(id)) throw new AtbError(`依赖编号不存在：${id}`);
  }
  const r = batch.setDependencies(dataDir, itemId, uniq);
  if (!r.ok) throw new AtbError(r.errors.join('；'));
  return { dependsOn: r.dependsOn };
}

// 依赖是否满足：statusOf(id) 回调返回条目状态；默认要求 done（人工验收完成）
export function depsSatisfied(dataDir, itemId, statusOf) {
  const { dependsOn } = loadItemPolicy(dataDir, itemId);
  if (!dependsOn.length) return { ok: true, unsatisfied: [] };
  const unsatisfied = dependsOn.filter((id) => statusOf(id) !== 'done');
  return { ok: unsatisfied.length === 0, unsatisfied };
}

// ---------- 条目模型策略（REQ-20260906-024：本项指定 > 项目默认 > 继承；缺省 inherit） ----------

export function loadItemModelSelection(dataDir, itemId) {
  const p = batch.readPolicies(dataDir);
  const sel = (p.items[itemId] || {}).modelSelection;
  const n = normalizeModelSelection(sel == null ? { mode: 'inherit' } : sel);
  return n.ok ? n.value : { mode: 'inherit' }; // 历史脏数据不致命：按继承处理并在预检暴露
}

export function saveItemModelSelection(dataDir, itemId, selection) {
  resolveItemDir(dataDir, itemId); // 校验条目存在
  const n = normalizeModelSelection(selection == null ? { mode: 'inherit' } : selection);
  if (!n.ok) throw new AtbError(`modelSelection 非法：${n.error}`);
  const r = batch.saveItemPolicyFields(dataDir, itemId, { modelSelection: n.value });
  if (!r.ok) throw new AtbError(r.errors.join('；'));
  return n.value;
}

// ---------- 运行记录 ----------

function newRunId() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `run-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${crypto.randomBytes(2).toString('hex')}`;
}

// 创建顺序号：扫描现有 runs 取最大 seq + 1，listRuns 按 seq 排序，
// 避免同秒创建的多条记录因 runId 随机后缀导致顺序漂移
function nextSeq(dataDir) {
  const root = path.join(dispatchRoot(dataDir), 'runs');
  let max = 0;
  if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root)) {
      const r = readJson(path.join(root, name, 'run.json'));
      if (r && Number.isInteger(r.seq) && r.seq > max) max = r.seq;
    }
  }
  return max + 1;
}

export function newRun(dataDir, { itemId, projectRoot, prompt, config = {}, batchId = null, modelSnapshot = null }) {
  const runId = newRunId();
  const now = new Date().toISOString();
  const run = {
    version: 1,
    runId,
    seq: nextSeq(dataDir),
    batchId,
    itemId,
    projectRoot,
    executor: 'codex-exec',
    owner: null,          // worker 认领后的 owner（claim --by <单号>）；未认领为 null
    phase: 'reserved',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    endedAt: null,
    lastEventAt: null,
    threadId: null,       // thread.started 给出的确切会话 ID；未获得保持 null
    attempts: [],         // { attemptNo, kind: new|resume, startedAt, pid, pidStartTime, exitCode, signal, endedAt }
    cancelRequested: false,
    timeoutMin: config.timeoutMin ?? 60,
    retriesUsed: 0,
    result: null,         // { code, reason, reportRef? }
    recoveryNote: null,
    prompt: String(prompt || ''),
    // REQ-20260906-024：本次执行的模型配置快照（非敏感）。创建后固定不变：
    // 同项续跑、网络重试与重启恢复都用快照，不重新套用后来修改的项目/全局默认值。
    modelSnapshot: modelSnapshot || null,
    modelConfirmed: null, // 运行时返回的实际模型标识（M17）；未返回保持 null，如实展示
    supersedes: null,     // 主动切换模型产生的新尝试：{ runId, reason }
  };
  const dir = runDir(dataDir, runId);
  ensureDir(dir);
  writeJsonAtomic(path.join(dir, 'run.json'), run);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'stderr.log'), '');
  fs.writeFileSync(path.join(dir, 'prompt.md'), run.prompt);
  return run;
}

export function getRun(dataDir, runId) {
  const run = readJson(path.join(runDir(dataDir, runId), 'run.json'));
  if (!run || run.runId !== runId) throw new AtbError(`找不到运行记录：${runId}`);
  return run;
}

export function updateRun(dataDir, runId, patch) {
  const cur = getRun(dataDir, runId);
  const next = { ...cur, ...patch, runId, updatedAt: new Date().toISOString() };
  if (patch.phase && !RUN_PHASES.includes(patch.phase)) {
    throw new AtbError(`非法运行阶段：${patch.phase}（合法值：${RUN_PHASES.join(' | ')}）`);
  }
  writeJsonAtomic(path.join(runDir(dataDir, runId), 'run.json'), next);
  return next;
}

// 本执行器的运行记录集合（同目录下还可能有 Zcode 批次的运行，按 executor 区分互不误读）
function myRuns(dataDir) {
  const root = path.join(dispatchRoot(dataDir), 'runs');
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const id of fs.readdirSync(root)) {
    const r = readJson(path.join(root, id, 'run.json'));
    if (r && r.executor === MY_EXECUTOR) out.push(r);
  }
  out.sort((a, b) => (b.seq || 0) - (a.seq || 0) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  return out;
}

export function listRuns(dataDir, { limit = 20, offset = 0 } = {}) {
  const all = myRuns(dataDir);
  return { total: all.length, items: all.slice(offset, offset + limit) };
}

// 最近一次涉及条目的运行（条目详情「最近执行结果」入口用）
export function lastRunForItem(dataDir, itemId) {
  return myRuns(dataDir).find((r) => r.itemId === itemId) || null;
}

// 扫描非终态运行（崩溃恢复核对清单；cleanup_pending/needs_attention 也在此列——仍占用项目）
export function listOpenRuns(dataDir) {
  return myRuns(dataDir).filter((r) => !isTerminalPhase(r.phase));
}

// ---------- 模型待处理记录（REQ-20260906-024：持久提示，重启/刷新后仍可找到） ----------
// dispatch/pending.json：{ version, items: { <requestId>: {…} } }
// 记录只含非敏感字段；同一问题（同条目+同分类+同配置指纹）合并，不因轮询重复弹出。

const PENDING_KINDS = ['config-unresolved', 'model-missing', 'model-denied', 'effort-unsupported', 'model-mismatch', 'provider-changed'];

function pendingPath(dataDir) {
  return path.join(dispatchRoot(dataDir), 'pending.json');
}

function readPendingFile(dataDir) {
  const saved = readJson(pendingPath(dataDir));
  return saved && typeof saved.items === 'object' ? saved : { version: 1, items: {} };
}

function writePendingFile(dataDir, pending) {
  ensureDir(dispatchRoot(dataDir));
  writeJsonAtomic(pendingPath(dataDir), pending);
}

// 登记/合并待处理：同 itemId + kind + configFingerprint 视为同一问题，只更新时间与摘要
export function addModelPending(dataDir, { itemId, runId = null, kind, summary, logRef = null, configFingerprint = null }) {
  if (!PENDING_KINDS.includes(kind)) throw new AtbError(`未知待处理分类：${kind}`);
  const pending = readPendingFile(dataDir);
  const now = new Date().toISOString();
  const dup = Object.values(pending.items).find((x) =>
    x.status === 'open' && x.itemId === itemId && x.kind === kind
    && (x.configFingerprint || null) === (configFingerprint || null));
  if (dup) {
    dup.updatedAt = now;
    dup.summary = String(summary || '').slice(0, 500) || dup.summary;
    if (runId) dup.runId = runId;
    if (logRef) dup.logRef = logRef;
    writePendingFile(dataDir, pending);
    return dup;
  }
  const requestId = `pd-${now.replace(/[-:TZ.]/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`;
  const rec = {
    requestId, itemId, runId: runId || null, kind,
    summary: String(summary || '').slice(0, 500),
    logRef: logRef || null,             // 如 { runId, file: 'stderr' }
    configFingerprint: configFingerprint || null,
    status: 'open', createdAt: now, updatedAt: now,
  };
  pending.items[requestId] = rec;
  writePendingFile(dataDir, pending);
  return rec;
}

export function listModelPending(dataDir, { onlyOpen = false } = {}) {
  const pending = readPendingFile(dataDir);
  let items = Object.values(pending.items);
  if (onlyOpen) items = items.filter((x) => x.status === 'open');
  items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return items;
}

// 修复并执行成功后才更新处理状态（resume/retry 成功上报后调用）
export function resolveModelPending(dataDir, { itemId = null, requestId = null } = {}) {
  const pending = readPendingFile(dataDir);
  let n = 0;
  for (const rec of Object.values(pending.items)) {
    if (rec.status !== 'open') continue;
    const hit = requestId ? rec.requestId === requestId : (itemId && rec.itemId === itemId);
    if (!hit) continue;
    rec.status = 'resolved';
    rec.resolvedAt = new Date().toISOString();
    n++;
  }
  if (n) writePendingFile(dataDir, pending);
  return n;
}


// ---------- 日志追加与增量读取（字节偏移；不整载全量） ----------

export function appendEvent(dataDir, runId, event) {
  fs.appendFileSync(path.join(runDir(dataDir, runId), 'events.jsonl'), JSON.stringify(event) + '\n');
}

export function appendStderr(dataDir, runId, chunk) {
  fs.appendFileSync(path.join(runDir(dataDir, runId), 'stderr.log'), chunk);
}

export function writeFinalMessage(dataDir, runId, text) {
  fs.writeFileSync(path.join(runDir(dataDir, runId), 'final-message.md'), String(text || ''));
}

const LOG_FILES = { events: 'events.jsonl', stderr: 'stderr.log', final: 'final-message.md', prompt: 'prompt.md' };

export function readLog(dataDir, runId, name, { offset = 0, limit = 256 * 1024 } = {}) {
  const file = LOG_FILES[name];
  if (!file) throw new AtbError(`未知日志：${name}（可用：${Object.keys(LOG_FILES).join(' | ')}）`);
  const abs = path.join(runDir(dataDir, runId), file);
  const size = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > size) {
    throw new AtbError(`offset 非法（0～${size}）：${offset}`);
  }
  const fd = fs.openSync(abs, 'r');
  try {
    const len = Math.min(limit, size - offset);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, offset);
    const nextOffset = offset + len;
    return { offset, nextOffset, eof: nextOffset >= size, size, data: buf.toString('utf8') };
  } finally {
    fs.closeSync(fd);
  }
}

// ---------- 项目实施互斥（共用 .locks/impl.lock，core.claim 侧同步检查） ----------
// 语义与 REQ-20260906-002 批次层一致：无超时自动接管，异常走人工核对；
// owner 必须与 worker 认领名（单号）一致，assertNoImplConflict 才会放行 worker 的 claim。

function implLockPath(dataDir) {
  return path.join(dataDir, '.locks', 'impl.lock');
}

// 获取实施互斥：payload 至少含 owner（=worker 认领名单号）；被占返回 { ok:false, holder }，绝不自动接管
export function acquireProjectLock(dataDir, owner, { pid = process.pid, kind = 'codex', itemId = null, runId = null } = {}) {
  ensureDir(path.join(dataDir, '.locks'));
  const payload = { kind, owner, pid, itemId, runId, at: new Date().toISOString() };
  try {
    acquireLock(implLockPath(dataDir), Infinity, payload);
    return { ok: true, holder: payload };
  } catch (e) {
    if (!(e instanceof AtbError)) throw e;
    return { ok: false, holder: readImplLockIfExists(dataDir) };
  }
}

// 补记实施互斥的归属字段（runId 在预留成功后才知道）
export function stampProjectLock(dataDir, extra) {
  const cur = readImplLockIfExists(dataDir);
  if (!cur) return false;
  try {
    fs.writeFileSync(implLockPath(dataDir), JSON.stringify({ ...cur, ...extra, at: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

// 触碰锁新鲜度（at 时间戳），证明持有者仍活着
export function touchProjectLock(dataDir, owner) {
  const holder = readImplLockIfExists(dataDir);
  if (!holder || holder.owner !== owner) return false;
  return stampProjectLock(dataDir, {});
}

// 仅当锁仍归属本次（owner 或 runId 匹配）才释放
export function releaseProjectLock(dataDir, owner, runId = null) {
  const holder = readImplLockIfExists(dataDir);
  if (!holder) return false;
  const mine = (owner && holder.owner === owner) || (runId && holder.runId === runId);
  if (!mine) return false;
  releaseLock(implLockPath(dataDir));
  return true;
}

export function readProjectLock(dataDir) {
  return readImplLockIfExists(dataDir);
}
