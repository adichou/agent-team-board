// REQ-20260907-003 需求完善 —— 批量补全文档数据层（refine-store）。
// REQ-20260908-020：候选口径从「待接受（submitted）且文档不全」切换为「已接受（accepted）且未完善」，
// 每轮领取实时读取全部已接受单（新接受的单自动进入本轮候选）；仅子代理模式（执行 Agent = zcode | codex），
// 双 Agent 提示词差异化；单级完善三态（未完善/完善中/已完善）落 refine/states.json（执行账本，不进状态机）。
// 与实施账本（dispatch/）、咨询账本（oncall/）完全隔离：不进 REQ/BUG 状态机、不占 impl.lock，
// 条目全程保持 accepted；Agent 只编辑条目目录 markdown，不写业务源码、不调用 claim/report。
// 事实源：<dataDir>/refine/{settings.json, states.json, batches/RFB-YYYYMMDD-NNN/batch.json, runs/<runId>/run.json}
// 全部 JSON 原子写入；候选快照（缺失原因 + 文档指纹基线）按项冻结用于并发/状态保护；
// 文档基线在领取时点重冻结（BUG-20260908-011），仅用于 done 回执「文档确有变更」核验。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  AtbError,
  acquireLock,
  releaseLock,
  resolveItemDir,
  readStatus,
  setStatus,
  writeJsonAtomic,
  listItems,
  orderedDocs,
  actor,
  localDateStamp,
} from './core.mjs';
// REQ-20260910-027：开发人员设置已移除——normalizeDeveloper import 删除；
// developer 入参在 createRefineBatch / buildRefinePrompt 保留但忽略（兼容旧调用）。
import {
  FOLLOW_SESSION_PROMPT_LINE,
  REFINE_BUG_DOC_LINES,
  REFINE_DEMO_PERMIT_LINE,
  REFINE_SCHEDULER_AUTO_PLAN_LINES,
  REFINE_SCHEDULER_KEEP_ACCEPTED_LINE,
  REFINE_UI_DEMO_QUALITY,
  REFINE_WORKER_AUTO_PLAN_LINES,
  REFINE_WORKER_KEEP_ACCEPTED_LINE,
  autoPlanAfterRefineDone,
  loadTaskSettings,
  normalizePromptForDisplay,
} from './task-settings.mjs';
import { readRefineStates, setRefineItemState } from './refine-states.mjs';

export const REASON_MAX_CHARS = 200;   // fail reason / done summary 上限（与批次回执口径一致）
export const RECEIPT_MAX_BYTES = 2048; // 回执/check 协议载荷上限
// REQ-20260909-011：通用子代理模式标识 subagent（新建任务缺省）；zcode / codex 为存量值，
// 直连显式传入仍合法（存量语义兼容）。提示词已通用化，不再按 Agent 差异化。
export const REFINE_MODES = ['zcode', 'codex', 'subagent'];
export const REFINE_SUBAGENT_MODE = 'subagent';

export const REFINE_BATCH_STATUSES = ['prepared', 'running', 'paused', 'finished'];
export const FINAL_REFINE_PHASES = new Set(['done', 'failed', 'skipped', 'interrupted']);
export const REFINE_RESULT_LABEL = {
  done: '已完成', failed: '失败', skipped: '已出局', interrupted: '已释放',
  'in-flight': '进行中', queued: '排队中', reserved: '进行中', running: '进行中',
};

const REFINE_ID_LOCK_STALE_MS = 30_000;
// REQ-20260908-025：指纹算法版本注册表——口径演进史与旧版本重算依据的唯一事实源。
// ── 升级登记纪律（调整指纹口径必须遵守）：
// 1) 调整参与指纹的文件集（原 DOC_FILES 演进）或哈希构造时，在下方**追加**新版本条目，
//    不得修改/删除既有条目（旧版本重算能力依赖其原始定义）；
// 2) 同步 bump FINGERPRINT_VERSION 指向新条目；
// 3) 在对应看板条目的 design.md 登记演进原因（书面策略副本见 REQ-20260908-025/design.md）。
// ── 旧版本条目的废弃时机：仅当确认不再有任何未结束批次或在途运行可能携带该版本基线
// （含无前缀裸哈希——裸哈希兼容按全部已知口径逐一重算）时方可删除；实践口径：至少保留
// 最近两个版本，且删除历史口径属破坏存量基线可比性的变更，需人工确认。
// v1：三文档口径（REQ-20260908-021 之前的历史口径；上线时无版本前缀，以裸 40 位 sha1 落盘）。
// v2：REQ-20260908-021 起纳入演示文件 ui-demo.html 的四文件口径（v2 起 fingerprint 带 v2: 前缀）。
const FINGERPRINT_VERSIONS = [
  { version: 1, files: ['README.md', 'design.md', 'test-cases.md'] },
  { version: 2, files: ['README.md', 'design.md', 'test-cases.md', 'ui-demo.html'] },
];
export const FINGERPRINT_VERSION = 2;
const UI_DEMO_FILE = 'ui-demo.html';
// REQ-20260908-021：演示文件质量门槛（提示词口径，双 Agent 提示词与 README/指引共用同一表述）
// BUG-20260910-011：文案收敛到 task-settings（REFINE_UI_DEMO_QUALITY），生成层与展示归一层共用唯一事实源
const UI_DEMO_QUALITY = REFINE_UI_DEMO_QUALITY;

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB_PATH = path.join(pluginRoot, 'scripts', 'atb.mjs');

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const nowIso = () => new Date().toISOString();

export function refineDir(dataDir) {
  return path.join(dataDir, 'refine');
}
export function refineBatchesDir(dataDir) {
  return path.join(refineDir(dataDir), 'batches');
}
export function refineRunsDir(dataDir) {
  return path.join(refineDir(dataDir), 'runs');
}
export function refineRunDir(dataDir, runId) {
  if (!/^run-\d{8}-\d{6}-[0-9a-f]{4,}$/.test(String(runId))) throw new AtbError(`非法 runId：${runId}`);
  return path.join(refineRunsDir(dataDir), runId);
}
function refineBatchPath(dataDir, batchId) {
  if (!/^RFB-\d{8}-\d{3,}$/.test(String(batchId))) throw new AtbError(`非法完善批次号：${batchId}`);
  return path.join(refineBatchesDir(dataDir), batchId, 'batch.json');
}

// 幂等初始化：目录 + 计数器 + .gitignore（执行账本不进版本控制）
export function ensureRefine(dataDir) {
  fs.mkdirSync(refineBatchesDir(dataDir), { recursive: true });
  fs.mkdirSync(refineRunsDir(dataDir), { recursive: true });
  const settingsPath = path.join(refineDir(dataDir), 'settings.json');
  if (!readJson(settingsPath)) {
    writeJsonAtomic(settingsPath, { version: 1, counters: { batch: 0, run: 0 } });
  }
  const gi = path.join(dataDir, '.gitignore');
  const wanted = ['refine/runs/', 'refine/batches/', 'refine/states.json'];
  let cur = '';
  try { cur = fs.readFileSync(gi, 'utf8'); } catch {}
  const add = wanted.filter((l) => !cur.split('\n').includes(l));
  if (add.length) fs.writeFileSync(gi, cur.replace(/\n*$/, '\n') + add.join('\n') + '\n');
}

function nextRefineId(dataDir, kind) {
  const lockPath = path.join(dataDir, '.locks', 'refine-id.lock');
  acquireLock(lockPath, REFINE_ID_LOCK_STALE_MS, { pid: process.pid, at: nowIso() });
  try {
    ensureRefine(dataDir);
    const settingsPath = path.join(refineDir(dataDir), 'settings.json');
    const cfg = readJson(settingsPath) || { version: 1, counters: {} };
    cfg.counters[kind] = (cfg.counters[kind] || 0) + 1;
    writeJsonAtomic(settingsPath, cfg);
    return { seq: cfg.counters[kind], id: `${kind === 'batch' ? 'RFB' : 'run'}-${localDateStamp()}-${String(cfg.counters[kind]).padStart(3, '0')}` };
  } finally {
    releaseLock(lockPath);
  }
}

// ---------- 完整性分析（启发式，保守报告关键缺失） ----------

// 按 '## ' 标题切节；返回 { heading → 正文行[] }
function sectionsOf(text) {
  const out = {};
  let cur = '__head__';
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) {
      cur = m[1].trim();
      out[cur] = [];
    } else {
      (out[cur] = out[cur] || []).push(line);
    }
  }
  return out;
}

function findSection(sections, prefix) {
  const key = Object.keys(sections).find((k) => k.startsWith(prefix));
  return key != null ? sections[key] : undefined; // undefined=节缺失；[]=节存在但为空
}

// 节正文剥空行与「（待补充）」占位后是否有实质内容；bareNumbering 兼容仅编号占位
function bodyMeaningful(lines, { bareNumbering = false } = {}) {
  for (const raw of lines || []) {
    let s = raw.trim();
    if (!s) continue;
    s = s.replace(/^-\s*\[[ xX]?\]\s*/, ''); // 剥离开头复选框（- [ ] / - [x]）
    if (/^[（(]?待补充[)）]?$/.test(s)) continue;
    if (bareNumbering && /^\d+[.、)]?\s*$/.test(s)) continue;
    return true;
  }
  return false;
}

// UI 关键词词表（REQ-20260908-015，design.md 定案并固化为 refine-store 测试断言）：
// 用于「描述节命中且 README 无界面展示节」的启发式判定；「UI」按大写原样匹配，
// 避免小写 ui 命中英文单词子串（require/build/guide 等）造成误判。
// BUG-20260910-011：增补「边框」（BUG-20260910-010 实测漏报词，与 按钮/输入框 同级的界面词）。
const UI_KEYWORDS = ['界面', 'UI', '页面', '弹窗', '面板', '按钮', '输入框', '布局', '拖拽', '抽屉', '顶栏', '边框'];

