// REQ-20260910-029 发布模块数据层（release-store）—— server.mjs / 流水线执行器使用。
// 事实源：<dataDir>/releases/（与 requirements/bugs/dispatch 隔离，不进 REQ/BUG 状态机）：
//   config.json                       模块配置（protectedBranches 受保护分支等）
//   sku-map.json                      Bundle ID → SKU 映射（Apple 首次收集后持久化复用）
//   runs/REL-YYYYMMDD-NNN/run.json    发布运行（冻结配置、阶段状态、证据、操作历史）
//   runs/REL-YYYYMMDD-NNN/logs/*.log  阶段日志（脱敏后落盘）
// 语义边界：
//   - 发布是实际执行流程：本层只存事实与证据，不伪造执行成功；
//   - 同项目同目标类型同时只有一个活动运行（prechecking/running/waiting-manual），
//     重试 / 取消 / 刷新只操作本运行（exceptId），不覆盖其他运行状态；
//   - 敏感内容（远端 URL 凭据、ASC 密钥、token）一律 sanitize / scrub 后才入记录与日志；
//   - 服务重启后 running 阶段标记 interrupted（可重试），不自动重跑已开始的阶段。

import fs from 'node:fs';
import path from 'node:path';
import {
  AtbError, writeJsonAtomic, localDateStamp,
} from './core.mjs';

const padNum = (n, len) => String(n).padStart(len, '0');
// ref 名非法字符：空白 / ~ ^ : ? * [ ] \（git check-ref-format 口径的子集）
const BAD_REF_CHARS = /[\s~^:?*[\]\\]/;

export const RELEASE_SCHEMA_VERSION = 1;

// 目标类型：git / apple / electron（REQ-20260910-030 桌面应用）可执行；
// web / storage 仅保留扩展枚举（不显示可执行入口）
export const TARGET_TYPES = [
  { key: 'git', label: 'Git 远端', enabled: true },
  { key: 'apple', label: 'Apple App Store', enabled: true },
  { key: 'electron', label: '桌面应用（Electron）', enabled: true },
  { key: 'web', label: '网站', enabled: false },
  { key: 'storage', label: '网络存储', enabled: false },
];
export const TARGET_LABEL = Object.fromEntries(TARGET_TYPES.map((x) => [x.key, x.label]));
export const EXECUTABLE_TARGETS = TARGET_TYPES.filter((x) => x.enabled).map((x) => x.key);

export const RUN_STATUSES = ['draft', 'prechecking', 'running', 'waiting-manual', 'succeeded', 'failed', 'canceled'];
export const RUN_STATUS_LABEL = {
  draft: '草稿', prechecking: '预检', running: '进行中', 'waiting-manual': '等待人工',
  succeeded: '成功', failed: '失败', canceled: '已取消',
};
// 活动运行：占用同目标互斥（等待人工占互斥——外部流程未终结，避免同目标双开）
export const ACTIVE_STATUSES = ['prechecking', 'running', 'waiting-manual'];
export const STAGE_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped', 'canceled'];

// Git 七阶段 / Apple 八阶段 / Electron 五阶段（README 口径；顺序即执行顺序）
export const GIT_STAGES = [
  { key: 'freeze', label: '配置冻结' },
  { key: 'local-precheck', label: '本地预检' },
  { key: 'fetch-remote', label: '获取远端' },
  { key: 'quality-check', label: '质量检查' },
  { key: 'plan', label: '推送计划' },
  { key: 'push', label: '执行推送' },
  { key: 'verify', label: '结果核验' },
];
export const APPLE_STAGES = [
  { key: 'locate', label: '定位应用与材料' },
  { key: 'env-credentials', label: '环境与凭据' },
  { key: 'materials', label: '资料与合规' },
  { key: 'build', label: '版本与构建' },
  { key: 'upload', label: '上传 TestFlight' },
  { key: 'submission-check', label: '提审前检查' },
  { key: 'review-data', label: '准备审核数据' },
  { key: 'track', label: '人工提审与跟踪' },
];
// REQ-20260910-030：freeze → local-precheck（只读预检）→ deps-install（隔离 worktree）→ build（electron-builder 逐平台）→ verify（产物核验）
export const ELECTRON_STAGES = [
  { key: 'freeze', label: '配置冻结' },
  { key: 'local-precheck', label: '本地预检' },
  { key: 'deps-install', label: '依赖安装' },
  { key: 'build', label: '桌面构建' },
  { key: 'verify', label: '产物核验' },
];
const STAGE_DEFS = { git: GIT_STAGES, apple: APPLE_STAGES, electron: ELECTRON_STAGES };
export const stagesFor = (target) => (STAGE_DEFS[target] || GIT_STAGES)
  .map((s) => ({ key: s.key, label: s.label, status: 'pending', startedAt: null, endedAt: null, error: null, result: null }));

