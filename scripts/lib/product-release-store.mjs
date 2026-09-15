// REQ-20260915-002 产品发布数据层（product-release-store）—— server.mjs / 流水线使用。
// 事实源：<dataDir>/releases/product-runs/PREL-YYYYMMDD-NNN/run.json + logs/*.log
// （与 REL 发布运行同目录树隔离，不进 REQ/BUG 状态机）。
// 语义边界（README 落定口径）：
//   - 产品发布运行独立建模并关联 BLD：冻结 main/dev 分支头、远端、条目快照、额外提交、
//     官网目标；发布不自动更改关联 REQ/BUG 人工验收状态；来源 BLD 改名/删除不破坏快照；
//   - 同产品同时只有一个活动运行（prechecking/running/waiting-manual）；同产品+版本已成功
//     再创建为幂等拒绝（指向既有运行，不重复发版）；
//   - 整体 succeeded 仅当 sync-source 完成且 Web App / 官网两个必备目标全部回验 done；
//     部分成功保持 failed 并保留各目标真实状态（分开显示 Web App 已发布 / 官网已上线）；
//   - 预检结果带指纹：冻结输入（版本 / main / dev / 远端 / 官网配置 / 材料指纹）任一变化
//     使旧预检失效，启动被阻塞并列出变化项；
//   - 取消只停后续阶段（已上线目标保留）；重试从首个失败阶段接续；
//   - 服务重启 running/prechecking 标记 interrupted 可重试（对齐 REL recoverInterrupted）。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AtbError, writeJsonAtomic, localDateStamp } from './core.mjs';
import { scrubSecrets } from './release-store.mjs';

const padNum = (n, len) => String(n).padStart(len, '0');
const nowIso = () => new Date().toISOString();
const HASH_RE = /^[0-9a-f]{40}$/i;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;

export const PREL_SCHEMA_VERSION = 1;
export const PREL_STATUSES = ['draft', 'prechecking', 'running', 'waiting-manual', 'succeeded', 'failed', 'canceled'];
export const PREL_STATUS_LABEL = {
  draft: '草稿', prechecking: '预检', running: '进行中', 'waiting-manual': '等待人工',
  succeeded: '已发布', failed: '失败', canceled: '已取消',
};
// 活动运行：同产品互斥（等待人工同样占互斥，防同目标双开）
export const ACTIVE_STATUSES = ['prechecking', 'running', 'waiting-manual'];

// 六阶段（顺序即执行顺序）：源码 main/dev 双分支原子推送是必经前置，随后两个必备目标
export const PRODUCT_STAGES = [
  { key: 'sync-source', label: '源码同步（切 main + main/dev 原子推送）' },
  { key: 'webapp-build', label: 'Web App 构建（冻结源码）' },
  { key: 'webapp-verify', label: 'Web App 本机部署回验' },
  { key: 'site-materials', label: '官网中英文材料核验' },
  { key: 'site-deploy', label: '官网本机构建部署' },
  { key: 'site-verify', label: '官网中英文回验' },
];
// 目标卡：webapp = build+verify 两阶段；site = materials+deploy+verify 三阶段
export const PRODUCT_TARGETS = { webapp: 'Web App', site: '官网与文档' };
const TARGET_STAGES = { webapp: ['webapp-build', 'webapp-verify'], site: ['site-materials', 'site-deploy', 'site-verify'] };

// 同产品并发冲突（HTTP 409；携带活动/幂等运行 ID 供前端引导）
export class ProductReleaseConflictError extends AtbError {
  constructor(message, activeRunId) {
    super(message);
    this.activeRunId = activeRunId;
  }
}

/* ---------- 目录 ---------- */

export const productRunsRoot = (dataDir) => path.join(dataDir, 'releases', 'product-runs');
export const productRunDir = (dataDir, id) => path.join(productRunsRoot(dataDir), id);
export const productRunFile = (dataDir, id) => path.join(productRunDir(dataDir, id), 'run.json');

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

function nextRunId(dataDir) {
  let ids = [];
  try {
    ids = fs.readdirSync(productRunsRoot(dataDir)).filter((x) => /^PREL-\d{8}-\d{3}$/.test(x));
  } catch { /* 目录尚未创建 */ }
  const stamp = localDateStamp();
  const todayMax = ids.filter((x) => x.includes(stamp)).reduce((m, x) => Math.max(m, Number(x.slice(-3))), 0);
  const globalMax = ids.reduce((m, x) => Math.max(m, Number(x.slice(-3))), 0);
  return `PREL-${stamp}-${padNum(Math.max(todayMax, globalMax) + 1, 3)}`;
}

