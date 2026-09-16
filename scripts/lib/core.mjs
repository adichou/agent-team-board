#!/usr/bin/env node
// agent-team-board 核心数据层 —— atb.mjs（CLI）与 server.mjs（Status Board）共用。
// 事实源是项目内 docs/agent-team-board/：机器读写 status.json，人读写 markdown。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { refineStateOf, setRefineItemState } from './refine-states.mjs';
// REQ-20260911-009 dev 分支工作流（initData 自动 git init + 切 dev）。模块间为调用期
// 依赖（互不在此处取值），ESM 循环导入可安全加载。
// BUG-20260915-007：手动 /dev 收口同样以认领时快照为归因基线（report 无 run 分支收口提交）。
import { ensureDevWorkflow, captureManualTreeSnapshot } from './git-flow.mjs';
// REQ-20260911-007 待人工决策账本（执行层索引，不写 status.json）——claim / 确认完成防呆钩子
import {
  activeHoldOf, unansweredCount, saveHoldRecord, renderDecisionsDoc, HOLD_STATE_LABEL,
} from './hold-states.mjs';
// REQ-20260914-001 挂起确认账本（执行层索引，不写 status.json）——claim 项目级挂起防呆钩子。
// confirm-states 自包含（不 import core），此处引用无循环依赖。
import { waitingDevelopConfirm } from './confirm-states.mjs';

export const DATA_REL_DIR = path.join('docs', 'agent-team-board');
// pending-alignment 仅为存量兼容保留（历史条目仍可人工放行）；主流程不再进入。
// planned（已计划，REQ-20260908-010）：accepted 与 in-progress 之间的人工排期档。
export const STATES = ['submitted', 'accepted', 'planned', 'pending-alignment', 'in-progress', 'done'];
// 状态机（REQ-20260903-001 回退单阶段）：单向主干；人工回退边：
// done → in-progress（驳回完成）、accepted → submitted（驳回接受，REQ-20260907-011）、
// planned → accepted（移出计划，REQ-20260908-010）。
export const TRANSITIONS = {
  submitted: ['accepted'],
  accepted: ['planned', 'in-progress', 'submitted'], // planned = 人工置计划（REQ-20260908-010）；submitted = 人工驳回接受
  planned: ['in-progress', 'accepted'], // in-progress = claim 认领即实施；accepted = 人工移出计划
  'pending-alignment': ['in-progress'], // 存量兼容：旧待对齐条目人工放行
  'in-progress': ['done'],
  done: ['in-progress'],
};
// accepted / planned / done 仅限人工执行；Agent 侧由 hooks/state-guard.mjs 在 PreToolUse 确定性拦截。
export const HUMAN_ONLY_TO = new Set(['accepted', 'planned', 'done']);
export const DOC_ORDER = ['README.md', 'design.md', 'test-cases.md', 'test-report.md'];

const CONFIG_LOCK_STALE_MS = 30_000;
const CLAIM_LOCK_STALE_MS = 24 * 60 * 60 * 1000;

export class AtbError extends Error {}

let __actorNameCache = null;

// 会话名解析（REQ-20260901-005）：显式传入优先 → 环境会话 ID → 可读缺省名（前缀-MMDD-4位随机，进程内缓存）
// 缺省名不再产生裸 terminal；前缀取 ATB_AGENT_NAME（如 zcode / codex），缺省 atb。
export function resolveActorName(explicit) {
  if (explicit) return explicit;
  const envSession = process.env.ZCODE_SESSION_ID || process.env.CLAUDE_SESSION_ID;
  if (envSession) return envSession;
  if (!__actorNameCache) {
    const prefix = (process.env.ATB_AGENT_NAME || 'atb').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'atb';
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const suffix = crypto.randomBytes(2).toString('hex');
    __actorNameCache = `${prefix}-${p(d.getMonth() + 1)}${p(d.getDate())}-${suffix}`;
  }
  return __actorNameCache;
}

export function __resetActorCacheForTest() {
  __actorNameCache = null;
}

export function actor() {
  return resolveActorName(null);
}

export function localDateStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function padNum(n, len) {
  return String(n).padStart(len, '0');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function readStatus(dir) {
  const st = readJson(path.join(dir, 'status.json'));
  if (!st || !st.id || !st.status) {
    throw new AtbError(`${dir} 缺少合法的 status.json`);
  }
  return st;
}

export function writeStatus(dir, st) {
  writeJsonAtomic(path.join(dir, 'status.json'), st);
}

function pushHistory(st, from, to, by, note = '') {
  st.history = st.history || [];
  st.history.push({ at: new Date().toISOString(), from, to, by, note });
}

// ---------- 数据目录定位 ----------

export function dataDirFrom(cwd) {
  if (process.env.ATB_DIR) return path.resolve(process.env.ATB_DIR);
  let dir = path.resolve(cwd);
  for (;;) {
    const cand = path.join(dir, DATA_REL_DIR);
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireDataDir(cwd) {
  const dir = dataDirFrom(cwd);
  if (!dir) throw new AtbError(`未找到 ${DATA_REL_DIR}，请先在项目根执行 atb init`);
  return dir;
}

// REQ-20260910-005：导出供 server 项目管理 preview 使用（初始化实际写入位置口径）
export function gitRootFrom(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const DATA_README = `# Agent Team Board 数据目录

本目录是「智能体团队看板」的事实源，请随项目代码提交进 git。

- \`requirements/REQ-YYYYMMDD-NNN/\` —— 需求（README / design / test-cases / test-report）
- \`requirements/<REQ>/bugs/BUG-YYYYMMDD-NNN/\` —— 归属该需求的 Bug
- \`bugs/BUG-YYYYMMDD-NNN/\` —— 独立 Bug
- \`status.json\` 由 atb 工具维护，**请勿手改**（Agent 写入也会被钩子拦截）

状态流转：submitted → accepted（人工）→ planned（人工置计划）→ in-progress（Agent 认领）→ done（人工确认）。
人工操作入口：Status Board 网页（\`/board\`）或终端执行
\`node <插件>/scripts/atb.mjs status <ID> accepted|planned|done\`。
`;

export function initData(cwd) {
  const existing = dataDirFrom(cwd);
  if (existing) throw new AtbError(`已初始化：${existing}`);
  // REQ-20260911-009：初始化即落 Git 工作流——项目根不是 git 仓库则自动 `git init`，
  // 随后按需创建 dev 分支并把工作区切到 dev（幂等、只本地操作不 push）。失败如实抛错
  // （初始化完成后当前分支应为 dev 是验收口径，不做静默降级）。
  ensureDevWorkflow(path.resolve(cwd));
  const root = gitRootFrom(cwd) || path.resolve(cwd);
  const dataDir = path.join(root, DATA_REL_DIR);
  fs.mkdirSync(path.join(dataDir, 'requirements'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'bugs'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, '.locks'), { recursive: true });
  writeJsonAtomic(path.join(dataDir, 'config.json'), {
    version: 1,
    date: localDateStamp(),
    counters: { requirement: 0, bug: 0 },
  });
  fs.writeFileSync(path.join(dataDir, '.gitignore'), '.locks/\n');
  fs.writeFileSync(path.join(dataDir, 'README.md'), DATA_README);
  return dataDir;
}

// ---------- 原子锁（O_EXCL，过期自动接管） ----------
// acquireLock/releaseLock 供 lib/batch.mjs 复用（批次计数器、实施互斥锁）

export function acquireLock(lockPath, staleMs, payload) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const body = JSON.stringify(payload);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, body);
      fs.closeSync(fd);
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let st = null;
      let holder = null;
      try {
        st = fs.statSync(lockPath);
        holder = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      } catch {}
      const age = st ? Date.now() - st.mtimeMs : Infinity;
      if (age > staleMs) {
        try { fs.unlinkSync(lockPath); } catch {}
        continue;
      }
      throw new AtbError(
        `锁被占用：${path.basename(lockPath)}（持有者 ${holder?.owner || holder?.pid || '未知'}，` +
        `${Math.round(age / 1000)} 秒前）`
      );
    }
  }
  throw new AtbError(`获取锁失败：${lockPath}`);
}

