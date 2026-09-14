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
import { AtbError, writeJsonAtomic } from './core.mjs';

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

const versionsRoot = (dataDir) => path.join(dataDir, 'builds', 'versions');

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
function normalizeItems(items, existingIds = new Set()) {
  if (!Array.isArray(items) || !items.length) {
    throw new AtbError('版本至少关联一个条目（需求单 / Bug 单）');
  }
  const out = [];
  for (const raw of items) {
    const itemId = String(raw?.itemId || '').trim();
    const commit = String(raw?.commit || '').trim().toLowerCase();
    if (!ITEM_ID_RE.test(itemId)) throw new AtbError(`条目编号不合法：${itemId || '（空）'}`);
    if (!HASH_RE.test(commit)) throw new AtbError(`${itemId} 缺少有效的关联 commit（40 位提交号）`);
    if (existingIds.has(itemId)) throw new AtbError(`${itemId} 已在本版本中，不可重复添加`);
    if (out.some((x) => x.itemId === itemId)) throw new AtbError(`${itemId} 重复提交`);
    out.push({
      itemId,
      commit,
      title: String(raw?.title || '').slice(0, 200),
      mergedAt: raw?.mergedAt ?? null,
      mergeError: raw?.mergeError ?? null,
    });
  }
  return out;
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
    if (v) list.push(v);
  }
  // 创建倒序（同日编号越大越新；跨日按日期戳倒序）
  return list.sort((a, b) => stampOf(b.id).localeCompare(stampOf(a.id)));
}

export function readVersion(dataDir, id) {
  const v = readJsonSafe(path.join(versionsRoot(dataDir), String(id || ''), 'version.json'));
  if (!v) throw new AtbError(`找不到版本计划：${id}`);
  return v;
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

export function createVersion(dataDir, { name, items, by = 'board' } = {}) {
  const info = validateInfo({ name: name ?? '', description: '' });
  const normalized = normalizeItems(items);
  // BUG-20260914-004：先校验占用再分配编号，被拒绝的创建不占当日序列
  assertNotOccupied(dataDir, normalized.map((x) => x.itemId));
  const v = {
    schema: 1,
    id: nextVersionId(dataDir),
    name: info.name || defaultName(),
    description: '',
    status: 'draft',
    targetBranch: TARGET_BRANCH,
    items: normalized,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    merge: { startedAt: null, finishedAt: null, error: null, baseBranch: null },
    by,
  };
  return writeVersion(dataDir, v);
}

function assertEditableStatus(v, { allowMergingInfo = false } = {}) {
  if (v.status === 'merging' && !allowMergingInfo) {
    throw new BuildConflictError('版本合并中，暂不可修改');
  }
}

// 条目增删锁（design.md 口径）：合并中禁用增删，已合并锁定增删
function assertItemsEditable(v) {
  if (v.status === 'merging') throw new BuildConflictError('版本合并中，条目不可增删');
  if (v.status === 'merged') throw new BuildConflictError('版本已合并，条目已锁定（如需调整请新建版本）');
}

export function saveInfo(dataDir, id, { name, description, by = 'board' } = {}) {
  const v = readVersion(dataDir, id);
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
  assertItemsEditable(v);
  const have = new Set(v.items.map((x) => x.itemId));
  const add = normalizeItems(items, have);
  // BUG-20260914-004：跨版本重复纳入兜底（排除本版本自身，本版本内重复由 normalizeItems 报既有口径）
  assertNotOccupied(dataDir, add.map((x) => x.itemId), id);
  v.items.push(...add);
  v.by = by;
  return writeVersion(dataDir, v);
}

export function removeItems(dataDir, id, itemIds, { by = 'board' } = {}) {
  const v = readVersion(dataDir, id);
  assertItemsEditable(v);
  const ids = (Array.isArray(itemIds) ? itemIds : []).map(String);
  if (!ids.length) throw new AtbError('未指定要移出的条目');
  const set = new Set(ids);
  const keep = v.items.filter((x) => !set.has(x.itemId));
  if (keep.length === v.items.length) throw new AtbError('所选条目均不在本版本中');
  v.items = keep; // 允许清空（draft/failed 态）：移出后可重新添加，合并确认按当前清单生成
  v.by = by;
  return writeVersion(dataDir, v);
}

// 换选条目 commit（合并前可修正关联；合并后锁定）
export function setItemCommit(dataDir, id, itemId, commit, { by = 'board' } = {}) {
  const v = readVersion(dataDir, id);
  assertItemsEditable(v);
  const it = v.items.find((x) => x.itemId === String(itemId || ''));
  if (!it) throw new AtbError(`${itemId} 不在本版本中`);
  const h = String(commit || '').trim().toLowerCase();
  if (!HASH_RE.test(h)) throw new AtbError(`${itemId} 缺少有效的关联 commit（40 位提交号）`);
  it.commit = h;
  it.mergedAt = null;
  it.mergeError = null;
  v.by = by;
  return writeVersion(dataDir, v);
}

export function beginMerge(dataDir, id, { baseBranch = null, by = 'board' } = {}) {
  const v = readVersion(dataDir, id);
  if (!['draft', 'failed'].includes(v.status)) {
    throw new BuildConflictError(`当前状态（${VERSION_STATUS_LABEL[v.status] || v.status}）不可合并${v.status === 'merging' ? '（合并进行中）' : '（已合并）'}`);
  }
  v.status = 'merging';
  v.merge.startedAt = nowIso();
  v.merge.error = null;
  v.merge.baseBranch = baseBranch;
  v.by = by;
  return writeVersion(dataDir, v);
}

// 逐条目结果落盘：全成功 → merged；任一失败 → failed（成功条目保持已合并，重试只补未合并）。
export function finishMerge(dataDir, id, { results = [], by = 'board' } = {}) {
  const v = readVersion(dataDir, id);
  if (v.status !== 'merging') throw new BuildConflictError('版本不在合并中，无法写入合并结果');
  const byItem = new Map(results.map((r) => [String(r.itemId), r]));
  for (const it of v.items) {
    const r = byItem.get(it.itemId);
    if (!r) continue; // 未覆盖到的条目（如重试新增）保持原状
    if (r.ok) {
      it.mergedAt = it.mergedAt || nowIso();
      it.mergeError = null;
    } else {
      it.mergedAt = null;
      it.mergeError = String(r.error || '合并失败');
    }
  }
  const allOk = v.items.every((x) => x.mergedAt);
  v.status = allOk ? 'merged' : 'failed';
  v.merge.finishedAt = nowIso();
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
  const v = readVersion(dataDir, id); // 不存在 → AtbError「找不到版本计划：<id>」
  if (v.status === 'merging') {
    throw new BuildConflictError('版本合并中，不可删除，请等合并结束后再删');
  }
  fs.rmSync(path.join(versionsRoot(dataDir), v.id), { recursive: true, force: true });
  return { ok: true, id: v.id };
}