// REQ-20260908-021：ui-demo.html 状态——missing=缺失；placeholder=空/仅注释占位；ok=有实质内容
function uiDemoState(dir) {
  let raw = null;
  try { raw = fs.readFileSync(path.join(dir, UI_DEMO_FILE), 'utf8'); } catch { return 'missing'; }
  const stripped = raw.replace(/<!--[\s\S]*?-->/g, '').trim();
  return stripped ? 'ok' : 'placeholder';
}

// BUG-20260908-017：UI 演示检查收敛为需求 / Bug 共用（判定分层与缺失原因文案同需求侧 REQ-20260908-021）：
// 1) 启发式：探测文本（需求=描述节；Bug=现象+期望行为节）命中 UI 关键词且无「界面展示」节 → 涉及 UI 需界面展示；
// 2) 存在性：节已存在但正文剥空行/「（待补充）」占位后为空 → 界面展示待补充；
// 3) 演示三查（节有实质内容且未声明「不涉及界面改动」时）：
//    缺 ui-demo.html → 涉及 UI 缺 ui-demo.html 演示；文件空/仅注释占位 → ui-demo.html 演示待补充；
//    节正文未链接 ./ui-demo.html → 界面展示节未链接 ./ui-demo.html（ASCII 线框降为可选补充）。
//    兜底：节内写明「不涉及界面改动」即视为有效内容，不做演示三查（启发式误判保护，沿用 015）。
function uiDemoReasons(secs, probeText, dir) {
  const reasons = [];
  const demo = findSection(secs, '界面展示');
  const demoText = demo === undefined ? '' : demo.join('');
  const isUiItem = UI_KEYWORDS.some((k) => probeText.includes(k))
    || demoText.includes(UI_DEMO_FILE); // 节内自行链接演示文件亦视为 UI 单
  const declaredNonUi = demo !== undefined && demoText.includes('不涉及界面改动');
  if (demo === undefined) {
    if (UI_KEYWORDS.some((k) => probeText.includes(k))) reasons.push('涉及 UI 需界面展示');
  } else if (!bodyMeaningful(demo)) {
    reasons.push('界面展示待补充');
  } else if (isUiItem && !declaredNonUi) {
    const st = uiDemoState(dir);
    if (st === 'missing') reasons.push('涉及 UI 缺 ui-demo.html 演示');
    else if (st === 'placeholder') reasons.push('ui-demo.html 演示待补充');
    else if (!demoText.includes(UI_DEMO_FILE)) reasons.push('界面展示节未链接 ./ui-demo.html');
  }
  return reasons;
}