export function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch {}
}

// ---------- 项目实施互斥（REQ-20260906-002，Zcode 批次 / Codex 派发 / 手工 claim 共用） ----------
// .locks/impl.lock 在「预留 → 认领 → 实施 → 收尾核对」期间持有；无超时自动接管，异常走人工核对。

export function readImplLockIfExists(dataDir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dataDir, '.locks', 'impl.lock'), 'utf8'));
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

// 失败待核对占用（BUG-20260906-003）：failed 且 safeToContinue=false 的回执不释放项目实施占用，
// 而是把锁标记为 attention（项目暂停）。所有实施入口（含原锁属主）都不得再开工，
// 直到人工在批次上恢复（暂停→恢复）后由批次层解除。
// REQ-20260914-001：attentionKind='confirm' 为自动提交不完整挂起（待人工确认提交），
// 恢复入口是任务页「待人工确认」的确认并继续（核验+补交通过后自动恢复）。
function implAttentionError(impl) {
  if (impl.attentionKind === 'confirm') {
    return new AtbError(
      `项目已挂起：${impl.itemId || '条目'} 自动提交不完整` +
      `${impl.attentionReason ? `（${impl.attentionReason}）` : ''}，待人工确认提交；` +
      '请到 Status Board 任务页「待人工确认」核对差异并确认后继续，队列与认领在确认通过后恢复'
    );
  }
  return new AtbError(
    `项目已暂停：批次 ${impl.batchId || '未知'} 的 ${impl.itemId || '条目'} 实施失败` +
    `${impl.attentionReason ? `（${impl.attentionReason}）` : ''}，无法确认工作区可继续；` +
    '请先到 Status Board「AI 开发」核对遗留改动，再通过 暂停→恢复 解除项目占用'
  );
}

// 供各实施入口（批次 next 等）在占用实施互斥前检查：attention 期间一律拒绝
export function assertNoImplAttention(dataDir) {
  const impl = readImplLockIfExists(dataDir);
  if (impl && impl.attention) throw implAttentionError(impl);
}

// 手工/普通认领前检查：批次/Codex/他人手工正在实施时不允许再认领本项目条目（锁属主本人放行）
function assertNoImplConflict(dataDir, owner) {
  const impl = readImplLockIfExists(dataDir);
  if (!impl) return;
  if (impl.attention) throw implAttentionError(impl); // 失败待核对：属主本人也不放行（BUG-20260906-003）
  if (impl.owner && impl.owner === owner) return;
  const who = impl.kind === 'batch' ? `批量批次 ${impl.batchId || ''}`
    : impl.kind === 'codex' ? 'Codex 自动派发'
    : impl.kind === 'manual' ? '手工认领'
    : impl.kind || '实施任务';
  throw new AtbError(
    `项目实施互斥中：${who}（owner ${impl.owner || '未知'}）正在实施 ${impl.itemId || '条目'}；` +
    '请先到 Status Board「AI 开发」核对执行状态，不要并行认领本项目条目'
  );
}

// 手工/普通认领占用实施互斥（BUG-20260906-002）：claim 起到 report/确认完成前独占，
// 与批次（batch）/Codex 派发（codex）共用 .locks/impl.lock，生命周期与认领锁对齐。
function implLockPathOf(dataDir) {
  return path.join(dataDir, '.locks', 'impl.lock');
}

// 手工认领占用实施互斥：同 owner 同条目幂等（含批次/Codex 属主续认，不覆盖其归属）；
// 同 owner 异条目拒绝——同一时间本项目只能有一个实施任务；异 owner 由 assertNoImplConflict 先行拦截。
function acquireImplLockForClaim(dataDir, id, owner, now) {
  try {
    acquireLock(implLockPathOf(dataDir), Infinity, { kind: 'manual', itemId: id, owner, at: now });
    return;
  } catch (e) {
    const holder = readImplLockIfExists(dataDir);
    if (holder && holder.owner === owner && (holder.itemId === id || holder.itemId == null)) return; // 幂等补锁
    if (holder && holder.owner === owner) {
      throw new AtbError(
        `项目实施互斥：${owner} 正在实施 ${holder.itemId || '其他条目'}；` +
        `同一时间本项目只能有一个实施任务，请先收尾（report）再认领 ${id}`
      );
    }
    throw e; // 异 owner 抢占（竞态兜底）：保持锁占用错误
  }
}

// 释放手工实施占用：仅 kind=manual 且条目匹配时；批次/Codex 锁由各自收尾释放
function releaseImplLockForManual(dataDir, id) {
  const impl = readImplLockIfExists(dataDir);
  if (impl && impl.kind === 'manual' && impl.itemId === id) {
    releaseLock(implLockPathOf(dataDir));
  }
}

// ---------- 编号生成（按日重置的全局计数器） ----------

export function nextId(dataDir, type) {
  if (type !== 'requirement' && type !== 'bug') throw new AtbError(`非法类型：${type}`);
  const lockPath = path.join(dataDir, '.locks', 'config.lock');
  acquireLock(lockPath, CONFIG_LOCK_STALE_MS, { pid: process.pid, at: new Date().toISOString() });
  try {
    const cfgPath = path.join(dataDir, 'config.json');
    const cfg = readJson(cfgPath) || { version: 1, counters: {} };
    const today = localDateStamp();
    if (cfg.date !== today) {
      cfg.date = today;
      cfg.counters = { requirement: 0, bug: 0 };
    }
    cfg.counters[type] = (cfg.counters[type] || 0) + 1;
    writeJsonAtomic(cfgPath, cfg);
    const prefix = type === 'requirement' ? 'REQ' : 'BUG';
    return `${prefix}-${today}-${padNum(cfg.counters[type], 3)}`;
  } finally {
    releaseLock(lockPath);
  }
}