// 同目标并发冲突（HTTP 409；携带当前活动运行 ID 供前端引导）
export class ReleaseConflictError extends AtbError {
  constructor(message, activeRunId) {
    super(message);
    this.activeRunId = activeRunId;
  }
}

const nowIso = () => new Date().toISOString();
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/* ---------- 目录 ---------- */

export function releasesDir(dataDir) {
  return path.join(dataDir, 'releases');
}
export function runsDir(dataDir) {
  return path.join(releasesDir(dataDir), 'runs');
}
export function runDir(dataDir, id) {
  return path.join(runsDir(dataDir), id);
}
export function runFile(dataDir, id) {
  return path.join(runDir(dataDir, id), 'run.json');
}

/* ---------- 脱敏（S5） ---------- */

// 剥离 URL 内嵌凭据（https://user:pass@host/… → https://host/…）。
// 仅用户名无密码（ssh://git@host 等传输账户）不是凭据，保持原样。
export function sanitizeRemoteUrl(url) {
  const raw = String(url || '');
  try {
    const u = new URL(raw);
    if (u.password) {
      u.password = '';
      u.username = '';
      return u.toString().replace(/:\/\/@/, '://');
    }
    return raw;
  } catch {
    // ssh 简式 git@host:path 或本地路径：无凭据语义，原样返回
    return raw.replace(/[a-zA-Z0-9._%+-]+:[^@/\s]+@/g, '');
  }
}

// 日志敏感信息擦除：token / Authorization / 私钥块
export function scrubSecrets(text) {
  return String(text || '')
    .replace(/Authorization:\s*Bearer\s+\S+/gi, 'Authorization: Bearer ***')
    .replace(/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, '$1***$2')
    .replace(/\b[a-zA-Z0-9_-]{20,}\.{2,}[a-zA-Z0-9_-]{10,}\.{1,}[a-zA-Z0-9_-]{10,}\b/g, (m) => `${m.slice(0, 6)}***`);
}

/* ---------- 模块配置 ---------- */

export function readModuleConfig(dataDir) {
  const file = path.join(releasesDir(dataDir), 'config.json');
  const cfg = readJson(file);
  if (!cfg) return { protectedBranches: [] };
  if (typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new AtbError('发布模块 config.json 已损坏，无法解析（请人工检查，系统不自动覆盖）');
  }
  return {
    protectedBranches: Array.isArray(cfg.protectedBranches) ? cfg.protectedBranches.filter((x) => typeof x === 'string') : [],
    appleRepoPaths: cfg.appleRepoPaths && typeof cfg.appleRepoPaths === 'object' ? cfg.appleRepoPaths : {},
    // REQ-20260915-002：官网仓库根目录（设置模块一次配置，供产品发布复用；不硬编码目录名）
    homepageRepoRoot: typeof cfg.homepageRepoRoot === 'string' ? cfg.homepageRepoRoot : '',
  };
}

// REQ-20260915-002：保存官网仓库根目录（一次配置；变更使旧预检失效——由冻结输入指纹口径保证）
export function saveHomepageRepoRoot(dataDir, repoRoot) {
  const val = String(repoRoot || '').trim();
  if (!val || !path.isAbsolute(val)) throw new AtbError('官网仓库根目录必须是绝对路径');
  if (!fs.existsSync(val)) throw new AtbError(`官网仓库目录不存在：${val}`);
  if (!fs.existsSync(path.join(val, '.git'))) throw new AtbError(`配置的目录不是 git 仓库：${val}`);
  const cfg = readModuleConfig(dataDir);
  fs.mkdirSync(releasesDir(dataDir), { recursive: true });
  writeJsonAtomic(path.join(releasesDir(dataDir), 'config.json'), {
    ...cfg,
    homepageRepoRoot: val,
    homepageUpdatedAt: new Date().toISOString(),
  });
  return { ok: true, homepageRepoRoot: val };
}

