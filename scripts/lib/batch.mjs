// REQ-20260906-002 Zcode 批量开发 —— 共用批次/执行账本核心层。
// 与 REQ-20260906-003（Codex 自动派发）共用：存储规范、项目实施互斥、依赖策略与回执协议。
// REQ-20260908-010：选单口径从 accepted 切换为 planned（已计划），领取时实时吸收新置计划条目。
// 事实源：<dataDir>/dispatch/{settings.json, policies.json, worker-spec.md, batches/<batchId>/batch.json, runs/<runId>/run.json}
// 全部 JSON 经本模块原子写入；Agent 不手写。条目业务状态仍走 core.claim/report 状态机。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AtbError,
  acquireLock,
  releaseLock,
  resolveItemDir,
  readStatus,
  writeJsonAtomic,
  listItems,
  orderedDocs,
  actor,
  localDateStamp,
  readImplLockIfExists,
  assertNoImplAttention,
} from './core.mjs';
import { FOLLOW_SESSION_PROMPT_LINE } from './task-settings.mjs';
import * as gitFlow from './git-flow.mjs';
import * as confirmStore from './confirm-store.mjs';
import { waitingDevelopConfirm, clipReasonKeepEnds } from './confirm-states.mjs';

// REQ-20260908-019：批次上限设置已移除（BATCH_LIMIT_* 常量随之删除）——
// 上限原本只截断创建时点的初始快照，REQ-20260908-010 实时队列后已无实际约束意义。
// REQ-20260906-023：批次账本保留上限——batches/ 最多保留 100 个批次目录，超出删除最旧的
export const BATCH_RETENTION_MAX = 100;
// 协议载荷上限（REQ-20260906-002 §4）：回执与核对响应分别不超过 2 KiB UTF-8
export const RECEIPT_MAX_BYTES = 2048;
export const CHECK_MAX_BYTES = 2048;
export const REASON_MAX_CHARS = 200;
// REQ-20260910-027：批次开发人员设置（REQ-20260907-002）已整体移除——
// 名称规范化校验与长度上限常量删除；createBatch 的同名入参保留但忽略（兼容旧调用）。

// 批次阶段与运行阶段属于执行账本，不写入条目 status
export const BATCH_STATUSES = ['prepared', 'running', 'paused', 'needs_attention', 'finished'];
export const FINAL_RUN_PHASES = new Set(['reported', 'blocked', 'failed']);
export const RESULTS = ['reported', 'blocked', 'failed'];

const DISPATCH_LOCK_STALE_MS = 30_000;
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKER_SPEC_SRC = path.join(pluginRoot, 'skills', 'agent-team-board', 'worker-spec.md');
const ATB_PATH = path.join(pluginRoot, 'scripts', 'atb.mjs');

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const nowIso = () => new Date().toISOString();

function dispatchDir(dataDir) {
  return path.join(dataDir, 'dispatch');
}

function batchesDir(dataDir) {
  return path.join(dispatchDir(dataDir), 'batches');
}

function runsDir(dataDir) {
  return path.join(dispatchDir(dataDir), 'runs');
}

// ---------- 初始化（幂等） ----------

export function ensureDispatch(dataDir) {
  fs.mkdirSync(dispatchDir(dataDir), { recursive: true });
  const settingsPath = path.join(dispatchDir(dataDir), 'settings.json');
  if (!readJson(settingsPath)) {
    // REQ-20260908-019：defaults.batchLimit 随上限设置移除，初始化只写计数器
    writeJsonAtomic(settingsPath, { version: 1, counters: { batch: 0, run: 0 } });
  }
  const policiesPath = path.join(dispatchDir(dataDir), 'policies.json');
  if (!readJson(policiesPath)) {
    writeJsonAtomic(policiesPath, { version: 1, items: {} });
  }
  // 执行规范快照进项目数据目录：提示词引用项目内路径，插件升级不致悬空
  const specDst = path.join(dispatchDir(dataDir), 'worker-spec.md');
  if (!fs.existsSync(specDst)) {
    try {
      fs.copyFileSync(WORKER_SPEC_SRC, specDst);
    } catch {
      fs.writeFileSync(specDst, '# AI 开发执行规范\n\n（生成时插件规范文件缺失，请更新插件后重新启动任务。）\n');
    }
  }
  // 运行账本不进版本控制；不得误排除既有需求文档
  const gi = path.join(dataDir, '.gitignore');
  const wanted = ['dispatch/runs/', 'dispatch/batches/'];
  let cur = '';
  try { cur = fs.readFileSync(gi, 'utf8'); } catch {}
  const add = wanted.filter((l) => !cur.split('\n').includes(l));
  if (add.length) fs.writeFileSync(gi, cur.replace(/\n*$/, '\n') + add.join('\n') + '\n');
}

// ---------- 编号（与 config.json 计数器同款互斥，独立序列） ----------

function nextDispatchId(dataDir, kind) {
  const lockPath = path.join(dataDir, '.locks', 'dispatch.lock');
  acquireLock(lockPath, DISPATCH_LOCK_STALE_MS, { pid: process.pid, at: nowIso() });
  try {
    ensureDispatch(dataDir);
    const settingsPath = path.join(dispatchDir(dataDir), 'settings.json');
    const cfg = readJson(settingsPath) || { version: 1, counters: {} };
    cfg.counters[kind] = (cfg.counters[kind] || 0) + 1;
    writeJsonAtomic(settingsPath, cfg);
    return `${kind}-${localDateStamp()}-${String(cfg.counters[kind]).padStart(3, '0')}`;
  } finally {
    releaseLock(lockPath);
  }
}

// ---------- 依赖策略 ----------

// 结构与 REQ-20260906-003 dispatch-store 对齐：{ version, items: { <id>: { dependsOn } } }；
// 读取兼容历史 deps 形态，写入统一 items，避免两个调度器互相清空依赖。
export function readPolicies(dataDir) {
  ensureDispatch(dataDir);
  const saved = readJson(path.join(dispatchDir(dataDir), 'policies.json'));
  const items = saved && typeof saved.items === 'object' ? saved.items : (saved && typeof saved.deps === 'object' ? saved.deps : {});
  return { version: 1, items };
}

function writePolicies(dataDir, policies) {
  writeJsonAtomic(path.join(dispatchDir(dataDir), 'policies.json'), policies);
}

// 校验并保存依赖：不存在 / 自依赖 / 成环就地报错（供 UI 400 与 CLI 提示共用）
export function setDependencies(dataDir, itemId, dependsOn) {
  try {
    resolveItemDir(dataDir, itemId);
  } catch {
    return { ok: false, errors: [`条目不存在：${itemId}`] };
  }
  if (!Array.isArray(dependsOn)) return { ok: false, errors: ['dependsOn 必须是编号数组'] };
  const errors = [];
  const seen = new Set();
  for (const dep of dependsOn) {
    if (typeof dep !== 'string' || !/^(?:REQ|BUG)-\d{8}-\d{3,}$/.test(dep)) {
      errors.push(`非法编号：${dep}`);
      continue;
    }
    if (seen.has(dep)) continue;
    seen.add(dep);
    if (dep === itemId) {
      errors.push(`不能依赖自身：${dep}`);
      continue;
    }
    try {
      resolveItemDir(dataDir, dep);
    } catch {
      errors.push(`依赖不存在：${dep}`);
    }
  }
  // 成环检测：以「其余条目现有策略 + 本次改动」构成的图做 DFS
  const policies = readPolicies(dataDir);
  const graph = {};
  for (const [id, v] of Object.entries(policies.items)) {
    if (id !== itemId) graph[id] = [...(v.dependsOn || [])];
  }
  graph[itemId] = [...seen];
  const visiting = new Set();
  const done = new Set();
  const visit = (node, trail) => {
    if (done.has(node)) return false;
    if (visiting.has(node)) return trail.slice(trail.indexOf(node)).concat(node).join(' → ');
    visiting.add(node);
    for (const next of graph[node] || []) {
      const cyc = visit(next, [...trail, node]);
      if (cyc) return cyc;
    }
    visiting.delete(node);
    done.add(node);
    return false;
  };
  for (const id of Object.keys(graph)) {
    const cyc = visit(id, []);
    if (cyc) {
      errors.push(`依赖成环：${cyc}`);
      break;
    }
  }
  if (errors.length) return { ok: false, errors };

  const next = { version: 1, items: { ...policies.items } };
  // REQ-20260906-024：保存依赖时保留条目策略的其他字段（如 modelSelection），清空依赖仅移除该键
  if (seen.size) next.items[itemId] = { ...(policies.items[itemId] || {}), dependsOn: [...seen] };
  else if (policies.items[itemId]) {
    const rest = { ...policies.items[itemId] };
    delete rest.dependsOn;
    if (Object.keys(rest).length) next.items[itemId] = rest;
    else delete next.items[itemId];
  } else delete next.items[itemId];
  writePolicies(dataDir, next);
  return { ok: true, dependsOn: [...seen] };
}

