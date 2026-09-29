// REQ-20260913-001 构建模块数据层（build-store）—— server.mjs 使用。
// 事实源：<dataDir>/builds/versions/BLD-YYYYMMDD-NNN/version.json（与 requirements/bugs/releases
// 隔离，不进 REQ/BUG 状态机）。版本状态机：draft 计划中 → merging 合并中 → merged 已合并 / failed
// 失败（failed 可重试回 merging，只补未合并条目）。语义边界（design.md 落定口径）：
//   - 合并入 main 由 build-git 在服务端同步执行；本层只存事实与逐条目结果，不伪造成功；
//   - merging/merged 锁条目增删；merging 锁名称与描述编辑；merged/failed 允许编辑信息；
//   - 服务重启后 merging 标记 failed（recoverMerging，不自动重跑）。
//   - 一条目至多纳入一个版本（BUG-20260914-004）：已纳入任一版本（draft/merging/merged/failed
//     任一状态）的条目视为占用，跨版本重复纳入在本层拒绝（含占用版本编号）；从 draft/failed
//     版本移出或删除版本后占用释放，条目可重新纳入。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AtbError, writeJsonAtomic } from './core.mjs';
import * as flow from './publish-flow.mjs';

const pad = (n, len) => String(n).padStart(len, '0');
const nowIso = () => new Date().toISOString();
const HASH_RE = /^[0-9a-f]{40}$/i;
const ITEM_ID_RE = /^(?:REQ|BUG)-\d{8}-\d{3,}$/;

export const NAME_MAX = 80;
export const DESC_MAX = 4000;
export const TARGET_BRANCH = 'main';

export const VERSION_STATUSES = ['draft', 'merging', 'merged', 'failed'];
export const VERSION_STATUS_LABEL = {
  draft: '计划中', merging: '合并中', merged: '已合并', failed: '失败',
};

// 冲突类（HTTP 409）：状态机不允许的操作（重复合并 / 锁定态增删编辑等）。
export class BuildConflictError extends AtbError {}

const versionsRoot = (dataDir) => path.join(dataDir, 'runtime', 'builds', 'versions');

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeVersion(dataDir, v) {
  const dir = path.join(versionsRoot(dataDir), v.id);
  fs.mkdirSync(dir, { recursive: true });
  v.updatedAt = nowIso();
  writeJsonAtomic(path.join(dir, 'version.json'), v);
  return v;
}

function stampOf(id) {
  const m = /^BLD-(\d{8})-(\d{3})$/.exec(String(id || ''));
  return m ? `${m[1]}-${m[2]}` : '';
}

// 编号序列：扫描既有目录 BLD-YYYYMMDD-NNN，同日最大 NNN + 1。
function nextVersionId(dataDir) {
  const d = new Date();
  const today = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
  let max = 0;
  try {
    for (const name of fs.readdirSync(versionsRoot(dataDir))) {
      const m = /^BLD-(\d{8})-(\d{3})$/.exec(name);
      if (m && m[1] === today) max = Math.max(max, Number(m[2]));
    }
  } catch { /* 目录不存在 → 首个 */ }
  return `BLD-${today}-${pad(max + 1, 3)}`;
}

function defaultName() {
  const d = new Date();
  return `版本 ${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}-${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}`;
}

// 归一化 + 校验条目（itemId 格式 / commit 形态 / 去重）。title 可选（看板带入展示用）。
// BUG-20260921-015：一条目可关联多个提交——入参支持 commit（单提交，向后兼容）或
// commits（数组，允许为空）；落盘形态 commits 数组 + commit 别名（= 首个提交，旧读取方
// 向后兼容）。同一条目内提交按 hash 去重。
export function commitsOf(it) {
  const arr = Array.isArray(it?.commits) && it.commits.length
    ? it.commits
    : (it?.commit ? [it.commit] : []);
  return [...new Set(arr.map((h) => String(h || '').trim().toLowerCase()).filter(Boolean))];
}

function normalizeItems(items, existingIds = new Set()) {
  if (!Array.isArray(items) || !items.length) {
    throw new AtbError('版本至少关联一个条目（需求单 / Bug 单）');
  }
  const out = [];
  for (const raw of items) {
    const itemId = String(raw?.itemId || '').trim();
    if (!ITEM_ID_RE.test(itemId)) throw new AtbError(`条目编号不合法：${itemId || '（空）'}`);
    const commits = commitsOf(raw);
    const invalidShape = raw?.commits !== undefined && !Array.isArray(raw.commits);
    const supplied = Array.isArray(raw?.commits) ? raw.commits : (raw?.commit !== undefined ? [raw.commit] : []);
    if (invalidShape || supplied.some((c) => typeof c !== 'string' || !HASH_RE.test(c.trim().toLowerCase())) || commits.some((c) => !HASH_RE.test(c))) {
      throw new AtbError(`${itemId} 缺少有效的关联 commit（40 位提交号）`);
    }
    if (existingIds.has(itemId)) throw new AtbError(`${itemId} 已在本版本中，不可重复添加`);
    if (out.some((x) => x.itemId === itemId)) throw new AtbError(`${itemId} 重复提交`);
    out.push({
      itemId,
      commit: commits[0],
      commits,
      title: String(raw?.title || '').slice(0, 200),
      mergedAt: raw?.mergedAt ?? null,
      mergeError: raw?.mergeError ?? null,
    });
  }
  return out;
}

// BUG-20260921-015 读路径迁移：旧单提交数据（items[].commit，无 commits）读取时补全
// commits 数组（[commit]），不落盘、不抛错——旧版本数据零迁移即可在新模型下工作；任一
// 后续写操作（saveInfo / addItems / appendItemCommits …）都会以新形态整体写回。
function migrateItems(items) {
  if (!Array.isArray(items)) return items;
  return items.map((it) => (it && Array.isArray(it.commits) && it.commits.length ? it : { ...it, commits: commitsOf(it) }));
}