/* ---------- SKU 映射（Apple 首次收集后持久化复用，S5/A1） ---------- */

export function readSkuMap(dataDir) {
  const file = path.join(releasesDir(dataDir), 'sku-map.json');
  const m = readJson(file);
  if (!m || typeof m !== 'object') return {};
  return m;
}

export function saveSkuMapping(dataDir, { bundleId, sku, isDefault = false }) {
  const key = String(bundleId || '').trim();
  const val = String(sku || '').trim();
  if (!key || !val) throw new AtbError('bundleId 与 sku 均不能为空');
  fs.mkdirSync(releasesDir(dataDir), { recursive: true });
  const map = readSkuMap(dataDir);
  map[key] = { sku: val, isDefault: !!isDefault, updatedAt: nowIso() };
  writeJsonAtomic(path.join(releasesDir(dataDir), 'sku-map.json'), map);
  return { bundleId: key, mapping: map[key] };
}

/* ---------- 运行记录 ---------- */

const GIT_BAD_REF = (s) => BAD_REF_CHARS.test(s) || s.startsWith('-') || s.startsWith('refs/');

// Electron 平台组合（REQ-20260910-030）：mac → macOS 应用包（dmg）、win → Windows 安装包（nsis）
export const ELECTRON_PLATFORM_LABEL = { mac: 'macOS', win: 'Windows' };

function validateElectronConfig(c, fields) {
  const str = (v) => (v == null ? '' : String(v).trim());
  const raw = Array.isArray(c.platforms) ? c.platforms : [];
  const platforms = [...new Set(raw.map((p) => String(p).trim()).filter(Boolean))];
  if (!platforms.length) {
    fields.platforms = '必须至少选择一个目标平台（macOS / Windows）';
  } else if (platforms.some((p) => !['mac', 'win'].includes(p))) {
    fields.platforms = '目标平台仅支持 macOS / Windows';
  } else {
    c.platforms = platforms.sort(); // 规范化：去重排序（mac < win，列表标识稳定）
  }
  if (str(c.macArch) && !['arm64', 'x64', 'universal'].includes(str(c.macArch))) {
    fields.macArch = 'macOS 架构仅支持 arm64 / x64 / universal';
  } else {
    c.macArch = str(c.macArch);
  }
  if (str(c.version) && !/^\d+(\.\d+){0,2}$/.test(str(c.version))) {
    fields.version = '版本号形如 1.2.0（留空默认取项目 package.json version）';
  }
  const outDir = str(c.outDir);
  if (outDir.startsWith('/') || outDir.includes('..')) {
    fields.outDir = '输出目录必须是项目内的相对路径（如 dist），不能逃出项目根';
  } else if (!outDir) {
    c.outDir = 'dist'; // 默认 dist/（.gitignore 已忽略）
  }
}

function validateConfig(target, config) {
  const fields = {};
  const c = config && typeof config === 'object' ? config : {};
  const str = (v) => (v == null ? '' : String(v).trim());
  if (target === 'git') {
    if (!str(c.remote)) fields.remote = '必须选择已配置的 remote';
    if (!str(c.sourceBranch)) fields.sourceBranch = '必须填写源分支';
    if (!str(c.targetBranch)) fields.targetBranch = '必须填写目标分支';
    if (GIT_BAD_REF(str(c.targetBranch))) {
      fields.targetBranch = '目标分支名非法（不能包含空白或 ref 元字符）';
    }
    if (str(c.tagName) && (BAD_REF_CHARS.test(str(c.tagName)) || str(c.tagName).startsWith('-'))) {
      fields.tagName = '标签名非法';
    }
    if (!str(c.checkCommand)) fields.checkCommand = '必须配置项目校验命令（缺失校验配置将明确阻塞）';
  } else if (target === 'electron') {
    validateElectronConfig(c, fields);
  } else {
    if (!str(c.projectPath)) fields.projectPath = '必须选择 Xcode project / workspace';
    if (!str(c.scheme)) fields.scheme = '必须填写 scheme';
    if (!str(c.platform)) fields.platform = '必须选择平台';
    if (!/^\d+(\.\d+){0,2}$/.test(str(c.version))) fields.version = '版本号形如 1.2.0';
    if (!/^\d+$/.test(str(c.build))) fields.build = 'build 号为数字';
  }
  if (Object.keys(fields).length) {
    const e = new AtbError('发布配置不完整');
    e.fields = fields;
    throw e;
  }
}