// BUG-20260910-011：UI 探测文本统一取数——analyzeItemDocs 与 done 回执核验（finishRefineRun 的
// UI 演示三查门槛）共用同一口径，保证「已完善」标记与完整性判定一致。
// 需求 = 描述节正文（口径不变）；Bug = README 一级标题行（条目标题）+ 现象 + 期望行为——标题纳入：
// 登记未带 --desc 时现象/期望为「（待补充）」占位文本，标题中的 UI 关键词（如「操作按钮」）
// 此前不参与探测导致领取漏报（BUG-20260910-011 成因 3）。
function h1TitleOf(secs) {
  return (secs['__head__'] || []).filter((l) => /^#\s+\S/.test(l.trim())).join('');
}
function uiProbeOf(secs, type) {
  if (type === 'requirement') {
    const desc = findSection(secs, '描述');
    return desc === undefined ? '' : desc.join('');
  }
  const phen = findSection(secs, '现象');
  const want = findSection(secs, '期望');
  return h1TitleOf(secs) + [phen, want].map((s) => (s === undefined ? '' : s.join(''))).join('');
}

// BUG-20260910-011：done 回执完整性门槛（范围：UI 演示三查，design.md 定案 1）——只重跑 UI 演示
// 三查而非全量 analyzeItemDocs：节齐备/说明不过简等内容质量启发式历史回执口径从未以其为门槛，
// 存量「短说明即 done」合法形态大量存在；UI 演示是可机械判定的硬性产物（文件存在性/占位/链接）。
// README 读取失败返回空数组（README 缺失由候选/领取口径先行暴露，回执另有指纹「真实变更」门槛）。
export function uiDemoGateReasons(dir, type) {
  let readme = null;
  try { readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8'); } catch { return []; }
  const secs = sectionsOf(readme);
  return uiDemoReasons(secs, uiProbeOf(secs, type), dir);
}

export function analyzeItemDocs(dir, type) {
  const reasons = [];
  const readme = (() => {
    try { return fs.readFileSync(path.join(dir, 'README.md'), 'utf8'); } catch { return null; }
  })();
  if (readme == null) {
    reasons.push('README 缺失');
  } else {
    const secs = sectionsOf(readme);
    const desc = findSection(secs, '描述');
    if (desc !== undefined && !bodyMeaningful(desc)) reasons.push('README 描述待补充');
    if (type === 'requirement') {
      const acc = findSection(secs, '验收标准');
      if (acc === undefined) reasons.push('缺验收标准');
      else if (!bodyMeaningful(acc, { bareNumbering: true })) reasons.push('验收标准待补充');
      // REQ-20260908-015：完善判定收敛到 README——design/test-cases 属开发阶段文档，不再产生缺失原因。
      // REQ-20260908-021：涉及 UI 的需求，界面展示须为条目目录内可交互 html 演示（详见 uiDemoReasons 注释）。
      reasons.push(...uiDemoReasons(secs, uiProbeOf(secs, 'requirement'), dir));
    } else {
      const phen = findSection(secs, '现象');
      if (phen === undefined || !bodyMeaningful(phen)) reasons.push('缺现象说明');
      const repro = findSection(secs, '复现');
      if (repro === undefined || !bodyMeaningful(repro, { bareNumbering: true })) reasons.push('缺复现步骤');
      const want = findSection(secs, '期望');
      if (want === undefined || !bodyMeaningful(want)) reasons.push('缺期望结果');
      const acc = findSection(secs, '验收');
      if (acc === undefined || !bodyMeaningful(acc)) reasons.push('缺验收说明');
      // BUG-20260908-017：涉及 UI 的 Bug 与需求同等对待——以 标题+现象+期望行为 节为启发式探测文本
      //（BUG-20260910-011：探测文本纳入 README 一级标题行，见 uiProbeOf 注释），界面展示节 +
      // ui-demo.html 演示三查同需求侧口径（演示内容建议对照缺陷现象与期望修复后状态，见提示词）；
      // 不涉及 UI 的 Bug 不受影响。
      reasons.push(...uiDemoReasons(secs, uiProbeOf(secs, 'bug'), dir));
    }
    // 说明过简：描述 + 验收（Bug 为现象/复现/期望/验收）实质内容合计 <30 字
    const bodyKeys = Object.keys(secs).filter((k) =>
      type === 'requirement' ? (k.startsWith('描述') || k.startsWith('验收标准')) : true);
    const totalLen = bodyKeys.reduce((n, k) => n + (secs[k] || []).join('').replace(/\s/g, '').replace(/[（(]?待补充[)）]?/g, '').length, 0);
    if (totalLen < 30) reasons.push('README 说明过简');
  }
  return { complete: reasons.length === 0, reasons };
}

// 文档指纹：参与文件内容 sha1（缺失记 <missing>），参与文件集与哈希构造由
// FINGERPRINT_VERSIONS 注册表按版本定义（演进纪律见注册表注释）。
// REQ-20260908-015：完整性判定虽收敛到 README，指纹仍覆盖三文档——worker 只改 README 时必然变化，
// 同时避免「只改 design/test-cases 也记完成」的记账歧义。
// REQ-20260908-021：纳入约定的演示文件 ui-demo.html（存在时计入）——只补交互演示的 done 回执同样可记账。
// REQ-20260908-025：指纹自带算法版本，返回 `v<N>:<40hex>`——四处冻结点（创建/吸收/重排队/领取）
// 均经本函数落盘，基线随冻结时点携带算法版本；比对一律走 docsUnchangedSince（按基线版本口径重算）。
function hashFiles(dir, files) {
  const h = crypto.createHash('sha1');
  for (const name of files) {
    let content = null;
    try { content = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { /* 缺失 */ }
    h.update(name);
    h.update('\u0000');
    h.update(content == null ? '<missing>' : content);
    h.update('\u0001');
  }
  return h.digest('hex');
}

// 按指定版本口径重算当前文档指纹（裸哈希）；未登记版本抛错（注册表外无重算依据）
export function docsFingerprintAt(dir, version) {
  const spec = FINGERPRINT_VERSIONS.find((v) => v.version === Number(version));
  if (!spec) throw new AtbError(`未知指纹算法版本：v${version}`);
  return hashFiles(dir, spec.files);
}

export function docsFingerprint(dir) {
  return `v${FINGERPRINT_VERSION}:${docsFingerprintAt(dir, FINGERPRINT_VERSION)}`;
}

// REQ-20260908-025 基线比对助手（三处比对点统一入口：finishRefineRun done 核验、
// server codex precheck/settle）——「当前文档相对基线是否未被编辑」：
// - 基线带版本前缀 v<N>: → 按该版本口径重算比对（算法演进后旧版本基线仍可比对，不再误报）；
// - 存量裸 40 位 sha1（版本化上线前冻结）→ 无版本标识、无法区分冻结时口径：按全部已知口径
//   逐一重算，任一匹配即视为未编辑（只对「未编辑」方向放宽；真编辑在任一口径下都不再等于
//   旧哈希，sha1 碰撞忽略）——发布本身不使存量在途批次新增误报出局；
// - 带版本前缀但版本未登记（代码回退读到新基线的异常场景）→ 视为已变更：宁可出局/拒绝，
//   不在无法重算的口径下静默通过「文档确有变更」核验（atb serve 版本检测重启后自愈）；
// - 其他非法形态（null/非哈希串）→ 视为已变更（与旧逻辑「重算≠基线」方向一致）。
export function docsUnchangedSince(dir, baseline) {
  const raw = String(baseline ?? '');
  const m = /^v(\d+):([0-9a-f]{40})$/.exec(raw);
  if (m) {
    const spec = FINGERPRINT_VERSIONS.find((v) => v.version === Number(m[1]));
    return spec ? hashFiles(dir, spec.files) === m[2] : false;
  }
  if (/^[0-9a-f]{40}$/.test(raw)) {
    return FINGERPRINT_VERSIONS.some((v) => hashFiles(dir, v.files) === raw);
  }
  return false;
}

// 候选（REQ-20260908-020）：已接受（accepted）且完善状态 ≠ 已完善；
// 完整性启发式保留用于展示缺失原因（不再过滤候选）；req 优先 → 创建早 → 编号（与实施候选同序口径）
export function refineCandidates(dataDir) {
  const rank = { requirement: 0, bug: 1 };
  const states = readRefineStates(dataDir);
  return listItems(dataDir)
    .filter((x) => x.status === 'accepted')
    .filter((x) => !states[x.id] || states[x.id].state !== 'refined')
    .map((x) => {
      let dir = null;
      try { dir = resolveItemDir(dataDir, x.id).dir; } catch { return null; }
      const a = analyzeItemDocs(dir, x.type);
      return { id: x.id, type: x.type, title: x.title, createdAt: x.createdAt, reasons: a.reasons };
    })
    .filter(Boolean)
    .sort((a, b) =>
      (rank[a.type] - rank[b.type]) ||
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
      String(a.id).localeCompare(String(b.id)));
}

// ---------- 批次账本 ----------

export function getRefineBatch(dataDir, batchId) {
  const b = readJson(refineBatchPath(dataDir, batchId));
  if (!b || b.batchId !== batchId) throw new AtbError(`找不到完善批次：${batchId}`);
  return b;
}

function saveRefineBatch(dataDir, batch) {
  batch.lastActivityAt = nowIso();
  writeJsonAtomic(refineBatchPath(dataDir, batch.batchId), batch);
}

export function listRefineBatches(dataDir) {
  const dir = refineBatchesDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((n) => readJson(path.join(dir, n, 'batch.json')))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function unfinishedRefineBatches(dataDir) {
  return listRefineBatches(dataDir)
    .filter((b) => b.status !== 'finished')
    .sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
      String(a.batchId).localeCompare(String(b.batchId)));
}

// 缺省解析目标：最早未结束批次；全部结束回退最新（面板「已结束/创建下一批」语义）
export function queueHeadRefineBatch(dataDir) {
  return unfinishedRefineBatches(dataDir)[0] || listRefineBatches(dataDir)[0] || null;
}

// 主调度提示词（REQ-20260909-011 通用化：单一版本，不再按执行 Agent 分叉——同一份提示词可在
// 任意一种 Agent 会话中直接粘贴执行；调度要素与既有口径完整保留）。
// REQ-20260913-003 去批次化：不含批次号/--batch 核对入口/排队接续，含实时取单指令
// （每完成一项实时从已接受未完善队列领取下一项，队列取空即本轮结束）。
// REQ-20260909-005：modelSource='follow'（默认）→ 注入「与主调度会话保持一致」指令。
// BUG-20260909-017：模型指令行统一跟随口径——manual 或仅传 model/level（兼容旧调用）同样注入
// FOLLOW_SESSION_PROMPT_LINE；均未传 → 不注入（直连调用不变）。agent 参数保留但忽略（兼容旧调用签名）。
// BUG-20260910-008：autoPlan（「完善完成后自动转入计划」开关，默认 false）分态约束段——关闭沿
// REQ-20260908-020 原约束行（零回归）；开启时说明 done 回执后系统自动 accepted → planned 属预期
// 系统行为、不得据此暂停（防严格 Agent 把系统流转当约束违反而中断推进），Agent 纪律不放宽。
export function buildRefinePrompt({ projectRoot, batchId = null, developer = null, agent = null, modelSource = null, model = null, level = null, autoPlan = false, atbPath = ATB_PATH }) {
  void batchId; // REQ-20260913-003：调度不依赖批次标识，参数仅作兼容
  void agent; // REQ-20260909-011：执行端无关，参数仅作兼容
  void developer; // REQ-20260910-027：开发人员已移除，参数仅作兼容（不再生成会话命名指令）
  const modelLine = modelSource === 'follow' || modelSource === 'manual' || model || level
    ? FOLLOW_SESSION_PROMPT_LINE
    : null;
  // REQ-20260909-011：领取前缀固定单一通用前缀（不再 zcode-refine / codex-refine 二选一；
  // 前缀仅为会话标识字符串，不影响锁与账本语义）
  const byPrefix = 'refine';
  const constraintLines = autoPlan ? REFINE_SCHEDULER_AUTO_PLAN_LINES : [REFINE_SCHEDULER_KEEP_ACCEPTED_LINE];
  return [
    '你是当前项目的 AI 分析调度员，只负责派发与接收短回执。',
    `项目：${projectRoot}`,
    ...(modelLine ? [modelLine] : []),
    '',
    '在当前项目的 Agent 会话中执行本提示词：每轮新启动一个子代理，按执行流程完善当前队列中最早的一个已接受条目的文档。',
    '实时取单：每完成一项，立即核对并从当前已接受未完善队列（需求优先、最旧优先）领取下一项；运行中新接受的单立即可领取，无需任何并入操作；实时队列取空即本轮结束。',
    '子代理会话命名统一为：<条目编号>（与主调度会话区分）。',
    '每个子代理只做一项；同一时间只运行一个；不要让子代理再派发子代理。',
    '',
    `CLI 约定：atb 指 node ${atbPath}（下同）。`,
    '',
    '子代理流程（每项一个）：',
    `1. 领取：atb refine next --by ${byPrefix}-<序号> --dir ${JSON.stringify(projectRoot)}`,
    '   （返回条目、目录、缺失原因；stop 时按提示结束）',
    '   领取/回执命令在子代理会话内执行（工作目录用 --dir 指定）。',
    '2. 阅读条目现有说明与项目代码/文档，直接编辑条目目录下的 markdown 补全：',
    '   需求只补 README：描述 + 验收标准；涉及 UI 时须含界面布局、交互行为、状态反馈与界面展示——',
    `   界面展示节保留布局/交互/状态反馈的文字说明并链接 ./${UI_DEMO_FILE}，同时在条目目录创建 ${UI_DEMO_FILE}`,
    `   可交互演示：${UI_DEMO_QUALITY}；`,
    // BUG-20260910-011：Bug 分支四行收敛为 task-settings 常量（与展示归一层共用唯一事实源）
    ...REFINE_BUG_DOC_LINES,
    '   项目里查不到的事实一律写「待确认」，不要编造。',
    '3. 回执：atb refine done <RUN-ID> --summary "<补全要点>"（须真实改过文档）；',
    '   无法完善用 atb refine fail <RUN-ID> --reason "<短句>"；认领冲突用 atb refine release。',
    '',
    ...constraintLines,
    REFINE_DEMO_PERMIT_LINE,
    `4. 主会话核对：atb refine check --dir ${JSON.stringify(projectRoot)}`,
    '   nextAction=continue 时派发下一个子代理；stop 时结束。主会话只接收规定的短回执，不复制子代理的完整文档内容。',
  ].join('\n');
}

// codex 单项提示词：条目目录行供测试夹具与运行核验解析，保持稳定形态
// BUG-20260910-008：autoPlan 分态第 3 条约束——关闭沿原句（零回归）；开启说明核验记账后系统自动
// accepted → planned 属预期、不得据此暂停，你自身仍不得改状态（纪律不放宽，文案常量见 task-settings）。
export function buildRefineWorkerPrompt({ item, projectRoot, atbPath = ATB_PATH, runId, autoPlan = false }) {
  const constraintLines = autoPlan ? REFINE_WORKER_AUTO_PLAN_LINES : [REFINE_WORKER_KEEP_ACCEPTED_LINE];
  return [
    `请将当前会话名改为 ${item.id}。`,
    `你是本项目的需求完善执行者，补全看板条目 ${item.id}：${item.title} 的文档。`,
    `项目根：${projectRoot}（codex 已以 -C 指定工作目录，请勿切换目录）。执行编号：${runId}。`,
    `条目目录：${item.itemDir}`,
    `缺失原因：${(item.reasons || []).join('、')}`,
    '',
    '要求：',
    '1. 阅读条目目录下现有 markdown 与项目代码/文档，直接编辑条目目录内文件补全：',
    '   需求只补 README：描述 + 验收标准；涉及 UI 时须含界面布局、交互行为、状态反馈与界面展示——',
    `   界面展示节保留布局/交互/状态反馈的文字说明并链接 ./${UI_DEMO_FILE}，同时在条目目录创建 ${UI_DEMO_FILE}`,
    `   可交互演示：${UI_DEMO_QUALITY}；`,
    // BUG-20260910-011：Bug 分支前三行与主调度提示词共用常量；末行句读差异（。/；）保留 worker 原形态
    ...REFINE_BUG_DOC_LINES.slice(0, 3),
    '   演示建议对照展示缺陷现象与期望修复后状态（如通过状态切换/开关对比）。',
    '2. 项目里查不到的事实一律写「待确认」，不要编造。',
    ...constraintLines,
    `   不要写 test-report.md、不要 git commit；只编辑条目目录下的 markdown（涉及 UI 的需求或 Bug 可另建约定的 ${UI_DEMO_FILE}）。`,
    `4. 完成后把补全要点（一两句话）作为最终回复直接输出（服务会核验文档确有变更后记账）。`,
    `   CLI 入口（可选核对）：node ${JSON.stringify(atbPath)} refine check --dir ${JSON.stringify(projectRoot)}`,
  ].join('\n');
}

// ---------- 完善批次创建 ----------

// BUG-20260910-008：「完善完成后自动转入计划」开关的实时读取（生成层 createRefineBatch /
// newCodexRefineRun 冻结提示词与展示层 refineSummary/publicView 归一共用）。展示/回显按**实时**
// 开关分态（design.md 结论）：自动流转发生在 done 回执时点、按当时设置生效——展示文案与之一致才
// 能防严格 Agent 把 accepted → planned 误判为约束被违反；设置读取异常按默认关闭（与
// autoPlanRefinedItem 的 settings-read-failed 口径一致）。
export function refineAutoPlanOn(dataDir) {
  try {
    return autoPlanAfterRefineDone(loadTaskSettings(dataDir));
  } catch {
    return false;
  }
}

// 启动一轮批量完善（REQ-20260913-003 去批次化）：不再冻结候选快照、不再排队——
// - 账本 candidates 置空（显式 ids 仅作队首种子，供终态任务单条目重建路径），每次领取实时读取
//   当前已接受未完善队列（见 effectiveRefineCandidates / nextRefineItem）；基线指纹沿用
//   「领取时冻结」口径（BUG-20260908-011：创建/吸收到领取之间的人工编辑不作为出局门槛）；
// - 同一项目同一时间只有一轮完善执行：创建前盘点未结束账本，空转（无在途运行且无剩余）账本
//   就地收尾后仍存在未结束账本 → 抛「已有进行中的完善任务」，不产生排队对象；
// - 启动行为保持「复制调度提示词，登记运行后才算执行中」口径。
// REQ-20260909-011 通用子代理模式：mode/agent 缺省记 subagent；显式传 zcode / codex 仍合法。
// REQ-20260909-005：modelSource（follow | manual）来自调用方；follow 时忽略 model/level。
export function createRefineBatch(dataDir, { ids = null, mode = REFINE_SUBAGENT_MODE, agent = null, developer = null, projectRoot, modelSource = null, model = null, level = null } = {}) {
  if (!REFINE_MODES.includes(mode)) throw new AtbError(`mode 必须是 ${REFINE_MODES.join(' | ')}，得到：${mode}`);
  const execAgent = REFINE_MODES.includes(agent) ? agent : mode; // agent 显式指定优先（兼容只传 mode 的旧调用）
  ensureRefine(dataDir);
  void developer; // REQ-20260910-027：开发人员设置已移除，入参保留但忽略（不再校验/落账）
  const scoped = ids != null;
  if (scoped && !Array.isArray(ids)) throw new AtbError('ids 必须是编号数组');

  // 队列盘点（REQ-20260913-003：先于候选检查——已有进行中的一轮时，即便当前无新增候选
  // 也必须以「重复启动」拒绝，不得误报「没有可完善候选」）：收尾无在途运行且无剩余（实时口径）
  // 的空账本就地 finished，防旧空转轮卡住启动；其余未结束账本即进行中的一轮——
  // 拒绝重复启动（不排队、不新建对象）。
  for (const b of unfinishedRefineBatches(dataDir)) {
    const st = refineBatchState(dataDir, b);
    const active = st.currentRun && !FINAL_REFINE_PHASES.has(st.currentRun.phase);
    if (!active && st.counts.remaining === 0) {
      if (b.status !== 'finished') {
        b.status = 'finished';
        saveRefineBatch(dataDir, b);
      }
      continue;
    }
    throw new AtbError(
      `已有进行中的完善任务（${b.status === 'prepared' ? '待启动' : '执行中'}）：同一时间只有一轮执行，无需重复启动；` +
      '如需重开请先完成、恢复或终止当前任务',
    );
  }

  let base = refineCandidates(dataDir);
  if (scoped) {
    const want = new Set(ids.filter((x) => typeof x === 'string'));
    base = base.filter((x) => want.has(x.id));
    if (!base.length) {
      throw new AtbError('勾选的条目均不可完善：可能已完善或不在已接受状态，请重新勾选');
    }
  }
  if (!base.length) throw new AtbError('没有可完善候选：已接受条目均已完善（或尚无已接受条目）');

  const { id: batchId } = nextRefineId(dataDir, 'batch');
  // REQ-20260913-003：不再冻结候选——缺省 seed 为空（领取时实时读取已接受未完善队列），
  // 仅显式 ids（终态任务单条目重建）作为队首种子落账（带基线/缺失原因快照）。
  const seed = scoped ? base.map((x) => {
    const dir = resolveItemDir(dataDir, x.id).dir;
    return { id: x.id, type: x.type, title: x.title, reasons: [...x.reasons], baseline: docsFingerprint(dir) };
  }) : [];
  const batch = {
    version: 1,
    batchId,
    kind: 'refine',
    mode,
    agent: execAgent, // REQ-20260908-020：执行 Agent（子代理模式双 Agent 差异化提示词的依据）
    projectRoot,
    // REQ-20260910-027：developer 字段不再写（存量账本保留不迁移，读取侧不透出）
    createdAt: nowIso(),
    lastActivityAt: nowIso(),
    status: 'prepared',
    pauseRequested: false,
    abortRequested: false,
    currentRunId: null,
    candidates: seed,
    // BUG-20260910-008：创建时按当前开关分态冻结提示词（关闭=原口径零回归；开启=附系统流转说明，
    // 防止 Agent 把 done 后系统 accepted → planned 误判为约束违反而暂停推进）
    prompt: buildRefinePrompt({ projectRoot, agent: execAgent, modelSource: modelSource === 'follow' ? 'follow' : (modelSource === 'manual' ? 'manual' : null), model: modelSource === 'follow' ? null : model, level: modelSource === 'follow' ? null : level, autoPlan: refineAutoPlanOn(dataDir) }),
  };
  fs.mkdirSync(path.dirname(refineBatchPath(dataDir, batchId)), { recursive: true });
  saveRefineBatch(dataDir, batch);
  return { batch, created: true };
}

// ---------- 运行账本 ----------

function newRunId(dataDir) {
  // 计数序列只用于落盘目录名唯一；展示形态与 oncall 执行一致 run-<date>-<time>-<rand>
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  const rand = crypto.randomBytes(2).toString('hex');
  return `run-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${rand}`;
}

export function getRefineRun(dataDir, runId) {
  const r = readJson(path.join(refineRunDir(dataDir, runId), 'run.json'));
  if (!r || r.runId !== runId) throw new AtbError(`找不到完善执行：${runId}`);
  return r;
}

function saveRefineRun(dataDir, run) {
  run.updatedAt = nowIso();
  writeJsonAtomic(path.join(refineRunDir(dataDir, run.runId), 'run.json'), run);
}

function newRefineRun(dataDir, { batchId, item, owner, mode = 'zcode', phase = 'reserved', prompt = null, executor = null }) {
  ensureRefine(dataDir);
  const runId = newRunId(dataDir);
  const run = {
    version: 1,
    runId,
    batchId,
    itemId: item.id,
    owner: owner || actor(),
    mode,
    phase,
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    threadId: null,
    reason: null,
    summary: null,
    attempts: [],
  };
  // REQ-20260908-014：领取时快照条目标题，供回执/记录在主调度会话直接显示单号+标题
  if (item.title != null) run.itemTitle = item.title;
  if (prompt) run.prompt = prompt;
  if (executor) run.executor = executor;
  fs.mkdirSync(refineRunDir(dataDir, runId), { recursive: true });
  saveRefineRun(dataDir, run);
  return run;
}

export function updateRefineRun(dataDir, runId, patch) {
  const cur = getRefineRun(dataDir, runId);
  const next = { ...cur, ...patch, runId, updatedAt: nowIso() };
  saveRefineRun(dataDir, next);
  return next;
}

function refineRunsOfBatch(dataDir, batchId) {
  const dir = refineRunsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((n) => readJson(path.join(dir, n, 'run.json')))
    .filter((r) => r && r.batchId === batchId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// 批次动态状态：终态映射（每条目首个终态）、在途集合、计数、当前运行
// BUG-20260908-010：新增 reacceptable——终态回执后被人工「驳回再接受 / 移出计划回已接受」
// （完善状态被 core.mjs 进入 accepted 钩子重置为「未完善」）的条目集合；计数上不计入
// done/failed/skipped/interrupted 而计入 remaining（total = 四类终态 + remaining 恒等式保持）。
function refineBatchState(dataDir, batch) {
  const runs = refineRunsOfBatch(dataDir, batch.batchId);
  const finalByItem = new Map();
  const activeByItem = new Set();
  for (const r of runs) {
    if (FINAL_REFINE_PHASES.has(r.phase)) {
      if (!finalByItem.has(r.itemId)) finalByItem.set(r.itemId, r);
    } else {
      activeByItem.add(r.itemId);
    }
  }
  const reacceptable = new Set();
  for (const id of finalByItem.keys()) {
    if (reacceptedForRerun(dataDir, id)) reacceptable.add(id);
  }
  // REQ-20260908-026：retryItems 标记「异常记录已重新执行」——条目回到待处理（队尾），
  // 不占终态计数；下一轮 next 重新领取产生新执行尝试（保留原记录与失败原因）。
  const retryItems = new Set(Object.keys(batch.retryItems || {}));
  let currentRun = null;
  if (batch.currentRunId) {
    currentRun = runs.find((r) => r.runId === batch.currentRunId)
      || readJson(path.join(refineRunDir(dataDir, batch.currentRunId), 'run.json'));
  }
  // REQ-20260913-003：候选按实时口径盘点（不再依赖建轮时冻结快照）
  const candidates = effectiveRefineCandidates(dataDir, batch);
  const counts = { total: candidates.length, done: 0, failed: 0, skipped: 0, interrupted: 0, remaining: 0 };
  for (const r of finalByItem.values()) {
    if (reacceptable.has(r.itemId) || retryItems.has(r.itemId)) continue; // 重新排队待处理：不占终态计数
    if (r.phase === 'done') counts.done++;
    else if (r.phase === 'failed') counts.failed++;
    else if (r.phase === 'skipped') counts.skipped++;
    else if (r.phase === 'interrupted') counts.interrupted++;
  }
  counts.remaining = candidates
    .filter((c) => !finalByItem.has(c.id) || reacceptable.has(c.id) || retryItems.has(c.id)).length;
  return { runs, finalByItem, activeByItem, reacceptable, retryItems, currentRun, counts };
}

// BUG-20260908-010：终态回执后条目被人工重新接受的判定。依据 core.mjs 进入 accepted 钩子置位的
// 确定性事件标记：state=unrefined 且**无 runId** 且 reaccepted=true，且条目当前仍 accepted。
// 三个易混形态必须排除（不用时间戳比较——回执与再接受可能同毫秒，判定不稳定）：
// - fail/release 回置的 unrefined 带 runId（整体替换清除标记）→ 不重领（fail 出局、release 换单语义不变，防无限重领）；
// - skipRun 不写索引：出局条目（目录损坏/状态变化）的 states 仍是首次接受的无标记记录 → 不复活；
// - 已移入计划等非 accepted 状态 → 不重领。
function reacceptedForRerun(dataDir, itemId) {
  const rec = readRefineStates(dataDir)[itemId];
  if (!rec || rec.state !== 'unrefined' || rec.runId || rec.reaccepted !== true) return false;
  try {
    return readStatus(resolveItemDir(dataDir, itemId).dir).status === 'accepted';
  } catch {
    return false;
  }
}

// ---------- refine 互斥（.locks/refine.lock；无超时接管，异常走人工核对/释放） ----------

function refineLockPath(dataDir) {
  return path.join(dataDir, '.locks', 'refine.lock');
}

function acquireRefineLock(dataDir, payload) {
  acquireLock(refineLockPath(dataDir), Infinity, payload);
}

function readRefineLock(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(refineLockPath(dataDir), 'utf8'));
  } catch {
    return null;
  }
}

function releaseRefineLockIf(dataDir, pred) {
  const lock = readRefineLock(dataDir);
  if (lock && pred(lock)) {
    try { fs.unlinkSync(refineLockPath(dataDir)); } catch {}
  }
}

// 供 codex 执行器尝试占用（busy 时由调用方决定等待/跳过）
export function tryAcquireRefineLock(dataDir, payload) {
  try {
    acquireRefineLock(dataDir, payload);
    return { ok: true };
  } catch (e) {
    const holder = readRefineLock(dataDir);
    return { ok: false, holder, error: e.message };
  }
}
export function releaseRefineLockForRun(dataDir, runId, owner) {
  releaseRefineLockIf(dataDir, (l) => l.runId === runId || l.owner === owner);
}

// ---------- 领取与回执（zcode worker 入口） ----------

// 实时候选（REQ-20260913-003）：本轮执行不再冻结候选快照——每次盘点都实时读取当前已接受
// 未完善队列（需求优先、最旧优先）。返回生效候选 = 账本已登记候选（含显式 ids 队首种子与存量
// 账本，带基线/缺失原因快照）∪ 当前实时候选（物化为候选对象，基线为当前指纹的初始值——
// 领取时按当前文档重冻结，BUG-20260908-011 口径不变；排除其他未结束账本已登记条目，兼容存量数据）。
export function effectiveRefineCandidates(dataDir, batch) {
  const known = new Set((batch.candidates || []).map((c) => c.id));
  for (const other of unfinishedRefineBatches(dataDir)) {
    if (other.batchId !== batch.batchId) {
      for (const c of other.candidates || []) known.add(c.id);
    }
  }
  const fresh = refineCandidates(dataDir).filter((x) => !known.has(x.id));
  const materialized = fresh.map((x) => {
    let baseline = '';
    try { baseline = docsFingerprint(resolveItemDir(dataDir, x.id).dir); } catch { /* 目录异常：留空，领取时再冻结 */ }
    return { id: x.id, type: x.type, title: x.title, reasons: [...x.reasons], baseline };
  });
  return [...(batch.candidates || []), ...materialized];
}

// 实时吸收落盘（REQ-20260908-020 沿革）：把实时候选物化进账本（领取核验 done 时要按账本候选的
// 基线比对「文档确有变更」）。调用点：next / check / summary / 回执收尾 / 释放 / 结算——展示层
// 摘要读取同样吸收，保证面板待处理队列实时（新接受的单立即可见、立即可领取）。
function absorbNewRefineCandidates(dataDir, batch) {
  const known = new Set(batch.candidates.map((c) => c.id));
  const fresh = effectiveRefineCandidates(dataDir, batch).filter((c) => !known.has(c.id));
  if (fresh.length) {
    batch.candidates.push(...fresh);
    saveRefineBatch(dataDir, batch);
  }
}

// BUG-20260908-010：把「终态后重新接受」的条目重新入队——移到候选队尾并按**当前文档**
// 重冻结基线、刷新缺失原因（上一轮 done 的修改不视为人工篡改；done 核验「文档确有变更」
// 口径不变，基线即重冻结时点指纹）。重排队只在每轮 next 扫描一次，同轮内一条目的再次领取
// 仅源于「终态回执之后重新接受」这一人工事件，不会无限重领。
function requeueReacceptedRefineItems(dataDir, batch) {
  const probe = refineBatchState(dataDir, batch);
  const requeue = batch.candidates.filter((c) => probe.reacceptable.has(c.id));
  if (!requeue.length) return;
  const fresh = new Map(refineCandidates(dataDir).map((x) => [x.id, x]));
  const requeued = new Set(requeue.map((c) => c.id));
  for (const cand of requeue) {
    const dir = resolveItemDir(dataDir, cand.id).dir;
    cand.baseline = docsFingerprint(dir);
    const f = fresh.get(cand.id);
    if (f) {
      cand.reasons = [...f.reasons];
      cand.title = f.title;
    }
  }
  batch.candidates = [...batch.candidates.filter((c) => !requeued.has(c.id)), ...requeue];
  saveRefineBatch(dataDir, batch);
}

export function nextRefineItem(dataDir, batchId, { owner = null } = {}) {
  owner = owner || actor();
  ensureRefine(dataDir);
  const batch = getRefineBatch(dataDir, batchId);
  // 存量数据排队保护：存在更早的未结束完善账本时不得越过队首领取
  const prior = unfinishedRefineBatches(dataDir).find((b) => b.batchId !== batchId &&
    (String(b.createdAt || '').localeCompare(String(batch.createdAt || '')) < 0 ||
      (String(b.createdAt || '') === String(batch.createdAt || '') && b.batchId < batchId)));
  if (prior) {
    throw new AtbError(`完善任务 ${batchId} 排队中：前序任务 ${prior.batchId} 尚未结束，不得抢先领取`);
  }
  if (batch.abortRequested) {
    return { stop: 'aborted', counts: refineBatchState(dataDir, batch).counts, notice: '任务已终止：不再派发后续项' };
  }
  absorbNewRefineCandidates(dataDir, batch); // 实时队列：先吸收新接受的未完善条目再盘点
  requeueReacceptedRefineItems(dataDir, batch); // BUG-20260908-010：终态后重新接受的条目重排队尾并重冻结基线
  const state0 = refineBatchState(dataDir, batch);
  if (state0.currentRun && !FINAL_REFINE_PHASES.has(state0.currentRun.phase)) {
    const r = state0.currentRun;
    throw new AtbError(
      `当前执行未收尾：${r.runId}（${r.itemId}，owner ${r.owner}，${r.phase}）。` +
      '先核对旧子 Agent 是否结束，不得创建第二个完善执行'
    );
  }
  if (batch.pauseRequested) {
    return { stop: 'paused', counts: state0.counts, notice: '已暂停后续领取' };
  }
  acquireRefineLock(dataDir, { kind: 'zcode', batchId, owner, at: nowIso() });
  for (const cand of batch.candidates) {
    // BUG-20260908-010：finalByItem 历史终态不排除「终态后重新接受（重排队）」的条目；
    // REQ-20260908-026：retryItems 标记的异常记录同样重新领取（新执行尝试）
    if (state0.finalByItem.has(cand.id) && !state0.reacceptable.has(cand.id) && !state0.retryItems.has(cand.id)) continue;
    if (state0.activeByItem.has(cand.id)) continue;
    let st = null;
    let dir = null;
    try {
      dir = resolveItemDir(dataDir, cand.id).dir;
      st = readStatus(dir);
    } catch {
      skipRun(dataDir, batch, cand, '条目目录损坏，无法完善');
      continue;
    }
    if (st.status !== 'accepted') {
      skipRun(dataDir, batch, cand, `状态已变化（当前 ${st.status}），不再需要本批完善`);
      continue;
    }
    // BUG-20260908-011：文档指纹基线改在领取时冻结（派发该项、写运行前）——创建/吸收到领取
    // 之间的人工编辑（补充背景）不再作为出局门槛；done 回执「文档确有变更」核验沿用
    // cand.baseline，即以领取时点为准：领取后无论子代理还是人工再编辑都算「领取后变更」，
    // 领取后未做任何修改仍拒绝记完成（「基线一致不能记完成」语义不变）。
    cand.baseline = docsFingerprint(dir);
    // BUG-20260908-013：领取落账继承批次执行 Agent（batch.agent 缺省回退 batch.mode，兼容旧批次），
    // 与 skipRun()/newCodexRefineRun() 口径一致，codex 批次不得误标 zcode
    const run = newRefineRun(dataDir, {
      batchId: batch.batchId,
      item: { id: cand.id, title: st.title },
      owner,
      mode: batch.agent || batch.mode,
      phase: 'reserved',
    });
    batch.currentRunId = run.runId;
    batch.status = 'running';
    if (batch.retryItems && batch.retryItems[cand.id]) {
      delete batch.retryItems[cand.id]; // REQ-20260908-026：重试领取成功，清除标记（随下方落盘）
      if (!Object.keys(batch.retryItems).length) delete batch.retryItems;
    }
    saveRefineBatch(dataDir, batch);
    // REQ-20260908-020：领取成功置「完善中」（执行账本索引，徽标随轮询可见）
    setRefineItemState(dataDir, cand.id, 'refining', { runId: run.runId });
    return {
      runId: run.runId,
      batchId: batch.batchId,
      itemId: cand.id,
      type: cand.type,
      title: st.title,
      reasons: cand.reasons,
      itemDir: dir,
      docs: orderedDocs(dir),
      owner,
    };
  }
  // 无可领取：收尾批次并释放互斥
  const state = refineBatchState(dataDir, batch);
  batch.currentRunId = null;
  batch.status = 'finished';
  saveRefineBatch(dataDir, batch);
  releaseRefineLockIf(dataDir, () => true);
  return {
    stop: state.counts.remaining > 0 ? 'blocked' : 'finished',
    counts: state.counts,
  };
}

// 出局落账（不占 currentRun；直接写终态 run 供记录展示）
function skipRun(dataDir, batch, cand, reason) {
  const run = newRefineRun(dataDir, {
    batchId: batch.batchId,
    item: { id: cand.id, title: cand.title },
    owner: 'refine',
    mode: batch.mode,
    phase: 'reserved',
  });
  run.phase = 'skipped';
  run.reason = String(reason).slice(0, REASON_MAX_CHARS);
  run.finishedAt = nowIso();
  saveRefineRun(dataDir, run);
  return run;
}

// REQ-20260908-014：运行标题——优先领取时快照 run.itemTitle，历史运行缺失时回退实时读条目；
// 条目已被删除等读取失败返回 null（单号仍可追溯，标题缺失不报错）
function titleOfRun(dataDir, run) {
  if (run && run.itemTitle != null) return run.itemTitle;
  try {
    return readStatus(resolveItemDir(dataDir, run.itemId).dir).title ?? null;
  } catch {
    return null;
  }
}

// REQ-20260909-010：完善完成后自动转入计划（配置默认关闭，见 task-settings.mjs refine 分区）。
// 仅由回执处理逻辑内部调用（zcode 路径 finishRefineRun / codex 路径 server settle），是系统行为
// 而非 Agent 命令：不经 CLI status、不写拦截面，Agent 纪律与 state-guard 拦截规则不变。
// 不抛错，返回统一形态：{ transitioned: true } | { transitioned: false, reason, error? }。
// reason：not-enabled（未开启，默认）/ not-accepted:<status>（条目非已接受——如人工已提前移入计划，
// 不重复流转）/ settings-read-failed / status-read-failed（前置读取失败）/ transition-failed（流转异常）。
export function autoPlanRefinedItem(dataDir, itemId, runId) {
  try {
    if (!autoPlanAfterRefineDone(loadTaskSettings(dataDir))) {
      return { transitioned: false, reason: 'not-enabled' };
    }
  } catch {
    return { transitioned: false, reason: 'settings-read-failed' };
  }
  let st = null;
  try {
    st = readStatus(resolveItemDir(dataDir, itemId).dir);
  } catch {
    return { transitioned: false, reason: 'status-read-failed' };
  }
  if (st.status !== 'accepted') {
    return { transitioned: false, reason: `not-accepted:${st.status}` };
  }
  try {
    setStatus(dataDir, itemId, 'planned', {
      by: 'system',
      note: `完善后自动转入计划（${runId}）`,
    });
    return { transitioned: true };
  } catch (e) {
    return { transitioned: false, reason: 'transition-failed', error: String(e.message || e).slice(0, 120) };
  }
}

// 流转结果的可读文案（CLI 输出行 / 面板记录标注共用口径；浏览器端 app.js 另持等价映射）
export function autoPlanResultText(plan) {
  if (!plan) return '';
  if (plan.transitioned) return '已自动转入计划（planned）';
  const reason = String(plan.reason || '');
  if (reason.startsWith('not-accepted:')) {
    const st = reason.slice('not-accepted:'.length);
    return st === 'planned'
      ? '未自动转入计划（条目当前为 planned）：无需自动转入'
      : `未自动转入计划（条目当前为 ${st}）`;
  }
  const label = {
    'not-enabled': '未开启自动转入计划',
    'settings-read-failed': '设置读取失败',
    'status-read-failed': '条目状态读取失败',
    'transition-failed': '流转执行失败',
  }[reason] || reason || '未知原因';
  return `自动转入计划失败（${label}${plan.error ? `：${plan.error}` : ''}）：请人工移入计划`;
}

export function finishRefineRun(dataDir, runId, { result, summary = '', reason = '' } = {}) {
  const run = getRefineRun(dataDir, runId);
  if (FINAL_REFINE_PHASES.has(run.phase)) {
    throw new AtbError(`运行 ${runId} 已收尾（${run.phase}），同一运行不得重复回执`);
  }
  const batch = getRefineBatch(dataDir, run.batchId);
  const cand = batch.candidates.find((c) => c.id === run.itemId);
  let receipt;
  if (result === 'done') {
    summary = String(summary || '').trim();
    if (!summary) throw new AtbError('done 回执必须携带 summary（补全要点，≤200 字）');
    if ([...summary].length > REASON_MAX_CHARS) {
      throw new AtbError(`summary 超过 ${REASON_MAX_CHARS} 字，请精简（完整内容写进条目文档）`);
    }
    const { dir, type: itemType } = resolveItemDir(dataDir, run.itemId);
    const st = readStatus(dir);
    // REQ-20260909-010：done 核验允许 accepted | planned——人工提前移入计划（planned）时完善结果
    // 仍有效：done 成功记账、跳过自动流转（回执说明原因）；其余状态维持拒绝（人工核对，改用 refine fail）。
    if (st.status !== 'accepted' && st.status !== 'planned') {
      throw new AtbError(`条目已离开已接受状态（当前 ${st.status}）：完善结果请人工核对，改用 refine fail 登记原因`);
    }
    // REQ-20260908-025：按基线自带版本口径重算比对（cand 缺失仍按「一致」拒绝，语义不变）
    if (cand ? docsUnchangedSince(dir, cand.baseline) : true) {
      throw new AtbError('文档内容与冻结基线一致：未检测到补全变更，不能记完成');
    }
    // BUG-20260910-011：done 完整性门槛（UI 演示三查）——「已完善」标记与 analyzeItemDocs 的完整性
    // 判定必须一致：涉及 UI 的条目缺界面展示节 / 演示文件 / 链接时拒绝回执，防再现「完善成功记账但
    // 演示缺失」（长跑旧口径批次下的实际形态，003~007 即此成因）。补齐后重试即可；确无法补演示用
    // refine fail 登记原因留痕。门槛范围与探测口径见 uiDemoGateReasons / uiProbeOf 注释（design.md 定案 1）。
    const uiGateReasons = uiDemoGateReasons(dir, itemType);
    if (uiGateReasons.length) {
      throw new AtbError(
        `完善完整性核验未通过（UI 演示三查）：${uiGateReasons.join('、')}` +
        '——请补齐界面展示节（正文链接 ./ui-demo.html）并在条目目录创建 ui-demo.html 可交互演示后重试，' +
        '或改用 refine fail 登记原因',
      );
    }
    run.phase = 'done';
    run.summary = summary;
    receipt = { version: 1, batchId: run.batchId, runId, itemId: run.itemId, title: titleOfRun(dataDir, run), result: 'done', summary };
  } else if (result === 'failed') {
    reason = String(reason || '').trim();
    if (!reason) throw new AtbError('failed 回执必须携带简短 reason（≤200 字）');
    if ([...reason].length > REASON_MAX_CHARS) {
      throw new AtbError(`reason 超过 ${REASON_MAX_CHARS} 字：完整错误请写入运行目录文件，回执只留短摘要`);
    }
    run.phase = 'failed';
    run.reason = reason;
    receipt = { version: 1, batchId: run.batchId, runId, itemId: run.itemId, title: titleOfRun(dataDir, run), result: 'failed', reason };
  } else {
    throw new AtbError(`result 必须是 done | failed，得到：${result}`);
  }
  run.finishedAt = nowIso();
  saveRefineRun(dataDir, run);

  // REQ-20260908-020：done 核验通过置「已完善」；fail 回置「未完善」（可被下一轮重新领取）
  setRefineItemState(dataDir, run.itemId, result === 'done' ? 'refined' : 'unrefined', { runId });

  // REQ-20260909-010：完善完成后自动转入计划（默认关闭）。done 终态与完善账本先落（完成事实不丢），
  // 流转由回执处理内部系统执行（非 Agent 命令，Agent 纪律与 state-guard 拦截不变）；任何异常都不
  // 阻断回执——结果随运行账本落盘（面板记录标注数据源）并并入回执 JSON。
  if (result === 'done') {
    const plan = autoPlanRefinedItem(dataDir, run.itemId, runId);
    run.autoPlan = plan;
    saveRefineRun(dataDir, run);
    receipt.autoPlan = plan;
  }

  if (batch.currentRunId === runId) batch.currentRunId = null;
  absorbNewRefineCandidates(dataDir, batch); // BUG-20260908-010：收尾判定前实时吸收，运行中新接受的单不得漏
  const state = refineBatchState(dataDir, batch);
  batch.status = batch.pauseRequested ? 'paused' : (state.counts.remaining > 0 ? 'running' : 'finished');
  saveRefineBatch(dataDir, batch);
  releaseRefineLockIf(dataDir, (l) => l.runId === runId || l.owner === run.owner);

  const bytes = Buffer.byteLength(JSON.stringify(receipt), 'utf8');
  if (bytes > RECEIPT_MAX_BYTES) {
    throw new AtbError(`回执超过 ${RECEIPT_MAX_BYTES} 字节（${bytes}）：请缩短 summary/reason`);
  }
  return { ok: true, receipt };
}

// 释放未回执的预留（认领冲突换单等）：interrupted 终态 + 释放互斥
export function releaseRefineRun(dataDir, runId, { reason = '' } = {}) {
  const run = getRefineRun(dataDir, runId);
  if (FINAL_REFINE_PHASES.has(run.phase)) {
    throw new AtbError(`运行 ${runId} 已收尾（${run.phase}），无需释放`);
  }
  run.phase = 'interrupted';
  run.reason = String(reason || '预留释放').slice(0, REASON_MAX_CHARS);
  run.finishedAt = nowIso();
  saveRefineRun(dataDir, run);
  setRefineItemState(dataDir, run.itemId, 'unrefined', { runId }); // REQ-20260908-020：释放回置未完善
  const batch = getRefineBatch(dataDir, run.batchId);
  if (batch.currentRunId === runId) batch.currentRunId = null;
  absorbNewRefineCandidates(dataDir, batch); // BUG-20260908-010：收尾判定前实时吸收
  const state = refineBatchState(dataDir, batch);
  if (!batch.pauseRequested) {
    batch.status = state.counts.remaining > 0 ? 'running' : 'finished';
  }
  saveRefineBatch(dataDir, batch);
  releaseRefineLockIf(dataDir, (l) => l.runId === runId || l.owner === run.owner);
  return { ok: true, runId, itemId: run.itemId };
}

// REQ-20260908-020 终止完善任务（人工，二次确认后调用）：
// - 停止派发后续项（abortRequested，next 一律 stop=aborted）；
// - 在途运行（含排队）落 interrupted 并注明人工终止，对应条目回置「未完善」；
// - 剩余未领取项落 skipped 出局账；refine 互斥全部释放；批次转 finished + aborted 终止态。
// 在途子代理运行在主调度会话内，看板无法直接停止——notice 提示到对应会话人工停止。
export function abortRefineBatch(dataDir, batchId) {
  const batch = getRefineBatch(dataDir, batchId);
  if (batch.abortRequested) {
    return { ok: true, batchId, aborted: true, counts: refineBatchState(dataDir, batch).counts, notice: '任务已终止（幂等返回）' };
  }
  const state = refineBatchState(dataDir, batch);
  for (const r of state.runs) {
    if (FINAL_REFINE_PHASES.has(r.phase)) continue;
    r.phase = 'interrupted';
    r.reason = '人工终止任务';
    r.finishedAt = nowIso();
    saveRefineRun(dataDir, r);
    setRefineItemState(dataDir, r.itemId, 'unrefined', { runId: r.runId });
  }
  const handled = new Set([...state.finalByItem.keys(), ...state.activeByItem.keys()]);
  // REQ-20260913-003：剩余项按实时口径出局（建轮不冻结——账本 candidates 可能为空，
  // 实时候选同样需要落 skipped 出局账，终止后计数才归零）
  for (const cand of effectiveRefineCandidates(dataDir, batch)) {
    if (handled.has(cand.id)) continue;
    skipRun(dataDir, batch, cand, '任务终止，剩余项出局');
  }
  batch.abortRequested = true;
  batch.aborted = true;
  batch.currentRunId = null;
  batch.status = 'finished';
  saveRefineBatch(dataDir, batch);
  releaseRefineLockIf(dataDir, () => true);
  const counts = refineBatchState(dataDir, batch).counts;
  return {
    ok: true,
    batchId,
    aborted: true,
    counts,
    notice: '任务已终止：停止派发后续项，剩余项已出局；在途子代理请在对应子代理会话人工停止',
  };
}

// BUG-20260908-015：终态批次判定——已终止（abortRequested/aborted）或已结束（finished）的完善批次
// 不得再被暂停/恢复改写状态；返回可读原因（供 CLI/HTTP 入口透传明确错误），非终态返回 null
export function refineBatchTerminalReason(batch) {
  if (batch.abortRequested || batch.aborted) return '任务已人工终止，不能暂停/恢复';
  if (batch.status === 'finished') return '任务已结束，不能暂停/恢复';
  return null;
}

export function pauseRefineBatch(dataDir, batchId, paused) {
  const batch = getRefineBatch(dataDir, batchId);
  // BUG-20260908-015：终态批次（已终止/已结束）幂等拒绝——不写 pauseRequested、不改 status，
  // 防止暂停请求把 finished 复活为 paused（恢复方向也不得把终止态翻回 running/prepared）
  if (refineBatchTerminalReason(batch)) return batch;
  batch.pauseRequested = Boolean(paused);
  const state = refineBatchState(dataDir, batch);
  const active = state.currentRun && !FINAL_REFINE_PHASES.has(state.currentRun.phase);
  if (paused && !active) batch.status = 'paused';
  else if (!paused && batch.status === 'paused') {
    batch.status = state.runs.length ? 'running' : 'prepared';
  }
  saveRefineBatch(dataDir, batch);
  return batch;
}

// 运行终态后重估批次状态（codex 执行器结算调用；zcode 路径在回执内已处理）
export function settleRefineBatch(dataDir, batchId) {
  const batch = getRefineBatch(dataDir, batchId);
  absorbNewRefineCandidates(dataDir, batch); // BUG-20260908-010：结算判定前实时吸收
  const state = refineBatchState(dataDir, batch);
  const active = state.currentRun && !FINAL_REFINE_PHASES.has(state.currentRun.phase);
  const next = batch.pauseRequested ? 'paused'
    : (state.counts.remaining === 0 ? 'finished'
      : (active || state.runs.length ? 'running' : 'prepared'));
  if (batch.status !== next) {
    batch.status = next;
    saveRefineBatch(dataDir, batch);
  }
  return batch;
}

// ---------- 核对与摘要协议 ----------

export function checkRefineBatch(dataDir, batchId) {
  const batch = getRefineBatch(dataDir, batchId);
  // BUG-20260908-010：核对先实时吸收候选再判定 stop——运行中新接受的单（含同轮重新接受重排队项
  // 经 refineBatchState 计入 remaining）使 nextAction 保持 continue，不得因创建时快照耗尽提前收工。
  absorbNewRefineCandidates(dataDir, batch);
  const state = refineBatchState(dataDir, batch);
  const currentRun = state.currentRun;
  const active = currentRun && !FINAL_REFINE_PHASES.has(currentRun.phase);

  let nextAction = 'continue';
  let notice = '';
  if (active) {
    nextAction = 'needs_attention';
    notice = `当前执行未收尾（${currentRun.runId} ${currentRun.itemId} owner ${currentRun.owner}），等待子 Agent 回执后核对`;
  } else if (batch.abortRequested) {
    nextAction = 'stop';
    notice = '任务已人工终止：不再派发后续项；在途子代理请在对应子代理会话人工停止';
  } else if (batch.pauseRequested) {
    nextAction = 'stop';
    notice = '已暂停后续领取（在途执行不受影响）';
  } else if (state.counts.remaining === 0) {
    nextAction = 'stop';
    notice = '本轮完善队列已处理完毕（条目均保持已接受，后续流转由人工判断）';
    if (batch.status !== 'finished') {
      batch.status = 'finished';
      saveRefineBatch(dataDir, batch);
    }
  } else if (state.activeByItem.size > 0 && !currentRun) {
    notice = `有 ${state.activeByItem.size} 项在 codex 后台排队/执行中，等待执行器结算`;
  }
  const payload = {
    version: 1,
    batchId: batch.batchId,
    mode: batch.mode,
    status: batch.status,
    current: active
      ? { runId: currentRun.runId, itemId: currentRun.itemId, title: titleOfRun(dataDir, currentRun), owner: currentRun.owner, phase: currentRun.phase, at: currentRun.createdAt }
      : null,
    counts: state.counts,
    nextAction,
    ...(notice ? { notice } : {}),
  };
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > RECEIPT_MAX_BYTES) {
    throw new AtbError(`核对响应超过 ${RECEIPT_MAX_BYTES} 字节（${bytes}）`);
  }
  return payload;
}

export function listRefineRuns(dataDir, batchId, { offset = 0, limit = 20 } = {}) {
  const runs = refineRunsOfBatch(dataDir, batchId);
  // REQ-20260908-026：attempt = 本任务内该条目的第几次执行（记录「第 N 次」展示）
  const attemptByRun = new Map();
  const seenPerItem = new Map();
  for (const r of [...runs].reverse()) {
    seenPerItem.set(r.itemId, (seenPerItem.get(r.itemId) || 0) + 1);
    attemptByRun.set(r.runId, seenPerItem.get(r.itemId));
  }
  const records = runs.slice(offset, offset + limit).map((r) => ({
    runId: r.runId,
    itemId: r.itemId,
    title: titleOfRun(dataDir, r),
    owner: r.owner,
    mode: r.mode,
    result: FINAL_REFINE_PHASES.has(r.phase) ? r.phase : 'in-flight',
    summary: r.summary || null,
    reason: r.reason || null,
    at: r.finishedAt || r.createdAt,
    attempt: attemptByRun.get(r.runId) || 1,
    autoPlan: r.autoPlan || null, // REQ-20260909-010：完善后自动流转结果（面板记录标注数据源）
  }));
  return { total: runs.length, records };
}

// 重新执行（REQ-20260908-026）：异常 / 已中断完善记录核验后重排队尾并标记 retryItems——
// 原记录与失败原因保留，计数改记待处理，下一轮 next 重新领取产生新尝试。
// 条目须仍处于已接受（不自动改业务状态）；终态任务由前端以该条目重建新任务承接。
export function retryRefineRun(dataDir, runId) {
  const run = getRefineRun(dataDir, runId);
  if (run.phase === 'done' || run.phase === 'skipped') {
    throw new AtbError(`完善执行 ${runId} 结果为 ${run.phase}（非异常记录），无需重新执行`);
  }
  if (!FINAL_REFINE_PHASES.has(run.phase) && run.phase !== 'interrupted') {
    throw new AtbError(`完善执行 ${runId} 尚未收尾（${run.phase}）：在途执行不得重复派发`);
  }
  const batch = getRefineBatch(dataDir, run.batchId);
  if (batch.abortRequested || batch.status === 'finished') {
    throw new AtbError(`完善任务 ${batch.batchId} 已${batch.abortRequested ? '终止' : '结束'}：请通过新一轮任务承接（按该条目重建并复制调度提示词）`);
  }
  const state = refineBatchState(dataDir, batch);
  if (state.activeByItem.has(run.itemId)) {
    throw new AtbError(`${run.itemId} 已有在途完善执行：不得重复派发`);
  }
  const { dir } = resolveItemDir(dataDir, run.itemId);
  const st = readStatus(dir);
  if (st.status !== 'accepted') {
    throw new AtbError(`${run.itemId} 当前为 ${st.status}：重新执行要求条目仍处于已接受（accepted），不自动修改业务状态`);
  }
  if (!state.finalByItem.has(run.itemId)) {
    return { ok: true, batchId: batch.batchId, itemId: run.itemId, alreadyPending: true, notice: '该条目已在待处理队列中，等待下一轮领取' };
  }
  if (state.retryItems.has(run.itemId)) {
    return { ok: true, batchId: batch.batchId, itemId: run.itemId, alreadyQueued: true, notice: '已在重试队列中（重复点击不产生重复执行）' };
  }
  // 重排队尾 + 按当前文档重冻结基线 / 刷新缺失原因（与终态后重新接受的重排队口径一致）
  const cand = batch.candidates.find((c) => c.id === run.itemId);
  if (cand) {
    batch.candidates = [...batch.candidates.filter((c) => c.id !== run.itemId), cand];
    cand.baseline = docsFingerprint(dir);
    const fresh = refineCandidates(dataDir).find((x) => x.id === run.itemId);
    if (fresh) {
      cand.reasons = [...fresh.reasons];
      cand.title = fresh.title;
    }
  }
  batch.retryItems = { ...(batch.retryItems || {}), [run.itemId]: runId };
  const counts = refineBatchState(dataDir, batch).counts;
  batch.status = batch.pauseRequested ? 'paused' : (counts.remaining > 0 ? 'running' : 'finished');
  batch.lastActivityAt = nowIso();
  saveRefineBatch(dataDir, batch);
  const attempt = state.runs.filter((r) => r.itemId === run.itemId).length + 1;
  return {
    ok: true, batchId: batch.batchId, itemId: run.itemId, attempt,
    notice: `已加入本轮重试队列（第 ${attempt} 次尝试），保留原异常记录`,
  };
}

export function refineSummary(dataDir, batchId = null) {
  const batch = batchId
    ? getRefineBatch(dataDir, batchId)
    : queueHeadRefineBatch(dataDir);
  if (!batch) throw new AtbError('尚无完善批次：请先在看板创建');
  const state = refineBatchState(dataDir, batch);
  // BUG-20260908-018：首屏 5 条（性能口径）保留，但必须带 recordsTotal——
  // 否则面板出现「计数合计 > 5、列表只有 5 且无任何入口」的静默截断
  const { total, records } = listRefineRuns(dataDir, batch.batchId, { offset: 0, limit: 5 });
  return {
    batch: refineBatchPublicView(batch, { autoPlan: refineAutoPlanOn(dataDir) }),
    currentRun: state.currentRun,
    counts: state.counts,
    records,
    recordsTotal: total,
    check: checkRefineBatch(dataDir, batch.batchId),
  };
}

// 面板/摘要公开视图：冻结候选带缺失原因（结果展示需要），不含运行明细
// BUG-20260909-017：prompt 按当前口径归一（存量账本冻结的旧模型行不再透出；账本文件本身不回写）
// BUG-20260910-001：归一升级为全量口径（执行端段/旧命名行/旧领取前缀一并归一）
// BUG-20260910-008：opts.autoPlan（实时开关，refineAutoPlanOn 读取）——按当前状态把冻结约束段
// 归一到 ON/OFF 文案（两方向，幂等；账本不回写）；缺省不触碰约束行（既有调用零回归）
export function refineBatchPublicView(b, { autoPlan = null } = {}) {
  return {
    // REQ-20260913-003：批次号不再透出（面板/全局视图去批次概念；账本内部键保留）
    mode: b.mode,
    agent: b.agent || b.mode, // REQ-20260908-020：执行 Agent（存量批次缺字段回退 mode）
    status: b.status,
    abortRequested: Boolean(b.abortRequested),
    aborted: Boolean(b.aborted),
    pauseRequested: b.pauseRequested,
    // REQ-20260910-027：不再透出 developer（存量账本字段保留不迁移）
    createdAt: b.createdAt,
    lastActivityAt: b.lastActivityAt,
    candidates: (b.candidates || []).map(({ id, type, title, reasons }) => ({ id, type, title, reasons })),
    prompt: normalizePromptForDisplay(b.prompt, autoPlan == null ? undefined : { autoPlan }),
  };
}

// REQ-20260910-003 全局看板：完善批次简报（纯只读）。计数与当前项与 /api/refine/current
// 面板同源（refineBatchState 同一函数）；不调用 checkRefineBatch（可能改批次状态与吸收候选）、
// 不写任何账本、不碰锁。queued 由服务端按「非队首的 prepared 批次」补标。
export function refineBatchBrief(dataDir, batchOrId) {
  const b = typeof batchOrId === 'string' ? getRefineBatch(dataDir, batchOrId) : batchOrId;
  const state = refineBatchState(dataDir, b);
  const cur = state.currentRun;
  return {
    kind: 'refine',
    mode: b.mode,
    status: b.status,
    pauseRequested: Boolean(b.pauseRequested),
    abortRequested: Boolean(b.abortRequested),
    aborted: Boolean(b.aborted),
    // REQ-20260910-027：不再透出 developer（存量账本字段保留不迁移）
    createdAt: b.createdAt,
    lastActivityAt: b.lastActivityAt,
    current: cur
      ? { itemId: cur.itemId, title: titleOfRun(dataDir, cur), owner: cur.owner, createdAt: cur.createdAt }
      : null,
    counts: { ...state.counts },
  };
}

// ---------- codex 执行账本入口（服务端逐项后台执行） ----------

export function newCodexRefineRun(dataDir, { batchId, item, projectRoot, atbPath = ATB_PATH, by = null, timeoutMin = 60 }) {
  const payload = {
    ...item,
    itemDir: resolveItemDir(dataDir, item.id).dir,
  };
  // BUG-20260910-008：worker 提示词按当前开关分态冻结（与 buildRefinePrompt 同口径）
  const prompt = buildRefineWorkerPrompt({ item: payload, projectRoot, atbPath, runId: 'pending', autoPlan: refineAutoPlanOn(dataDir) });
  const run = newRefineRun(dataDir, {
    batchId,
    item: { id: item.id, title: item.title },
    owner: by || 'codex-refine',
    mode: 'codex',
    phase: 'queued',
    prompt,
  });
  run.timeoutMin = timeoutMin;
  const dir = refineRunDir(dataDir, run.runId);
  fs.writeFileSync(path.join(dir, 'prompt.md'), prompt);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'stderr.log'), '');
  saveRefineRun(dataDir, run);
  return run;
}

export function appendRefineEvent(dataDir, runId, event) {
  fs.appendFileSync(path.join(refineRunDir(dataDir, runId), 'events.jsonl'), JSON.stringify(event) + '\n');
}

export function appendRefineStderr(dataDir, runId, chunk) {
  fs.appendFileSync(path.join(refineRunDir(dataDir, runId), 'stderr.log'), chunk);
}

export function listRefineRunsWithOpen(dataDir) {
  const dir = refineRunsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((n) => readJson(path.join(dir, n, 'run.json')))
    .filter((r) => r && !FINAL_REFINE_PHASES.has(r.phase));
}
