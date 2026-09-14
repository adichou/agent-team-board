// REQ-20260908-020 单级完善三态索引（未完善 / 完善中 / 已完善）。
// 存储：<dataDir>/refine/states.json → { version, items: { [itemId]: { state, updatedAt, runId } } }
// 约束：只落执行账本（refine/），不写条目 status.json（状态机铁律，state-guard 保护）；
// 本模块被 core.mjs 引用（accepted 进入钩子），故不得反向 import core（避免循环依赖），
// 原子写在此自持一份最小实现。

import fs from 'node:fs';
import path from 'node:path';

export const REFINE_ITEM_STATES = ['unrefined', 'refining', 'refined'];
export const REFINE_STATE_LABEL = { unrefined: '未完善', refining: '完善中', refined: '已完善' };

function statesPath(dataDir) {
  return path.join(dataDir, 'refine', 'states.json');
}

function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function readRefineStates(dataDir) {
  try {
    const j = JSON.parse(fs.readFileSync(statesPath(dataDir), 'utf8'));
    if (j && typeof j.items === 'object' && j.items) return j.items;
  } catch { /* 缺失/损坏：视为无记录 */ }
  return {};
}

// 置位：state ∈ REFINE_ITEM_STATES；extra 可带 runId / reaccepted。
// reaccepted（BUG-20260908-010）：由 core.mjs 进入 accepted 钩子在「再接受」（此前已有索引记录）时
// 置位——终态回执后条目被人工驳回再接受/移出计划回已接受的确定性事件标记（时间戳同毫秒不可靠）；
// 后续领取（refining）/回执置位会整体替换记录，标记随之清除。
// 条目目录缺失（如已删除）不阻断调用方——索引按 id 记录，删除的单不再展示徽标。
export function setRefineItemState(dataDir, itemId, state, extra = {}) {
  if (!REFINE_ITEM_STATES.includes(state)) {
    throw new Error(`非法完善状态：${state}（合法值：${REFINE_ITEM_STATES.join(' | ')}）`);
  }
  const file = statesPath(dataDir);
  let j = null;
  try {
    j = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* 首次写入 */ }
  if (!j || typeof j !== 'object') j = { version: 1, items: {} };
  if (!j.items || typeof j.items !== 'object') j.items = {};
  j.items[itemId] = {
    state,
    updatedAt: new Date().toISOString(),
    ...(extra.runId ? { runId: extra.runId } : {}),
    ...(extra.reaccepted ? { reaccepted: true } : {}),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, j);
  return j.items[itemId];
}

// 读取单个条目完善状态；无记录返回 null（已接受单展示口径按「未完善」处理）
export function refineStateOf(dataDir, itemId) {
  const rec = readRefineStates(dataDir)[itemId];
  return rec && REFINE_ITEM_STATES.includes(rec.state) ? rec.state : null;
}