function validateInfo({ name, description }) {
  const n = String(name ?? '').trim();
  const d = String(description ?? '');
  if (n.length > NAME_MAX) throw new AtbError(`版本名称不超过 ${NAME_MAX} 字`);
  if (d.length > DESC_MAX) throw new AtbError(`版本描述不超过 ${DESC_MAX} 字`);
  return { name: n, description: d };
}

export function listVersions(dataDir) {
  const root = versionsRoot(dataDir);
  let names = [];
  try { names = fs.readdirSync(root); } catch { return []; }
  const list = [];
  for (const name of names) {
    if (!/^BLD-\d{8}-\d{3}$/.test(name)) continue;
    const v = readJsonSafe(path.join(root, name, 'version.json'));
    if (v) list.push(migrateVersion(v));
  }
  // 创建倒序（同日编号越大越新；跨日按日期戳倒序）
  return list.sort((a, b) => stampOf(b.id).localeCompare(stampOf(a.id)));
}

// BUG-20260921-015：读取归一（items 迁移出 commits 数组），写操作整体写回新形态。
function migrateVersion(v) {
  if (!v || !Array.isArray(v.items)) return v;
  return { ...v, items: migrateItems(v.items) };
}

export function readVersion(dataDir, id) {
  const v = readJsonSafe(path.join(versionsRoot(dataDir), String(id || ''), 'version.json'));
  if (!v) throw new AtbError(`找不到版本计划：${id}`);
  return migrateVersion(v);
}

// BUG-20260914-004：跨版本占用索引——itemId → 所在版本 id（任一状态：draft/merging/merged/failed
// 均视为占用）。excludeVersionId 用于「添加条目」路径排除目标版本自身（条目已在本版本中的
// 重复添加由 normalizeItems 既有口径报「已在本版本中」）。
export function occupiedItemMap(dataDir, { excludeVersionId = null } = {}) {
  const map = new Map();
  for (const v of listVersions(dataDir)) {
    if (excludeVersionId && v.id === excludeVersionId) continue;
    for (const it of v.items || []) {
      if (!map.has(it.itemId)) map.set(it.itemId, v.id);
    }
  }
  return map;
}

// 跨版本重复纳入兜底：任一条目已被其他版本占用 → AtbError（HTTP 400），报错含占用版本编号。
function assertNotOccupied(dataDir, itemIds, excludeVersionId = null) {
  const map = occupiedItemMap(dataDir, { excludeVersionId });
  for (const id of itemIds) {
    if (map.has(id)) throw new AtbError(`条目 ${id} 已纳入版本 ${map.get(id)}，不可重复纳入`);
  }
}

// targetBranch（REQ-20260916-005）：版本计划的合并目标主分支——服务端创建时按
// git-flow resolveMainBranch 解析结果传入（仅 master 历史仓库为 'master'）；缺省
// TARGET_BRANCH（'main'），数据层不读 git、不猜测（旧调用 / 既有口径兼容）。
// REQ-20260922-006 版本号：独立顶层 `version`（x.y.z 语义化格式），与计划编号（BLD-…，
// 仍用于目录与审计）解耦；显示与发布提示词以 version 为准，存量数据无该字段时由
// 展示层回退旧派生口径（YYYYMMDD-NNN），不迁移数据。
export const VERSION_NUMBER_RE = /^\d+\.\d+\.\d+$/;