// ---------- 条目定位 ----------

const ID_RE = /^(REQ|BUG)-\d{8}-\d{3,}$/;

export function resolveItemDir(dataDir, id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new AtbError(`非法编号：${id}（形如 REQ-YYYYMMDD-NNN / BUG-YYYYMMDD-NNN）`);
  }
  const type = id.startsWith('REQ') ? 'requirement' : 'bug';
  const topDir = path.join(dataDir, type === 'requirement' ? 'requirements' : 'bugs', id);
  if (fs.existsSync(topDir)) return { dir: topDir, type, nested: false };
  if (type === 'bug') {
    const reqRoot = path.join(dataDir, 'requirements');
    if (fs.existsSync(reqRoot)) {
      for (const name of fs.readdirSync(reqRoot)) {
        const d = path.join(reqRoot, name, 'bugs', id);
        if (fs.existsSync(d)) return { dir: d, type, nested: true };
      }
    }
  }
  throw new AtbError(`找不到 ${id}（可用 atb list 查看全部条目）`);
}

// ---------- 条目截图附件（REQ-20260909-009：新建需求 / Bug 描述支持截图） ----------
// 校验与落盘口径全面对齐讨论单附件（REQ-20260907-001，oncall-store）：图片后缀白名单、
// 单文件 8MB 上限（与 /api/fs/raw 一致）、防穿越文件名、同名自动加序号不覆盖。
// 截图随条目目录进 git（attachments/ 子目录），README 描述节以相对引用追加，人与 Agent
// 直接读 markdown 也能看到引用关系。常量与工具集中在本模块，oncall-store 复用（单一真源）。

export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024; // 附件（截图）单文件上限，与 /api/fs/raw 一致
export const ATTACHMENT_IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.bmp': 'image/bmp', '.avif': 'image/avif',
};
export const ITEM_ATTACHMENTS_MAX = 9; // 新建表单截图张数上限（design.md 定稿：README 建议 ≤9）

export function attachmentMime(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return ATTACHMENT_IMAGE_MIME[ext] || null;
}

// 附件文件名校验：不含路径分隔符/控制字符（含穿越形态直接拒绝，不静默改名），仅白名单图片后缀
function safeAttachmentName(name) {
  const base = String(name || '').trim();
  if (!base || base.startsWith('.') || base !== path.basename(base)) {
    throw new AtbError(`非法附件文件名：${name}`);
  }
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(base)) throw new AtbError(`非法附件文件名：${name}`);
  const ext = path.extname(base).toLowerCase();
  if (!ATTACHMENT_IMAGE_MIME[ext]) {
    throw new AtbError(`附件仅支持图片（${Object.keys(ATTACHMENT_IMAGE_MIME).join(' ')}）：${name}`);
  }
  return base;
}

// 落盘单个附件到 <dir>/attachments/：返回最终文件名（同名单附件自动加序号后缀，不覆盖既有文件）
export function saveItemAttachment(dir, name, buf) {
  const base = safeAttachmentName(name);
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length > ATTACHMENT_MAX_BYTES) {
    throw new AtbError(`附件 ${(buf.length / 1024 / 1024).toFixed(1)}MB 超过 8MB 上限`);
  }
  const attDir = path.join(dir, 'attachments');
  fs.mkdirSync(attDir, { recursive: true });
  let target = path.join(attDir, base);
  if (fs.existsSync(target)) {
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    let i = 2;
    while (fs.existsSync(path.join(attDir, `${stem}-${i}${ext}`))) i++;
    target = path.join(attDir, `${stem}-${i}${ext}`);
  }
  fs.writeFileSync(target, buf);
  return path.basename(target);
}

// 读取条目附件：白名单 + 防穿越（basename 拒绝 ../）+ 8MB 在线展示上限
export function readItemAttachment(dir, name) {
  const base = safeAttachmentName(name);
  const attDir = path.join(dir, 'attachments');
  const file = path.resolve(attDir, base);
  if (!(file + path.sep).startsWith(attDir + path.sep) || !fs.existsSync(file)) {
    throw new AtbError(`附件不存在：${name}`);
  }
  if (fs.statSync(file).size > ATTACHMENT_MAX_BYTES) {
    throw new AtbError(`图片超过 8MB 上限，不在线展示`);
  }
  return fs.readFileSync(file);
}

// 解析创建请求附件数组：[{ name, dataBase64 }] → [{ name, buf }]。
// 逐项校验（张数 / 白名单 / 大小 / 数据形态），任一非法抛错——配合 createItem
// 「先全量校验再占号落盘」的原子性口径（对齐 core.editItem，整单拒绝不留半写入目录）。
export function parseItemAttachments(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new AtbError('attachments 必须是数组');
  if (list.length > ITEM_ATTACHMENTS_MAX) {
    throw new AtbError(`截图最多 ${ITEM_ATTACHMENTS_MAX} 张（收到 ${list.length} 张）`);
  }
  return list.map((att) => {
    if (!att || typeof att !== 'object') throw new AtbError('附件格式非法（需要 { name, dataBase64 }）');
    const name = safeAttachmentName(att.name);
    let buf;
    if (typeof att.dataBase64 === 'string') buf = Buffer.from(att.dataBase64, 'base64');
    else if (Buffer.isBuffer(att.data)) buf = att.data;
    else throw new AtbError(`附件 ${att.name} 缺少数据（dataBase64）`);
    if (buf.length > ATTACHMENT_MAX_BYTES) {
      throw new AtbError(`附件 ${(buf.length / 1024 / 1024).toFixed(1)}MB 超过 8MB 上限`);
    }
    return { name, buf };
  });
}

// ---------- 创建 ----------

function reqReadme(id, title, description) {
  return `# ${id} ${title}

- 状态：submitted（待人工接受）
- 创建：${new Date().toISOString()}

## 描述

${description || '（待补充）'}

## 验收标准

- [ ] （待补充）
`;
}

function reqDesign(id, title) {
  return `# 设计 — ${id} ${title}

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

## 方案

（技术选型、接口设计、影响面）

**开源选型（REQ-20260909-015）**：动手自研前先评估是否有成熟、维护中的开源库，优先复用——以依赖方式引入
（Node/Web 项目走 npm，Apple 平台走 SPM / CocoaPods），禁止复制开源库源码进项目仓库；仅当库无包分发渠道
且确需使用时才允许 vendor（内嵌源码），须在 licenses.md 标注复制范围与原因。License 只用开源友好白名单：
MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense；GPL / LGPL / AGPL / SSPL 等
强传染许可及 License 不明的库禁止引入。自研须写明理由（三选一）：引用了哪些库 / 无合适库的原因 /
引入成本高于自研的原因。引入开源库须在条目目录维护 licenses.md（库名 / 版本 / 引入方式 / License / 仓库地址），
未使用开源库的条目不创建该文件。

## 风险与边界
`;
}