// 配置校验（server /run/save 复用；错误带 fields 供前端定位字段）
export function validateRunConfig(target, config) {
  if (!EXECUTABLE_TARGETS.includes(target)) {
    const known = TARGET_TYPES.find((x) => x.key === target);
    throw new AtbError(known ? `目标类型「${known.label}」首期未开放（仅保留扩展设计）` : `非法目标类型：${target}`);
  }
  validateConfig(target, config);
}

function nextRunId(dataDir) {
  const dir = runsDir(dataDir);
  let ids = [];
  try {
    ids = fs.readdirSync(dir).filter((x) => /^REL-\d{8}-\d{3}$/.test(x));
  } catch { /* 目录尚未创建 */ }
  const stamp = localDateStamp();
  const todayMax = ids
    .filter((x) => x.includes(stamp))
    .reduce((m, x) => Math.max(m, Number(x.slice(-3))), 0);
  // 非当日运行存在时不回退序号：取全局最大 +1 的保守做法（同日优先当日序号）
  const globalMax = ids.reduce((m, x) => Math.max(m, Number(x.slice(-3))), 0);
  return `REL-${stamp}-${padNum(Math.max(todayMax, globalMax) + 1, 3)}`;
}

export function createRun(dataDir, { target, config, by = 'board', parentId = null }) {
  if (!EXECUTABLE_TARGETS.includes(target)) {
    const known = TARGET_TYPES.find((x) => x.key === target);
    throw new AtbError(known ? `目标类型「${known.label}」首期未开放（仅保留扩展设计）` : `非法目标类型：${target}`);
  }
  validateConfig(target, config);
  const id = nextRunId(dataDir);
  const run = {
    id, schemaVersion: RELEASE_SCHEMA_VERSION, target,
    status: 'draft',
    parentId: parentId || null,
    createdAt: nowIso(), updatedAt: nowIso(),
    config: JSON.parse(JSON.stringify(config)),
    frozen: null,
    stages: stagesFor(target),
    evidence: [],
    history: [{ at: nowIso(), action: 'create', by, note: `创建草稿（${TARGET_LABEL[target]}）` }],
    simulated: false,
  };
  fs.mkdirSync(runDir(dataDir, id), { recursive: true });
  fs.mkdirSync(path.join(runDir(dataDir, id), 'logs'), { recursive: true });
  writeJsonAtomic(runFile(dataDir, id), run);
  return run;
}

export function readRun(dataDir, id) {
  if (!/^REL-\d{8}-\d{3}$/.test(String(id || ''))) throw new AtbError(`非法运行编号：${id}`);
  const run = readJson(runFile(dataDir, id));
  if (!run || run.id !== id) throw new AtbError(`找不到发布运行 ${id}`);
  return run;
}

export function listRuns(dataDir) {
  let ids = [];
  try {
    ids = fs.readdirSync(runsDir(dataDir)).filter((x) => /^REL-\d{8}-\d{3}$/.test(x));
  } catch {
    return [];
  }
  return ids
    .map((id) => readJson(runFile(dataDir, id)))
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((run) => summarizeRun(run));
}

export function summarizeRun(run) {
  const failedStage = run.stages.find((s) => s.status === 'failed');
  let version = null;
  if (run.target === 'apple') version = `${run.config.version || ''} (${run.config.build || ''})`.trim();
  if (run.target === 'electron') version = run.config.version || null;
  return {
    id: run.id, target: run.target, status: run.status, label: runLabel(run),
    parentId: run.parentId || null,
    createdAt: run.createdAt, updatedAt: run.updatedAt,
    simulated: !!run.simulated,
    sourceOid: run.frozen?.sourceOid || null,
    version,
    failedStage: failedStage ? failedStage.key : null,
    error: failedStage?.error || null,
  };
}