const verParts = (s) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(s ?? ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

// 缺省自动分配：既有计划 version 的最大者 patch +1（major/minor/patch 数值比较）；无历史 0.1.0。
function nextVersionNumber(dataDir) {
  let best = null;
  for (const v of listVersions(dataDir)) {
    const cur = verParts(v.version);
    if (!cur) continue;
    if (!best
      || cur[0] > best[0]
      || (cur[0] === best[0] && (cur[1] > best[1] || (cur[1] === best[1] && cur[2] > best[2])))) best = cur;
  }
  return best ? `${best[0]}.${best[1]}.${best[2] + 1}` : '0.1.0';
}

// 版本号解析：空 / 缺省 → 自动分配；非法格式 / 与既有计划重复 → AtbError（唯一性按当前
// 存在的计划校验，删除后可复用，与计划编号口径一致）。
function resolveVersionNumber(dataDir, version) {
  const given = String(version ?? '').trim();
  if (!given) return nextVersionNumber(dataDir);
  if (!VERSION_NUMBER_RE.test(given)) {
    throw new AtbError(`版本号须为 x.y.z 语义化格式（如 0.1.0）：${given}`);
  }
  for (const v of listVersions(dataDir)) {
    if (v.version === given) throw new AtbError(`版本号 ${given} 已被版本计划 ${v.id} 使用，不可重复`);
  }
  return given;
}

export function createVersion(dataDir, { name, items, targetBranch = TARGET_BRANCH, version = null, by = 'board' } = {}) {
  const info = validateInfo({ name: name ?? '', description: '' });
  const normalized = normalizeItems(items);
  // BUG-20260914-004：先校验占用再分配编号，被拒绝的创建不占当日序列
  assertNotOccupied(dataDir, normalized.map((x) => x.itemId));
  const v = {
    schema: 1,
    id: nextVersionId(dataDir),
    version: resolveVersionNumber(dataDir, version),
    name: info.name || defaultName(),
    description: '',
    status: 'draft',
    targetBranch: String(targetBranch || TARGET_BRANCH),
    items: normalized,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    merge: { startedAt: null, finishedAt: null, error: null, baseBranch: null, mainSha: null },
    by,
  };
  return writeVersion(dataDir, v);
}

function assertEditableStatus(v, { allowMergingInfo = false } = {}) {
  if (v.status === 'merging' && !allowMergingInfo) {
    throw new BuildConflictError('版本合并中，暂不可修改');
  }
}

// BUG-20260928-005 正式发布判定换基准：以「发布按钮 + 二次确认」发起的一键发布链路
//（build-publish.start，release.confirmedAt 落账）为锁定时点；推送（release.pushedAt，
// 含动作一 push / 发布管线 sync-source 原子推送）只是推送事实，不构成正式发布、不锁定范围。
// BUG-20260928-015 读取侧兜底：确认对应的发布运行（confirmedRunId）以失败 / 取消终态结束
// 时（取消 ≠ 发布成功），该确认不再构成正式发布——存量「已确认但发布失败」计划据此恢复
// 可编辑，无需手工改 runtime 数据。终态读取同一账本 run.json（build-publish-store 事实源）：
// 账本缺失（被清理）时保守判已发布，避免误解锁真实发布过的版本。
export function isReleased(v, dataDir = null) {
  if (!(v && v.release && v.release.confirmedAt)) return false;
  if (!dataDir) return true; // 未提供数据目录（旧调用形态）：按 confirmedAt 现状判定
  const runId = v.release.confirmedRunId;
  if (!runId) return true; // 无运行编号可查：按确认事实判定
  return !publishRunFailedLike(dataDir, runId);
}

// 发布运行账本读取（只读；runId 形态校验防路径逃逸，非法 / 缺失返回 null）。
export function publishRunOf(dataDir, runId) {
  const id = String(runId || '');
  if (!/^BPUB-[A-Za-z0-9-]+$/.test(id)) return null;
  return readJsonSafe(path.join(dataDir, 'runtime', 'builds', 'publish-runs', id, 'run.json'));
}

// 失败口径（写侧回退与读取侧兜底共用的同一判定）：运行账本存在且终态为 failed / canceled。
function publishRunFailedLike(dataDir, runId) {
  const run = publishRunOf(dataDir, runId);
  return !!run && ['failed', 'canceled'].includes(run.status);
}

// REQ-20260929-002 已发布汇总迁入本层（原 build-publish-store.publishedByBld，落账口径由
// 「发布运行 succeeded 推导」换基准为「确认动作直接写版本计划发布态」），并集口径：
//   ① 版本计划确认态（isReleased——release.confirmedAt 且对应运行非失败 / 取消终态）；
//   ② 存量 succeeded 发布运行（BUG-20260928-005 之前经旧执行阶段发布的历史版本，不做迁移、
//     不回退标识、不解锁）。
// 运行账本只读同源路径（与 publishRunOf 一致），不引入对 build-publish-store 的反向依赖。
// 供构建模块列表接口随 versions 一次装配返回（Map<bldId,{published:true,version,runId}>）。
function listPublishRuns(dataDir) {
  const dir = path.join(dataDir, 'runtime', 'builds', 'publish-runs');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((id) => /^BPUB-[A-Za-z0-9-]+$/.test(id))
    .map((id) => readJsonSafe(path.join(dir, id, 'run.json')))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}
export function publishedByBld(dataDir) {
  const out = new Map();
  for (const r of listPublishRuns(dataDir)) {
    if (r.status !== 'succeeded' || !r.bldId || out.has(r.bldId)) continue;
    out.set(r.bldId, { published: true, version: r.version, runId: r.id });
  }
  for (const v of listVersions(dataDir)) {
    if (out.has(v.id) || !isReleased(v, dataDir)) continue;
    out.set(v.id, { published: true, version: v.version || null, runId: (v.release && v.release.confirmedRunId) || null });
  }
  return out;
}

// 发布成功为不可逆事实；后续失败或草稿不得重新开放版本写入。
// 口径与迁移前一致（仅按 succeeded 运行账本拦截，AtbError）：「确认账但无 succeeded 运行」
// 的锁定由既有 isReleased 链路承担（BuildConflictError → HTTP 409，文案「已正式发布」），
// 两道合计完备（确认账存在时 isReleased 保守判已发布）。迁自 build-publish-store（REQ-
// 20260929-002），保持异常类型与触发条件零变化。
export const PUBLISHED_READ_ONLY = '已发布，版本计划仅可查看；如需调整请新建版本';
export function assertUnpublished(dataDir, bldId) {
  if (bldId && listPublishRuns(dataDir).some((r) => r.status === 'succeeded' && r.bldId === bldId)) throw new AtbError(PUBLISHED_READ_ONLY);
}

// 条目增删锁：合并中禁用增删；发布确认（正式发布）才锁定——merged（含已推送未确认）
// 允许补关联条目 / 换 commit（随后重开合并只补未合并条目）。
function assertItemsEditable(dataDir, v) {
  assertUnpublished(dataDir, v.id);
  if (v.status === 'merging') throw new BuildConflictError('版本合并中，条目不可增删');
  if (isReleased(v, dataDir)) throw new BuildConflictError('版本已正式发布，条目已锁定（如需调整请新建版本）');
}

export function saveInfo(dataDir, id, { name, description, by = 'board' } = {}) {
  const v = readVersion(dataDir, id);
  assertUnpublished(dataDir, v.id);
  assertEditableStatus(v);
  const info = validateInfo({ name: name ?? v.name, description: description ?? v.description });
  if (!info.name) throw new AtbError('版本名称不能为空');
  v.name = info.name;
  v.description = info.description;
  v.by = by;
  return writeVersion(dataDir, v);
}

export function addItems(dataDir, id, items, { by = 'board' } = {}) {
  const v = readVersion(dataDir, id);
  assertItemsEditable(dataDir, v);
  const have = new Set(v.items.map((x) => x.itemId));
  const add = normalizeItems(items, have);
  // BUG-20260914-004：跨版本重复纳入兜底（排除本版本自身，本版本内重复由 normalizeItems 报既有口径）
  assertNotOccupied(dataDir, add.map((x) => x.itemId), id);
  v.items.push(...add);
  v.by = by;
  // REQ-20260920-003：新增条目 → 发布范围变化，旧文档提交标识失效（需重新核对）
  markDocsScopeStale(dataDir, v, `新增关联条目：${add.map((x) => x.itemId).join('、')}`);
  return v;
}

export function removeItems(dataDir, id, itemIds, { by = 'board' } = {}) {
  const v = readVersion(dataDir, id);
  assertItemsEditable(dataDir, v);
  const ids = (Array.isArray(itemIds) ? itemIds : []).map(String);
  if (!ids.length) throw new AtbError('未指定要移出的条目');
  const set = new Set(ids);
  const removed = v.items.filter((x) => set.has(x.itemId));
  if (!removed.length) throw new AtbError('所选条目均不在本版本中');
  // REQ-20260926-002 已合入事实不可静默抹除：提交已合并入 main 的条目不可移出——
  // main 上的重放提交不回滚，计划内合入记录（mergedAt / 重放证据）保持可追溯；显式报错非静默。
  const mergedHits = removed.filter((x) => x.mergedAt);
  if (mergedHits.length) {
    throw new BuildConflictError(`条目 ${mergedHits.map((x) => x.itemId).join('、')} 已合并入 main，不可移出（已合入事实保留在计划中；如需调整请新建版本）`);
  }
  const keep = v.items.filter((x) => !set.has(x.itemId));
  v.items = keep; // 允许清空（draft/failed 态）：移出后可重新添加，合并确认按当前清单生成
  v.by = by;
  // REQ-20260920-003：移出条目 → 发布范围变化，旧文档提交标识失效（需重新核对）
  markDocsScopeStale(dataDir, v, `移出关联条目：${removed.map((x) => x.itemId).join('、')}`);
  return v;
}

// 换选条目 commit（BUG-20260920-005：合并中与推送完成后锁定，merged 未推送仍可修正关联）。
// BUG-20260921-015：换选 = 整体替换该条目的提交集合（单提交语义，与旧口径一致）；补齐
// 多提交场景走 appendItemCommits（保留原有关联追加）。
export function setItemCommit(dataDir, id, itemId, commit, { by = 'board' } = {}) {
  const v = readVersion(dataDir, id);
  assertItemsEditable(dataDir, v);
  const it = v.items.find((x) => x.itemId === String(itemId || ''));
  if (!it) throw new AtbError(`${itemId} 不在本版本中`);
  // REQ-20260926-002 已合入事实不可静默抹除：已合并条目更换提交关联会把 mergedAt 一并复位，
  // 使「已合入 main」在计划内显示为未发生——改为显式拦截；追加新提交走 appendItemCommits。
  if (it.mergedAt) {
    throw new BuildConflictError(`条目 ${it.itemId} 已合并入 main，不可更换提交关联（追加新提交请用「补入提交」；如需调整请新建版本）`);
  }
  const h = String(commit || '').trim().toLowerCase();
  if (!HASH_RE.test(h)) throw new AtbError(`${itemId} 缺少有效的关联 commit（40 位提交号）`);
  const prev = it.commit;
  it.commit = h;
  it.commits = [h];
  it.mergedAt = null;
  it.mergeError = null;
  v.by = by;
  // REQ-20260920-003：更换 commit → 发布范围变化，旧文档提交标识失效（需重新核对）
  if (prev !== h) markDocsScopeStale(dataDir, v, `条目 ${it.itemId} 更换了关联提交`);
  return v;
}

// BUG-20260921-015 补入条目其余依赖提交：additions = [{ itemId, commits: [hash…] }]，仅适用
// 已在本版本的条目（新条目走 addItems）。保留条目原有关联与顺序，追加未持有的提交（按
// hash 去重，幂等）；实际补入时该条目需重新合并（mergedAt / mergeError 复位）；发布范围
// 变化联动 markDocsScopeStale（文档需重新核对 / 提交）。锁定口径与 addItems 一致。
export function appendItemCommits(dataDir, id, additions, { by = 'board' } = {}) {
  const v = readVersion(dataDir, id);
  assertItemsEditable(dataDir, v);
  const rows = Array.isArray(additions) ? additions : [];
  if (!rows.length) return v;
  const appended = [];
  for (const row of rows) {
    const it = v.items.find((x) => x.itemId === String(row?.itemId || ''));
    if (!it) throw new AtbError(`${row?.itemId || '（空）'} 不在本版本中`);
    const have = new Set(commitsOf(it));
    const add = commitsOf(row).filter((h) => {
      if (!HASH_RE.test(h)) throw new AtbError(`${it.itemId} 缺少有效的关联 commit（40 位提交号）`);
      return !have.has(h);
    });
    if (!add.length) continue;
    it.commits = [...have, ...add];
    it.mergedAt = null; // 条目提交集合变化 → 需重新合并（已并入提交幂等记成功）
    it.mergeError = null;
    appended.push({ itemId: it.itemId, commits: add });
  }
  if (!appended.length) return v;
  v.by = by;
  // REQ-20260920-003：补入提交 → 发布范围变化，旧文档提交标识失效（需重新核对）
  markDocsScopeStale(dataDir, v, `补入依赖提交：${appended.map((x) => `${x.itemId}（+${x.commits.length}）`).join('、')}`);
  return v;
}

export function beginMerge(dataDir, id, { baseBranch = null, by = 'board' } = {}) {
  const v = readVersion(dataDir, id);
  // merged（含已推送未确认）允许为补入条目重开合并（增量：只补未合并条目，已并入提交
  // 幂等记成功）；merging 维持锁定；发布确认（正式发布）后锁定。
  if (v.status === 'merging') {
    throw new BuildConflictError(`当前状态（${VERSION_STATUS_LABEL[v.status] || v.status}）不可合并（合并进行中）`);
  }
  if (isReleased(v, dataDir)) {
    throw new BuildConflictError('版本已正式发布，不可再合并（如需调整请新建版本）');
  }
  if (!['draft', 'failed', 'merged'].includes(v.status)) {
    throw new BuildConflictError(`当前状态（${VERSION_STATUS_LABEL[v.status] || v.status}）不可合并`);
  }
  v.status = 'merging';
  v.merge.startedAt = nowIso();
  v.merge.error = null;
  v.merge.baseBranch = baseBranch;
  v.by = by;
  return writeVersion(dataDir, v);
}

// 逐条目结果落盘：全成功 → merged；任一失败 → failed（成功条目保持已合并，重试只补未合并）。
// BUG-20260921-015：results 按（itemId, commit）逐提交一行——同一条目多行结果聚合判定：
// 任一行失败即条目失败（保留首个失败原因），全部成功才记条目已合并；无结果的条目保持
// 原状（重试新增 / 中止未覆盖）。
// REQ-20260915-002：可选 mainSha 记录合并完成后的 main 分支头（新计划作为冻结证据；
// 旧计划无此字段时按「候选 + 额外提交」口径展示，不用时间戳或登记时 tip 代替冻结证据）。
export function finishMerge(dataDir, id, { results = [], mainSha = null, by = 'board' } = {}) {
  const v = readVersion(dataDir, id);
  if (v.status !== 'merging') throw new BuildConflictError('版本不在合并中，无法写入合并结果');
  const byItem = new Map();
  for (const r of Array.isArray(results) ? results : []) {
    const key = String(r.itemId);
    const prev = byItem.get(key);
    byItem.set(key, { ok: (prev ? prev.ok : true) && r.ok === true, error: (prev && prev.error) || (r.ok === true ? null : String(r.error || '合并失败')) });
  }
  for (const it of v.items) {
    // 空提交条目无重放动作，合并步骤直接完成。
    const r = byItem.get(it.itemId) || (!commitsOf(it).length ? { ok: true } : null);
    if (!r) continue; // 未覆盖到的条目（如重试新增）保持原状
    if (r.ok) {
      it.mergedAt = it.mergedAt || nowIso();
      it.mergeError = null;
    } else {
      it.mergedAt = null;
      it.mergeError = r.error;
    }
  }
  const allOk = v.items.every((x) => x.mergedAt);
  v.status = allOk ? 'merged' : 'failed';
  v.merge.finishedAt = nowIso();
  if (allOk && mainSha && /^[0-9a-f]{40}$/i.test(String(mainSha))) v.merge.mainSha = String(mainSha).toLowerCase();
  const failedItems = v.items.filter((x) => x.mergeError);
  v.merge.error = allOk ? null : failedItems.map((x) => `${x.itemId}：${x.mergeError}`).join('；').slice(0, 400);
  v.by = by;
  return writeVersion(dataDir, v);
}

// 服务重启恢复：merging → failed（不自动重跑；对齐 release recoverInterrupted 口径）。返回处理数。
export function recoverMerging(dataDir) {
  let n = 0;
  for (const v of listVersions(dataDir)) {
    if (v.status !== 'merging') continue;
    v.status = 'failed';
    v.merge.error = v.merge.error || '服务重启中断合并，可重试';
    v.merge.finishedAt = v.merge.finishedAt || nowIso();
    writeVersion(dataDir, v);
    n++;
  }
  return n;
}

// REQ-20260913-004 删除版本：按编号读取后整目录移除 builds/versions/<id>/（看板数据层面清理，
// 不可恢复）。语义按状态区分：draft/failed = 放弃该版本计划（关联条目与 commit 关联一并移除，
// 条目本身与提交不受影响，可重新纳入其他版本）；merged = 仅移除看板版本记录（提交已实际合并入
// main，代码与 git 历史不动）；merging 禁删（合并执行中删除会破坏状态机，等合并结束再删）。
// 对齐批次删除（deleteBatch）的整目录 fs.rmSync 口径。
export function deleteVersion(dataDir, id) {
  assertUnpublished(dataDir, id);
  const v = readVersion(dataDir, id); // 不存在 → AtbError「找不到版本计划：<id>」
  if (v.status === 'merging') {
    throw new BuildConflictError('版本合并中，不可删除，请等合并结束后再删');
  }
  fs.rmSync(path.join(versionsRoot(dataDir), v.id), { recursive: true, force: true });
  return { ok: true, id: v.id };
}

/* ---------- REQ-20260920-003 发布流程：文档 / 推送 / 官网检测状态 ---------- */

// 范围指纹：条目 + 每条全部提交 hash（BUG-20260921-015：一条目多提交全量参与，补入提交
// 即范围变化）。文档基准由 recordDocsCommit 时的 publishScopeFingerprint（含八文件内容
// hash）另行固化，两者共同构成「旧快照不放行」依据。
export function scopeFingerprintOf(v) {
  const part = (v?.items || []).map((it) => `${it.itemId}:${commitsOf(it).join(',')}`).sort();
  return crypto.createHash('sha256').update(JSON.stringify(part)).digest('hex');
}

// 记录文档提交：files = { '<文件名>': '<内容 sha256>' }（提交时点磁盘内容），scopeFp 为
// publish-flow.publishScopeFingerprint（条目 + 文档基准）计算值；清除范围过期标记。
// REQ-20260921-010：白名单按版本语言集判定（docLangsOf）。
export function recordDocsCommit(dataDir, id, { commitHash, files, scopeFp } = {}) {
  const v = readVersion(dataDir, id);
  if (!/^[0-9a-f]{40}$/i.test(String(commitHash || ''))) throw new AtbError('文档提交记录缺少有效 commit hash');
  if (!files || typeof files !== 'object') throw new AtbError('文档提交记录缺少文件清单');
  for (const name of Object.keys(files)) {
    if (!flow.isPublishDocFile(name, flow.docLangsOf(v), flow.customDocsOf(v))) throw new AtbError(`非发布文档文件：${name}`);
  }
  v.docs = {
    commitHash: String(commitHash).toLowerCase(),
    files,
    scopeFp: String(scopeFp || ''),
    scopeStale: false,
    staleReason: null,
    // BUG-20260926-004：重新提交（含 noop 重确认路径）即基于当前范围重新入账，重置
    // 范围变化时点（求值侧新鲜度基准随之清零——scopeStale / staleReason 一并清除）
    scopeChangedAt: null,
    committedAt: nowIso(),
  };
  v.by = 'board';
  return writeVersion(dataDir, v);
}

// 范围变化（增删条目 / 换 commit）后失效旧提交标识：标记 scopeStale 并说明来源；保留已写
// 内容与提交记录（不得拿旧已提交标识为新范围放行合并）。始终落盘（调用方返回 v）。
// BUG-20260926-004：落盘本次范围变化时点 scopeChangedAt（重复触发刷新为最近一次，以落盘
// 时点为准）——求值侧据此判定审核记录是否基于当前范围（审核时点晚于该时点即视为重新核对
// 生效），把「范围变化后需重新核对」从「重新核对动作无效」的死锁（本单缺陷）收敛为可恢复
// 的过程性校验；scopeStale 标记与 staleReason 溯源语义不变。
function markDocsScopeStale(dataDir, v, reason) {
  if (v.docs?.commitHash) {
    v.docs.scopeStale = true;
    v.docs.staleReason = String(reason || '发布范围已变化').slice(0, 200);
    v.docs.scopeChangedAt = nowIso();
  }
  return writeVersion(dataDir, v);
}

// REQ-20260921-008 人工通过审核（审查对话框「通过审核」）：在版本记录顶层 v.review 固化
// 审核时点磁盘内容 sha256——与 v.docs（提交记录语义）隔离，避免未提交版本被误判 uncommitted。
// 求值侧（publish-flow.evaluateDocsFlow）：内容再变（内部编辑 / 外部 IDE 修改）hash 不一致即
// 自动回退「已总结待审核」；发布范围变化（scopeStale）后既有审核按 scopeChangedAt 时点失效，
// BUG-20260926-004 起重新「通过审核」（本函数写入的时点晚于范围变化时点）即恢复——不再死锁。
// hash 缺省按 readFile（缺省读项目根磁盘）现算当前内容。
export function recordDocsReview(dataDir, id, { file, hash, readFile } = {}) {
  const v = readVersion(dataDir, id);
  if (!flow.isPublishDocFile(file, flow.docLangsOf(v), flow.customDocsOf(v))) throw new AtbError(`非发布文档文件：${file || '（空）'}（仅语言集内文档可审核）`);
  let h = String(hash || '');
  if (!h) {
    const read = typeof readFile === 'function'
      ? readFile
      : (f) => { try { return fs.readFileSync(path.join(projectRootGuess(dataDir), f), 'utf8'); } catch { return null; } };
    const text = read(file);
    if (text == null) throw new AtbError(`${file} 不存在或不可读：先编写并保存再通过审核`);
    h = crypto.createHash('sha256').update(text).digest('hex');
  }
  if (!/^[0-9a-f]{64}$/.test(h)) throw new AtbError('审核记录缺少有效内容 hash（sha256）');
  v.review = { files: { ...((v.review && v.review.files) || {}), [file]: { hash: h.toLowerCase(), at: nowIso() } } };
  v.by = 'board';
  return writeVersion(dataDir, v);
}

// REQ-20260921-010 文档语言集：保存到版本记录顶层 v.langs（发布计划级持久化，重新进入
// 文档编写步回显）；merging / 发布确认（正式发布）锁定不可改（与五步门禁 docs 步锁定口径
// 一致，BUG-20260928-005 起推送不再锁定）；非法语言集报错不改盘。语言集是文档清单的唯一
// 事实源（求值 / 审核白名单 / 提交 pathspec / AI 总结提示词均按其展开）。
// BUG-20260922-002：语言集变化会改变自定义文档的展开形态（MIGRATION → MIGRATION.md +
// MIGRATION_<lang>.md），扩展语言集导致既有自定义 KEY 展开撞名时拒绝保存（如单语言集下
// MIGRATION 与 MIGRATION_FR 合法共存，加入 fr 后 MIGRATION 的 MIGRATION_fr.md 与
// MIGRATION_FR.md 重名）。
export function saveDocLangs(dataDir, id, { langs, by = 'board' } = {}) {
  const v = readVersion(dataDir, id);
  if (v.status === 'merging') throw new BuildConflictError('版本合并中，暂不可修改文档语言集');
  if (isReleased(v, dataDir)) throw new BuildConflictError('已正式发布，范围锁定（如需调整请新建版本）');
  const r = Array.isArray(langs) ? flow.normalizeLangsList(langs) : flow.normalizeDocLangs(langs);
  if (r.error) throw new AtbError(r.error);
  const conflict = flow.customDocsExpandConflict(flow.customDocsOf(v), r.langs);
  if (conflict) {
    throw new AtbError(`语言集展开后自定义文档重名：${conflict.a} 与 ${conflict.b} 均展开出 ${conflict.file}；请先移除或改名其中一个自定义文档再改语言集`);
  }
  v.langs = r.langs;
  v.by = by;
  return writeVersion(dataDir, v);
}

// REQ-20260922-003 自定义发布文档清单：发布计划级持久化（版本记录顶层 v.customDocs，
// 大写 KEY 数组、顺序保留，类比 v.langs / saveDocLangs 先例）；merging / 已正式发布（pushed）
// 锁定增删；命名 / 去重 / 上限 / 展开重名校验经 publish-flow.normalizeCustomDocName（权威
// 口径，前端 validateCustomDocName 镜像）。清单是文件清单唯一事实源的一部分：求值 / 审核白名单 /
// AI 总结账本与提示词 / 完结快照 / 提交 pathspec 均随其展开。
export function addCustomDoc(dataDir, id, { name, by = 'board' } = {}) {
  const v = readVersion(dataDir, id);
  if (v.status === 'merging') throw new BuildConflictError('版本合并中，暂不可修改自定义文档清单');
  if (isReleased(v, dataDir)) throw new BuildConflictError('已正式发布，范围锁定，如需调整请新建版本');
  const existing = flow.customDocsOf(v);
  const r = flow.normalizeCustomDocName(name, { existing, langs: flow.docLangsOf(v) });
  if (r.error) throw new AtbError(r.error);
  v.customDocs = [...existing, r.key];
  v.by = by;
  return writeVersion(dataDir, v);
}

// 移除自定义文档（BUG-20260922-002 起整份移除全部语种）：允许移除已总结 / 已审核条目；
// AI 总结运行中的拦截由服务端按 summary 账本校验（本层不依赖 summary store）。随清单移出：
//   ① 审核留痕 v.review.files 中该 KEY 全部语言文件记录一并清理（防同 KEY 再添加时旧 hash
//      复活「已审核」）；
//   ② 删除项目根磁盘上该 KEY 按当前语言集展开的全部文件（不残留退出 pathspec 的孤儿未跟踪
//      文件；projectRoot 缺省按 dataDir 推断，删除失败不阻塞清单移除）。
// 整体完结记录（v.review.finalized）随完结阶段去除（BUG-20260926-002）不再产生：历史版本
// 记录中残留的旧快照不被读取（求值侧忽略口径），后续人工审核重写 v.review 时自然收敛。
export function removeCustomDoc(dataDir, id, { key, by = 'board', projectRoot = null } = {}) {
  const v = readVersion(dataDir, id);
  if (v.status === 'merging') throw new BuildConflictError('版本合并中，暂不可修改自定义文档清单');
  if (isReleased(v, dataDir)) throw new BuildConflictError('已正式发布，范围锁定，如需调整请新建版本');
  const k = String(key || '').trim().toUpperCase();
  const existing = flow.customDocsOf(v);
  if (!existing.includes(k)) throw new AtbError(`自定义文档不在清单中：${k || '（空）'}`);
  const removedFiles = flow.customDocFilesOf(k, flow.docLangsOf(v)).map((f) => f.file);
  if (v.review?.files && Object.keys(v.review.files).length) {
    const files = { ...v.review.files };
    for (const f of removedFiles) delete files[f];
    v.review = { ...v.review, files };
  }
  const root = projectRoot ? path.resolve(String(projectRoot)) : projectRootGuess(dataDir);
  for (const f of removedFiles) {
    try { fs.rmSync(path.join(root, f), { force: true }); } catch { /* 磁盘清理失败不阻塞清单移除 */ }
  }
  v.customDocs = existing.filter((x) => x !== k);
  v.by = by;
  return writeVersion(dataDir, v);
}

// REQ-20260926-002 文档合并落账：审核通过的发布文档单独提交后经 docs/merge 端点 cherry-pick
// 合入 main，把「文档提交 → main 上的重放提交 → main 头」证据固化到 v.docsMerge（直接关联
// BLD 计划号，不要求额外 REQ / BUG，也不通过功能条目的 done 门禁）。
//   - commitHash = dev 上的文档提交（v.docs.commitHash 同源）；replayedHash = main 上的重放
//     提交；mainSha = 合并后 main 头；replays = [{ itemId, original, replayed }] 重放证据；
//   - 重试 / 范围变化后再次合并：history 逐次累积（已合入事实不抹除、可追溯），replays 按
//     original 去重合并（同一原始提交不重复累积证据，重复合并幂等不丢既有记录）。
export function recordDocsMerge(dataDir, id, { commitHash, replayedHash = null, mainSha = null, replays = [] } = {}) {
  const v = readVersion(dataDir, id);
  if (!/^[0-9a-f]{40}$/i.test(String(commitHash || ''))) throw new AtbError('文档合并记录缺少有效 commit hash');
  const rows = (Array.isArray(replays) ? replays : [])
    .filter((r) => r && r.original && r.replayed)
    .map((r) => ({
      itemId: String(r.itemId || 'docs'),
      original: String(r.original).toLowerCase(),
      replayed: String(r.replayed).toLowerCase(),
    }));
  const entry = {
    commitHash: String(commitHash).toLowerCase(),
    replayedHash: replayedHash ? String(replayedHash).toLowerCase() : null,
    mainSha: mainSha && /^[0-9a-f]{40}$/i.test(String(mainSha)) ? String(mainSha).toLowerCase() : null,
    replays: rows,
    mergedAt: nowIso(),
  };
  const prev = v.docsMerge || {};
  const prevReplays = new Map((Array.isArray(prev.replays) ? prev.replays : [])
    .filter((r) => r && r.original)
    .map((r) => [String(r.original).toLowerCase(), r]));
  for (const r of rows) prevReplays.set(r.original, r);
  v.docsMerge = {
    commitHash: entry.commitHash,
    replayedHash: entry.replayedHash,
    mainSha: entry.mainSha,
    replays: [...prevReplays.values()],
    mergedAt: entry.mergedAt,
    history: [...(Array.isArray(prev.history) ? prev.history : []), entry],
  };
  v.by = 'board';
  return writeVersion(dataDir, v);
}

// 推送成功记录：同基准（同 sha）重试 / 页面重载不重置起点；基准变化（main 前进后重新推送
// 成功）更新起点并作废旧官网命中证据（需重新核对目标范围）。
export function recordPushSuccess(dataDir, id, { remote, sha } = {}) {
  const v = readVersion(dataDir, id);
  if (!/^[0-9a-f]{40}$/i.test(String(sha || ''))) throw new AtbError('推送成功记录缺少有效 sha');
  const prev = v.release || {};
  const sameBaseline = prev.pushedSha && prev.pushedSha === String(sha).toLowerCase();
  v.release = {
    ...prev,
    pushRemote: String(remote || prev.pushRemote || 'origin'),
    pushedSha: String(sha).toLowerCase(),
    pushedAt: sameBaseline ? prev.pushedAt : nowIso(),
    site: sameBaseline ? (prev.site || { status: 'waiting' }) : { status: 'waiting', evidence: null, checkedHead: null, lastScanAt: null, nextScanAt: null, note: '推送基准已变化，重新检测' },
  };
  // REQ-20260922-006 发布时间：作为版本计划一等属性随推送成功同步（与 release.pushedAt
  // 同刻同语义——同基准不重置、基准变化更新）；存量已推送计划无该字段，由读取侧回退。
  v.releasedAt = v.release.pushedAt;
  v.by = 'board';
  return writeVersion(dataDir, v);
}

// BUG-20260928-005 正式发布确认落账：用户点击「发布」并通过二次确认后，一键发布链路
//（build-publish.start，BUG-20260928-002）在运行启动时调用——正式发布锁定以该时点为准
//（isReleased），推送动作本身不锁定。REQ-20260929-002 起发布收敛为状态更新（无执行阶段），
// 本落账即发布动作本体（确认 → 版本计划置「已发布」）。幂等：有效确认存在期间不重置（发布
// 重试不换时点）；BUG-20260928-015 起「首次固化」修正为「最近一次有效确认」——确认对应的
// 发布运行以失败 / 取消终态结束时确认锁被 rollbackReleaseConfirm 回退，再发布时在此重新固化
// 新的确认时点与运行编号（历史确认留痕在 publish-runs 与 run 账本中可追溯）；确认前已有的
// 推送事实（pushedAt / site）原样保留。
export function recordReleaseConfirm(dataDir, id, { runId = null } = {}) {
  const v = readVersion(dataDir, id);
  const prev = v.release || {};
  if (prev.confirmedAt) return v;
  const now = nowIso();
  v.release = {
    ...prev,
    confirmedAt: now,
    confirmedRunId: runId,
  };
  // REQ-20260929-002 发布时间取确认时点：发布不再推送远端（REQ-20260922-006 随推送同步
  // releasedAt 的口径退役），releasedAt 与 confirmedAt 同刻固化；存量已推送计划的
  // release.pushedAt（推送事实）原样保留。
  v.releasedAt = now;
  v.by = 'board';
  return writeVersion(dataDir, v);
}

// BUG-20260928-015 确认锁回退（写侧主路径）：发布运行进入失败 / 取消终态的收尾处调用——
// 当 release.confirmedRunId === runId 且该运行按失败口径判定（账本存在且终态 failed /
// canceled，与 isReleased 兜底同一判定函数，读写两侧结论一致）时，清除 confirmedAt /
// confirmedRunId，其余 release 字段（确认前的推送事实 pushedAt / pushedSha / site）原样
// 保留；succeeded 运行不可逆（任何路径都不清除确认锁），运行不匹配 / 账本缺失为无操作。
export function rollbackReleaseConfirm(dataDir, id, { runId = null } = {}) {
  const v = readVersion(dataDir, id);
  const prev = v.release || {};
  if (!prev.confirmedAt || !runId || prev.confirmedRunId !== runId) return v;
  if (!publishRunFailedLike(dataDir, runId)) return v;
  const { confirmedAt: _dropAt, confirmedRunId: _dropRun, ...rest } = prev;
  v.release = rest;
  v.by = 'board';
  return writeVersion(dataDir, v);
}

// 官网扫描结果落盘（幂等覆写 site 子状态；保留 pushedAt / pushedSha 推送事实）。
export function recordSiteScan(dataDir, id, scan) {
  const v = readVersion(dataDir, id);
  const prev = v.release || {};
  const s = scan || {};
  v.release = {
    ...prev,
    site: {
      status: String(s.status || 'waiting'),
      reason: s.reason || null,
      scanned: Number.isInteger(s.scanned) ? s.scanned : null,
      windowCount: Number.isInteger(s.windowCount) ? s.windowCount : null,
      checkedHead: s.checkedHead || null,
      lastScanAt: s.lastScanAt || nowIso(),
      nextScanAt: s.nextScanAt || null,
      since: s.since || prev.pushedAt || null,
      evidence: s.evidence || null,
      branch: s.branch || null,
      note: s.note || null,
    },
  };
  v.by = 'board';
  return writeVersion(dataDir, v);
}

// 重放证据落账：merge.replays = [{ itemId, original, replayed }]（隔离合并以 cherry-pick
// 重放提交进 main，原始 commit 不再是 main 祖先；发布包含性检验据此认可重放提交）。
// 重试分批执行时按 original 去重合并累积（不覆盖丢失此前批次的证据）。
export function saveMergeReplays(dataDir, id, replays = []) {
  const v = readVersion(dataDir, id);
  const prev = new Map((v.merge?.replays || []).map((r) => [r.original, r]));
  for (const r of Array.isArray(replays) ? replays : []) {
    if (!r.itemId || !r.original || !r.replayed) continue;
    prev.set(String(r.original).toLowerCase(), {
      itemId: String(r.itemId),
      original: String(r.original).toLowerCase(),
      replayed: String(r.replayed).toLowerCase(),
    });
  }
  v.merge = { ...(v.merge || {}), replays: [...prev.values()] };
  v.by = 'board';
  return writeVersion(dataDir, v);
}

// 项目根推断（readFile 缺省口径的兜底）：dataDir 形如 <root>/agent-team-board，取上一级。
function projectRootGuess(dataDir) {
  try {
    const p = path.resolve(String(dataDir), '..');
    return p;
  } catch {
    return '.';
  }
}