function reqTestCases(id, title) {
  return `# 测试用例 — ${id} ${title}

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
`;
}

// REQ-20260908-009：Bug 一律独立创建，不再有归属需求；源单（引入来源）写 design.md。
function bugReadme(id, title, description) {
  return `# ${id} ${title}

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：${new Date().toISOString()}

## 现象

${description || '（待补充）'}

## 复现步骤

1.

## 期望行为
`;
}

// Bug 设计说明书：核心是「引入来源（源单）」节（REQ-20260830-004 归因规范的落点）。
function bugDesign(id, title) {
  return `# 设计 — ${id} ${title}

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-… / BUG-…（编号需经 \`atb list\` 核验真实存在）
- 引入来源：未定位（排查过程：…）
- （登记时暂空：尚未排查）

## 根因分析

## 方案

**开源选型（REQ-20260909-015）**：动手自研前先评估是否有成熟、维护中的开源库，优先复用——以依赖方式引入
（Node/Web 项目走 npm，Apple 平台走 SPM / CocoaPods），禁止复制开源库源码进项目仓库；仅当库无包分发渠道
且确需使用时才允许 vendor（内嵌源码），须在 licenses.md 标注复制范围与原因。License 只用开源友好白名单：
MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense；GPL / LGPL / AGPL / SSPL 等
强传染许可及 License 不明的库禁止引入。自研须写明理由（三选一）：引用了哪些库 / 无合适库的原因 /
引入成本高于自研的原因。引入开源库须在条目目录维护 licenses.md（库名 / 版本 / 引入方式 / License / 仓库地址），
未使用开源库的条目不创建该文件。

## 风险与边界
`;
}

// REQ-20260909-009：attachments = [{ name, dataBase64 }]，先全量校验（张数/白名单/大小/数据）
// 再占号落盘——任一附件非法整单拒绝，不留半写入条目目录（对齐 core.editItem 原子性口径）。
// 附件落盘 <条目目录>/attachments/（同名自动加序号不覆盖），README 描述（需求）/ 现象（Bug）
// 节末尾按添加顺序追加 `![截图](attachments/<编码后文件名>)` 引用行；无附件口径与旧版完全一致。
// REQ-20260910-015：accept=true 一步「创建并接受」——创建完成后立即按 setStatus 进 accepted 的
// 同一口径落 accepted（history 追加 submitted → accepted「创建并接受」、refine 索引置未完善），
// 与「先创建再人工接受」完全等价；接受环节写状态失败时回滚删除条目目录，不留半成品
// （单号计数器不回退，对齐 deleteItem 口径）。缺省行为与旧版完全一致（落 submitted）。
export function createItem(dataDir, { type, title, description = '', parent = null, by, attachments = [], accept = false }) {
  if (type !== 'requirement' && type !== 'bug') throw new AtbError('type 必须是 requirement 或 bug');
  title = String(title || '').trim();
  if (!title) throw new AtbError('标题不能为空');
  if ([...title].length > 120) throw new AtbError('标题过长（不超过 120 字）');
  description = String(description ?? '');

  if (parent) {
    // REQ-20260908-009：Bug 一律独立创建（归属需求选项已去掉），源单改写 design.md 引入来源节。
    if (type === 'bug') {
      throw new AtbError('Bug 不再支持创建时归属需求（一律独立 Bug）；引入来源（源单）请写入 design.md「引入来源」节');
    }
    throw new AtbError('需求不能归属其他需求');
  }

  const atts = parseItemAttachments(attachments); // 先全量校验再占号（不合规不消耗单号）

  const id = nextId(dataDir, type);
  const dir = path.join(dataDir, type === 'requirement' ? 'requirements' : 'bugs', id);
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const st = {
    id,
    type,
    title,
    status: 'submitted',
    parent: null,
    owner: null,
    createdAt: now,
    updatedAt: now,
    agentCompletedAt: null,
    lastReport: null,
    history: [{ at: now, from: null, to: 'submitted', by: by || actor() }],
  };
  writeStatus(dir, st);

  // 落盘附件并按最终文件名生成引用行（按添加顺序），追加在描述正文末尾
  const saved = atts.map((a) => saveItemAttachment(dir, a.name, a.buf));
  const descBody = saved.length
    ? (description.trim()
        ? `${description.trim()}\n\n${saved.map((n) => `![截图](attachments/${encodeURIComponent(n)})`).join('\n')}`
        : saved.map((n) => `![截图](attachments/${encodeURIComponent(n)})`).join('\n'))
    : description;

  if (type === 'requirement') {
    fs.writeFileSync(path.join(dir, 'README.md'), reqReadme(id, title, descBody));
    fs.writeFileSync(path.join(dir, 'design.md'), reqDesign(id, title));
    fs.writeFileSync(path.join(dir, 'test-cases.md'), reqTestCases(id, title));
  } else {
    fs.writeFileSync(path.join(dir, 'README.md'), bugReadme(id, title, descBody));
    fs.writeFileSync(path.join(dir, 'design.md'), bugDesign(id, title));
  }

  // REQ-20260910-015：创建并接受——文档全部落盘后再接受，失败回滚删除目录（要么完整 accepted、要么不留）
  if (accept) {
    try {
      st.status = 'accepted';
      st.updatedAt = new Date().toISOString();
      pushHistory(st, 'submitted', 'accepted', by || actor(), '创建并接受');
      writeStatus(dir, st);
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw e;
    }
    // 与 setStatus 进 accepted 同口径：置「未完善」进批量完善候选（首次接受无 reaccepted 标记）；
    // 索引写失败不阻断状态流转（REQ-20260908-020 同口径）
    try { setRefineItemState(dataDir, id, 'unrefined', {}); } catch { /* 索引写失败不阻断 */ }
  }
  return st;
}

// ---------- 改标题（REQ-20260907-011：仅待接受条目，人工修正登记表述） ----------

// 标题同步：条目文档首行形如 `# [设计 — |测试用例 — ]ID 标题`（createItem 生成）。
// 按 ID 定位首行，把 ID 之后的旧标题替换为新标题；首行不含 ID（用户完全改写过）则跳过不视为错误。
function syncDocTitles(dir, id, oldTitle, newTitle) {
  for (const name of orderedDocs(dir)) {
    const file = path.join(dir, name);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    const head = lines[0] || '';
    const idx = head.indexOf(id);
    if (!head.startsWith('# ') || idx === -1) continue;
    if (head.slice(idx + id.length).trimStart() !== oldTitle) continue; // 首行标题已被改写，保持原样
    lines[0] = `${head.slice(0, idx + id.length)} ${newTitle}`;
    fs.writeFileSync(file, lines.join('\n'));
  }
}