export function runLabel(run) {
  if (run.target === 'git') {
    return `${run.config.remote || '?'} → ${run.config.targetBranch || '?'}`;
  }
  if (run.target === 'electron') {
    const name = run.frozen?.appName || run.config.appName || '桌面应用';
    const plats = (run.config.platforms || []).map((p) => ELECTRON_PLATFORM_LABEL[p] || p).join(' + ');
    return `${name} ${run.frozen?.version || run.config.version || '?'}${plats ? ` · ${plats}` : ''}`;
  }
  return `${run.config.version || '?'} · Apple App Store`;
}

/* ---------- 原子更新（history 记账） ---------- */

export function mutateRun(dataDir, id, fn, { by = 'board', action = 'update', note = '' } = {}) {
  const run = readRun(dataDir, id);
  fn(run);
  run.updatedAt = nowIso();
  run.history.push({ at: nowIso(), action, by, note: note || undefined });
  writeJsonAtomic(runFile(dataDir, id), run);
  return run;
}

/* ---------- 阶段日志（脱敏落盘） ---------- */

export function appendStageLog(dataDir, id, stage, line) {
  const file = path.join(runDir(dataDir, id), 'logs', `${stage}.log`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const stamped = `[${new Date().toISOString()}] ${scrubSecrets(String(line))}`;
  fs.appendFileSync(file, `${stamped}\n`);
  return stamped;
}

export function readRunLogs(dataDir, id) {
  const dir = path.join(runDir(dataDir, id), 'logs');
  const out = {};
  try {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.log')).sort()) {
      out[f.replace(/\.log$/, '')] = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean);
    }
  } catch { /* 无日志目录 → 空对象 */ }
  return out;
}

/* ---------- 互斥（S3） ---------- */

export function activeRunOf(dataDir, target, { exceptId = null } = {}) {
  return listRuns(dataDir).find((r) => r.target === target && ACTIVE_STATUSES.includes(r.status) && r.id !== exceptId) || null;
}

export function assertTargetFree(dataDir, target, { exceptId = null } = {}) {
  const active = activeRunOf(dataDir, target, { exceptId });
  if (active) {
    throw new ReleaseConflictError(`同目标（${TARGET_LABEL[target]}）已有活动运行 ${active.id}（${RUN_STATUS_LABEL[active.status]}），并发运行互斥`, active.id);
  }
}

/* ---------- 重试 / 取消（S4） ---------- */

// 定位首个失败 / 未完成阶段（null = 无）
export function firstFailedStage(run) {
  return run.stages.find((s) => s.status === 'failed' || (s.status === 'canceled' && false)) || null;
}

// 重试语义：失败阶段及其后非 done 阶段回 pending；已完成阶段与证据不动
export function resetForRetry(run) {
  const idx = run.stages.findIndex((s) => s.status === 'failed');
  if (idx === -1) return run;
  for (let i = idx; i < run.stages.length; i++) {
    run.stages[i].status = 'pending';
    run.stages[i].error = null;
    run.stages[i].startedAt = null;
    run.stages[i].endedAt = null;
    // result 保留：已获取的外部事实（上传标识等）供「先查询再操作」复用
  }
  run.status = 'running';
  return run;
}

// 取消语义：pending / running 阶段置 canceled；已完成阶段与证据保留
export function cancelRemaining(run, reason = '') {
  for (const s of run.stages) {
    if (s.status === 'pending' || s.status === 'running') {
      s.status = 'canceled';
      s.endedAt = nowIso();
    }
  }
  run.status = 'canceled';
  return run;
}

/* ---------- 服务重启中断标记（S5） ---------- */

// running / prechecking 状态在服务重启后无内存执行器：标记 interrupted（可重试），不自动重跑；
// skipIds 为本进程内正在执行的活动运行（不可误标）
export function recoverInterrupted(dataDir, { skipIds = [] } = {}) {
  let ids = [];
  try {
    ids = fs.readdirSync(runsDir(dataDir)).filter((x) => /^REL-\d{8}-\d{3}$/.test(x));
  } catch {
    return;
  }
  for (const id of ids) {
    if (skipIds.includes(id)) continue;
    const run = readJson(runFile(dataDir, id));
    if (!run) continue;
    if (!['running', 'prechecking'].includes(run.status)) continue;
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
    writeJsonAtomic(runFile(dataDir, id), run);
  }
}

/* ---------- 证据记账 ---------- */

export function pushEvidence(run, kind, note, extra = {}) {
  run.evidence.push({ at: nowIso(), kind, note: scrubSecrets(note), ...extra });
}