// REQ-20260906-024：合并写入条目策略的附加字段（如 modelSelection），保留 dependsOn 等既有字段。
// 调用方负责字段校验（dispatch-store.normalizeModelSelection）；此处只做存在性校验与合并落盘。
export function saveItemPolicyFields(dataDir, itemId, patch) {
  try {
    resolveItemDir(dataDir, itemId);
  } catch {
    return { ok: false, errors: [`条目不存在：${itemId}`] };
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, errors: ['patch 必须是对象'] };
  }
  const policies = readPolicies(dataDir);
  const cur = policies.items[itemId] || {};
  const next = { version: 1, items: { ...policies.items, [itemId]: { ...cur, ...patch } } };
  writePolicies(dataDir, next);
  return { ok: true, fields: next.items[itemId] };
}

export function dependenciesOf(dataDir, itemId) {
  const p = readPolicies(dataDir);
  return [...((p.items[itemId] || {}).dependsOn || [])];
}

// 依赖未全部人工验收（done）→ 返回阻塞原因；父子归属不算依赖
export function depBlocked(dataDir, itemId, policies = null) {
  const deps = (policies || readPolicies(dataDir)).items[itemId];
  const list = (deps && deps.dependsOn) || [];
  if (!list.length) return null;
  for (const dep of list) {
    let st = null;
    try {
      st = readStatus(resolveItemDir(dataDir, dep).dir);
    } catch {
      return `依赖不存在：${dep}`;
    }
    if (st.status !== 'done') return `依赖未验收：${dep}（当前 ${st.status}，需人工确认 done）`;
  }
  return null;
}

// ---------- 候选选单（REQ-20260908-010：仅 planned 未认领；最旧优先 = 创建时间升序 → 编号） ----------
// 旧口径（accepted 且需求优先于 Bug）已随「已计划」状态退役：需求原文「先处理最旧的单」。

export function candidateItems(dataDir) {
  return listItems(dataDir)
    .filter((x) => x.status === 'planned' && !x.owner)
    .sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
      String(a.id).localeCompare(String(b.id))
    );
}

// ---------- 批次 ----------

function batchPath(dataDir, batchId) {
  return path.join(batchesDir(dataDir), batchId, 'batch.json');
}

function runPath(dataDir, runId) {
  return path.join(runsDir(dataDir), runId, 'run.json');
}

export function getBatch(dataDir, batchId) {
  const b = readJson(batchPath(dataDir, batchId));
  if (!b || !b.batchId) throw new AtbError(`找不到批次：${batchId}`);
  return b;
}

function saveBatch(dataDir, batch) {
  batch.lastActivityAt = nowIso();
  writeJsonAtomic(batchPath(dataDir, batch.batchId), batch);
}

export function listBatches(dataDir) {
  const dir = batchesDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((n) => readJson(path.join(dir, n, 'batch.json')))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function latestBatch(dataDir, mode = null) {
  const all = listBatches(dataDir).filter((b) => !mode || b.mode === mode);
  return all[0] || null;
}

// REQ-20260906-025 批次排队：未结束批次（status !== 'finished'）按创建时间升序构成
// 项目级单队列（次键 batchId 字符串序，与 prune 同口径）；账本无需迁移，原 batch.json 即队列成员。
export function unfinishedBatches(dataDir) {
  return listBatches(dataDir)
    .filter((b) => b.status !== 'finished')
    .sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
      String(a.batchId).localeCompare(String(b.batchId)));
}

// 队首 = 最早未结束批次：next/check/summary 与 serve/UI 的缺省解析目标。
// 无未结束批次时调用方回退 latestBatch（保留「已结束批次面板 / 创建下一批」展示语义）。
export function queueHeadBatch(dataDir) {
  return unfinishedBatches(dataDir)[0] || null;
}

// 批次保留清理（REQ-20260906-023）：保留最近 keep 个批次目录，更旧的删除。
// 「最旧」按 createdAt（次键 batchId，编号含日期与全局递增序号，字符串序即创建序）；
// 存在未收尾运行（在途执行）的批次跳过不删，防止删除正在执行的批次账本；
// 单个批次删除失败跳过继续，不向调用方抛错。返回 { kept, removed: [batchId…] }（removed 旧→新）。
export function pruneBatches(dataDir, keep = BATCH_RETENTION_MAX) {
  const all = listBatches(dataDir)
    .sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
      String(a.batchId).localeCompare(String(b.batchId))); // 升序：旧 → 新
  const removed = [];
  for (const b of all.slice(0, Math.max(0, all.length - keep))) {
    if (b.currentRunId) {
      const run = readJson(runPath(dataDir, b.currentRunId));
      if (run && !FINAL_RUN_PHASES.has(run.phase) && run.phase !== 'interrupted' && run.phase !== 'skipped') continue; // 在途保护
    }
    try {
      fs.rmSync(path.join(batchesDir(dataDir), b.batchId), { recursive: true, force: true });
      removed.push(b.batchId);
    } catch { /* 目录异常：跳过该批次，不中断创建流程 */ }
  }
  return { kept: all.length - removed.length, removed };
}

export function getRun(dataDir, runId) {
  const r = readJson(runPath(dataDir, runId));
  if (!r || !r.runId) throw new AtbError(`找不到运行：${runId}`);
  return r;
}

// REQ-20260907-013 删除未在执行的批次：无在途运行且非 needs_attention 才允许。
// 在途判定与 checkBatch 同口径并全量扫描本批运行（不只看 currentRunId，防异常残留）；
// needs_attention 批次承载 attention 项目占用的恢复入口（暂停→恢复），删除会丢失入口，故拒绝。
// 仅移除批次账本目录（与 pruneBatches 同口径）：runs/ 运行记录与条目业务状态不动，
// 被删批次的候选回到可入批候选池；队列为动态计算，删除后位次自动前移、防抢随之解除。
export function deleteBatch(dataDir, batchId) {
  const batch = getBatch(dataDir, batchId);
  const state = batchState(dataDir, batch);
  const open = state.runs.find((r) => !FINAL_OR_SKIP(r.phase) && r.phase !== 'interrupted');
  if (open) {
    throw new AtbError(`批次 ${batchId} 正在执行（${open.runId} ${open.itemId}，owner ${open.owner}，${open.phase}），不能删除；请先收尾后在途运行`);
  }
  if (batch.status === 'needs_attention') {
    throw new AtbError(`批次 ${batchId} 待人工核对（needs_attention），请先到 Status Board 核对并恢复后再删除`);
  }
  fs.rmSync(path.join(batchesDir(dataDir), batchId), { recursive: true, force: true });
  return { ok: true, batchId };
}

function saveRun(dataDir, run) {
  run.updatedAt = nowIso();
  writeJsonAtomic(runPath(dataDir, run.runId), run);
}