export function renameItem(dataDir, id, { title, by } = {}) {
  const { dir } = resolveItemDir(dataDir, id);
  const st = readStatus(dir);
  if (st.status !== 'submitted') {
    throw new AtbError(
      `${id} 当前状态 ${st.status} 不能改标题（仅待接受可改；` +
      '其余状态请直接编辑条目目录下的 markdown 文档，或另立新单）'
    );
  }
  title = String(title ?? '').trim();
  if (!title) throw new AtbError('标题不能为空');
  if ([...title].length > 120) throw new AtbError('标题过长（不超过 120 字）');
  if (title === st.title) throw new AtbError(`新标题与原标题相同（${st.title}），无需修改`);
  const oldTitle = st.title;
  syncDocTitles(dir, id, oldTitle, title);
  st.title = title;
  st.updatedAt = new Date().toISOString();
  pushHistory(st, st.status, st.status, by || actor(), `标题修改：「${oldTitle}」→「${title}」`);
  writeStatus(dir, st);
  return st;
}

// ---------- 编辑标题与描述（REQ-20260908-011：仅待接受条目，标题 + 描述一次改完） ----------

// 描述节口径：需求 README「## 描述」、Bug README「## 现象」（与创建模板同一口径）。
const DESC_HEADING = { requirement: '## 描述', bug: '## 现象' };