/* ---------- 冻结指纹与预检新鲜度 ---------- */

const INPUT_LABELS = [
  ['version', '发行版本号'],
  ['mainSha', 'main 分支头'],
  ['devSha', 'dev 分支头'],
  ['remote', '源码远端'],
  ['homepage', '官网配置'],
  ['materialsFingerprint', '官网材料指纹'],
];

// 冻结输入指纹：任一输入变化 → 旧预检失效（README：输入或材料变化使旧预检失效）
export function computeFreezeFingerprint(inputs) {
  const h = crypto.createHash('sha256');
  for (const [key] of INPUT_LABELS) {
    const v = inputs ? inputs[key] : undefined;
    h.update(`${key}=${v == null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v)}\n`);
  }
  return h.digest('hex').slice(0, 32);
}

// 启动前新鲜度核验：无预检 / 预检未通过 / 输入变化 → AtbError（stale 列变化项）
export function assertPrecheckFresh(run, currentInputs) {
  if (!run.precheck) {
    throw new AtbError('尚未预检：请先运行预检（预检为只读操作，不推送 / 不上传 / 不部署）');
  }
  if (!run.precheck.ok) {
    throw new AtbError('预检未通过：请先处理预检列出的阻塞项后重新预检');
  }
  const expected = computeFreezeFingerprint(currentInputs);
  if (run.precheck.fingerprint !== expected) {
    const changes = [];
    const before = run.precheck.inputs || {};
    for (const [key, label] of INPUT_LABELS) {
      const a = before[key] == null ? 'null' : typeof before[key] === 'object' ? JSON.stringify(before[key]) : String(before[key]);
      const b = currentInputs ? currentInputs[key] : undefined;
      const b2 = b == null ? 'null' : typeof b === 'object' ? JSON.stringify(b) : String(b);
      if (a !== b2) changes.push(label);
    }
    throw new AtbError(`预检已失效（${changes.join('、') || '冻结输入'}在预检后发生变化）：请重新预检并在展示新计划后启动${changes.includes('main 分支头') ? '（main 已前进，可重新冻结为当前 main）' : ''}`);
  }
  return true;
}

/* ---------- 运行记录 ---------- */

function normalizeFreeze(freeze) {
  const f = freeze && typeof freeze === 'object' ? freeze : {};
  const mainSha = String(f.mainSha || '').toLowerCase();
  const devSha = String(f.devSha || '').toLowerCase();
  if (!HASH_RE.test(mainSha)) throw new AtbError('冻结失败：无法读取 main 分支头（40 位提交号）');
  if (!HASH_RE.test(devSha)) throw new AtbError('冻结失败：无法读取 dev 分支头（main/dev 双分支推送前置，两分支缺一不可）');
  if (!String(f.remote || '').trim()) throw new AtbError('冻结失败：源码远端未解析（缺失或歧义时明确阻塞）');
  return {
    mainSha, devSha,
    remote: String(f.remote).trim(),
    remoteUrl: scrubSecrets(String(f.remoteUrl || '')),
    extraCommits: Array.isArray(f.extraCommits) ? f.extraCommits.slice(0, 50) : [],
    homepage: {
      repoRoot: String(f.homepage?.repoRoot || ''),
      branch: String(f.homepage?.branch || 'main'),
      contentDir: String(f.homepage?.contentDir || ''),
    },
  };
}