// 本批全部运行（按创建时间倒序）
function batchRuns(dataDir, batchId) {
  const dir = runsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((n) => readJson(path.join(dir, n, 'run.json')))
    .filter((r) => r && r.batchId === batchId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// 批次动态状态：终态运行映射、计数、在途运行
// REQ-20260908-020：skipped（任务终止出局）同为终态——计入 counts.skipped 且不再算待处理。
// REQ-20260908-026：retryItems 标记「异常/已中断记录已重新执行」——该条目回到待处理
// （不计入异常终态计数），下一轮 next 重新领取并产生新执行尝试（保留原记录）。
const FINAL_OR_SKIP = (phase) => FINAL_RUN_PHASES.has(phase) || phase === 'skipped';
// 批次动态状态：终态运行映射、计数、在途运行（候选按实时口径盘点，REQ-20260913-003）
// REQ-20260908-020：skipped（任务终止出局）同为终态——计入 counts.skipped 且不再算待处理。
// REQ-20260908-026：retryItems 标记「异常/已中断记录已重新执行」——该条目回到待处理
// （不计入异常终态计数），下一轮 next 重新领取并产生新执行尝试（保留原记录）。
function batchState(dataDir, batch) {
  const runs = batchRuns(dataDir, batch.batchId);
  const retryItems = new Set(Object.keys(batch.retryItems || {}));
  const finalByItem = new Map();
  for (const r of runs) {
    if (FINAL_OR_SKIP(r.phase) && !finalByItem.has(r.itemId)) finalByItem.set(r.itemId, r);
  }
  let currentRun = null;
  if (batch.currentRunId) {
    currentRun = runs.find((r) => r.runId === batch.currentRunId) || readJson(runPath(dataDir, batch.currentRunId));
  }
  const candidates = effectiveCandidates(dataDir, batch);
  const counts = {
    total: candidates.length,
    reported: 0,
    blocked: 0,
    failed: 0,
    skipped: 0,
    interrupted: 0, // REQ-20260908-026：中断账计数（面板「异常」口径的组成部分）
    remaining: 0,
  };
  for (const r of runs) {
    if (r.phase === 'interrupted') counts.interrupted++;
  }
  for (const r of finalByItem.values()) {
    if (retryItems.has(r.itemId)) continue; // 重新排队待处理：不占终态计数
    if (r.phase === 'reported') counts.reported++;
    else if (r.phase === 'blocked') counts.blocked++;
    else if (r.phase === 'failed') counts.failed++;
    else if (r.phase === 'skipped') counts.skipped++;
  }
  counts.remaining = candidates.filter((id) => !finalByItem.has(id) || retryItems.has(id)).length;
  return { runs, finalByItem, retryItems, currentRun, counts };
}

// 剩余候选的当前可派发性盘点（BUG-20260906-001）：与 nextItem 的逐候选出局判定同口径——
// 已有终态运行跳过；目录损坏 / 盘点后被认领或流转（含升级前遗留的 accepted 候选）→ 出局；
// 依赖未满足 → 受阻；否则可派发。check 的 stop 判定与 next 的 stop=blocked 收尾共用，保证两处不会口径漂移。
function remainingDisposition(dataDir, batch, state, policies = null) {
  const pol = policies || readPolicies(dataDir);
  const blockedIds = [];
  const outIds = [];
  let dispatchable = 0;
  for (const itemId of effectiveCandidates(dataDir, batch)) {
    // REQ-20260908-026：retryItems 标记的条目已回到待处理，按普通候选盘点
    if (state.finalByItem.has(itemId) && !state.retryItems.has(itemId)) continue;
    let st = null;
    try {
      st = readStatus(resolveItemDir(dataDir, itemId).dir);
    } catch {
      outIds.push(itemId); // 条目目录损坏：不可派发
      continue;
    }
    if (st.status !== 'planned' || st.owner) { outIds.push(itemId); continue; }
    if (depBlocked(dataDir, itemId, pol)) { blockedIds.push(itemId); continue; }
    dispatchable++;
  }
  return { dispatchable, blockedIds, outIds };
}

// 主调度提示词（REQ-20260913-003 去批次化：不含批次号/批次摘要入口/排队接续，核对入口不依赖
// 批次标识；含实时取单指令——每完成一项实时从已计划队列最旧优先领取下一项，队列取空即本轮结束）。
// REQ-20260910-027：开发人员设置已移除——不再生成会话命名指令；developer 参数保留但忽略（兼容旧调用）。
// REQ-20260909-011 通用化：单一版本（agent 参数保留但忽略）——同一份提示词可在任意一种 Agent 会话中
// 直接粘贴执行；调度要素完整保留。
// REQ-20260909-005：modelSource='follow'（默认）→ 注入「与主调度会话保持一致」指令
// （FOLLOW_SESSION_PROMPT_LINE）。
// BUG-20260909-017：模型指令行统一跟随口径——manual 或仅传 model/level（兼容旧调用）同样注入
// 跟随指令；均未传 → 不注入任何行（直连调用行为不变）。
export function generatePrompt({ projectRoot, workerSpecPath, batchId = null, developer = null, agent = null, modelSource = null, model = null, level = null, atbPath = ATB_PATH }) {
  void batchId; // REQ-20260913-003：调度不依赖批次标识，参数仅作兼容
  void agent; // REQ-20260909-011：执行端无关，参数仅作兼容
  void developer; // REQ-20260910-027：开发人员已移除，参数仅作兼容
  const head = [
    '你是当前项目的 AI 开发调度员，只负责派发与接收短回执。',
    `项目：${projectRoot}`,
  ];
  const modelLine = modelSource === 'follow' || modelSource === 'manual' || model || level
    ? [FOLLOW_SESSION_PROMPT_LINE]
    : [];
  const common = [
    `执行规范：${workerSpecPath}`,
    `调度核对入口：node ${atbPath} batch check --dir ${projectRoot}`,
    '',
    '每轮新启动一个子代理，按执行规范领取当前队列中最早的一个可实施条目，认领、实施、测试并上报。',
    '实时取单：每完成一项，立即核对并从当前已计划队列（最旧优先）领取下一项；运行中新移入计划的条目立即可领取，无需任何并入操作；实时队列取空即本轮结束。',
    '每个子代理只做一项；子代理会话命名统一为：<条目编号>（与主调度会话区分）。',
    '同一时间只运行一个；不要让子代理再派发子代理。',
    '只传项目根与规范路径，不复制本会话的历史实施记录。',
    '',
    '完整需求、代码、测试日志、报告均由子代理按需读取或落盘。',
    '主会话只接收规定的短回执，并调用最小核对入口。',
    'nextAction=continue 时启动下一个新子代理；stop 时结束；',
    'needs_attention 时说明简短原因和记录入口，等待人工处理。',
    '不要重复读取全队列、完整报告，不逐项输出长总结，不高频轮询。',
    '收尾只给本轮计数和异常入口。不得代替人工接受需求或确认完成。',
  ];
  return [...head, ...modelLine, ...common].join('\n');
}

// 启动一轮批量开发（REQ-20260913-003 去批次化）：不再冻结候选快照、不再排队——
// - 账本 candidates 置空（显式 ids 仅作队首种子，供终态任务单条目重建路径），每次领取实时读取
//   当前已计划队列（见 effectiveCandidates / nextItem）；
// - 同一项目同一时间只有一轮执行：创建前盘点未结束账本，空转（无在途运行且无剩余）账本就地
//   收尾后仍存在未结束账本（待启动/执行中/暂停/待核对）→ 抛「已有进行中的任务」，不产生排队对象；
// - 启动行为保持「复制调度提示词，登记运行后才算执行中」口径。
// ids（BUG-20260909-006 起语义收敛）：显式指定队首种子——种子 = 规范候选序 ∩ ids；
// 现役调用方为终态任务「按原配置重试本项」的单条目重建（REQ-20260908-026）。
// REQ-20260909-011：agent 缺省记通用子代理模式标识 subagent；mode 维持 'zcode'。
// REQ-20260909-005：modelSource（follow | manual）来自调用方；follow 时忽略 model/level。
export function createBatch(dataDir, { ids = null, projectRoot, mode = 'zcode', agent = null, developer = null, modelSource = null, model = null, level = null } = {}) {
  ensureDispatch(dataDir);
  void developer; // REQ-20260910-027：开发人员设置已移除，入参保留但忽略（不再校验/落账）
  const execAgent = agent === 'codex' || agent === 'zcode' ? agent : 'subagent';
  if (ids != null && !Array.isArray(ids)) {
    throw new AtbError('ids 必须是编号数组');
  }
  const scoped = ids != null;

  // 队列盘点（REQ-20260913-003：先于候选检查——已有进行中的一轮时，即便当前无新增候选
  // 也必须以「重复启动」拒绝，不得误报「没有可实施候选」；盘点不按 mode 区分——同项目
  // 同一时间只有一个执行会话，zcode 轮同样拦下 codex 启动）：无在途运行且无剩余（实时口径）
  // 的未结束账本就地收尾，防旧空转轮卡住启动；待核对（needs_attention）轮承载人工恢复入口，
  // 不自动收尾——按重复启动拒绝；其余未结束账本即进行中的一轮——不排队、不新建对象。
  for (const b of unfinishedBatches(dataDir)) {
    const st = batchState(dataDir, b);
    const active = st.currentRun && !FINAL_RUN_PHASES.has(st.currentRun.phase);
    if (b.status !== 'needs_attention' && !active && st.counts.remaining === 0) {
      if (b.status !== 'finished') {
        b.status = 'finished';
        saveBatch(dataDir, b);
      }
      continue;
    }
    throw new AtbError(
      `已有进行中的任务（${b.status === 'prepared' ? '待启动' : '执行中'}）：同一时间只有一轮执行，无需重复启动；` +
      '如需重开请先完成、恢复或终止当前任务',
    );
  }

  const want = scoped ? new Set(ids.filter((x) => typeof x === 'string')) : null;
  let base = candidateItems(dataDir);
  if (scoped) base = base.filter((x) => want.has(x.id));
  // scoped 空集先报错（显式指定集合无候选，错误信息指向重新指定/置计划）
  if (scoped && !base.length) {
    throw new AtbError('指定的条目均不可入队：可能已被认领或不在已计划状态');
  }
  if (!scoped && !base.length) {
    throw new AtbError('没有可实施候选：请先在 Status Board 接受条目并「移入计划」（仅 planned 且未被认领的条目会进入实时队列）');
  }

  const batchId = nextDispatchId(dataDir, 'batch');
  const workerSpecPath = path.join(dispatchDir(dataDir), 'worker-spec.md');
  const prompt = generatePrompt({ projectRoot, workerSpecPath, agent: execAgent, modelSource: modelSource === 'follow' ? 'follow' : (modelSource === 'manual' ? 'manual' : null), model: modelSource === 'follow' ? null : model, level: modelSource === 'follow' ? null : level });
  const batch = {
    batchId,
    mode,
    agent: execAgent, // REQ-20260908-020：执行 Agent（存量账本缺字段同义 zcode）
    projectRoot,
    createdAt: nowIso(),
    lastActivityAt: nowIso(),
    // REQ-20260910-027：developer 字段不再写（存量账本保留不迁移，读取侧不透出）
    // REQ-20260913-003：不再冻结候选——缺省 candidates 为空（领取时实时读取已计划队列），
    // 仅显式 ids（终态任务单条目重建）作为队首种子落账。
    candidates: scoped ? base.map((x) => x.id) : [],
    prompt,
    status: 'prepared',
    pauseRequested: false,
    abortRequested: false,
    currentRunId: null,
  };
  fs.mkdirSync(path.dirname(batchPath(dataDir, batchId)), { recursive: true });
  saveBatch(dataDir, batch);
  // REQ-20260906-023：新账本落盘后清理超出保留上限的最旧记录
  const pruned = pruneBatches(dataDir);
  return { batch, created: true, pruned };
}

// 创建时的受阻计数（供看板展示，依赖后续满足会动态解除；实时口径含未入账候选）
export function blockedCountAtCreate(dataDir, batch) {
  const policies = readPolicies(dataDir);
  return effectiveCandidates(dataDir, batch)
    .filter((id) => {
      try {
        return readStatus(resolveItemDir(dataDir, id).dir).status === 'planned';
      } catch {
        return false;
      }
    })
    .filter((id) => depBlocked(dataDir, id, policies)).length;
}

// ---------- 实施互斥（.locks/impl.lock；无超时接管，异常走人工核对） ----------

function implLockPath(dataDir) {
  return path.join(dataDir, '.locks', 'impl.lock');
}

function acquireImplLock(dataDir, payload) {
  assertNoImplAttention(dataDir); // 失败待核对期间其他批次同样不得开工（BUG-20260906-003）
  acquireLock(implLockPath(dataDir), Infinity, payload); // Infinity：不因过期自动接管
}

// 预留成功后补写锁内容（runId/itemId），供 claim 冲突提示指明在实施哪一条
function stampImplLock(dataDir, extra) {
  try {
    const cur = readImplLockIfExists(dataDir) || {};
    fs.writeFileSync(implLockPath(dataDir), JSON.stringify({ ...cur, ...extra }));
  } catch {}
}

// 失败待核对占用（BUG-20260906-003）：本运行的失败无法确认工作区可继续时，
// 不释放实施互斥，改为在锁上标记 attention（项目暂停），其他入口一律被拒；
// 人工在批次上恢复（暂停→恢复）后由 pauseBatch 解除。
function holdImplAttention(dataDir, run, reason) {
  const lock = readImplLockIfExists(dataDir);
  if (lock && (lock.runId === run.runId || lock.owner === run.owner)) {
    try {
      fs.writeFileSync(implLockPath(dataDir), JSON.stringify({
        ...lock, attention: true, attentionReason: reason, attentionAt: nowIso(),
      }));
    } catch {}
  }
}

// REQ-20260914-001 提交不完整挂起占用：与失败待核对同锁同语义（项目暂停、所有实施入口被拒），
// 但恢复入口是「待人工确认提交」的确认并继续（核验+补交通过后 resumeAfterConfirm 解除），
// 不依赖暂停→恢复按钮；attentionKind='confirm' 供提示文案区分指引。
function holdConfirmAttention(dataDir, run, reason) {
  const lock = readImplLockIfExists(dataDir);
  if (lock && (lock.runId === run.runId || lock.owner === run.owner)) {
    try {
      fs.writeFileSync(implLockPath(dataDir), JSON.stringify({
        ...lock, attention: true, attentionKind: 'confirm', attentionReason: reason, attentionAt: nowIso(),
      }));
    } catch {}
  }
}

function releaseImplLockIf(dataDir, pred) {
  const lock = readImplLockIfExists(dataDir);
  if (lock && pred(lock)) {
    try { fs.unlinkSync(implLockPath(dataDir)); } catch {}
  }
}

// ---------- 领取与核对（worker 入口） ----------

// 实时候选（REQ-20260913-003）：批次概念退役后，本轮执行不再冻结候选快照——每次盘点都实时
// 读取当前已计划队列（最旧优先）。返回生效候选 = 账本已登记候选（含显式 ids 队首种子与存量账本）
// ∪ 当前实时候选（排除其他未结束账本已登记条目，兼容存量排队数据，一个条目至多属于一轮）。
export function effectiveCandidates(dataDir, batch) {
  const known = new Set(batch.candidates);
  for (const other of unfinishedBatches(dataDir)) {
    if (other.batchId !== batch.batchId) {
      for (const id of other.candidates || []) known.add(id);
    }
  }
  return [...batch.candidates, ...candidateItems(dataDir).filter((x) => !known.has(x.id)).map((x) => x.id)];
}

export function nextItem(dataDir, batchId, { owner = null } = {}) {
  owner = owner || actor();
  const batch = getBatch(dataDir, batchId);
  if (batch.status === 'needs_attention') {
    throw new AtbError(`任务 ${batchId} 待人工核对（needs_attention），请先到 Status Board 查看失败原因`);
  }
  // 存量数据防抢：存在更早的未结束账本时本轮仍在排队，不得越过队首领取；
  // impl 互斥为第二道防线，此检查保证 A 项间空隙 B 也不会被派发。
  const prior = unfinishedBatches(dataDir).find((b) => b.batchId !== batchId &&
    (String(b.createdAt || '').localeCompare(String(batch.createdAt || '')) < 0 ||
      (String(b.createdAt || '') === String(batch.createdAt || '') && b.batchId < batchId)));
  if (prior) {
    throw new AtbError(`任务 ${batchId} 排队中：前序任务 ${prior.batchId} 尚未结束，当前任务结束后自动接续，不得抢先领取`);
  }
  // REQ-20260908-020：任务已终止——停止派发（在途执行不受影响，需在对应子代理会话人工停止）
  if (batch.abortRequested) {
    return { stop: 'aborted', counts: batchState(dataDir, batch).counts, notice: '任务已终止：不再派发后续项' };
  }
  const state0 = batchState(dataDir, batch);
  if (state0.currentRun && !FINAL_RUN_PHASES.has(state0.currentRun.phase)) {
    const r = state0.currentRun;
    throw new AtbError(
      `当前执行未收尾：${r.runId}（${r.itemId}，owner ${r.owner}，${r.phase}）。` +
      '先核对旧子 Agent 是否结束，不得创建第二个实施任务'
    );
  }
  // REQ-20260914-001：存在活动的「待人工确认提交」挂起时不得派发后续项（人工恢复领取也不放行，
  // 只有确认并继续闭环后才恢复）——notice 指明阻塞条目与原因，不派空 worker。先于 pauseRequested
  // 判定：挂起暂停是最具体的原因，提示须直达确认入口。只看 waiting（resolved 已闭环不阻塞）。
  const waitingConfirm = waitingDevelopConfirm(dataDir);
  if (waitingConfirm) {
    return {
      stop: 'paused',
      counts: state0.counts,
      notice: `队列挂起：${waitingConfirm.itemId} 待人工确认提交（${waitingConfirm.reason || '自动提交不完整'}）；请到 Status Board 任务页「待人工确认」完成确认并继续`,
    };
  }
  if (batch.pauseRequested) {
    return { stop: 'paused', counts: state0.counts, notice: '已暂停后续领取（在途执行不受影响）' };
  }

  // 项目实施互斥：预留 → 认领 → 实施 → 收尾核对 全程持有（跨进程文件锁），
  // 回执收尾（finishRun/releaseReservation）才释放；获取失败即说明被占用（Z04）
  acquireImplLock(dataDir, { kind: 'batch', batchId, owner, at: nowIso() });
  const policies = readPolicies(dataDir);
  const candidates = effectiveCandidates(dataDir, batch);
  for (const itemId of candidates) {
    // 已有终态运行跳过；REQ-20260908-026：retryItems 标记的条目重新领取（新执行尝试）
    if (state0.finalByItem.has(itemId) && !state0.retryItems.has(itemId)) continue;
    let st = null;
    try {
      st = readStatus(resolveItemDir(dataDir, itemId).dir);
    } catch {
      continue; // 条目目录损坏：跳过，不派发
    }
    if (st.status !== 'planned' || st.owner) continue; // 已被认领/流转：自然出局
    if (depBlocked(dataDir, itemId, policies)) continue; // 依赖未满足：本轮跳过
    if (batch.retryItems && batch.retryItems[itemId]) {
      delete batch.retryItems[itemId]; // 重新领取成功：清除重试标记（随下方 saveBatch 落盘）
      if (!Object.keys(batch.retryItems).length) delete batch.retryItems;
    }
    const runId = nextDispatchId(dataDir, 'run');
    const run = {
      runId,
      batchId,
      itemId,
      owner,
      executor: batch.mode,
      createdAt: nowIso(),
      startedAt: null,
      phase: 'reserved',
      childSessionId: null,
      attempts: 1,
      cancelRequested: false,
      reason: null,
      reportRef: null,
    };
    fs.mkdirSync(path.dirname(runPath(dataDir, runId)), { recursive: true });
    // REQ-20260911-009：预留即拍工作区快照——回执核验通过后的自动提交以此为归因基线
    // （期间未变化的预留前脏改动不卷入；非 git 项目为 null，收尾时明确跳过）。
    run.treeSnapshot = gitFlow.workingTreeSnapshot(batch.projectRoot);
    saveRun(dataDir, run);
    stampImplLock(dataDir, { runId, itemId });
    batch.currentRunId = runId;
    batch.status = 'running'; // 有效运行登记：待启动 → 执行中
    saveBatch(dataDir, batch);
    const dir = resolveItemDir(dataDir, itemId).dir;
    return {
      runId,
      batchId,
      itemId,
      title: st.title,
      itemDir: dir,
      docs: orderedDocs(dir),
      workerSpec: path.join(dispatchDir(dataDir), 'worker-spec.md'),
      owner,
    };
  }
  // 无可实施候选：释放互斥并收尾（含仅余阻塞项——不派空 worker）
  const state = batchState(dataDir, batch);
  const dispo = remainingDisposition(dataDir, batch, state, policies);
  batch.currentRunId = null;
  batch.status = 'finished';
  saveBatch(dataDir, batch);
  releaseImplLockIf(dataDir, () => true);
  const counts = { ...state.counts };
  if (dispo.blockedIds.length) counts.blockedPending = dispo.blockedIds.length;
  return {
    stop: state.counts.remaining > 0 ? 'blocked' : 'finished',
    counts,
  };
}

// 预留释放：仅限「尚未认领」或「已被他人认领」的竞态；本运行已认领则拒绝
export function releaseReservation(dataDir, runId, { reason = '' } = {}) {
  const run = getRun(dataDir, runId);
  if (FINAL_RUN_PHASES.has(run.phase) || run.phase === 'interrupted') {
    throw new AtbError(`运行 ${runId} 已收尾（${run.phase}），无需释放`);
  }
  const st = readStatus(resolveItemDir(dataDir, run.itemId).dir);
  if (st.status !== 'accepted' && st.owner === run.owner) {
    throw new AtbError(
      `${run.itemId} 已被本运行认领（in-progress，owner ${run.owner}）；` +
      '认领后的失败保持业务状态，请改用 run receipt --result failed 收尾'
    );
  }
  run.phase = 'interrupted';
  run.reason = String(reason || '预留释放').slice(0, REASON_MAX_CHARS);
  run.finishedAt = nowIso();
  saveRun(dataDir, run);
  const batch = getBatch(dataDir, run.batchId);
  if (batch.currentRunId === runId) batch.currentRunId = null;
  const state = batchState(dataDir, batch);
  if (!batch.pauseRequested) {
    batch.status = state.counts.remaining > 0 ? 'running' : 'finished';
  }
  saveBatch(dataDir, batch);
  releaseImplLockIf(dataDir, (l) => l.runId === runId || l.owner === run.owner);
  return { ok: true, runId, itemId: run.itemId };
}

// ---------- 重新执行（REQ-20260908-026） ----------

// 异常 / 已中断执行记录的「重新执行」：核验占用后把条目重新纳入本轮待处理
// （标记 retryItems，计数改记待处理、保留原记录与失败原因），下一轮 next 重新领取产生新尝试。
// 不自动修改人工管理的业务状态：被认领条目一律拒绝并给出人工处理指引；
// 终态任务不在此路径——由前端以该条目重建新的待启动任务并复制调度提示词承接。
export function retryRun(dataDir, runId) {
  const run = getRun(dataDir, runId);
  if (run.phase === 'reported' || run.phase === 'skipped') {
    throw new AtbError(`运行 ${runId} 结果为 ${run.phase}（非异常记录），无需重新执行`);
  }
  if (!FINAL_RUN_PHASES.has(run.phase) && run.phase !== 'interrupted') {
    throw new AtbError(`运行 ${runId} 尚未收尾（${run.phase}）：在途执行不得重复派发，请先核对旧子代理是否结束`);
  }
  const batch = getBatch(dataDir, run.batchId);
  if (batch.status === 'needs_attention') {
    throw new AtbError(`任务 ${batch.batchId} 待人工核对（needs_attention）：请先在面板恢复领取（暂停→恢复）后再重试`);
  }
  if (batch.abortRequested || batch.status === 'finished') {
    throw new AtbError(`任务 ${batch.batchId} 已${batch.abortRequested ? '终止' : '结束'}：请通过新一轮任务承接（按该条目重建并复制调度提示词）`);
  }
  const state = batchState(dataDir, batch);
  if (state.runs.some((r) => r.itemId === run.itemId && !FINAL_OR_SKIP(r.phase) && r.phase !== 'interrupted')) {
    throw new AtbError(`${run.itemId} 已有在途执行：不得重复派发造成双执行`);
  }
  const { dir } = resolveItemDir(dataDir, run.itemId);
  const st = readStatus(dir);
  if (st.status !== 'planned' || st.owner) {
    throw new AtbError(
      `${run.itemId} 当前为 ${st.status}${st.owner ? `（由 ${st.owner} 认领）` : ''}：重新执行不自动修改人工管理的业务状态，` +
      '请先确认旧子代理已停止并在 Status Board 人工处理该条目（回到已计划且未认领），再点「重新执行」',
    );
  }
  if (!state.finalByItem.has(run.itemId)) {
    return { ok: true, batchId: batch.batchId, itemId: run.itemId, alreadyPending: true, notice: '该条目已在待处理队列中，等待下一轮领取' };
  }
  if (state.retryItems.has(run.itemId)) {
    return { ok: true, batchId: batch.batchId, itemId: run.itemId, alreadyQueued: true, notice: '已在重试队列中（重复点击不产生重复执行）' };
  }
  batch.retryItems = { ...(batch.retryItems || {}), [run.itemId]: runId };
  const counts = batchState(dataDir, batch).counts;
  batch.status = batch.pauseRequested ? 'paused' : (counts.remaining > 0 ? 'running' : 'finished');
  batch.lastActivityAt = nowIso();
  saveBatch(dataDir, batch);
  const attempt = state.runs.filter((r) => r.itemId === run.itemId).length + 1;
  return {
    ok: true, batchId: batch.batchId, itemId: run.itemId, attempt,
    notice: `已加入本轮重试队列（第 ${attempt} 次尝试），保留原异常记录；遵守暂停与串行领取规则`,
  };
}

// ---------- 回执与核对协议 ----------

function buildReceipt(run, { result, reportRef, reason, safeToContinue }) {
  const receipt = { version: 1, batchId: run.batchId, runId: run.runId, itemId: run.itemId, result };
  if (result === 'reported') receipt.reportRef = reportRef;
  else {
    receipt.reason = reason;
    receipt.safeToContinue = safeToContinue;
  }
  return receipt;
}

export function finishRun(dataDir, runId, { result, reason = '', reportRef = null, safeToContinue = null } = {}) {
  const run = getRun(dataDir, runId);
  if (FINAL_RUN_PHASES.has(run.phase)) {
    const same =
      run.phase === result &&
      (result !== 'reported' || run.reportRef === reportRef) &&
      (result === 'reported' || (run.reason || '') === (reason || ''));
    if (!same) throw new AtbError(`运行 ${runId} 已有回执（${run.phase}），同一运行不得提交不同回执`);
    return { ok: true, idempotent: true, receipt: readJson(path.join(runsDir(dataDir), runId, 'receipt.json')) };
  }
  if (!RESULTS.includes(result)) {
    throw new AtbError(`result 必须是 ${RESULTS.join(' | ')}，得到：${result}`);
  }
  if (result === 'reported') {
    if (!reportRef) throw new AtbError('reported 回执必须携带 reportRef（条目 test-report 的相对引用），修正示例：atb run receipt <RUN-ID> --result reported --report-ref test-report.md');
    if ([...String(reason || '')].length) throw new AtbError('reported 回执不带 reason；异常情况请用 blocked/failed');
  } else {
    reason = String(reason || '').trim();
    if (!reason) throw new AtbError(`${result} 回执必须携带简短 reason（详细错误落盘后引用）`);
    if ([...reason].length > REASON_MAX_CHARS) {
      throw new AtbError(`reason 超过 ${REASON_MAX_CHARS} 字：完整错误请写入运行目录文件，回执只留短摘要`);
    }
  }
  const safe = safeToContinue == null ? result === 'blocked' : Boolean(safeToContinue);
  const receipt = buildReceipt(run, { result, reportRef, reason, safeToContinue: safe });

  // 证据核对（Z10）：reported 必须能关联本次 runId/owner/条目与新的上报时间
  if (result === 'reported') {
    const st = readStatus(resolveItemDir(dataDir, run.itemId).dir);
    if (st.status !== 'in-progress') {
      throw new AtbError(`证据不符：${run.itemId} 当前是 ${st.status}（应为 in-progress，即本运行认领后上报）`);
    }
    if (st.owner !== run.owner) {
      throw new AtbError(`证据不符：条目 owner 是 ${st.owner}，与运行 owner ${run.owner} 不一致`);
    }
    const rep = st.lastReport;
    if (!rep || rep.runId !== run.runId) {
      throw new AtbError('证据不符：本次上报未关联该 runId（atb report 需带 --run；旧报告不能当作本次完成）');
    }
    if (String(rep.at).localeCompare(String(run.createdAt)) < 0) {
      throw new AtbError('证据不符：report 时间早于本次运行创建时间，旧报告不能通过核对');
    }
    const refAbs = path.resolve(resolveItemDir(dataDir, run.itemId).dir, reportRef);
    const itemAbs = resolveItemDir(dataDir, run.itemId).dir;
    if (!(refAbs + path.sep).startsWith(itemAbs + path.sep) || !fs.existsSync(refAbs)) {
      throw new AtbError(`reportRef 不在条目目录内或不存在：${reportRef}`);
    }
  }

  // REQ-20260911-009 到待测试自动 commit：回执核验通过即把本单改动按现行分组规范提交
  // （doc/test/业务，消息「类型: 描述 单号」，只 commit 不 push）。在批量批次内执行，
  // 视同人工授权；由 atb 进程内部执行 git，不经 Agent Bash 工具，不受 state-guard 拦截。
  // 自动提交失败不阻断回执：改动保留在工作区，可 atb run autocommit <RUN-ID> 重试。
  let autoCommit = null;
  let suspendReason = null; // REQ-20260914-001：提交不完整 → 挂起当前条目并暂停队列
  if (result === 'reported') {
    const flowBatch = getBatch(dataDir, run.batchId);
    autoCommit = gitFlow.autoCommitForRun({ dataDir, projectRoot: flowBatch.projectRoot, run });
    receipt.autoCommit = {
      status: autoCommit.status,
      commits: (autoCommit.commits || []).map((c) => c.hash),
      // BUG-20260913-006：待人工路径随回执显式上抛（预留前已脏且本单动过，不静默留脏）
      ...(Array.isArray(autoCommit.pendingManual) && autoCommit.pendingManual.length
        ? { pendingManual: autoCommit.pendingManual.slice(0, 20) }
        : {}),
      ...(autoCommit.reason ? { reason: autoCommit.reason } : {}),
    };
    // REQ-20260914-001：提交完整性是收尾与后续派发的前置——归属不明 / 暂扣 / 失败 /
    // 无法确认完整时挂起当前条目（待人工确认提交）并持久化暂停队列，文档或部分文件
    // 提交成功不得视为开发完成，后续项不得继续执行。
    suspendReason = confirmStore.commitIncompleteReason(autoCommit);
    if (suspendReason) {
      // BUG-20260915-004：回执挂起原因不再 slice(0, 120) 拦腰截断（会把报错中段关键结论
      // 整段截掉）；保头保尾 + 提高上限至 REASON_MAX_CHARS，超长时中段以省略号衔接。
      receipt.suspended = { itemId: run.itemId, blockType: 'commit', reason: clipReasonKeepEnds(suspendReason, REASON_MAX_CHARS) };
    }
  }

  const bytes = Buffer.byteLength(JSON.stringify(receipt), 'utf8');
  if (bytes > RECEIPT_MAX_BYTES) {
    throw new AtbError(`回执超过 ${RECEIPT_MAX_BYTES} 字节（${bytes}）：请缩短 reason、用 reportRef 引用详细文件`);
  }

  run.phase = result;
  run.reason = result === 'reported' ? null : reason;
  run.reportRef = result === 'reported' ? reportRef : null;
  run.safeToContinue = result === 'reported' ? null : safe;
  run.finishedAt = nowIso();
  if (autoCommit) run.autoCommit = autoCommit;
  saveRun(dataDir, run);
  fs.mkdirSync(path.join(runsDir(dataDir), runId), { recursive: true });
  writeJsonAtomic(path.join(runsDir(dataDir), runId, 'receipt.json'), receipt);

  const batch = getBatch(dataDir, run.batchId);
  if (batch.currentRunId === runId) batch.currentRunId = null;
  const state = batchState(dataDir, batch);
  if (suspendReason) {
    // REQ-20260914-001 提交不完整挂起：持久化暂停队列（pauseRequested）+ 声明待人工确认
    // 提交记录 + 项目实施占用转 attentionKind='confirm'（不释放为可被后续任务占用的
    // 执行权；当前条目的核验/补交/恢复入口不经实施锁，不发生死锁）。确认并继续闭环
    // （核验+补交+测试全过）后由服务端 resumeAfterConfirm 解除。
    try {
      confirmStore.declareCommitConfirm(dataDir, {
        run, batch, autoCommit, projectRoot: batch.projectRoot,
      });
    } catch (e) {
      // 声明失败（如已有活动记录）不阻断回执落账，如实带入 notice 供人工核对
      // BUG-20260915-004：原因同样保头保尾，不再拦腰截断丢关键段
      suspendReason = `${clipReasonKeepEnds(suspendReason, 120)}；挂起登记失败：${String(e.message || e).slice(0, 60)}`;
    }
    batch.pauseRequested = true;
    batch.status = 'paused';
    saveBatch(dataDir, batch);
    holdConfirmAttention(dataDir, run, suspendReason);
  } else if (result === 'reported' || safe) {
    batch.status = batch.pauseRequested ? 'paused' : (state.counts.remaining > 0 ? 'running' : 'finished');
    saveBatch(dataDir, batch);
    releaseImplLockIf(dataDir, (l) => l.runId === runId || l.owner === run.owner);
  } else {
    batch.status = 'needs_attention'; // 环境级错误/失败：停止批次，保留未领条目待人工
    saveBatch(dataDir, batch);
    // BUG-20260906-003：无法确认工作区可继续时不释放项目实施占用（暂停项目），
    // 手工 claim / 其他批次 / Codex 派发一律被拒，直到人工恢复（暂停→恢复）解除。
    holdImplAttention(dataDir, run, reason);
  }
  return { ok: true, receipt };
}

// REQ-20260911-009 自动提交重试入口：自动提交失败的已上报运行，人工/流程可重试
// （幂等：git 历史已含单号或工作区无归属改动时按 skipped 返回，不产生重复提交）。
// REQ-20260914-001：该条目已声明「待人工确认提交」挂起时，补交走确认闭环
// （重新核验 / 确认并继续的授权补交），重试入口不越过人工确认直接提交。
export function retryAutoCommit(dataDir, runId) {
  const run = getRun(dataDir, runId);
  if (run.phase !== 'reported') {
    throw new AtbError(`运行 ${runId} 当前为 ${run.phase}：只有回执核验通过（reported）的运行才能重试自动提交`);
  }
  const flowBatch = getBatch(dataDir, run.batchId);
  const waiting = waitingDevelopConfirm(dataDir);
  if (waiting && waiting.itemId === run.itemId) {
    return {
      ok: true, runId, itemId: run.itemId,
      autoCommit: {
        status: 'skipped', commits: [],
        reason: `${run.itemId} 已挂起待人工确认提交：请到 Status Board 任务页「待人工确认」重新核验并确认后继续（授权补交在确认闭环内执行）`,
      },
    };
  }
  const autoCommit = gitFlow.autoCommitForRun({ dataDir, projectRoot: flowBatch.projectRoot, run });
  run.autoCommit = autoCommit;
  saveRun(dataDir, run);
  return { ok: true, runId, itemId: run.itemId, autoCommit };
}

// 最小核对（主调度入口）：只含当前执行、计数与 nextAction，≤2 KiB
export function checkBatch(dataDir, batchId) {
  const batch = getBatch(dataDir, batchId);
  const state = batchState(dataDir, batch);
  const currentRun = state.currentRun;
  const active = currentRun && !FINAL_RUN_PHASES.has(currentRun.phase) && currentRun.phase !== 'interrupted';

  let nextAction = 'continue';
  let notice = '';
  let blockedPending = 0;
  let finishedNow = false;
  if (active) {
    nextAction = 'needs_attention';
    notice = `当前执行未收尾（${currentRun.runId} ${currentRun.itemId} owner ${currentRun.owner}），执行状态待核对`;
  } else if (batch.status === 'needs_attention') {
    nextAction = 'needs_attention';
    const bad = state.runs.find((r) => FINAL_RUN_PHASES.has(r.phase) && r.phase !== 'reported');
    notice = `任务待人工核对：${bad ? `${bad.itemId} ${bad.phase}（${bad.reason || ''}）` : '存在失败/受阻运行'}`
      + '；核对遗留改动后通过 暂停→恢复 解除项目占用';
  } else if (batch.abortRequested) {
    nextAction = 'stop';
    notice = '任务已人工终止：不再派发后续项；在途子代理请在对应子代理会话人工停止';
  } else if (batch.pauseRequested) {
    nextAction = 'stop';
    // REQ-20260914-001：挂起待人工确认提交时给出阻塞条目与入口（队列暂停的持久化原因）
    const waitingConfirm = waitingDevelopConfirm(dataDir);
    notice = waitingConfirm
      ? `队列已暂停：${waitingConfirm.itemId} 待人工确认提交（${waitingConfirm.reason || '自动提交不完整'}）；请到 Status Board 任务页「待人工确认」核对差异并确认后继续`
      : '已暂停后续领取（在途执行不受影响；立即停止请到 Zcode 原生任务界面操作）';
  } else if (state.counts.remaining === 0) {
    nextAction = 'stop';
    notice = '本轮队列已处理完毕：实时队列已取空，可启动新一轮';
    if (batch.status !== 'finished') {
      batch.status = 'finished';
      saveBatch(dataDir, batch);
    }
    finishedNow = true;
  } else {
    // BUG-20260906-001：remaining 只看终态运行，覆盖不了「剩余项当前全部不可派发」——
    // 全部依赖受阻（或盘点后被认领/流转）时若仍返回 continue，主调度会反复派空 worker
    // （next 每轮都 stop=blocked）。须与 next 同口径判 stop，并带准确受阻计数。
    const dispo = remainingDisposition(dataDir, batch, state);
    blockedPending = dispo.blockedIds.length;
    if (dispo.dispatchable === 0) {
      nextAction = 'stop';
      const parts = [];
      if (dispo.blockedIds.length) parts.push(`依赖受阻 ${dispo.blockedIds.length} 项`);
      if (dispo.outIds.length) parts.push(`已被认领或流转 ${dispo.outIds.length} 项`);
      notice = `本轮剩余 ${state.counts.remaining} 项暂不可实施（${parts.join('，')}），不派空 worker`;
      if (batch.status !== 'finished') {
        batch.status = 'finished';
        saveBatch(dataDir, batch);
      }
      finishedNow = true;
    }
  }

  const payload = {
    version: 1,
    batchId: batch.batchId,
    status: batch.status,
    current: active
      ? { runId: currentRun.runId, itemId: currentRun.itemId, owner: currentRun.owner, phase: currentRun.phase, at: currentRun.createdAt }
      : null,
    counts: blockedPending ? { ...state.counts, blockedPending } : state.counts,
    nextAction,
    notice: notice || undefined,
  };
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > CHECK_MAX_BYTES) {
    throw new AtbError(`核对响应超过 ${CHECK_MAX_BYTES} 字节（${bytes}）：请检查 notice/reason 长度`);
  }
  return payload;
}

// ---------- 暂停/摘要/记录 ----------

// BUG-20260908-023：终态批次判定——已终止（abortRequested/aborted）或已结束（finished）的开发批次
// 不得再被暂停/恢复改写状态；返回可读原因（供 CLI/HTTP 入口透传明确错误），非终态返回 null
export function batchTerminalReason(batch) {
  if (batch.abortRequested || batch.aborted) return '任务已人工终止，不能暂停/恢复';
  if (batch.status === 'finished') return '任务已结束，不能暂停/恢复';
  return null;
}

export function pauseBatch(dataDir, batchId, paused) {
  const batch = getBatch(dataDir, batchId);
  // BUG-20260908-023：终态批次（已终止/已结束）幂等拒绝——不写 pauseRequested、不改 status，
  // 防止暂停请求把 finished 复活为 paused（恢复方向也不得把终止态翻回 running）；
  // 已终止批次的 attention 占用在 abortBatch 内已全量释放，拒绝不影响恢复解除占用的语义
  if (batchTerminalReason(batch)) return batch;
  batch.pauseRequested = Boolean(paused);
  const state = batchState(dataDir, batch);
  const active = state.currentRun && !FINAL_RUN_PHASES.has(state.currentRun.phase);
  if (paused && !active) batch.status = 'paused';
  else if (!paused && batch.status === 'paused') batch.status = 'running';
  saveBatch(dataDir, batch);
  // 人工恢复领取 = 已核对失败遗留改动：解除该批次留下的项目暂停占用（BUG-20260906-003）
  if (!paused) releaseImplLockIf(dataDir, (l) => l.attention && l.batchId === batchId);
  return batch;
}

// REQ-20260914-001 确认并继续（提交核验通过后恢复队列）：由服务端在 confirmCommitContinue
// 成功后调用。语义 = 解除该批次的挂起暂停 + 释放 attentionKind='confirm' 的项目实施占用；
// 与人工「恢复后续领取」按钮共用通路（幂等），队列从下一条继续（当前条目已收尾 reported）。
export function resumeAfterConfirm(dataDir, batchId) {
  const batch = getBatch(dataDir, batchId);
  const term = batchTerminalReason(batch);
  if (term) {
    // 已终止/已结束的批次无需恢复：占用已在终止时全量释放，如实返回
    return { ok: true, batchId, alreadyTerminal: true, notice: term };
  }
  const before = readImplLockIfExists(dataDir);
  pauseBatch(dataDir, batchId, false);
  const after = readImplLockIfExists(dataDir);
  return {
    ok: true,
    batchId,
    released: Boolean(before && (before.attention || before.attentionKind)) && (!after || !after.attention),
    status: getBatch(dataDir, batchId).status,
  };
}

// REQ-20260908-020 终止出局账（不占 currentRun；直接写终态 run 供记录展示）
function skipBatchRun(dataDir, batch, itemId, reason) {
  const runId = nextDispatchId(dataDir, 'run');
  const run = {
    runId,
    batchId: batch.batchId,
    itemId,
    owner: 'batch-abort',
    executor: batch.agent || batch.mode,
    createdAt: nowIso(),
    startedAt: null,
    phase: 'skipped',
    childSessionId: null,
    attempts: 0,
    cancelRequested: false,
    reason: String(reason).slice(0, REASON_MAX_CHARS),
    reportRef: null,
    finishedAt: nowIso(),
  };
  fs.mkdirSync(path.dirname(runPath(dataDir, runId)), { recursive: true });
  saveRun(dataDir, run);
  return run;
}

// REQ-20260908-020 终止开发任务（人工，二次确认后调用）：
// - 停止派发后续项（abortRequested，next 一律 stop=aborted）；
// - 在途/排队运行落 interrupted 并注明人工终止（已认领条目的业务状态不动，由人工后续处理）；
// - 剩余未领取项落 skipped 出局账；impl 互斥全部释放（含 attention 占用）；批次转 finished + aborted 终止态。
// 在途子代理运行在主调度会话内，看板无法直接停止——notice 提示到对应会话人工停止。
export function abortBatch(dataDir, batchId) {
  const batch = getBatch(dataDir, batchId);
  if (batch.abortRequested) {
    return { ok: true, batchId, aborted: true, counts: batchState(dataDir, batch).counts, notice: '任务已终止（幂等返回）' };
  }
  const state = batchState(dataDir, batch);
  for (const r of state.runs) {
    if (FINAL_OR_SKIP(r.phase) || r.phase === 'interrupted') continue;
    r.phase = 'interrupted';
    r.reason = '人工终止任务';
    r.finishedAt = nowIso();
    saveRun(dataDir, r);
  }
  const handled = new Set(state.runs.filter((r) => FINAL_OR_SKIP(r.phase) || r.phase === 'interrupted').map((r) => r.itemId));
  for (const itemId of effectiveCandidates(dataDir, batch)) {
    if (handled.has(itemId)) continue;
    skipBatchRun(dataDir, batch, itemId, '任务终止，剩余项出局');
  }
  batch.abortRequested = true;
  batch.aborted = true;
  batch.currentRunId = null;
  batch.status = 'finished';
  saveBatch(dataDir, batch);
  releaseImplLockIf(dataDir, () => true);
  const counts = batchState(dataDir, batch).counts;
  return {
    ok: true,
    batchId,
    aborted: true,
    counts,
    notice: '任务已终止：停止派发后续项，剩余项已出局；在途子代理请在对应子代理会话人工停止',
  };
}

export function listRuns(dataDir, batchId, { offset = 0, limit = 20 } = {}) {
  const runs = batchRuns(dataDir, batchId);
  // REQ-20260908-026：attempt = 本批次内该条目的第几次执行（按创建时间正序计数，供记录「第 N 次」展示）
  const attemptByRun = new Map();
  const seenPerItem = new Map();
  for (const r of [...runs].reverse()) {
    seenPerItem.set(r.itemId, (seenPerItem.get(r.itemId) || 0) + 1);
    attemptByRun.set(r.runId, seenPerItem.get(r.itemId));
  }
  const records = runs.slice(offset, offset + limit).map((r) => ({
    runId: r.runId,
    itemId: r.itemId,
    // REQ-20260908-001：记录带条目标题（看板批次记录单号后展示）；条目已删除等读取失败回退空串
    title: itemTitleOrEmpty(dataDir, r.itemId),
    owner: r.owner,
    // REQ-20260908-020：skipped（终止出局）原样透出，其余非终态映射 in-flight
    result: FINAL_RUN_PHASES.has(r.phase) || r.phase === 'interrupted' || r.phase === 'skipped' ? r.phase : 'in-flight',
    reason: r.reason || null,
    reportRef: r.reportRef || null,
    at: r.finishedAt || r.createdAt,
    attempt: attemptByRun.get(r.runId) || 1,
  }));
  return { total: runs.length, records };
}

// 条目标题读取（容错）：与 server.mjs /api/batch/current 的 currentRun 同口径
function itemTitleOrEmpty(dataDir, itemId) {
  try {
    return readStatus(resolveItemDir(dataDir, itemId).dir).title || '';
  } catch {
    return '';
  }
}

// 批次摘要（新主会话续接 / 看板展示）：当前执行、计数、最近记录与提示词（候选实时口径）。
// 缺省解析队首（最早未结束账本），排队账本不被最新账本顶掉；
// 全部结束时回退最新账本（已结束面板 / 启动新一轮入口语义）。
export function batchSummary(dataDir, batchId = null) {
  const batch = batchId
    ? getBatch(dataDir, batchId)
    : (queueHeadBatch(dataDir) || latestBatch(dataDir));
  if (!batch) throw new AtbError('尚无进行中的任务：请先在看板启动');
  const state = batchState(dataDir, batch);
  const policies = readPolicies(dataDir);
  const blockedIds = effectiveCandidates(dataDir, batch)
    .filter((id) => (!state.finalByItem.has(id) || state.retryItems.has(id)) && depBlocked(dataDir, id, policies))
    .filter((id) => {
      try {
        return readStatus(resolveItemDir(dataDir, id).dir).status === 'planned';
      } catch {
        return false;
      }
    });
  const { records, total: recordsTotal } = listRuns(dataDir, batch.batchId, { offset: 0, limit: 5 });
  // REQ-20260908-026：待处理队列（按领取顺序，含重试标记条目）——面板仅展示最近 2 条
  const pending = effectiveCandidates(dataDir, batch)
    .filter((id) => !state.finalByItem.has(id) || state.retryItems.has(id))
    .map((id) => ({ id, title: itemTitleOrEmpty(dataDir, id) }));
  return {
    batch,
    currentRun: state.currentRun,
    counts: state.counts,
    blockedIds,
    records,
    recordsTotal, // REQ-20260908-026：完整账面数（展示上限仅为界面限制）
    pending,
    check: checkBatch(dataDir, batch.batchId),
  };
}

// REQ-20260910-003 全局看板：本轮执行简报（纯只读，REQ-20260913-003 起不透出批次号）。
// 计数与当前项与 /api/batch/current 面板同源（batchState 同一函数，实时候选口径）；
// 不调用 checkBatch（它可能改账本状态）、不写任何账本、不碰锁。
export function batchBrief(dataDir, batchOrId) {
  const b = typeof batchOrId === 'string' ? getBatch(dataDir, batchOrId) : batchOrId;
  const state = batchState(dataDir, b);
  const cur = state.currentRun;
  return {
    kind: 'develop',
    mode: b.mode,
    status: b.status,
    pauseRequested: Boolean(b.pauseRequested),
    abortRequested: Boolean(b.abortRequested),
    aborted: Boolean(b.aborted),
    // REQ-20260910-027：不再透出 developer（存量账本字段保留不迁移）
    createdAt: b.createdAt,
    lastActivityAt: b.lastActivityAt,
    current: cur
      ? { itemId: cur.itemId, title: itemTitleOrEmpty(dataDir, cur.itemId), owner: cur.owner, createdAt: cur.createdAt }
      : null,
    counts: { ...state.counts },
  };
}