// 读取 README 描述节当前原文（去首尾空行）；缺节 / 缺 README 返回 null，由调用方决定预填或报错。
export function readDescriptionSection(dir, type) {
  const heading = DESC_HEADING[type];
  if (!heading) throw new AtbError(`类型 ${type} 没有描述节口径`);
  let text;
  try { text = fs.readFileSync(path.join(dir, 'README.md'), 'utf8'); } catch { return null; }
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

// 整节替换 README 描述节：保留节标题行与后续章节，节体替换为新描述（空 → 「（待补充）」占位）。
// 缺节时整体报错不落盘——宁可失败不可写错位置（不做模糊匹配兜底）。
function writeDescriptionSection(dir, type, desc) {
  const heading = DESC_HEADING[type];
  const file = path.join(dir, 'README.md');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) throw new AtbError(`README.md 缺少「${heading}」节，无法写回描述（不做模糊写入）`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  const body = String(desc ?? '').trim() || '（待补充）';
  fs.writeFileSync(file, [...lines.slice(0, start + 1), '', body, '', ...lines.slice(end)].join('\n'));
}

// 标题 + 描述一次改完（renameItem 的扩展，renameItem 保留兼容不动）：
// - 仅 submitted 可改（与 renameItem 同口径）；
// - 标题未传或与原标题相同、但描述有变化时照常保存；两者均无变化报「无变化」；
// - 描述唯一真源仍是 README 文档（status.json 不新增字段）；history 一次保存一条留痕。
export function editItem(dataDir, id, { title, description, by } = {}) {
  const { dir, type } = resolveItemDir(dataDir, id);
  const st = readStatus(dir);
  if (st.status !== 'submitted') {
    throw new AtbError(
      `${id} 当前状态 ${st.status} 不能编辑（仅待接受可改；` +
      '其余状态请直接编辑条目目录下的 markdown 文档，或另立新单）'
    );
  }
  const hasTitle = title != null;
  const hasDesc = description != null;
  if (!hasTitle && !hasDesc) throw new AtbError('标题与描述均无变化，无需保存（至少传一项）');
  // 先全量校验再落盘（原子性）：标题非法时描述不得先写，缺节时标题也不得先写
  let newTitle = null;
  if (hasTitle) {
    newTitle = String(title).trim();
    if (!newTitle) throw new AtbError('标题不能为空');
    if ([...newTitle].length > 120) throw new AtbError('标题过长（不超过 120 字）');
  }
  let descChanged = false;
  if (hasDesc) {
    const current = readDescriptionSection(dir, type);
    if (current == null) {
      throw new AtbError(`README.md 缺少「${DESC_HEADING[type]}」节，无法写回描述（不做模糊写入）`);
    }
    descChanged = (String(description).trim() || '（待补充）') !== current;
  }
  const titleChanged = hasTitle && newTitle !== st.title;
  if (!titleChanged && !descChanged) throw new AtbError('标题与描述均无变化，无需保存');
  const oldTitle = st.title;
  if (titleChanged) syncDocTitles(dir, id, oldTitle, newTitle);
  if (descChanged) writeDescriptionSection(dir, type, String(description));
  if (titleChanged) st.title = newTitle;
  st.updatedAt = new Date().toISOString();
  const note = titleChanged && descChanged
    ? `标题 + 描述修改：「${oldTitle}」→「${newTitle}」（README「${DESC_HEADING[type]}」节整体替换）`
    : titleChanged
      ? `标题修改：「${oldTitle}」→「${newTitle}」`
      : `描述修改（README「${DESC_HEADING[type]}」节整体替换）`;
  pushHistory(st, st.status, st.status, by || actor(), note);
  writeStatus(dir, st);
  return st;
}

// ---------- 删除条目（REQ-20260908-003：仅待接受，人工清理误登记） ----------

// 物理删除条目目录（status.json + 全部文档）。目录即全部数据，删除后无处留痕，
// 故无 history 记录；追溯依赖 git 历史（docs/ 随代码进版本控制）。
// 单号计数器（config.json）不回退：单号全局唯一不复用，避免与外部引用错位。
export function deleteItem(dataDir, id, { by } = {}) {
  const { dir, type } = resolveItemDir(dataDir, id);
  const st = readStatus(dir);
  if (st.status !== 'submitted') {
    throw new AtbError(
      `${id} 当前状态 ${st.status} 不能删除（仅待接受可删；` +
      '已进入流程的条目请用驳回 / 新单处理）'
    );
  }
  if (type === 'requirement') {
    const bugs = childBugs(dir);
    if (bugs.length) {
      throw new AtbError(
        `${id} 还有下属 Bug（${bugs.map((b) => b.id).join('、')}）：` +
        '请先删除这些 Bug 或用 atb move 移动归属，再删除需求'
      );
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { id, title: st.title, type, dir };
}

// ---------- 状态流转 ----------

export function setStatus(dataDir, id, to, { by, note = '', force = false } = {}) {
  if (!STATES.includes(to)) throw new AtbError(`非法状态：${to}（合法值：${STATES.join(' | ')}）`);
  const { dir } = resolveItemDir(dataDir, id);
  const st = readStatus(dir);
  if (st.status === to) return { changed: false, status: st };
  const allowed = TRANSITIONS[st.status] || [];
  if (!allowed.includes(to)) {
    throw new AtbError(
      `非法流转：${st.status} → ${to}。` +
      `合法路径 submitted → accepted → planned → in-progress → done；人工可驳回：done → in-progress、accepted → submitted、planned → accepted（移出计划）。` +
      `其中 accepted / planned / done 只能由人工在 Status Board 或终端执行。`
    );
  }
  // REQ-20260911-007 确认完成防呆：待人工决策未答完的条目确认完成前显式拦截——
  // 补齐决策并复工，或人工显式 force 越过（终端 --force / 网页二次确认）；
  // 决策已答完（或 force）时随确认完成闭环 hold 记录（closed-done）并刷新 decisions.md。
  if (st.status === 'in-progress' && to === 'done') {
    const hold = activeHoldOf(dataDir, id);
    if (hold) {
      const n = unansweredCount(hold);
      const who = by || actor();
      if (n > 0 && !force) {
        throw new AtbError(
          `${id} 尚有 ${n} 项人工决策未答（待人工决策，${hold.declaredBy || 'worker'} 声明）：` +
          '请先在 Status Board「待人工确认」补齐决策并复工；确要按现状完成请显式越过' +
          `（终端 atb status ${id} done --force；网页端二次确认）`
        );
      }
      const closed = {
        ...hold,
        state: 'closed-done',
        events: [...(hold.events || []), {
          at: new Date().toISOString(),
          kind: 'closed-done',
          by: who,
          note: n > 0 ? `人工显式确认完成（越过 ${n} 项未答决策）` : '决策已补齐，随确认完成闭环',
        }],
      };
      saveHoldRecord(dataDir, id, closed);
      renderDecisionsDoc(dataDir, id, dir, st.title);
    }
  }
  // REQ-20260908-020：完善中的已接受单不可驳回回待接受（CLI 与 UI 双侧同口径，防绕过）
  if (st.status === 'accepted' && to === 'submitted' && refineStateOf(dataDir, id) === 'refining') {
    throw new AtbError(`${id} 完善中，待本轮 AI 分析结束后再驳回回待接受`);
  }
  const from = st.status;
  const now = new Date().toISOString();
  st.status = to;
  st.updatedAt = now;
  if (from === 'accepted' && to === 'planned') {
    // 人工置计划（REQ-20260908-010）：排入开发计划，等待开发启动后最旧优先处理
    note = note || '人工置为已计划';
  }
  if (from === 'planned' && to === 'accepted') {
    // 人工移出计划（REQ-20260908-010）：退回已接受；已计划必然无 owner/认领锁，无需清理
    note = note || '人工移出计划，退回已接受';
  }
  if (from === 'accepted' && to === 'submitted') {
    // 人工驳回接受（REQ-20260907-011）：退回待接受；accepted 必然无 owner/认领锁，无需清理
    note = note || '人工驳回接受，退回待接受';
  }
  if (from === 'in-progress' && to === 'done') {
    // 人工确认完成：释放认领锁（BUG-20260903-002），有锁=确有会话在开发中；
    // 手工实施占用同步释放（BUG-20260906-002，幂等：report 已释放则无操作）
    releaseLock(path.join(dataDir, '.locks', `${id}.lock`));
    releaseImplLockForManual(dataDir, id);
    note = note || '人工确认完成';
  }
  if (from === 'done' && to === 'in-progress') {
    // 人工驳回：清空认领与完成标记，删除认领锁，允许 Agent 重新 claim；
    // 顺带清理手工实施占用残留（BUG-20260906-002 崩溃恢复路径，幂等）
    st.owner = null;
    st.agentCompletedAt = null;
    releaseLock(path.join(dataDir, '.locks', `${id}.lock`));
    releaseImplLockForManual(dataDir, id);
    note = note || '人工驳回完成，退回开发';
  }
  pushHistory(st, from, to, by || actor(), note);
  writeStatus(dir, st);
  // BUG-20260915-007：例外进入开发（认领受阻例外授权 status → in-progress，及驳回重开）
  // 捕获工作区快照，作为 report 无 run 收口提交的归因基线兜底（已 claim 的同周期保留最早快照）。
  if (to === 'in-progress') {
    try {
      captureManualTreeSnapshot({ dataDir, projectRoot: path.resolve(dataDir, '..', '..'), itemId: id, owner: by || actor(), note: 'status → in-progress（例外授权/驳回重开）' });
    } catch { /* 快照失败不阻断状态流转，report 收口按缺失快照口径处理 */ }
  }
  // REQ-20260908-020：任何单进入 accepted（含驳回后再接受、移出计划回已接受）一律置「未完善」，
  // 直到下一轮批量完善任务处理；三态只落执行账本索引（refine/states.json），不写 status.json。
  if (to === 'accepted') {
    // BUG-20260908-010：「再接受」（此前已有索引记录）时带确定性事件标记 reaccepted——
    // 供批量完善识别「终态回执后被重新接受」的条目重新入队；首次接受无记录不带标记。
    const hadRecord = refineStateOf(dataDir, id) != null;
    try { setRefineItemState(dataDir, id, 'unrefined', hadRecord ? { reaccepted: true } : {}); } catch { /* 索引写失败不阻断状态流转 */ }
  }
  return { changed: true, status: st };
}

function acquireLockOrOwned(lockPath, staleMs, owner) {
  // 获取锁；若锁已被同一 owner 持有则视为幂等成功
  try {
    acquireLock(lockPath, staleMs, { owner, at: new Date().toISOString() });
  } catch (e) {
    let holder = null;
    try { holder = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
    if (holder && holder.owner === owner) return;
    throw e;
  }
}

export function claim(dataDir, id, owner) {
  owner = owner || actor();
  const { dir } = resolveItemDir(dataDir, id);
  const st = readStatus(dir);
  if (st.status === 'submitted') {
    throw new AtbError(`${id} 尚未被人工接受，不能认领（请让用户在 Status Board 上点「接受」）`);
  }
  if (st.status === 'done') throw new AtbError(`${id} 已完成，无需认领`);
  // REQ-20260911-007 认领防呆：待人工决策（holding）期间任何 owner（含原 owner 续认）一律拒绝，
  // 指向待确认原因——不得静默产生第二实施者，也不得绕过人工决策继续开发。
  const hold = activeHoldOf(dataDir, id);
  if (hold) {
    const n = unansweredCount(hold);
    throw new AtbError(
      `${id} 待人工决策（${n} 项未答，${hold.declaredBy || 'worker'} 于 ${String(hold.declaredAt || '').slice(0, 10)} 声明${hold.reason ? `：${hold.reason}` : ''}）：` +
      '请在 Status Board「待人工确认」（或 atb hold list）补齐决策并复工后再实施'
    );
  }
  // REQ-20260914-001 项目级挂起防呆：存在「待人工确认提交」的挂起条目时整个开发队列暂停，
  // 任何条目的认领（含 /dev loop、手工、其他条目）一律拒绝——不得绕过人工确认放大混合修改；
  // 确认并继续（核验+补交+测试通过）后自动恢复。
  const confirmWaiting = waitingDevelopConfirm(dataDir);
  if (confirmWaiting) {
    throw new AtbError(
      `项目挂起：${confirmWaiting.itemId} 自动提交不完整（${confirmWaiting.reason || '待人工确认提交'}），` +
      `暂停期间不得认领 ${id}；请到 Status Board 任务页「待人工确认」完成确认后继续`
    );
  }
  // 条目级冲突先行：异 owner 续认同一条目 → 提示指向条目本身
  if ((st.status === 'pending-alignment' || st.status === 'in-progress') && st.owner && st.owner !== owner) {
    throw new AtbError(`${id} 已被 ${st.owner} 认领；请用 atb list 另选任务`);
  }
  // 项目实施互斥（REQ-20260906-002）：批次/Codex 派发/他人手工正在实施时拒绝认领（锁属主本人放行）
  assertNoImplConflict(dataDir, owner);
  const now = new Date().toISOString();
  if (st.status === 'accepted' || st.status === 'planned') {
    // 认领即实施（REQ-20260903-001 单阶段回退）；planned 与 accepted 同等对待
    // （REQ-20260908-010：调度器从已计划队列取单，认领即进入开发中）；
    // 手工/普通认领同样占用项目实施互斥（BUG-20260906-002），其余实施入口一律阻塞
    acquireImplLockForClaim(dataDir, id, owner, now);
    try {
      acquireLock(path.join(dataDir, '.locks', `${id}.lock`), CLAIM_LOCK_STALE_MS, { owner, at: now });
    } catch (e) {
      releaseImplLockForManual(dataDir, id); // 条目锁获取失败：回滚刚占用的实施互斥
      throw e;
    }
    const from = st.status;
    st.status = 'in-progress';
    st.owner = owner;
    st.updatedAt = now;
    pushHistory(st, from, 'in-progress', owner, `认领（${owner}）`);
    writeStatus(dir, st);
    // BUG-20260915-007：认领即拍工作区快照（与批量预留 nextItem 同构）——report 无 run
    // 收口提交以此为归因基线。快照失败不阻断认领（收口按缺失快照口径处理）。
    try {
      captureManualTreeSnapshot({ dataDir, projectRoot: path.resolve(dataDir, '..', '..'), itemId: id, owner });
    } catch { /* 同上：不阻断认领 */ }
    return st;
  }
  if (st.status === 'pending-alignment' || st.status === 'in-progress') {
    // 存量待对齐/in-progress 续认：同 owner 放行（补锁），异 owner 已被上方条目级检查拒绝
    acquireImplLockForClaim(dataDir, id, owner, now);
    acquireLockOrOwned(path.join(dataDir, '.locks', `${id}.lock`), CLAIM_LOCK_STALE_MS, owner);
    if (!st.owner) st.owner = owner;
    writeStatus(dir, st);
    // 续认同属同一认领周期：captureManualTreeSnapshot 幂等保留最早快照（上一周期已收口则刷新）
    try {
      captureManualTreeSnapshot({ dataDir, projectRoot: path.resolve(dataDir, '..', '..'), itemId: id, owner, note: '续认（同周期保留原快照）' });
    } catch { /* 快照失败不阻断续认 */ }
    return st;
  }
  throw new AtbError(`${id} 当前状态 ${st.status} 不能认领`);
}

// REQ-20260911-007 待人工决策复工专用通路：in-progress → planned。
// 不进通用 TRANSITIONS（普通 setStatus / 网页状态接口不提供此边）——仅人工经
// atb hold resume（终端）/ Status Board 复工按钮触发，hold-store 校验决策齐备后调用。
// 与 done → in-progress 驳回同口径清理：owner 清空、认领锁删除、手工实施占用释放；history 留痕。
export function resumeItemToPlanned(dataDir, id, { by, note = '' } = {}) {
  const { dir } = resolveItemDir(dataDir, id);
  const st = readStatus(dir);
  if (st.status !== 'in-progress') {
    throw new AtbError(
      `${id} 状态已变化（当前 ${st.status}），不能按原声明复工；` +
      '请核对当前状态后人工处理（如已完成则确认完成，仍需开发请按状态机流转）'
    );
  }
  const from = st.status;
  const now = new Date().toISOString();
  st.status = 'planned';
  st.owner = null;
  st.updatedAt = now;
  pushHistory(st, from, 'planned', by || actor(), note || '待人工决策复工（人工补齐决策，回已计划队列）');
  writeStatus(dir, st);
  releaseLock(path.join(dataDir, '.locks', `${id}.lock`));
  releaseImplLockForManual(dataDir, id);
  return st;
}

export function report(dataDir, id, { coverage = null, framework = '', summary = '', by, run = null } = {}) {
  const { dir } = resolveItemDir(dataDir, id);
  const st = readStatus(dir);
  if (st.status !== 'in-progress') {
    throw new AtbError(`只有 in-progress 的条目才能上报测试报告（${id} 当前是 ${st.status}）`);
  }
  by = by || actor();
  // 运行关联（REQ-20260906-002）：批量执行的 report 带 --run 记录 runId，供回执核对排除旧报告重放；
  // 不带 run 的旧调用保持兼容（runId 为 null）。
  const runId = run && run.runId ? String(run.runId) : null;
  const now = new Date().toISOString();
  const cov = coverage == null || coverage === '' ? null : Number(coverage);
  if (cov != null && (!Number.isFinite(cov) || cov < 0 || cov > 100)) {
    throw new AtbError('覆盖率必须是 0-100 的数字');
  }
  const md = `# 测试报告 — ${id} ${st.title}

- 时间：${now}
- 执行者：${by}
- 测试框架：${framework || '未填写'}
- 覆盖率：${cov == null ? '未统计' : `${cov}%`}

## 总结

${summary || '（未填写）'}

## 明细

（可粘贴命令输出、失败用例说明等）
`;
  fs.writeFileSync(path.join(dir, 'test-report.md'), md);
  st.lastReport = { at: now, coverage: cov, framework: framework || '', summary: summary || '', runId };
  st.agentCompletedAt = now;
  st.updatedAt = now;
  pushHistory(st, st.status, st.status, by, `上报测试报告${cov != null ? `（覆盖率 ${cov}%）` : ''}，待人工确认完成`);
  writeStatus(dir, st);
  // 上报即停止开发：释放认领锁（BUG-20260903-002）。条目仍为 in-progress（待人工确认），
  // 原认领者可随时 claim 续认补锁继续开发；guard 的「有锁=在开发中」放行条件因此重新收紧。
  releaseLock(path.join(dataDir, '.locks', `${id}.lock`));
  // 手工实施占用一并释放（BUG-20260906-002）：上报后其余实施入口恢复；
  // 批次（kind=batch）/Codex（kind=codex）占用由各自回执收尾释放，此处不动。
  releaseImplLockForManual(dataDir, id);
  return st;
}

// ---------- 认领锁维护（BUG-20260903-002） ----------

// 认领锁生命周期：claim 创建 → report（待人工确认）/ 确认完成（→done）/ 驳回（done→in-progress）即释放。
// 旧版本只驳回才释放，曾积累大量残留锁架空守卫；pruneLocks 一次性清理：
// 仅保留「条目 in-progress 且锁未过期」的认领锁；config.lock 按新鲜度处理；其余（不在办、孤儿、过期）删除。
export function pruneLocks(dataDir, { apply = true } = {}) {
  const locksDir = path.join(dataDir, '.locks');
  const kept = [];
  const removed = [];
  const skipped = [];
  if (!fs.existsSync(locksDir)) return { kept, removed, skipped };
  const now = Date.now();
  for (const name of fs.readdirSync(locksDir).sort()) {
    if (!name.endsWith('.lock')) continue;
    const file = path.join(locksDir, name);
    const base = name.slice(0, -'.lock'.length);
    if (base === 'config') {
      // 计数器互斥锁（30s 过期）：新鲜说明可能有进程正在占用，保留
      let ageMs = Infinity;
      try { ageMs = now - fs.statSync(file).mtimeMs; } catch {}
      if (ageMs > CONFIG_LOCK_STALE_MS) {
        if (apply) { try { fs.unlinkSync(file); } catch {} }
        removed.push({ name, reason: 'config.lock 已过期（>30s）' });
      } else {
        kept.push({ name });
      }
      continue;
    }
    if (!ID_RE.test(base)) {
      skipped.push(name);
      continue;
    }
    let keep = false;
    let reason = '';
    try {
      const { dir } = resolveItemDir(dataDir, base);
      const st = readStatus(dir);
      let ageMs = Infinity;
      try { ageMs = now - fs.statSync(file).mtimeMs; } catch {}
      if (st.status === 'in-progress') {
        if (ageMs < CLAIM_LOCK_STALE_MS) {
          keep = true;
        } else {
          reason = `条目在办但锁已过期（>24h）`;
        }
      } else {
        reason = `条目已 ${st.status}，不在开发中`;
      }
    } catch (e) {
      reason = `找不到条目或状态损坏（${e.message}）`;
    }
    if (keep) {
      kept.push({ name });
      continue;
    }
    if (apply) { try { fs.unlinkSync(file); } catch {} }
    removed.push({ name, reason });
  }
  return { kept, removed, skipped };
}

// ---------- 查询 ----------

function readStatusSafe(dir) {
  try {
    return readStatus(dir);
  } catch {
    return null;
  }
}

function childBugs(reqDir) {
  const root = path.join(reqDir, 'bugs');
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .sort()
    .map((n) => readStatusSafe(path.join(root, n)))
    .filter(Boolean);
}

export function listItems(dataDir) {
  const items = [];
  const reqRoot = path.join(dataDir, 'requirements');
  if (fs.existsSync(reqRoot)) {
    for (const name of fs.readdirSync(reqRoot).sort()) {
      const dir = path.join(reqRoot, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const st = readStatusSafe(dir);
      if (!st) continue;
      const bugs = childBugs(dir);
      st.bugs = bugs.map((b) => b.id);
      st.bugCount = bugs.length;
      st.openBugCount = bugs.filter((b) => b.status !== 'done').length;
      items.push(st);
      // 归属需求的 Bug 也是独立条目，需要出现在列表与看板列中
      items.push(...bugs);
    }
  }
  const bugRoot = path.join(dataDir, 'bugs');
  if (fs.existsSync(bugRoot)) {
    for (const name of fs.readdirSync(bugRoot).sort()) {
      const dir = path.join(bugRoot, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const st = readStatusSafe(dir);
      if (st) items.push(st);
    }
  }
  return items.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

export function orderedDocs(dir) {
  const present = new Set(
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md') && fs.statSync(path.join(dir, f)).isFile())
  );
  return [...DOC_ORDER.filter((n) => present.has(n)), ...[...present].filter((n) => !DOC_ORDER.includes(n)).sort()];
}

export function getItemDetail(dataDir, id) {
  const { dir } = resolveItemDir(dataDir, id);
  const st = readStatus(dir);
  const detail = { ...st, docs: orderedDocs(dir) };
  if (st.type === 'requirement') {
    const bugs = childBugs(dir).map((b) => ({
      id: b.id, title: b.title, status: b.status, agentCompletedAt: b.agentCompletedAt,
    }));
    detail.bugs = bugs;
    detail.bugCount = bugs.length;
    detail.openBugCount = bugs.filter((b) => b.status !== 'done').length;
  }
  return detail;
}

export function readDoc(dataDir, id, name) {
  if (!/^[\w.-]+\.md$/.test(name)) throw new AtbError('只能读取条目目录下的 .md 文档');
  const { dir } = resolveItemDir(dataDir, id);
  const file = path.resolve(dir, name);
  if (!(file + path.sep).startsWith(dir + path.sep) || !fs.existsSync(file)) {
    throw new AtbError(`文档不存在：${name}`);
  }
  return fs.readFileSync(file, 'utf8');
}

// ---------- 移动 Bug ----------

export function moveBug(dataDir, id, parent) {
  const { dir, type } = resolveItemDir(dataDir, id);
  if (type !== 'bug') throw new AtbError('只有 Bug 可以移动归属');
  let destDir;
  if (parent) {
    const p = resolveItemDir(dataDir, parent);
    if (p.type !== 'requirement') throw new AtbError(`归属 ${parent} 不是需求编号`);
    destDir = path.join(p.dir, 'bugs', id);
  } else {
    destDir = path.join(dataDir, 'bugs', id);
  }
  if (path.resolve(destDir) === path.resolve(dir)) return { moved: false };
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.renameSync(dir, destDir);
  const st = readStatus(destDir);
  const now = new Date().toISOString();
  st.parent = parent || null;
  st.updatedAt = now;
  pushHistory(st, st.status, st.status, actor(), parent ? `归属变更为 ${parent}` : '改为独立 Bug');
  writeStatus(destDir, st);
  return { moved: true };
}

// ---------- 看板聚合 ----------

export function boardData(cwd) {
  const dataDir = dataDirFrom(cwd);
  if (!dataDir) {
    return { initialized: false, dataDir: null, projectRoot: path.resolve(cwd), generatedAt: new Date().toISOString(), items: [] };
  }
  return {
    initialized: true,
    dataDir,
    projectRoot: path.resolve(dataDir, '..', '..'),
    generatedAt: new Date().toISOString(),
    items: listItems(dataDir),
  };
}