// 从已合并 BLD 创建产品发布草稿（冻结事实由 git 层收集后传入，本层只存事实不伪造）
export function createProductRun(dataDir, { productId, bld, freeze, version, versionName = '', by = 'board' }) {
  const product = String(productId || '').trim();
  if (!product) throw new AtbError('缺少产品标识（项目名）');
  if (!bld || bld.status !== 'merged') {
    throw new AtbError('仅已合并（merged）的版本计划可创建发布：未合并版本请先完成合并（不重复选单/合并）');
  }
  const ver = String(version || '').trim();
  if (!VERSION_RE.test(ver)) throw new AtbError('发行版本号非法（形如 1.2.0 / v1.2.0，字母数字 . _ + -）');
  // 条目快照来自 BLD（创建即冻结；来源计划后续改名/删除不影响本快照）
  const items = (Array.isArray(bld.items) ? bld.items : []).map((it) => ({
    itemId: String(it.itemId || ''),
    title: String(it.title || ''),
    commit: String(it.commit || '').toLowerCase(),
  }));
  if (!items.length) throw new AtbError('冻结失败：版本计划无关联条目快照');
  if (items.some((it) => !HASH_RE.test(it.commit))) throw new AtbError('冻结失败：条目快照缺少有效 commit');
  const fz = normalizeFreeze(freeze);
  fz.items = items;
  // 同产品活动运行互斥
  const runs = listProductRuns(dataDir);
  const active = runs.find((r) => r.productId === product && ACTIVE_STATUSES.includes(r.status));
  if (active) {
    throw new ProductReleaseConflictError(
      `产品 ${product} 已有活动发布运行 ${active.id}（${PREL_STATUS_LABEL[active.status] || active.status}）：同目标并发互斥，请先处理既有运行`,
      active.id,
    );
  }
  // 同产品+版本幂等：已成功不再重复发版
  const dup = runs.find((r) => r.productId === product && r.version === ver && r.status === 'succeeded');
  if (dup) {
    throw new ProductReleaseConflictError(
      `产品 ${product} 版本 ${ver} 已发布成功（${dup.id}）：不重复发版，请查看既有发布记录`,
      dup.id,
    );
  }
  const id = nextRunId(dataDir);
  const run = {
    id, schemaVersion: PREL_SCHEMA_VERSION,
    productId: product,
    bldId: String(bld.id || ''),
    bldName: String(bld.name || bld.id || ''),
    versionName: String(versionName || bld.name || ''),
    version: ver,
    status: 'draft',
    frozen: { version: ver, ...fz, materialsFingerprint: null },
    stages: PRODUCT_STAGES.map((s) => ({ key: s.key, label: s.label, status: 'pending', startedAt: null, endedAt: null, error: null, result: null })),
    targets: {
      webapp: { status: 'pending', localUrl: null, port: null },
      site: { status: 'pending', localUrl: null, port: null },
    },
    precheck: null,
    webapp: null,
    evidence: [],
    history: [{ at: nowIso(), action: 'create', by, note: `从 ${bld.id} 创建产品发布草稿（冻结 main ${fz.mainSha.slice(0, 8)} / dev ${fz.devSha.slice(0, 8)}）` }],
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  fs.mkdirSync(path.join(productRunDir(dataDir, id), 'logs'), { recursive: true });
  writeJsonAtomic(productRunFile(dataDir, id), run);
  return run;
}

export function readProductRun(dataDir, id) {
  if (!/^PREL-\d{8}-\d{3}$/.test(String(id || ''))) throw new AtbError(`非法产品发布运行编号：${id}`);
  const run = readJson(productRunFile(dataDir, id));
  if (!run || run.id !== id) throw new AtbError(`找不到产品发布运行 ${id}`);
  return run;
}

export function listProductRuns(dataDir) {
  let ids = [];
  try {
    ids = fs.readdirSync(productRunsRoot(dataDir)).filter((x) => /^PREL-\d{8}-\d{3}$/.test(x));
  } catch {
    return [];
  }
  return ids
    .map((id) => readJson(productRunFile(dataDir, id)))
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function summarizeProductRun(run) {
  const failedStage = run.stages.find((s) => s.status === 'failed');
  return {
    id: run.id, productId: run.productId, version: run.version, versionName: run.versionName,
    bldId: run.bldId, bldName: run.bldName,
    status: run.status, label: PREL_STATUS_LABEL[run.status] || run.status,
    createdAt: run.createdAt, updatedAt: run.updatedAt,
    mainSha: run.frozen?.mainSha || null,
    extraCount: (run.frozen?.extraCommits || []).length,
    targets: {
      webapp: run.targets?.webapp?.status || 'pending',
      site: run.targets?.site?.status || 'pending',
    },
    webappUrl: run.targets?.webapp?.localUrl || null,
    siteUrl: run.targets?.site?.localUrl || null,
    failedStage: failedStage ? failedStage.key : null,
    error: failedStage?.error || null,
  };
}

// 整体完成判定：sync-source done + 两必备目标全 done 才 succeeded（部分成功保持 failed）
export function overallStatus(run) {
  const stageOf = (k) => run.stages.find((s) => s.key === k);
  const syncDone = stageOf('sync-source')?.status === 'done';
  const targetsDone = Object.values(TARGET_STAGES).every((keys) => keys.every((k) => ['done', 'skipped'].includes(stageOf(k)?.status)));
  const anyCanceled = run.stages.some((s) => s.status === 'canceled');
  if (anyCanceled) return 'canceled';
  if (syncDone && targetsDone && run.stages.every((s) => ['done', 'skipped'].includes(s.status))) return 'succeeded';
  if (run.stages.some((s) => s.status === 'failed')) return 'failed';
  return run.status;
}

/* ---------- 原子更新 / 日志 ---------- */

export function mutateProductRun(dataDir, id, fn, { by = 'board', action = 'update', note = '' } = {}) {
  const run = readProductRun(dataDir, id);
  fn(run);
  run.updatedAt = nowIso();
  run.history.push({ at: nowIso(), action, by, note: note || undefined });
  writeJsonAtomic(productRunFile(dataDir, id), run);
  return run;
}

export function appendProductRunLog(dataDir, id, stage, line) {
  const file = path.join(productRunDir(dataDir, id), 'logs', `${stage}.log`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const stamped = `[${new Date().toISOString()}] ${scrubSecrets(String(line))}`;
  fs.appendFileSync(file, `${stamped}\n`);
  return stamped;
}

export function readProductRunLogs(dataDir, id) {
  const dir = path.join(productRunDir(dataDir, id), 'logs');
  const out = {};
  try {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.log')).sort()) {
      out[f.replace(/\.log$/, '')] = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean);
    }
  } catch { /* 无日志目录 → 空对象 */ }
  return out;
}

export function pushProductEvidence(run, kind, note, extra = {}) {
  run.evidence.push({ at: nowIso(), kind, note: scrubSecrets(note), ...extra });
}

/* ---------- 互斥 / 预检落盘 / 重试取消 / 恢复 ---------- */

export function activeProductRun(dataDir, { exceptId = null } = {}) {
  return listProductRuns(dataDir).find((r) => ACTIVE_STATUSES.includes(r.status) && r.id !== exceptId) || null;
}

export function assertProductFree(dataDir, { exceptId = null } = {}) {
  const active = activeProductRun(dataDir, { exceptId });
  if (active) {
    throw new ProductReleaseConflictError(
      `已有活动产品发布运行 ${active.id}（${PREL_STATUS_LABEL[active.status] || active.status}）：同产品并发互斥`,
      active.id,
    );
  }
}

// 预检结果落盘（inputs 为当时的实际冻结输入快照，指纹由本函数计算）
export function savePrecheck(dataDir, id, { ok, checks = [], inputs = {} }) {
  return mutateProductRun(dataDir, id, (r) => {
    r.precheck = {
      ranAt: nowIso(), ok: !!ok, checks,
      inputs: JSON.parse(JSON.stringify(inputs)),
      fingerprint: computeFreezeFingerprint(inputs),
    };
  }, { by: 'board', action: 'precheck', note: ok ? '预检通过' : '预检未通过（存在阻塞项）' });
}

// 重试：首个失败阶段及其后回 pending；已完成阶段与证据不动
export function resetForRetry(run) {
  const idx = run.stages.findIndex((s) => s.status === 'failed');
  if (idx === -1) return run;
  for (let i = idx; i < run.stages.length; i++) {
    run.stages[i].status = 'pending';
    run.stages[i].error = null;
    run.stages[i].startedAt = null;
    run.stages[i].endedAt = null;
  }
  run.status = 'running';
  return run;
}

// 取消：pending/running 阶段置 canceled；已完成阶段、证据与已上线目标保留
export function cancelRemaining(run, reason = '') {
  for (const s of run.stages) {
    if (s.status === 'pending' || s.status === 'running') {
      s.status = 'canceled';
      s.endedAt = nowIso();
    }
  }
  for (const t of Object.keys(run.targets || {})) {
    if (run.targets[t].status === 'pending') run.targets[t].status = 'canceled';
  }
  run.status = 'canceled';
  return run;
}

// 服务重启恢复：running/prechecking 阶段标 interrupted（可重试，不自动重跑）
export function recoverInterruptedProductRuns(dataDir, { skipIds = [] } = {}) {
  let ids = [];
  try {
    ids = fs.readdirSync(productRunsRoot(dataDir)).filter((x) => /^PREL-\d{8}-\d{3}$/.test(x));
  } catch {
    return 0;
  }
  let n = 0;
  for (const id of ids) {
    if (skipIds.includes(id)) continue;
    const run = readJson(productRunFile(dataDir, id));
    if (!run || !['running', 'prechecking'].includes(run.status)) continue;
    const runningStage = run.stages.find((s) => s.status === 'running');
    if (!runningStage) continue;
    runningStage.status = 'failed';
    runningStage.endedAt = nowIso();
    runningStage.error = {
      kind: 'interrupted',
      message: '服务重启导致执行中断：可重试本阶段（只重跑未完成操作；推送类操作重试前会先查询远端实际结果）',
    };
    run.status = 'failed';
    run.updatedAt = nowIso();
    run.history.push({ at: nowIso(), action: 'interrupted', by: 'system', note: '服务重启中断标记' });
    writeJsonAtomic(productRunFile(dataDir, id), run);
    n++;
  }
  return n;
}

// 目标卡阶段键（流水线按目标分组推进 / 展示用）
export { TARGET_STAGES };
