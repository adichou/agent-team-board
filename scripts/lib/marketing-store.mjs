// REQ-20260910-019 营销档案数据层（marketing-store）—— server.mjs 使用。
// 事实源：<dataDir>/marketing/（与 requirements/bugs 完全隔离，不进 REQ/BUG 状态机）：
//   profile.json          营销档案：定位字段 + 证据条目 + 当前定价指针（唯一可变文件，revision 乐观锁）
//   pricing/v<N>.json     定价版本：一次保存一个新文件，永不覆盖（v1、v2…按现存最大 N 递增）
// 语义边界：
//   - 读取 README 只形成初始化草稿，不代表市场需求已被验证；
//   - 候选定价保存不会自动成为当前定价，「设为当前方案」是唯一改指针的显式操作；
//   - 版本文件不可变，供后续渠道/活动按「创建时绑定版本」引用；
//   - 未知价格留 null，不生成无依据的确定价格；
//   - 本模块只记录方案，不触碰商店或支付系统实际价格。

// REQ-20260910-020 渠道与行动看板（同目录扩展，语义边界）：
//   channels/<id>.json     渠道：长期触点（平台 / 链接 / 受众 / 语言 / 形式 / 优先级 / 每周投入 / 数据获取 / 能力）
//   experiments/<id>.json  实验：一个推广假设（假设 / 主指标 / 观察窗口 / 成功标准 / 预算与支出 /
//                          工时 / 定价版本绑定 / 最终决策 / copiedFrom 来源）
//   activities/<id>.json   行动：一篇内容或一次发布（渠道 / 实验 / 内容草稿 / 素材引用 / 计划时间与时区 /
//                          发布链接或凭据 / 负责人 / 下一步 / linkedReqs / 状态与操作历史）
// 状态机：草稿 draft → 待发布 pending → 已发布 published → 观察中 observing → 已复盘 reviewed；
//   未复盘状态可 stopped（记录原因）；已复盘/已停止后经「复制为新实验」再尝试（新 ID + copiedFrom 保留历史）。
//   误操作走「更正」（仅回退，记录原因与历史）；推进按链式下一步，跳步拒绝。
//   发布凭据缺失不改状态；复盘需依据与决策，数据不足可选「暂不能判断」（undetermined，不等同验证成功）。
//   创建开发需求经统一 createItem 落 submitted（不自动接受 / 实施），README 描述带行动来源（双向关联），
//   携带幂等 key：同 key 重试不重复创建。

// REQ-20260910-021 效果与复盘（同目录扩展，语义边界）：
//   metrics/definitions.json    指标字典：默认播种五分类（曝光 / 互动 / 持续关注 / 使用 / 商业），
//                                自定义指标追加不覆盖；损坏报错不静默重建
//   metrics/observations/*.json 观察记录：指标键 + 起止日期 + 渠道 / 实验归属构成观察键；
//                                值 null=未知、0=真实零；修订带理由入历史（revision 递增）
//   reviews/<id>.json           复盘：观察期 + 目标 / 实际 + 固定观察快照 + 结论 + 下一步；
//                                快照在保存时捕获（含值与修订号），后续数据修订不改变历史复盘依据；
//                                无数据可保存「数据不足」（insufficient），不伪造改善幅度
// 观察键 = 指标 + 周期 + 归属（不含来源）：同键同值幂等（重复导入无变化、来源不静默改写）；
//   同键不同值为冲突——手工录入走修订（需理由），CSV 导入逐行选择修订或跳过，不静默相加。
// 聚合口径：第一版只对同口径、同币种、可加的互斥数据求和；存量指标取最新不跨日期相加；
//   关注类不跨平台求和（分开呈现）；独立人数按去重口径分开呈现；不同币种不默认换算。
//   转化率仅在同周期、同归属（口径一致）且分母有效时计算，否则「不可计算」并给出原因。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  AtbError, writeJsonAtomic, localDateStamp, createItem,
} from './core.mjs';

export const MARKETING_SCHEMA_VERSION = 1;

export const STAGES = ['exploring', 'validating', 'launched', 'growing'];
export const STAGE_LABEL = { exploring: '探索', validating: '验证', launched: '上线', growing: '增长' };

export const EVIDENCE_TYPES = ['fact', 'hypothesis', 'unverified'];
export const EVIDENCE_TYPE_LABEL = { fact: '事实', hypothesis: '假设', unverified: '待确认' };

export const PRICING_MODELS = ['free', 'onetime', 'subscription', 'usage', 'hybrid'];
export const PRICING_MODEL_LABEL = {
  free: '免费', onetime: '买断', subscription: '订阅', usage: '按量', hybrid: '混合',
};

// REQ-20260910-020 渠道与行动
export const CHANNEL_PRIORITIES = ['high', 'medium', 'low'];
export const CHANNEL_PRIORITY_LABEL = { high: '高', medium: '中', low: '低' };

export const ACTIVITY_STATUSES = ['draft', 'pending', 'published', 'observing', 'reviewed', 'stopped'];
export const ACTIVITY_STATUS_LABEL = {
  draft: '草稿', pending: '待发布', published: '已发布', observing: '观察中', reviewed: '已复盘', stopped: '已停止',
};
// 链式推进：只能到紧邻下一步；stopped 从任意未复盘状态进入（reviewed 除外，其结论由复盘决策承载）
const ACTIVITY_NEXT = { draft: 'pending', pending: 'published', published: 'observing', observing: 'reviewed' };
const ACTIVITY_ORDER = { draft: 0, pending: 1, published: 2, observing: 3, reviewed: 4, stopped: 5 };

export const ACTIVITY_DECISIONS = ['continue', 'adjust', 'stop', 'undetermined'];
export const ACTIVITY_DECISION_LABEL = { continue: '继续', adjust: '调整', stop: '停止', undetermined: '暂不能判断' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

// 并发冲突：携带服务端最新 revision 供客户端「重新载入」后重试（不静默覆盖）
export class MarketingConflictError extends AtbError {
  constructor(message, currentRevision) {
    super(message);
    this.currentRevision = currentRevision;
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

// ---------- 目录 ----------

export function marketingDir(dataDir) {
  return path.join(dataDir, 'marketing');
}
export function pricingDir(dataDir) {
  return path.join(marketingDir(dataDir), 'pricing');
}
export function profileFile(dataDir) {
  return path.join(marketingDir(dataDir), 'profile.json');
}

// ---------- 校验工具（错误收集到 fields：键为字段路径，值为中文提示） ----------

function strVal(v, { max = 2000, label = '内容' } = {}) {
  if (v == null) return '';
  return String(v).slice(0, max + 1); // 超限在 validate 阶段报错，这里先统一成字符串
}

function collectStr(fields, obj, key, path, { max = 2000, label }) {
  const v = obj?.[key];
  if (v == null || v === '') return;
  if (typeof v !== 'string') {
    fields[path] = `${label}必须是文本`;
    return;
  }
  if (v.length > max) fields[path] = `${label}过长（≤${max} 字）`;
}

// null=未知通过；否则必须是有限数字且 ≥0
function collectMoney(fields, v, path, label) {
  if (v == null || v === '') return;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    fields[path] = `${label}必须是 ≥ 0 的数字（未知请留空）`;
  }
}

// ---------- 读取 ----------

// 未建立营销档案 / 未初始化看板 → { initialized:false }（项目可正常打开）
// profile.json 损坏 → 抛 AtbError（前端显示读取失败可重试，不静默重建）
export function readState(dataDir) {
  const file = profileFile(dataDir);
  if (!fs.existsSync(file)) return { initialized: false };
  const profile = readJson(file);
  if (!profile || typeof profile !== 'object') {
    throw new AtbError('营销档案 profile.json 已损坏，无法解析（请人工检查文件，系统不自动覆盖）');
  }
  if (profile.schemaVersion !== MARKETING_SCHEMA_VERSION) {
    throw new AtbError(`不支持的营销档案 schemaVersion：${profile.schemaVersion}`);
  }
  const profile1 = normalizeProfile(profile);
  const versions = listVersions(dataDir);
  return { initialized: true, profile: profile1, versions, current: profile1.currentPricing };
}

function normalizeProfile(p) {
  const pos = p.positioning || {};
  return {
    schemaVersion: MARKETING_SCHEMA_VERSION,
    id: String(p.id || ''),
    createdAt: p.createdAt || '',
    updatedAt: p.updatedAt || '',
    revision: Number(p.revision) || 1,
    positioning: {
      intro: strVal(pos.intro),
      stage: STAGES.includes(pos.stage) ? pos.stage : 'exploring',
      markets: strVal(pos.markets),
      audience: strVal(pos.audience),
      scenarios: strVal(pos.scenarios),
      painPoints: strVal(pos.painPoints),
      alternatives: strVal(pos.alternatives),
      differentiators: strVal(pos.differentiators),
      links: strVal(pos.links),
      stageGoal: strVal(pos.stageGoal),
      primaryMetric: strVal(pos.primaryMetric),
      budget: pos.budget == null || pos.budget === '' ? null : pos.budget,
      weeklyHours: pos.weeklyHours == null || pos.weeklyHours === '' ? null : pos.weeklyHours,
    },
    evidence: Array.isArray(p.evidence)
      ? p.evidence.map((e, i) => ({
        id: typeof e?.id === 'string' && e.id ? e.id : `ev-${i + 1}`,
        type: EVIDENCE_TYPES.includes(e?.type) ? e.type : 'unverified',
        content: strVal(e?.content),
        source: strVal(e?.source, { max: 500 }),
        collectedAt: strVal(e?.collectedAt, { max: 10 }),
      }))
      : [],
    currentPricing: typeof p.currentPricing === 'string' && /^v\d+$/.test(p.currentPricing) ? p.currentPricing : null,
  };
}

// 按文件名计数排序；单个版本损坏 → { version, corrupt:true } 只读占位，其余照常
function listVersions(dataDir) {
  const dir = pricingDir(dataDir);
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const nums = names
    .map((n) => n.match(/^v(\d+)\.json$/))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  return nums.map((n) => {
    const file = path.join(dir, `v${n}.json`);
    const v = readJson(file);
    if (!v || typeof v !== 'object') return { version: `v${n}`, corrupt: true };
    return normalizeVersion(v, `v${n}`);
  });
}

function normalizeVersion(v, fallbackName) {
  return {
    schemaVersion: MARKETING_SCHEMA_VERSION,
    version: typeof v.version === 'string' && v.version ? v.version : fallbackName,
    createdAt: v.createdAt || '',
    model: PRICING_MODELS.includes(v.model) ? v.model : 'free',
    currency: strVal(v.currency, { max: 10 }),
    cycle: strVal(v.cycle, { max: 30 }),
    packages: Array.isArray(v.packages)
      ? v.packages.map((p) => ({
        name: strVal(p?.name, { max: 100 }),
        benefits: strVal(p?.benefits),
        price: p?.price == null || p?.price === '' ? null : p?.price,
      }))
      : [],
    costBasis: strVal(v.costBasis),
    competitorBasis: strVal(v.competitorBasis),
    validationMethod: strVal(v.validationMethod),
  };
}

// ---------- 初始化（用户显式触发；读取 README 仅形成草稿） ----------

// README 首个非标题、非空段落（一行）作简介草稿；无 README → 空串
export function readmeIntroDraft(projectRoot) {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
    for (const lineRaw of raw.split(/\r?\n/)) {
      const line = lineRaw.trim();
      if (!line || line.startsWith('#') || line.startsWith('```') || line.startsWith('---') || line.startsWith('|') || line.startsWith('[')) continue;
      return line.slice(0, 500);
    }
  } catch { /* 无 README：留空 */ }
  return '';
}

function blankProfile(intro) {
  const ts = nowIso();
  return {
    schemaVersion: MARKETING_SCHEMA_VERSION,
    id: `mp-${crypto.randomBytes(4).toString('hex')}`,
    createdAt: ts,
    updatedAt: ts,
    revision: 1,
    positioning: {
      intro, stage: 'exploring', markets: '', audience: '', scenarios: '',
      painPoints: '', alternatives: '', differentiators: '', links: '',
      stageGoal: '', primaryMetric: '', budget: null, weeklyHours: null,
    },
    evidence: [],
    currentPricing: null,
  };
}

export function initProfile(dataDir, { projectRoot, by = 'board' }) {
  if (!fs.existsSync(dataDir)) {
    throw new AtbError('未找到 docs/agent-team-board，请先初始化看板');
  }
  const file = profileFile(dataDir);
  if (fs.existsSync(file)) {
    throw new AtbError('营销档案已初始化（如档案损坏请人工处理，系统不自动覆盖）');
  }
  fs.mkdirSync(marketingDir(dataDir), { recursive: true });
  const profile = blankProfile(readmeIntroDraft(projectRoot || dataDir));
  writeJsonAtomic(file, profile);
  return profile;
}

function requireProfile(dataDir) {
  const file = profileFile(dataDir);
  const p = readJson(file);
  if (!p || typeof p !== 'object') {
    throw new AtbError('营销档案尚未初始化（在营销模块点击「初始化营销档案」）');
  }
  return p;
}

// ---------- 定位与证据保存（revision 乐观锁） ----------

function validatePositioning(pos, fields) {
  const p = pos || {};
  collectStr(fields, p, 'intro', 'positioning.intro', { label: '产品简介' });
  collectStr(fields, p, 'markets', 'positioning.markets', { max: 200, label: '目标市场与语言' });
  collectStr(fields, p, 'audience', 'positioning.audience', { label: '目标受众' });
  collectStr(fields, p, 'scenarios', 'positioning.scenarios', { label: '使用场景' });
  collectStr(fields, p, 'painPoints', 'positioning.painPoints', { label: '痛点' });
  collectStr(fields, p, 'alternatives', 'positioning.alternatives', { label: '替代产品' });
  collectStr(fields, p, 'differentiators', 'positioning.differentiators', { label: '差异点' });
  collectStr(fields, p, 'links', 'positioning.links', { max: 1000, label: '产品链接' });
  collectStr(fields, p, 'stageGoal', 'positioning.stageGoal', { label: '阶段目标' });
  collectStr(fields, p, 'primaryMetric', 'positioning.primaryMetric', { max: 200, label: '主指标' });
  collectMoney(fields, p.budget, 'positioning.budget', '预算');
  collectMoney(fields, p.weeklyHours, 'positioning.weeklyHours', '每周可投入工时');
}

function validateEvidence(evidence, fields) {
  const list = Array.isArray(evidence) ? evidence : [];
  list.forEach((e, i) => {
    const base = `evidence.${i}`;
    if (!e || typeof e !== 'object') {
      fields[base] = '证据条目格式非法';
      return;
    }
    if (!EVIDENCE_TYPES.includes(e.type)) {
      fields[`${base}.type`] = '证据类型必须是 事实 / 假设 / 待确认';
    }
    collectStr(fields, e, 'content', `${base}.content`, { label: '证据内容' });
    collectStr(fields, e, 'source', `${base}.source`, { max: 500, label: '来源' });
    if (e.collectedAt && !/^\d{4}-\d{2}-\d{2}$/.test(String(e.collectedAt))) {
      fields[`${base}.collectedAt`] = '采集日期应为 YYYY-MM-DD';
    }
  });
}

export function saveProfile(dataDir, { revision, positioning, evidence, by = 'board' }) {
  const cur = requireProfile(dataDir);
  const want = Number(revision);
  if (!Number.isFinite(want) || want !== cur.revision) {
    throw new MarketingConflictError(
      `营销档案已被其他窗口修改（本地基于 revision ${want}，服务端已是 ${cur.revision}），请重新载入后重试`,
      cur.revision,
    );
  }
  const fields = {};
  validatePositioning(positioning, fields);
  validateEvidence(evidence, fields);
  if (Object.keys(fields).length) {
    const err = new AtbError('营销档案字段校验失败');
    err.fields = fields;
    throw err;
  }

  const merged = normalizeProfile(cur);
  merged.positioning = {
    intro: strVal(positioning?.intro),
    stage: STAGES.includes(positioning?.stage) ? positioning.stage : merged.positioning.stage,
    markets: strVal(positioning?.markets, { max: 200 }),
    audience: strVal(positioning?.audience),
    scenarios: strVal(positioning?.scenarios),
    painPoints: strVal(positioning?.painPoints),
    alternatives: strVal(positioning?.alternatives),
    differentiators: strVal(positioning?.differentiators),
    links: strVal(positioning?.links, { max: 1000 }),
    stageGoal: strVal(positioning?.stageGoal),
    primaryMetric: strVal(positioning?.primaryMetric, { max: 200 }),
    budget: positioning?.budget == null || positioning?.budget === '' ? null : positioning.budget,
    weeklyHours: positioning?.weeklyHours == null || positioning?.weeklyHours === '' ? null : positioning.weeklyHours,
  };
  // 证据条目：保留合法 id，缺失时按现存最大序号顺延分配稳定 ID
  let nextSeq = merged.evidence.reduce((m, e) => {
    const n = Number(String(e.id).match(/^ev-(\d+)$/)?.[1] || 0);
    return Math.max(m, n);
  }, 0);
  merged.evidence = (Array.isArray(evidence) ? evidence : []).map((e) => {
    const idOk = typeof e?.id === 'string' && /^ev-\d+$/.test(e.id);
    return {
      id: idOk ? e.id : `ev-${++nextSeq}`,
      type: EVIDENCE_TYPES.includes(e?.type) ? e.type : 'unverified',
      content: strVal(e?.content),
      source: strVal(e?.source, { max: 500 }),
      collectedAt: e?.collectedAt ? String(e.collectedAt).slice(0, 10) : localDateStamp(),
    };
  });
  merged.revision = cur.revision + 1;
  merged.updatedAt = nowIso();
  writeJsonAtomic(profileFile(dataDir), merged);
  return readState(dataDir);
}

// ---------- 定价版本（保存恒新建，永不覆盖） ----------

function validatePricing(data, fields) {
  const d = data || {};
  if (!PRICING_MODELS.includes(d.model)) {
    fields.model = '收费模式必须是 免费 / 买断 / 订阅 / 按量 / 混合';
  }
  const paid = d.model && d.model !== 'free';
  if (paid && !String(d.currency || '').trim()) {
    fields.currency = '收费定价必须填写币种（如 CNY / USD）';
  }
  if (d.model === 'subscription' && !String(d.cycle || '').trim()) {
    fields.cycle = '订阅模式必须填写收费周期';
  }
  if (d.currency && String(d.currency).length > 10) fields.currency = '币种过长（≤10 字）';
  if (d.cycle && String(d.cycle).length > 30) fields.cycle = '周期过长（≤30 字）';
  collectStr(fields, d, 'costBasis', 'costBasis', { label: '成本依据' });
  collectStr(fields, d, 'competitorBasis', 'competitorBasis', { label: '竞品依据' });
  collectStr(fields, d, 'validationMethod', 'validationMethod', { label: '验证方法' });
  const pkgs = Array.isArray(d.packages) ? d.packages : [];
  pkgs.forEach((p, i) => {
    const base = `packages.${i}`;
    if (!p || typeof p !== 'object') {
      fields[base] = '套餐格式非法';
      return;
    }
    collectStr(fields, p, 'name', `${base}.name`, { max: 100, label: '套餐名' });
    collectStr(fields, p, 'benefits', `${base}.benefits`, { label: '套餐权益' });
    collectMoney(fields, p.price, `${base}.price`, '候选价格');
  });
  if (pkgs.length > 20) fields.packages = '套餐数量过多（≤20）';
}

// 已存版本数按文件名计（损坏文件也占号，确保永不覆盖任何既有版本）
function nextVersionNumber(dataDir) {
  let nums = [];
  try {
    nums = fs.readdirSync(pricingDir(dataDir))
      .map((n) => n.match(/^v(\d+)\.json$/))
      .filter(Boolean)
      .map((m) => Number(m[1]));
  } catch {}
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

export function savePricing(dataDir, { data, by = 'board' }) {
  requireProfile(dataDir); // 营销档案先建立
  const fields = {};
  validatePricing(data, fields);
  if (Object.keys(fields).length) {
    const err = new AtbError('定价方案字段校验失败');
    err.fields = fields;
    throw err;
  }
  const n = nextVersionNumber(dataDir);
  const version = normalizeVersion({
    version: `v${n}`,
    createdAt: nowIso(),
    model: data.model,
    currency: String(data.currency || '').trim(),
    cycle: String(data.cycle || '').trim(),
    packages: (Array.isArray(data.packages) ? data.packages : []).map((p) => ({
      name: strVal(p?.name, { max: 100 }),
      benefits: strVal(p?.benefits),
      price: p?.price == null || p?.price === '' ? null : p.price,
    })),
    costBasis: strVal(data.costBasis),
    competitorBasis: strVal(data.competitorBasis),
    validationMethod: strVal(data.validationMethod),
  }, `v${n}`);
  fs.mkdirSync(pricingDir(dataDir), { recursive: true });
  writeJsonAtomic(path.join(pricingDir(dataDir), `v${n}.json`), version);
  // 候选保存不自动成为当前定价：currentPricing 保持不变
  return { version, state: readState(dataDir) };
}

// ---------- 显式「设为当前方案」 ----------

export function setCurrentPricing(dataDir, { version, by = 'board' }) {
  const cur = requireProfile(dataDir);
  if (typeof version !== 'string' || !/^v\d+$/.test(version)) {
    throw new AtbError(`非法定价版本号：${version}`);
  }
  const file = path.join(pricingDir(dataDir), `${version}.json`);
  if (!fs.existsSync(file)) {
    throw new AtbError(`定价版本不存在：${version}`);
  }
  const v = readJson(file);
  if (!v || typeof v !== 'object') {
    throw new AtbError(`定价版本文件已损坏：${version}，不能设为当前方案`);
  }
  const merged = normalizeProfile(cur);
  merged.currentPricing = version;
  merged.updatedAt = nowIso();
  writeJsonAtomic(profileFile(dataDir), merged); // revision 不动：保存定位的乐观锁基线不受指针切换影响
  return readState(dataDir);
}

/* ================================================================
 * REQ-20260910-020 渠道 / 实验 / 内容行动看板
 * ================================================================ */

export function channelsDir(dataDir) {
  return path.join(marketingDir(dataDir), 'channels');
}
export function experimentsDir(dataDir) {
  return path.join(marketingDir(dataDir), 'experiments');
}
export function activitiesDir(dataDir) {
  return path.join(marketingDir(dataDir), 'activities');
}

function channelFile(dataDir, id) { return path.join(channelsDir(dataDir), `${id}.json`); }
function experimentFile(dataDir, id) { return path.join(experimentsDir(dataDir), `${id}.json`); }
function activityFile(dataDir, id) { return path.join(activitiesDir(dataDir), `${id}.json`); }

// 读取实体：不存在 / 损坏分别报错（不静默重建、不自动覆盖）
function requireEntity(file, label) {
  const raw = readJson(file);
  if (raw && typeof raw === 'object') return raw;
  if (fs.existsSync(file)) {
    throw new AtbError(`${label}文件已损坏，无法解析（请人工检查，系统不自动覆盖）`);
  }
  throw new AtbError(`${label}不存在`);
}

function allocId(dir, prefix) {
  for (let i = 0; i < 8; i++) {
    const id = `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
    if (!fs.existsSync(path.join(dir, `${id}.json`))) return id;
  }
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

function fieldError(message, fields) {
  const err = new AtbError(message);
  err.fields = fields;
  return err;
}

function checkRevision(cur, want, label) {
  const w = Number(want);
  if (!Number.isFinite(w) || w !== cur.revision) {
    throw new MarketingConflictError(
      `${label}已被其他窗口修改（本地基于 revision ${w}，服务端已是 ${cur.revision}），请重新载入后重试`,
      cur.revision,
    );
  }
}

// ---------- 读取（损坏 → corrupt:true 只读占位，其余照常） ----------

function readCollection(dir, normalize) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const items = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const raw = readJson(path.join(dir, name));
    if (!raw || typeof raw !== 'object') {
      items.push({ id: name.replace(/\.json$/, ''), corrupt: true });
      continue;
    }
    items.push(normalize(raw));
  }
  items.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    || String(a.id).localeCompare(String(b.id)));
  return items;
}

export function readBoard(dataDir) {
  const file = profileFile(dataDir);
  if (!fs.existsSync(file)) return { initialized: false };
  const profile = readJson(file);
  if (!profile || typeof profile !== 'object') {
    throw new AtbError('营销档案 profile.json 已损坏，无法解析（请人工检查文件，系统不自动覆盖）');
  }
  return {
    initialized: true,
    channels: readCollection(channelsDir(dataDir), normalizeChannel),
    experiments: readCollection(experimentsDir(dataDir), normalizeExperiment),
    activities: readCollection(activitiesDir(dataDir), normalizeActivity),
  };
}

// ---------- 渠道 ----------

function normalizeChannel(c) {
  return {
    schemaVersion: MARKETING_SCHEMA_VERSION,
    id: String(c.id || ''),
    createdAt: c.createdAt || '',
    updatedAt: c.updatedAt || '',
    revision: Number(c.revision) || 1,
    platform: strVal(c.platform, { max: 100 }),
    link: strVal(c.link, { max: 500 }),
    audience: strVal(c.audience, { max: 500 }),
    languages: strVal(c.languages, { max: 200 }),
    formats: strVal(c.formats, { max: 200 }),
    priority: CHANNEL_PRIORITIES.includes(c.priority) ? c.priority : 'medium',
    reason: strVal(c.reason),
    weeklyEffort: c.weeklyEffort == null || c.weeklyEffort === '' ? null : c.weeklyEffort,
    dataAccess: strVal(c.dataAccess),
    capabilities: strVal(c.capabilities),
  };
}

function validateChannel(d, fields) {
  if (!String(d.platform || '').trim()) fields.platform = '渠道平台不能为空（如 X / Reddit / 邮件列表）';
  if (String(d.platform || '').length > 100) fields.platform = '平台过长（≤100 字）';
  collectStr(fields, d, 'link', 'link', { max: 500, label: '账号 / 社区链接' });
  collectStr(fields, d, 'audience', 'audience', { max: 500, label: '目标受众' });
  collectStr(fields, d, 'languages', 'languages', { max: 200, label: '市场语言' });
  collectStr(fields, d, 'formats', 'formats', { max: 200, label: '内容形式' });
  if (d.priority != null && d.priority !== '' && !CHANNEL_PRIORITIES.includes(d.priority)) {
    fields.priority = '优先级必须是 高 / 中 / 低';
  }
  collectStr(fields, d, 'reason', 'reason', { label: '选择理由' });
  collectMoney(fields, d.weeklyEffort, 'weeklyEffort', '每周投入');
  collectStr(fields, d, 'dataAccess', 'dataAccess', { label: '获取数据方式' });
  collectStr(fields, d, 'capabilities', 'capabilities', { label: '可用能力' });
}

export function createChannel(dataDir, { data, by = 'board' }) {
  requireProfile(dataDir);
  const fields = {};
  validateChannel(data || {}, fields);
  if (Object.keys(fields).length) throw fieldError('渠道字段校验失败', fields);
  fs.mkdirSync(channelsDir(dataDir), { recursive: true });
  const id = allocId(channelsDir(dataDir), 'ch');
  const ts = nowIso();
  const ch = normalizeChannel({ ...(data || {}), id, createdAt: ts, updatedAt: ts, revision: 1 });
  writeJsonAtomic(channelFile(dataDir, id), ch);
  return { channel: ch, board: readBoard(dataDir) };
}

export function saveChannel(dataDir, { id, revision, data, by = 'board' }) {
  const cur = requireEntity(channelFile(dataDir, String(id || '')), '渠道');
  checkRevision(cur, revision, '渠道');
  const fields = {};
  validateChannel(data || {}, fields);
  if (Object.keys(fields).length) throw fieldError('渠道字段校验失败', fields);
  const merged = normalizeChannel(cur);
  Object.assign(merged, {
    platform: strVal(data?.platform, { max: 100 }),
    link: strVal(data?.link, { max: 500 }),
    audience: strVal(data?.audience, { max: 500 }),
    languages: strVal(data?.languages, { max: 200 }),
    formats: strVal(data?.formats, { max: 200 }),
    priority: CHANNEL_PRIORITIES.includes(data?.priority) ? data.priority : merged.priority,
    reason: strVal(data?.reason),
    weeklyEffort: data?.weeklyEffort == null || data?.weeklyEffort === '' ? null : data.weeklyEffort,
    dataAccess: strVal(data?.dataAccess),
    capabilities: strVal(data?.capabilities),
  });
  merged.revision = cur.revision + 1;
  merged.updatedAt = nowIso();
  writeJsonAtomic(channelFile(dataDir, merged.id), merged);
  return { channel: merged, board: readBoard(dataDir) };
}

// ---------- 实验 ----------

function normalizeExperiment(e) {
  return {
    schemaVersion: MARKETING_SCHEMA_VERSION,
    id: String(e.id || ''),
    createdAt: e.createdAt || '',
    updatedAt: e.updatedAt || '',
    revision: Number(e.revision) || 1,
    channelId: typeof e.channelId === 'string' && e.channelId ? e.channelId : null,
    hypothesis: strVal(e.hypothesis),
    primaryMetric: strVal(e.primaryMetric, { max: 200 }),
    observationStart: e.observationStart ? strVal(e.observationStart, { max: 10 }) : null,
    observationEnd: e.observationEnd ? strVal(e.observationEnd, { max: 10 }) : null,
    successCriteria: strVal(e.successCriteria),
    currency: strVal(e.currency, { max: 10 }),
    budgetPlanned: e.budgetPlanned == null || e.budgetPlanned === '' ? null : e.budgetPlanned,
    budgetActual: e.budgetActual == null || e.budgetActual === '' ? null : e.budgetActual,
    hoursPlanned: e.hoursPlanned == null || e.hoursPlanned === '' ? null : e.hoursPlanned,
    hoursActual: e.hoursActual == null || e.hoursActual === '' ? null : e.hoursActual,
    pricingVersion: typeof e.pricingVersion === 'string' && /^v\d+$/.test(e.pricingVersion) ? e.pricingVersion : null,
    decision: ACTIVITY_DECISIONS.includes(e.decision) ? e.decision : null,
    decisionBasis: strVal(e.decisionBasis),
    copiedFrom: typeof e.copiedFrom === 'string' && e.copiedFrom ? e.copiedFrom : null,
  };
}

function validateExperiment(d, fields, dataDir) {
  if (!String(d.hypothesis || '').trim()) fields.hypothesis = '实验假设不能为空（待验证的推广假设）';
  collectStr(fields, d, 'primaryMetric', 'primaryMetric', { max: 200, label: '主指标' });
  collectStr(fields, d, 'successCriteria', 'successCriteria', { label: '成功标准' });
  for (const [k, label] of [['observationStart', '观察开始'], ['observationEnd', '观察结束']]) {
    if (d[k] && !DATE_RE.test(String(d[k]))) fields[k] = `${label}应为 YYYY-MM-DD`;
  }
  if (d.observationStart && d.observationEnd && String(d.observationStart) > String(d.observationEnd)) {
    fields.observationEnd = '观察结束不能早于观察开始';
  }
  if (d.channelId) {
    const f = channelFile(dataDir, String(d.channelId));
    if (!fs.existsSync(f)) fields.channelId = '关联渠道不存在';
    else if (!readJson(f)) fields.channelId = '关联渠道文件已损坏';
  }
  // 费用按币种独立记录（不同币种不换算）：有预算或支出即须声明币种；0=实际零（合法）
  if ((d.budgetPlanned != null || d.budgetActual != null) && !String(d.currency || '').trim()) {
    fields.currency = '填写预算或支出时必须指定币种（不同币种不默认换算）';
  }
  if (d.currency && String(d.currency).length > 10) fields.currency = '币种过长（≤10 字）';
  collectMoney(fields, d.budgetPlanned, 'budgetPlanned', '预算');
  collectMoney(fields, d.budgetActual, 'budgetActual', '实际支出');
  collectMoney(fields, d.hoursPlanned, 'hoursPlanned', '预计工时');
  collectMoney(fields, d.hoursActual, 'hoursActual', '实际工时');
  if (d.pricingVersion != null && d.pricingVersion !== '') {
    if (!/^v\d+$/.test(String(d.pricingVersion))) fields.pricingVersion = '非法定价版本号';
    else if (!fs.existsSync(path.join(pricingDir(dataDir), `${d.pricingVersion}.json`))) {
      fields.pricingVersion = '定价版本不存在';
    }
  }
  if (d.decision != null && d.decision !== '' && !ACTIVITY_DECISIONS.includes(d.decision)) {
    fields.decision = '决策必须是 继续 / 调整 / 停止 / 暂不能判断';
  }
  if (d.decision && !String(d.decisionBasis || '').trim()) {
    fields.decisionBasis = '记录最终决策时需填写决策依据';
  }
  collectStr(fields, d, 'decisionBasis', 'decisionBasis', { label: '决策依据' });
}

export function createExperiment(dataDir, { data, by = 'board' }) {
  requireProfile(dataDir);
  const fields = {};
  validateExperiment(data || {}, fields, dataDir);
  if (Object.keys(fields).length) throw fieldError('实验字段校验失败', fields);
  fs.mkdirSync(experimentsDir(dataDir), { recursive: true });
  const id = allocId(experimentsDir(dataDir), 'exp');
  const ts = nowIso();
  const exp = normalizeExperiment({ ...(data || {}), id, createdAt: ts, updatedAt: ts, revision: 1 });
  writeJsonAtomic(experimentFile(dataDir, id), exp);
  return { experiment: exp, board: readBoard(dataDir) };
}

export function saveExperiment(dataDir, { id, revision, data, by = 'board' }) {
  const cur = requireEntity(experimentFile(dataDir, String(id || '')), '实验');
  checkRevision(cur, revision, '实验');
  const fields = {};
  validateExperiment(data || {}, fields, dataDir);
  if (Object.keys(fields).length) throw fieldError('实验字段校验失败', fields);
  const merged = normalizeExperiment(cur);
  Object.assign(merged, {
    channelId: typeof data?.channelId === 'string' && data.channelId ? data.channelId : null,
    hypothesis: strVal(data?.hypothesis),
    primaryMetric: strVal(data?.primaryMetric, { max: 200 }),
    observationStart: strVal(data?.observationStart, { max: 10 }),
    observationEnd: strVal(data?.observationEnd, { max: 10 }),
    successCriteria: strVal(data?.successCriteria),
    currency: strVal(data?.currency, { max: 10 }),
    budgetPlanned: data?.budgetPlanned == null || data?.budgetPlanned === '' ? null : data.budgetPlanned,
    budgetActual: data?.budgetActual == null || data?.budgetActual === '' ? null : data.budgetActual,
    hoursPlanned: data?.hoursPlanned == null || data?.hoursPlanned === '' ? null : data.hoursPlanned,
    hoursActual: data?.hoursActual == null || data?.hoursActual === '' ? null : data.hoursActual,
    pricingVersion: typeof data?.pricingVersion === 'string' && /^v\d+$/.test(data.pricingVersion) ? data.pricingVersion : null,
    decision: data?.decision != null && data.decision !== '' && ACTIVITY_DECISIONS.includes(data.decision) ? data.decision : null,
    decisionBasis: strVal(data?.decisionBasis),
  });
  merged.revision = cur.revision + 1;
  merged.updatedAt = nowIso();
  writeJsonAtomic(experimentFile(dataDir, merged.id), merged);
  return { experiment: merged, board: readBoard(dataDir) };
}

// 已复盘 / 已停止（或任意时点）复制为新实验：新 ID + copiedFrom；实际值 / 决策 / 观察窗口清空，
// 计划与定价版本绑定保留；行动复制为草稿（发布信息 / 关联 REQ 清空，保留 copiedFrom）
export function copyExperiment(dataDir, { id, fromActivityId, by = 'board' }) {
  requireProfile(dataDir);
  const src = requireEntity(experimentFile(dataDir, String(id || '')), '实验');
  const ts = nowIso();
  fs.mkdirSync(experimentsDir(dataDir), { recursive: true });
  const newId = allocId(experimentsDir(dataDir), 'exp');
  const neo = normalizeExperiment({
    ...src,
    id: newId, createdAt: ts, updatedAt: ts, revision: 1,
    budgetActual: null, hoursActual: null,
    decision: null, decisionBasis: '',
    observationStart: '', observationEnd: '',
    copiedFrom: src.id,
  });
  writeJsonAtomic(experimentFile(dataDir, newId), neo);

  fs.mkdirSync(activitiesDir(dataDir), { recursive: true });
  const acts = readCollection(activitiesDir(dataDir), normalizeActivity)
    .filter((a) => a.experimentId === src.id && a.corrupt !== true)
    .filter((a) => !fromActivityId || a.id === fromActivityId);
  for (const a of acts) {
    const na = normalizeActivity({
      ...a,
      id: allocId(activitiesDir(dataDir), 'act'), createdAt: ts, updatedAt: ts, revision: 1,
      experimentId: newId, // 归属新实验（草稿态重新尝试）
      status: 'draft',
      publishUrl: '', publishedAt: '', publishCredential: '',
      reviewBasis: '', decision: null, stoppedReason: '',
      linkedReqs: [],
      statusHistory: [{ at: ts, from: null, to: 'draft', by, note: `复制自行动 ${a.id}（实验 ${src.id}）` }],
      copiedFrom: a.id,
    });
    writeJsonAtomic(activityFile(dataDir, na.id), na);
  }
  return { experiment: neo, board: readBoard(dataDir) };
}

// ---------- 行动 ----------

function normalizeActivity(a) {
  return {
    schemaVersion: MARKETING_SCHEMA_VERSION,
    id: String(a.id || ''),
    createdAt: a.createdAt || '',
    updatedAt: a.updatedAt || '',
    revision: Number(a.revision) || 1,
    channelId: String(a.channelId || ''),
    experimentId: typeof a.experimentId === 'string' && a.experimentId ? a.experimentId : null,
    title: strVal(a.title, { max: 120 }),
    contentDraft: strVal(a.contentDraft, { max: 20000 }),
    materialRefs: strVal(a.materialRefs, { max: 2000 }),
    plannedAt: strVal(a.plannedAt, { max: 30 }),
    timezone: strVal(a.timezone, { max: 60 }),
    status: ACTIVITY_STATUSES.includes(a.status) ? a.status : 'draft',
    publishUrl: strVal(a.publishUrl, { max: 500 }),
    publishedAt: strVal(a.publishedAt, { max: 30 }),
    publishCredential: strVal(a.publishCredential, { max: 2000 }),
    owner: strVal(a.owner, { max: 100 }),
    nextStep: strVal(a.nextStep),
    reviewBasis: strVal(a.reviewBasis),
    decision: ACTIVITY_DECISIONS.includes(a.decision) ? a.decision : null,
    stoppedReason: strVal(a.stoppedReason),
    linkedReqs: Array.isArray(a.linkedReqs)
      ? a.linkedReqs
        .filter((l) => l && typeof l === 'object')
        .map((l) => ({
          id: String(l.id || ''),
          key: strVal(l.key, { max: 200 }),
          title: strVal(l.title, { max: 120 }),
          createdAt: l.createdAt || '',
        }))
      : [],
    statusHistory: Array.isArray(a.statusHistory)
      ? a.statusHistory
        .filter((h) => h && typeof h === 'object' && h.to)
        .map((h) => ({
          at: h.at || '',
          from: h.from || null,
          to: String(h.to),
          by: strVal(h.by, { max: 100 }),
          note: strVal(h.note, { max: 500 }),
          ...(h.type === 'correct' ? { type: 'correct' } : {}),
        }))
      : [],
    copiedFrom: typeof a.copiedFrom === 'string' && a.copiedFrom ? a.copiedFrom : null,
  };
}

function validateActivityCommon(d, fields, dataDir) {
  if (!d.channelId || typeof d.channelId !== 'string') {
    fields.channelId = '行动必须关联渠道';
  } else {
    const f = channelFile(dataDir, d.channelId);
    if (!fs.existsSync(f)) fields.channelId = '关联渠道不存在';
    else if (!readJson(f)) fields.channelId = '关联渠道文件已损坏';
  }
  if (d.experimentId) {
    const f = experimentFile(dataDir, String(d.experimentId));
    if (!fs.existsSync(f)) fields.experimentId = '关联实验不存在';
    else if (!readJson(f)) fields.experimentId = '关联实验文件已损坏';
  }
  collectStr(fields, d, 'title', 'title', { max: 120, label: '内容标题' });
  collectStr(fields, d, 'contentDraft', 'contentDraft', { max: 20000, label: '内容草稿' });
  collectStr(fields, d, 'materialRefs', 'materialRefs', { max: 2000, label: '素材引用' });
  if (d.plannedAt && !DATETIME_RE.test(String(d.plannedAt)) && !DATE_RE.test(String(d.plannedAt))) {
    fields.plannedAt = '计划时间应为 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm';
  }
  if (d.plannedAt && !String(d.timezone || '').trim()) {
    fields.timezone = '填写计划时间时必须指定时区（如 Asia/Shanghai）';
  }
  if (d.timezone && String(d.timezone).length > 60) fields.timezone = '时区过长（≤60 字）';
  if (d.publishedAt && !DATETIME_RE.test(String(d.publishedAt)) && !DATE_RE.test(String(d.publishedAt))) {
    fields.publishedAt = '发布时间应为 YYYY-MM-DDTHH:mm';
  }
  collectStr(fields, d, 'publishUrl', 'publishUrl', { max: 500, label: '发布链接' });
  collectStr(fields, d, 'publishCredential', 'publishCredential', { max: 2000, label: '发布凭据说明' });
  collectStr(fields, d, 'owner', 'owner', { max: 100, label: '负责人' });
  collectStr(fields, d, 'nextStep', 'nextStep', { label: '下一步' });
  collectStr(fields, d, 'reviewBasis', 'reviewBasis', { label: '结果依据' });
  if (d.decision != null && d.decision !== '' && !ACTIVITY_DECISIONS.includes(d.decision)) {
    fields.decision = '决策必须是 继续 / 调整 / 停止 / 暂不能判断';
  }
  collectStr(fields, d, 'stoppedReason', 'stoppedReason', { max: 500, label: '停止原因' });
}

// 状态不变量：已进入的状态其必备凭据 / 依据 / 原因不允许被编辑破坏
function validateActivityInvariants(merged, fields) {
  const s = merged.status;
  if (s === 'published' || s === 'observing' || s === 'reviewed') {
    if (!merged.publishedAt) fields.publishedAt = '已发布及之后的行动必须保留发布时间';
    if (!merged.publishUrl && !merged.publishCredential) {
      fields.publishUrl = '必须保留发布链接，或填写发布凭据说明';
    }
  }
  if (s === 'reviewed') {
    if (!String(merged.reviewBasis || '').trim()) fields.reviewBasis = '已复盘行动必须保留结果依据';
    if (!merged.decision) fields.decision = '已复盘行动必须保留决策';
  }
  if (s === 'stopped' && !String(merged.stoppedReason || '').trim()) {
    fields.stoppedReason = '已停止行动必须保留停止原因';
  }
}

export function createActivity(dataDir, { data, by = 'board' }) {
  requireProfile(dataDir);
  const fields = {};
  validateActivityCommon(data || {}, fields, dataDir);
  if (Object.keys(fields).length) throw fieldError('行动字段校验失败', fields);
  fs.mkdirSync(activitiesDir(dataDir), { recursive: true });
  const id = allocId(activitiesDir(dataDir), 'act');
  const ts = nowIso();
  const act = normalizeActivity({
    ...(data || {}), id, createdAt: ts, updatedAt: ts, revision: 1, status: 'draft',
    statusHistory: [{ at: ts, from: null, to: 'draft', by, note: '' }],
  });
  writeJsonAtomic(activityFile(dataDir, id), act);
  return { activity: act, board: readBoard(dataDir) };
}

export function saveActivity(dataDir, { id, revision, data, by = 'board' }) {
  const cur = requireEntity(activityFile(dataDir, String(id || '')), '行动');
  checkRevision(cur, revision, '行动');
  const fields = {};
  validateActivityCommon(data || {}, fields, dataDir);
  const merged = normalizeActivity(cur);
  Object.assign(merged, {
    channelId: String(data?.channelId || ''),
    experimentId: typeof data?.experimentId === 'string' && data.experimentId ? data.experimentId : null,
    title: strVal(data?.title, { max: 120 }),
    contentDraft: strVal(data?.contentDraft, { max: 20000 }),
    materialRefs: strVal(data?.materialRefs, { max: 2000 }),
    plannedAt: strVal(data?.plannedAt, { max: 30 }),
    timezone: strVal(data?.timezone, { max: 60 }),
    publishUrl: strVal(data?.publishUrl, { max: 500 }),
    publishedAt: strVal(data?.publishedAt, { max: 30 }),
    publishCredential: strVal(data?.publishCredential, { max: 2000 }),
    owner: strVal(data?.owner, { max: 100 }),
    nextStep: strVal(data?.nextStep),
    reviewBasis: strVal(data?.reviewBasis),
    decision: data?.decision != null && data.decision !== '' && ACTIVITY_DECISIONS.includes(data.decision) ? data.decision : null,
    stoppedReason: strVal(data?.stoppedReason, { max: 500 }),
  });
  validateActivityInvariants(merged, fields);
  if (Object.keys(fields).length) throw fieldError('行动字段校验失败', fields);
  merged.revision = cur.revision + 1;
  merged.updatedAt = nowIso();
  writeJsonAtomic(activityFile(dataDir, merged.id), merged);
  return { activity: merged, board: readBoard(dataDir) };
}

// 状态推进：链式下一步或停止；目标状态必备信息缺失 → 字段错误（状态不变）
export function setActivityStatus(dataDir, { id, revision, to, payload = {}, by = 'board' }) {
  const cur = requireEntity(activityFile(dataDir, String(id || '')), '行动');
  checkRevision(cur, revision, '行动');
  if (!ACTIVITY_STATUSES.includes(to)) throw new AtbError(`非法行动状态：${to}`);
  if (to === cur.status) {
    throw new AtbError(`行动已是「${ACTIVITY_STATUS_LABEL[cur.status]}」，无需重复操作`);
  }
  if (to !== 'stopped' && to !== ACTIVITY_NEXT[cur.status]) {
    throw new AtbError(
      `状态推进需按 草稿→待发布→已发布→观察中→已复盘 逐步进行（当前「${ACTIVITY_STATUS_LABEL[cur.status]}」` +
      `不能直接到「${ACTIVITY_STATUS_LABEL[to]}」；回退误操作请使用「更正」）`,
    );
  }
  if (to === 'stopped' && (cur.status === 'reviewed' || cur.status === 'stopped')) {
    throw new AtbError('已复盘的行动不能停止（结论由复盘决策承载，误操作请用「更正」）');
  }

  const merged = normalizeActivity(cur);
  const fields = {};
  const p = payload || {};
  // 人工登记的发布 / 复盘 / 停止信息随推进一次提交
  if (p.publishedAt != null) merged.publishedAt = strVal(p.publishedAt, { max: 30 });
  if (p.publishUrl != null) merged.publishUrl = strVal(p.publishUrl, { max: 500 });
  if (p.publishCredential != null) merged.publishCredential = strVal(p.publishCredential, { max: 2000 });
  if (p.reviewBasis != null) merged.reviewBasis = strVal(p.reviewBasis);
  if (p.stopReason != null) merged.stoppedReason = strVal(p.stopReason, { max: 500 });
  if (p.contentDraft) merged.contentDraft = strVal(p.contentDraft, { max: 20000 });
  if (p.decision != null && p.decision !== '') {
    if (!ACTIVITY_DECISIONS.includes(p.decision)) fields.decision = '决策必须是 继续 / 调整 / 停止 / 暂不能判断';
    else merged.decision = p.decision;
  }
  validateActivityInvariants({ ...merged, status: to }, fields);

  if (to === 'pending' && !String(merged.contentDraft || '').trim()) {
    fields.contentDraft = '标记待发布前需要内容草稿';
  }
  if (to === 'published') {
    if (!merged.publishedAt) fields.publishedAt = '标记已发布必须登记发布时间';
    if (!merged.publishUrl && !merged.publishCredential) {
      fields.publishUrl = '必须填写发布链接；无法提供公开链接时填写发布凭据说明';
    }
  }
  if (to === 'reviewed') {
    if (!String(merged.reviewBasis || '').trim()) fields.reviewBasis = '复盘需记录结果依据（数据来源与口径）';
    if (!merged.decision) {
      fields.decision = '复盘需选择决策：继续 / 调整 / 停止；数据不足可选「暂不能判断」（不等同验证成功）';
    }
  }
  if (to === 'stopped' && !String(merged.stoppedReason || '').trim()) {
    fields.stopReason = '停止需记录原因';
  }
  if (Object.keys(fields).length) throw fieldError('行动状态推进校验失败', fields);

  merged.status = to;
  merged.statusHistory.push({ at: nowIso(), from: cur.status, to, by, note: strVal(p.note, { max: 500 }) });
  merged.revision = cur.revision + 1;
  merged.updatedAt = nowIso();
  writeJsonAtomic(activityFile(dataDir, merged.id), merged);
  return { activity: merged, board: readBoard(dataDir) };
}

// 误操作更正：仅回退（含从已停止恢复），必须记录原因；不用于前进
export function correctActivityStatus(dataDir, { id, revision, to, reason, by = 'board' }) {
  const cur = requireEntity(activityFile(dataDir, String(id || '')), '行动');
  checkRevision(cur, revision, '行动');
  if (!ACTIVITY_STATUSES.includes(to)) throw new AtbError(`非法行动状态：${to}`);
  if (to === cur.status) throw new AtbError('更正目标状态与当前状态相同');
  const backOk = cur.status === 'stopped'
    ? to !== 'stopped'
    : (ACTIVITY_ORDER[to] ?? -1) < (ACTIVITY_ORDER[cur.status] ?? 99);
  if (!backOk) {
    throw new AtbError('更正仅用于回退误操作；前进请使用状态按钮（草稿→待发布→已发布→观察中→已复盘）');
  }
  const fields = {};
  if (!String(reason || '').trim()) fields.reason = '更正需记录原因（误操作说明）';
  if (String(reason || '').length > 500) fields.reason = '更正原因过长（≤500 字）';
  if (Object.keys(fields).length) throw fieldError('行动更正校验失败', fields);

  const merged = normalizeActivity(cur);
  merged.status = to;
  merged.statusHistory.push({ at: nowIso(), from: cur.status, to, by, note: strVal(reason, { max: 500 }), type: 'correct' });
  merged.revision = cur.revision + 1;
  merged.updatedAt = nowIso();
  writeJsonAtomic(activityFile(dataDir, merged.id), merged);
  return { activity: merged, board: readBoard(dataDir) };
}

// 人工「创建开发需求」：经统一 createItem 落 submitted（不自动接受或实施），
// REQ README 描述带行动来源（双向关联），行动 linkedReqs 记录编号；
// 携带幂等 key：同 key 重试不重复创建（两阶段写入，REQ 创建成功前先占位）
export function linkActivityReq(dataDir, { id, key, title, description = '', by = 'board' }) {
  const cur = requireEntity(activityFile(dataDir, String(id || '')), '行动');
  const fields = {};
  const keyS = String(key || '').trim();
  if (!keyS) fields.key = '缺少幂等 key（同一行动同一用途重试不重复创建）';
  if (keyS.length > 200) fields.key = 'key 过长（≤200 字）';
  const titleS = String(title || '').trim();
  if (!titleS) fields.title = '开发需求标题不能为空';
  if (Object.keys(fields).length) throw fieldError('创建开发需求校验失败', fields);

  const existing = (cur.linkedReqs || []).find((l) => l && l.key === keyS);
  if (existing && existing.id) {
    return { created: false, link: existing, board: readBoard(dataDir) };
  }

  const ts = nowIso();
  if (!existing) {
    const merged = normalizeActivity(cur);
    merged.linkedReqs.push({ id: '', key: keyS, title: titleS, createdAt: ts });
    merged.updatedAt = ts;
    merged.revision = cur.revision + 1;
    writeJsonAtomic(activityFile(dataDir, merged.id), merged);
  }

  const expPart = cur.experimentId ? ` · 实验 ${cur.experimentId}` : '';
  const source = `来源：营销「渠道与行动」看板 · 行动 ${id}${expPart}（人工从行动详情创建，${localDateStamp()}）`;
  const desc = String(description || '').trim();
  const st = createItem(dataDir, {
    type: 'requirement',
    title: titleS,
    description: desc ? `${desc}\n\n${source}` : source,
    by: 'board',
  });

  const fresh = normalizeActivity(requireEntity(activityFile(dataDir, String(id || '')), '行动'));
  const link = (fresh.linkedReqs || []).find((l) => l && l.key === keyS);
  if (link) link.id = st.id;
  fresh.updatedAt = nowIso();
  writeJsonAtomic(activityFile(dataDir, fresh.id), fresh);
  return { created: true, link: link || { id: st.id, key: keyS, title: titleS, createdAt: ts }, reqStatus: st, board: readBoard(dataDir) };
}

/* ================================================================
 * REQ-20260910-021 效果与复盘：手工指标、CSV 导入与复盘
 * ================================================================ */

export const METRIC_CATEGORIES = ['exposure', 'engagement', 'following', 'usage', 'commercial'];
export const METRIC_CATEGORY_LABEL = {
  exposure: '曝光', engagement: '互动', following: '持续关注', usage: '使用', commercial: '商业',
};
export const METRIC_KINDS = ['stock', 'delta', 'events', 'unique'];
export const METRIC_KIND_LABEL = { stock: '存量', delta: '期间增量', events: '事件次数', unique: '独立人数' };

// 默认指标字典（首次读取播种；单位 / 口径随定义保存）
const DEFAULT_METRICS = [
  { key: 'impressions', name: '展示次数', category: 'exposure', kind: 'events', unit: '次', dedup: '不去重（平台计数）' },
  { key: 'plays', name: '播放次数', category: 'exposure', kind: 'events', unit: '次', dedup: '不去重（平台计数）' },
  { key: 'likes', name: '点赞', category: 'engagement', kind: 'events', unit: '次', dedup: '不去重' },
  { key: 'comments', name: '评论', category: 'engagement', kind: 'events', unit: '次', dedup: '不去重' },
  { key: 'favorites', name: '收藏', category: 'engagement', kind: 'events', unit: '次', dedup: '不去重' },
  { key: 'followersTotal', name: '粉丝总数', category: 'following', kind: 'stock', unit: '人', dedup: '按平台账号；不跨平台求和' },
  { key: 'subscribersTotal', name: '订阅总数', category: 'following', kind: 'stock', unit: '人', dedup: '按平台账号；不跨平台求和' },
  { key: 'starsTotal', name: 'Star 总数', category: 'following', kind: 'stock', unit: '个', dedup: '按仓库；不跨平台求和' },
  { key: 'followersNew', name: '粉丝新增', category: 'following', kind: 'delta', unit: '人', dedup: '按平台账号去重；不跨平台求和' },
  { key: 'subsNew', name: '订阅新增', category: 'following', kind: 'delta', unit: '人', dedup: '按账号去重；不跨平台求和' },
  { key: 'starsNew', name: 'Star 新增', category: 'following', kind: 'delta', unit: '个', dedup: '按仓库事件去重；不跨平台求和' },
  { key: 'visitors', name: '访客', category: 'usage', kind: 'unique', unit: '人', dedup: '按设备在观察窗口内去重' },
  { key: 'downloads', name: '下载', category: 'usage', kind: 'delta', unit: '次', dedup: '平台计数不去重' },
  { key: 'activations', name: '激活', category: 'usage', kind: 'delta', unit: '人', dedup: '按账号去重' },
  { key: 'retained', name: '留存人数', category: 'usage', kind: 'unique', unit: '人', dedup: '按账号在窗口内去重' },
  { key: 'payers', name: '付费人数', category: 'commercial', kind: 'delta', unit: '人', dedup: '按账号去重' },
  { key: 'revenue', name: '收入', category: 'commercial', kind: 'delta', unit: '', dedup: '不适用', money: true },
  { key: 'refunds', name: '退款金额', category: 'commercial', kind: 'delta', unit: '', dedup: '不适用', money: true },
];

// 派生指标：分子 / 分母须同周期、同归属（口径一致）且分母有效才计算
const DEFAULT_DERIVED = [
  { key: 'activationRate', name: '激活率', numerator: 'activations', denominator: 'visitors', unit: '%' },
];

export function metricsDir(dataDir) {
  return path.join(marketingDir(dataDir), 'metrics');
}
export function definitionsFile(dataDir) {
  return path.join(metricsDir(dataDir), 'definitions.json');
}
export function observationsDir(dataDir) {
  return path.join(metricsDir(dataDir), 'observations');
}
export function reviewsDir(dataDir) {
  return path.join(marketingDir(dataDir), 'reviews');
}
function observationFile(dataDir, id) { return path.join(observationsDir(dataDir), `${id}.json`); }
function reviewFileOf(dataDir, id) { return path.join(reviewsDir(dataDir), `${id}.json`); }

// 合法日历日期（YYYY-MM-DD，且真实存在，如 2026-02-30 拒绝）
function isValidDate(v) {
  if (!DATE_RE.test(String(v || ''))) return false;
  const [y, m, d] = String(v).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function normalizeDefinition(d) {
  return {
    key: String(d?.key || ''),
    name: strVal(d?.name, { max: 50 }),
    category: METRIC_CATEGORIES.includes(d?.category) ? d.category : 'usage',
    kind: METRIC_KINDS.includes(d?.kind) ? d.kind : 'delta',
    unit: strVal(d?.unit, { max: 20 }),
    dedup: strVal(d?.dedup, { max: 100 }),
    money: d?.money === true,
    origin: d?.origin === 'custom' ? 'custom' : 'builtin',
    createdAt: d?.createdAt || '',
  };
}

// ---------- 指标字典 ----------

export function readMetricDefinitions(dataDir) {
  requireProfile(dataDir);
  const file = definitionsFile(dataDir);
  if (!fs.existsSync(file)) {
    const ts = nowIso();
    const seeded = {
      schemaVersion: MARKETING_SCHEMA_VERSION,
      updatedAt: ts,
      definitions: DEFAULT_METRICS.map((d) => normalizeDefinition({ ...d, origin: 'builtin', createdAt: ts })),
    };
    fs.mkdirSync(metricsDir(dataDir), { recursive: true });
    writeJsonAtomic(file, seeded); // 首次读取播种默认字典（幂等：仅缺失时）
    return seeded;
  }
  const raw = readJson(file);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.definitions)) {
    throw new AtbError('指标定义 definitions.json 已损坏，无法解析（请人工检查文件，系统不自动覆盖）');
  }
  return { ...raw, definitions: raw.definitions.map(normalizeDefinition) };
}

// 按指标 key 或名称精确解析
function resolveMetric(definitions, keyOrName) {
  const s = String(keyOrName || '').trim();
  if (!s) return null;
  return definitions.find((d) => d.key === s) || definitions.find((d) => d.name === s) || null;
}

export function addMetricDefinition(dataDir, { data, by = 'board' }) {
  requireProfile(dataDir);
  const cur = readMetricDefinitions(dataDir);
  const d = data || {};
  const fields = {};
  const name = String(d.name || '').trim();
  if (!name) fields.name = '指标名称不能为空';
  if (name.length > 50) fields.name = '指标名称过长（≤50 字）';
  let key = String(d.key || '').trim();
  if (key && !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,49}$/.test(key)) fields.key = '指标 key 只能含字母 / 数字 / 连字符（≤50 字）';
  if (!METRIC_CATEGORIES.includes(d.category)) fields.category = '指标分类必须是 曝光 / 互动 / 持续关注 / 使用 / 商业';
  if (!METRIC_KINDS.includes(d.kind)) fields.kind = '指标种类必须是 存量 / 期间增量 / 事件次数 / 独立人数';
  const unit = String(d.unit || '').trim();
  if (!unit) fields.unit = '单位 / 币种不能为空（如 次 / 人 / CNY）';
  if (unit.length > 20) fields.unit = '单位过长（≤20 字）';
  if (String(d.dedup || '').length > 100) fields.dedup = '去重口径过长（≤100 字）';
  if (Object.keys(fields).length) throw fieldError('自定义指标校验失败', fields);

  if (cur.definitions.some((x) => (key && x.key === key) || x.name === name)) {
    throw fieldError('自定义指标校验失败', { key: '指标 key 或名称已存在（观察键依赖唯一指标）' });
  }
  if (!key) key = `mk-${crypto.randomBytes(4).toString('hex')}`;
  const def = normalizeDefinition({
    key, name, category: d.category, kind: d.kind, unit, dedup: d.dedup,
    money: d.money === true, origin: 'custom', createdAt: nowIso(),
  });
  const next = {
    schemaVersion: MARKETING_SCHEMA_VERSION,
    updatedAt: nowIso(),
    definitions: [...cur.definitions, def],
  };
  writeJsonAtomic(definitionsFile(dataDir), next);
  return { definition: def, definitions: next.definitions };
}

// ---------- 观察记录 ----------

function normalizeObservation(o) {
  return {
    schemaVersion: MARKETING_SCHEMA_VERSION,
    id: String(o.id || ''),
    createdAt: o.createdAt || '',
    updatedAt: o.updatedAt || '',
    metricKey: String(o.metricKey || ''),
    dateStart: strVal(o.dateStart, { max: 10 }),
    dateEnd: strVal(o.dateEnd, { max: 10 }),
    value: o.value == null ? null : o.value,
    unit: strVal(o.unit, { max: 20 }),
    channelId: typeof o.channelId === 'string' && o.channelId ? o.channelId : null,
    experimentId: typeof o.experimentId === 'string' && o.experimentId ? o.experimentId : null,
    source: strVal(o.source, { max: 50 }) || '手工记录',
    timezone: strVal(o.timezone, { max: 60 }),
    collectionMethod: strVal(o.collectionMethod, { max: 50 }),
    revision: Number(o.revision) || 1,
    history: Array.isArray(o.history)
      ? o.history
        .filter((h) => h && typeof h === 'object')
        .map((h) => ({
          rev: Number(h.rev) || 1, value: h.value == null ? null : h.value,
          reason: strVal(h.reason, { max: 500 }), by: strVal(h.by, { max: 100 }), at: h.at || '',
        }))
      : [],
  };
}

// 损坏观察只读占位（corrupt:true），其余照常
function readObservations(dataDir) {
  return readCollection(observationsDir(dataDir), normalizeObservation);
}

// 观察键：指标 + 周期 + 归属（来源不入键——同键同值不重复计算，同键不同值走修订 / 冲突流程）
function observationKeyOf(metricKey, dateStart, dateEnd, channelId, experimentId) {
  return [metricKey, dateStart, dateEnd, channelId || '', experimentId || ''].join('|');
}

function findObservationByKey(dataDir, key) {
  return readObservations(dataDir).find((o) => o.corrupt !== true && observationKeyOf(o.metricKey, o.dateStart, o.dateEnd, o.channelId, o.experimentId) === key) || null;
}

function obsValueEqual(a, b) {
  return (a == null && b == null) || a === b;
}

// 手工录入 / 修订：同键同值幂等（不改来源）；同键不同值必须带修改理由（升 revision 入历史）
export function recordObservation(dataDir, { data, by = 'board' }) {
  requireProfile(dataDir);
  const defs = readMetricDefinitions(dataDir).definitions;
  const d = data || {};
  const fields = {};
  const def = resolveMetric(defs, String(d.metricKey || '').trim());
  if (!def) fields.metricKey = '未知指标：请先在指标字典中定义（可按名称或 key 录入）';
  const startOk = isValidDate(d.dateStart);
  const endOk = isValidDate(d.dateEnd);
  if (!startOk) fields.dateStart = '开始日期应为合法的 YYYY-MM-DD';
  if (!endOk) fields.dateEnd = '结束日期应为合法的 YYYY-MM-DD';
  if (startOk && endOk && String(d.dateStart) > String(d.dateEnd)) {
    fields.dateEnd = '结束日期不能早于开始日期';
  }
  let value = null;
  const rawVal = d.value;
  if (rawVal !== null && rawVal !== undefined && rawVal !== '') {
    const n = typeof rawVal === 'number' ? rawVal : Number(String(rawVal).trim());
    if (!Number.isFinite(n) || n < 0) fields.value = '值必须是不小于 0 的数字（未知请留空，真实零填 0）';
    else value = n;
  }
  if (d.channelId) {
    const f = channelFile(dataDir, String(d.channelId));
    if (!fs.existsSync(f)) fields.channelId = '关联渠道不存在';
    else if (!readJson(f)) fields.channelId = '关联渠道文件已损坏';
  }
  if (d.experimentId) {
    const f = experimentFile(dataDir, String(d.experimentId));
    if (!fs.existsSync(f)) fields.experimentId = '关联实验不存在';
    else if (!readJson(f)) fields.experimentId = '关联实验文件已损坏';
  }
  const unit = String(d.unit ?? '').trim();
  if (def && def.money && !unit) fields.unit = '金额类指标必须指定币种（不同币种不默认换算）';
  const source = String(d.source ?? '').trim() || '手工记录';
  if (source.length > 50) fields.source = '来源过长（≤50 字）';
  const timezone = strVal(d.timezone, { max: 60 });
  if (Object.keys(fields).length) throw fieldError('观察记录校验失败', fields);

  const key = observationKeyOf(def.key, String(d.dateStart), String(d.dateEnd), d.channelId || null, d.experimentId || null);
  const existing = findObservationByKey(dataDir, key);
  const ts = nowIso();
  if (!existing) {
    fs.mkdirSync(observationsDir(dataDir), { recursive: true });
    const id = allocId(observationsDir(dataDir), 'obs');
    const o = normalizeObservation({
      id, createdAt: ts, updatedAt: ts,
      metricKey: def.key, dateStart: String(d.dateStart), dateEnd: String(d.dateEnd), value,
      unit: unit || (def.money ? '' : def.unit),
      channelId: d.channelId || null, experimentId: d.experimentId || null,
      source, timezone,
      collectionMethod: String(d.collectionMethod ?? '').trim() || (source === '手工记录' ? '人工录入' : '文件导入'),
      revision: 1,
      history: [{ rev: 1, value, reason: String(d.reason ?? '').trim() || '初始登记', by, at: ts }],
    });
    writeJsonAtomic(observationFile(dataDir, o.id), o);
    return { observation: o, created: true, revised: false };
  }
  if (obsValueEqual(existing.value, value)) {
    // 同键同值：幂等（来源 / 时间戳不静默改写，不重复计算）
    return { observation: existing, created: false, revised: false };
  }
  const reason = String(d.reason ?? '').trim();
  if (!reason) {
    throw fieldError('观察记录校验失败', { reason: `该观察已存在（当前值 ${existing.value == null ? '未知' : existing.value}）：修订数值需填写修改理由（修订历史可追溯）` });
  }
  const merged = { ...existing };
  merged.value = value;
  merged.unit = unit || existing.unit;
  merged.source = source;
  merged.timezone = timezone;
  merged.revision = existing.revision + 1;
  merged.updatedAt = ts;
  merged.history = [...existing.history, { rev: merged.revision, value, reason: strVal(reason, { max: 500 }), by: strVal(by, { max: 100 }), at: ts }];
  writeJsonAtomic(observationFile(dataDir, merged.id), merged);
  return { observation: merged, created: false, revised: true };
}

// ---------- CSV 导入 ----------

const IMPORT_FIELDS = ['start', 'end', 'metric', 'value', 'unit', 'channel', 'experiment', 'source', 'timezone'];
const IMPORT_HEADER_ALIASES = {
  start: ['date_start', 'startdate', 'start', '开始日期', '开始'],
  end: ['date_end', 'enddate', 'end', '结束日期', '结束'],
  metric: ['metric', '指标名', '指标名称', '指标'],
  value: ['value', '数值', '值'],
  unit: ['unit', 'currency', '单位', '币种'],
  channel: ['channel', '渠道'],
  experiment: ['experiment', '实验'],
  source: ['source', '来源'],
  timezone: ['tz', 'timezone', '时区'],
};
const IMPORT_REQUIRED = ['start', 'end', 'metric', 'value'];

// 模板（UTF-8 文本；服务端按 text/csv 返回，前端下载后填写）
export function importTemplateCsv() {
  return [
    'date_start,date_end,metric,value,currency,channel,experiment,source,tz',
    '2026-09-01,2026-09-07,订阅新增,3,人,,,,UTC+8',
    '2026-09-01,2026-09-07,收入,680,CNY,,,,UTC+8',
  ].join('\n');
}

function parseCsvCellLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

// 首个非空行为表头（必需）；其余为数据行；rowNo 为文件物理行号（表头 = 1）
function parseCsv(text) {
  const lines = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/);
  const rows = [];
  let header = null;
  let rowNo = 0;
  for (const line of lines) {
    rowNo++;
    if (!line.trim()) continue;
    const cells = parseCsvCellLine(line);
    if (!header) { header = cells; continue; }
    rows.push({ rowNo, cells });
  }
  return { header: header || [], rows };
}

function autoMapping(header) {
  const map = {};
  header.forEach((col, idx) => {
    const s = String(col || '').trim().toLowerCase();
    for (const [field, aliases] of Object.entries(IMPORT_HEADER_ALIASES)) {
      if (map[field] !== undefined) continue;
      if (aliases.includes(s)) map[field] = idx;
    }
  });
  return map;
}

function resolveImportMapping(header, mapping) {
  const base = autoMapping(header);
  const merged = { ...base };
  if (mapping && typeof mapping === 'object') {
    for (const field of IMPORT_FIELDS) {
      const v = mapping[field];
      if (Number.isInteger(v) && v >= 0 && v < header.length) merged[field] = v;
    }
  }
  const missing = IMPORT_REQUIRED.filter((f) => merged[f] === undefined);
  if (missing.length) {
    throw new AtbError(`字段映射缺少必填列（开始日期 / 结束日期 / 指标 / 值）：请映射 ${missing.join('、')}`);
  }
  return merged;
}

function cellAt(cells, map, field) {
  const idx = map[field];
  if (idx === undefined || idx === null) return '';
  return String(cells[idx] ?? '').trim();
}

// 单行解析与校验：错误返回中文原因（含行号由调用方拼接）
function buildImportRow(dataDir, defs, cells, map) {
  const metricRaw = cellAt(cells, map, 'metric');
  const def = resolveMetric(defs, metricRaw);
  if (!def) return { ok: false, error: `未知指标「${metricRaw || '（空）'}」：请先在指标字典中定义` };
  const dateStart = cellAt(cells, map, 'start');
  const dateEnd = cellAt(cells, map, 'end');
  if (!isValidDate(dateStart)) return { ok: false, error: `开始日期「${dateStart || '（空）'}」非法（应为 YYYY-MM-DD）` };
  if (!isValidDate(dateEnd)) return { ok: false, error: `结束日期「${dateEnd || '（空）'}」非法（应为 YYYY-MM-DD）` };
  if (String(dateStart) > String(dateEnd)) return { ok: false, error: '结束日期不能早于开始日期' };
  const valueRaw = cellAt(cells, map, 'value');
  let value = null;
  if (valueRaw !== '') {
    const n = Number(valueRaw);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: `值「${valueRaw}」必须是不小于 0 的数字（未知请留空）` };
    value = n;
  }
  let channelId = null;
  const chanRaw = cellAt(cells, map, 'channel');
  if (chanRaw) {
    const chans = readCollection(channelsDir(dataDir), normalizeChannel).filter((c) => c.corrupt !== true);
    const ch = chans.find((c) => c.id === chanRaw)
      || chans.find((c) => c.platform === chanRaw)
      || chans.find((c) => String(c.platform).toLowerCase() === chanRaw.toLowerCase());
    if (!ch) return { ok: false, error: `关联渠道不存在「${chanRaw}」（可填渠道 ID 或平台名，或留空）` };
    channelId = ch.id;
  }
  let experimentId = null;
  const expRaw = cellAt(cells, map, 'experiment');
  if (expRaw) {
    const exps = readCollection(experimentsDir(dataDir), normalizeExperiment).filter((e) => e.corrupt !== true);
    const exp = exps.find((e) => e.id === expRaw) || exps.find((e) => e.hypothesis === expRaw);
    if (!exp) return { ok: false, error: `关联实验不存在「${expRaw}」（可填实验 ID 或假设原文，或留空）` };
    experimentId = exp.id;
  }
  let unit = cellAt(cells, map, 'unit');
  if (def.money && !unit) return { ok: false, error: `金额类指标「${def.name}」必须填写币种（currency 列，如 CNY / USD）` };
  if (!unit && !def.money) unit = def.unit;
  return {
    ok: true,
    row: {
      metricKey: def.key, metricName: def.name, dateStart, dateEnd, value,
      unit, channelId, experimentId,
      source: cellAt(cells, map, 'source') || 'CSV 导入',
      timezone: cellAt(cells, map, 'timezone') || 'UTC+8',
    },
  };
}

// 预览：逐行校验与冲突识别（不写盘）；错误行带行号与原因
export function previewImportCsv(dataDir, { csv, mapping } = {}) {
  requireProfile(dataDir);
  const defs = readMetricDefinitions(dataDir).definitions;
  const parsed = parseCsv(csv);
  if (!parsed.header.length) throw new AtbError('CSV 内容为空：请粘贴含表头的数据（可先下载模板）');
  const map = resolveImportMapping(parsed.header, mapping);
  const seen = new Map(); // 文件内同键去重：同值幂等、不同值报错（不静默相加）
  const rows = [];
  for (const { rowNo, cells } of parsed.rows) {
    const r = buildImportRow(dataDir, defs, cells, map);
    if (!r.ok) { rows.push({ rowNo, status: 'error', error: r.error }); continue; }
    const key = observationKeyOf(r.row.metricKey, r.row.dateStart, r.row.dateEnd, r.row.channelId, r.row.experimentId);
    const inFile = seen.get(key);
    if (inFile) {
      if (obsValueEqual(inFile.value, r.row.value)) {
        rows.push({ rowNo, status: 'same', ...r.row, inFileSize: true });
      } else {
        rows.push({ rowNo, status: 'error', error: `文件内第 ${inFile.rowNo} 行与本行观察键相同但值不同（${inFile.value ?? '未知'} vs ${r.row.value ?? '未知'}）：请合并为一行或改正` });
      }
      continue;
    }
    seen.set(key, { rowNo, value: r.row.value });
    const existing = findObservationByKey(dataDir, key);
    if (!existing) rows.push({ rowNo, status: 'new', ...r.row });
    else if (obsValueEqual(existing.value, r.row.value)) {
      rows.push({ rowNo, status: 'same', ...r.row, existingId: existing.id, existingValue: existing.value, existingRevision: existing.revision });
    } else {
      rows.push({ rowNo, status: 'conflict', ...r.row, existingId: existing.id, existingValue: existing.value, existingRevision: existing.revision });
    }
  }
  return {
    ok: rows.every((x) => x.status !== 'error'),
    total: rows.length,
    header: parsed.header,
    mapping: map,
    rows,
  };
}

function importRowToData(row, reason) {
  return {
    metricKey: row.metricKey, dateStart: row.dateStart, dateEnd: row.dateEnd, value: row.value,
    unit: row.unit, channelId: row.channelId, experimentId: row.experimentId,
    source: row.source, timezone: row.timezone, reason: reason || `CSV 导入（第 ${row.rowNo} 行）`,
  };
}

// 提交：存在任何错误行 → 原子拒绝（零写入）；冲突行需逐行选择修订（需理由）或跳过
export function commitImportCsv(dataDir, { csv, mapping, choices = {}, by = 'board' } = {}) {
  requireProfile(dataDir);
  const p = previewImportCsv(dataDir, { csv, mapping });
  const errs = p.rows.filter((x) => x.status === 'error');
  if (errs.length) {
    throw fieldError(
      `CSV 存在 ${errs.length} 个错误行，已阻止提交（不写入部分数据）`,
      Object.fromEntries(errs.map((x) => [`rows.${x.rowNo}`, `第 ${x.rowNo} 行：${x.error}`])),
    );
  }
  const fields = {};
  for (const c of p.rows.filter((x) => x.status === 'conflict')) {
    const ch = choices[c.rowNo];
    if (!ch || (ch.action !== 'revise' && ch.action !== 'skip')) {
      fields[`rows.${c.rowNo}`] = `第 ${c.rowNo} 行与现有记录值不同（现有 ${c.existingValue == null ? '未知' : c.existingValue}，导入 ${c.value == null ? '未知' : c.value}）：需明确选择修订或跳过`;
    } else if (ch.action === 'revise' && !String(ch.reason ?? '').trim()) {
      fields[`rows.${c.rowNo}.reason`] = `第 ${c.rowNo} 行选择修订需填写修改理由`;
    }
  }
  if (Object.keys(fields).length) throw fieldError('CSV 值冲突处理缺失', fields);

  let created = 0;
  let revised = 0;
  let unchanged = 0;
  let skipped = 0;
  for (const r of p.rows) {
    if (r.status === 'same') { unchanged++; continue; }
    if (r.status === 'conflict') {
      const ch = choices[r.rowNo];
      if (ch.action === 'skip') { skipped++; continue; }
      const out = recordObservation(dataDir, { data: importRowToData(r, String(ch.reason ?? '').trim()), by });
      if (out.revised) revised++;
      continue;
    }
    recordObservation(dataDir, { data: importRowToData(r, ''), by });
    created++;
  }
  return { created, revised, unchanged, skipped, effect: readEffect(dataDir, {}) };
}

// ---------- 效果汇总（卡片 / 派生 / 观察 / 复盘） ----------

function uniqueSources(list) {
  const map = new Map();
  for (const o of list) {
    const cur = map.get(o.source);
    if (!cur || String(o.updatedAt) > String(cur.updatedAt)) map.set(o.source, { source: o.source, updatedAt: o.updatedAt });
  }
  return [...map.values()];
}

function scopeIdOf(o) { return `${o.channelId || ''}|${o.experimentId || ''}`; }

// 聚合口径：第一版只对同口径、同币种、可加的互斥数据求和，其余分开呈现
function buildEffectCard(def, list, chLabel) {
  const base = {
    metricKey: def.key, name: def.name, category: def.category,
    categoryLabel: METRIC_CATEGORY_LABEL[def.category],
    kind: def.kind, kindLabel: METRIC_KIND_LABEL[def.kind],
    unit: def.unit, unitLabel: def.money ? '币种' : def.unit,
    dedup: def.dedup, money: !!def.money,
    status: 'none', value: null, unitText: '', revision: null,
    parts: [], sources: [], updatedAt: null, note: null,
  };
  if (!list.length) return base;
  const latest = list.reduce((m, o) => (String(o.updatedAt) > String(m.updatedAt) ? o : m));
  base.updatedAt = latest.updatedAt;
  base.revision = latest.revision;
  base.sources = uniqueSources(list);
  const partOf = (o, value, unit, period) => ({
    value, unit: unit || (def.money ? '' : def.unit),
    channelId: o.channelId || null, channelLabel: chLabel(o.channelId),
    experimentId: o.experimentId || null,
    period: period || `${o.dateStart}~${o.dateEnd}`,
    source: o.source, revision: o.revision, updatedAt: o.updatedAt,
  });
  const combinedPeriod = (items) => {
    const min = items.reduce((m, o) => (String(o.dateStart) < m ? String(o.dateStart) : m), String(items[0].dateStart));
    const max = items.reduce((m, o) => (String(o.dateEnd) > m ? String(o.dateEnd) : m), String(items[0].dateEnd));
    return `${min}~${max}`;
  };
  const sumOf = (items) => (items.every((o) => o.value == null) ? null : items.reduce((s, o) => s + (o.value == null ? 0 : o.value), 0));

  if (def.kind === 'stock') {
    // 存量：同归属取最新周期，不跨日期相加；跨归属分开呈现
    const byScope = new Map();
    for (const o of list) {
      const s = scopeIdOf(o);
      const cur = byScope.get(s);
      if (!cur || String(o.dateEnd) > String(cur.dateEnd) || (String(o.dateEnd) === String(cur.dateEnd) && o.revision > cur.revision)) byScope.set(s, o);
    }
    const parts = [...byScope.values()].map((o) => partOf(o, o.value, o.unit));
    base.parts = parts;
    if (parts.length === 1) {
      base.status = 'value';
      base.value = parts[0].value;
      base.unitText = parts[0].unit;
    } else {
      base.status = 'split';
      base.note = '存量指标按归属分开呈现（不跨日期相加、不跨平台求和）';
    }
    return base;
  }
  if (def.kind === 'unique') {
    // 独立人数：去重口径不跨范围相加，按归属 + 周期分开呈现
    const parts = list.map((o) => partOf(o, o.value, o.unit));
    base.parts = parts;
    if (parts.length === 1) {
      base.status = 'value';
      base.value = parts[0].value;
      base.unitText = parts[0].unit;
    } else {
      base.status = 'split';
      base.note = '独立人数按去重口径分开呈现，不跨范围相加';
    }
    return base;
  }
  if (def.category === 'following') {
    // 关注类：同归属跨周期可加（互斥时间片），跨平台分开呈现（禁止伪去重总数）
    const groups = new Map();
    for (const o of list) {
      const k = `${scopeIdOf(o)}|${o.unit || def.unit}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }
    const parts = [...groups.values()].map((items) => partOf(items[0], sumOf(items), items[0].unit || def.unit, combinedPeriod(items)));
    base.parts = parts;
    if (parts.length === 1) {
      base.status = 'value';
      base.value = parts[0].value;
      base.unitText = parts[0].unit;
    } else {
      base.status = 'split';
      base.note = '关注类指标不跨平台求和（各归属分开呈现，不展示伪去重总数）';
    }
    return base;
  }
  // 期间增量 / 事件次数：同单位（币种）跨互斥周期与归属求和；不同单位分开呈现
  const byUnit = new Map();
  for (const o of list) {
    const u = o.unit || def.unit;
    if (!byUnit.has(u)) byUnit.set(u, []);
    byUnit.get(u).push(o);
  }
  const parts = [...byUnit.entries()].map(([u, items]) => partOf(items[0], sumOf(items), u, combinedPeriod(items)));
  base.parts = parts;
  if (parts.length === 1) {
    base.status = 'value';
    base.value = parts[0].value;
    base.unitText = parts[0].unit;
  } else {
    base.status = 'split';
    base.note = def.money ? '不同币种分开呈现，不做默认换算' : '不同单位分开呈现，不混算';
  }
  return base;
}

// 派生转化率：同周期 + 同归属（口径一致）配对才计算；分母为零 / 未录入 / 口径不一致给出原因
function buildDerivedRate(d, obs) {
  const num = obs.filter((o) => o.metricKey === d.numerator);
  const den = obs.filter((o) => o.metricKey === d.denominator);
  const base = { key: d.key, name: d.name, numerator: d.numerator, denominator: d.denominator, unit: d.unit || '' };
  if (!den.length) return { ...base, status: 'not-computable', reason: '分母未录入（先录入分母指标观察）' };
  let best = null;
  for (const dn of den) {
    for (const nn of num) {
      if (nn.dateStart === dn.dateStart && nn.dateEnd === dn.dateEnd
        && scopeIdOf(nn) === scopeIdOf(dn)) {
        if (!best || String(dn.dateEnd) > String(best.dn.dateEnd)) best = { nn, dn };
      }
    }
  }
  if (best) {
    if (best.dn.value == null || best.nn.value == null) {
      return { ...base, status: 'not-computable', reason: '分子或分母为未知（空值），不可计算' };
    }
    if (best.dn.value === 0) return { ...base, status: 'not-computable', reason: '分母为零' };
    return { ...base, status: 'value', value: best.nn.value / best.dn.value, period: `${best.dn.dateStart}~${best.dn.dateEnd}` };
  }
  if (den.every((x) => x.value === 0)) return { ...base, status: 'not-computable', reason: '分母为零' };
  return { ...base, status: 'not-computable', reason: '口径不一致（分子分母观察周期或归属不同，不混算）' };
}

// ---------- 复盘 ----------

function normalizeReview(rv) {
  return {
    schemaVersion: MARKETING_SCHEMA_VERSION,
    id: String(rv.id || ''),
    createdAt: rv.createdAt || '',
    updatedAt: rv.updatedAt || '',
    experimentId: typeof rv.experimentId === 'string' && rv.experimentId ? rv.experimentId : null,
    periodStart: strVal(rv.periodStart, { max: 10 }),
    periodEnd: strVal(rv.periodEnd, { max: 10 }),
    target: strVal(rv.target, { max: 500 }),
    actual: strVal(rv.actual, { max: 500 }),
    basis: strVal(rv.basis),
    conclusion: strVal(rv.conclusion),
    nextStep: strVal(rv.nextStep),
    insufficient: rv.insufficient === true,
    snapshot: Array.isArray(rv.snapshot)
      ? rv.snapshot
        .filter((s) => s && typeof s === 'object')
        .map((s) => ({
          observationId: String(s.observationId || ''),
          metricKey: String(s.metricKey || ''),
          metricName: strVal(s.metricName, { max: 50 }),
          dateStart: strVal(s.dateStart, { max: 10 }),
          dateEnd: strVal(s.dateEnd, { max: 10 }),
          value: s.value == null ? null : s.value,
          unit: strVal(s.unit, { max: 20 }),
          source: strVal(s.source, { max: 50 }),
          revision: Number(s.revision) || 1,
        }))
      : [],
  };
}

function listReviews(dataDir) {
  return readCollection(reviewsDir(dataDir), normalizeReview);
}

// 复盘：保存时固定观察快照（值与修订号），后续数据修订不改变历史复盘依据
export function createReview(dataDir, { data, by = 'board' }) {
  requireProfile(dataDir);
  const d = data || {};
  const fields = {};
  const startOk = isValidDate(d.periodStart);
  const endOk = isValidDate(d.periodEnd);
  if (!startOk) fields.periodStart = '观察开始应为合法的 YYYY-MM-DD';
  if (!endOk) fields.periodEnd = '观察结束应为合法的 YYYY-MM-DD';
  if (startOk && endOk && String(d.periodStart) > String(d.periodEnd)) {
    fields.periodEnd = '观察结束不能早于观察开始';
  }
  if (d.experimentId) {
    const f = experimentFile(dataDir, String(d.experimentId));
    if (!fs.existsSync(f)) fields.experimentId = '关联实验不存在';
    else if (!readJson(f)) fields.experimentId = '关联实验文件已损坏';
  }
  collectStr(fields, d, 'target', 'target', { max: 500, label: '目标' });
  collectStr(fields, d, 'actual', 'actual', { max: 500, label: '实际' });
  collectStr(fields, d, 'basis', 'basis', { label: '依据说明' });
  if (!String(d.conclusion || '').trim()) fields.conclusion = '复盘结论不能为空';
  collectStr(fields, d, 'nextStep', 'nextStep', { label: '下一步' });
  const insufficient = d.insufficient === true;
  if (!insufficient && (!String(d.target || '').trim() || !String(d.actual || '').trim())) {
    fields.insufficient = '缺少目标 / 实际：无数据请勾选「数据不足」保存（不伪造改善幅度）';
  }
  if (Object.keys(fields).length) throw fieldError('复盘校验失败', fields);

  // 快照：观察期 ∩ 周期重叠 且 归属匹配（选了实验则仅该实验）的观察当前值与修订号
  const inRange = readObservations(dataDir)
    .filter((o) => o.corrupt !== true)
    .filter((o) => !d.experimentId || o.experimentId === d.experimentId)
    .filter((o) => o.dateStart <= String(d.periodEnd) && o.dateEnd >= String(d.periodStart));
  if (!insufficient && !inRange.length) {
    throw fieldError('复盘校验失败', { insufficient: '观察期内没有观察记录：请先录入数据，或勾选「数据不足」保存' });
  }
  const defs = readMetricDefinitions(dataDir).definitions;
  const snapshot = inRange.map((o) => ({
    observationId: o.id,
    metricKey: o.metricKey,
    metricName: defs.find((x) => x.key === o.metricKey)?.name || o.metricKey,
    dateStart: o.dateStart, dateEnd: o.dateEnd,
    value: o.value, unit: o.unit, source: o.source, revision: o.revision,
  }));
  fs.mkdirSync(reviewsDir(dataDir), { recursive: true });
  const id = allocId(reviewsDir(dataDir), 'rev');
  const ts = nowIso();
  const rv = normalizeReview({
    ...d, id, createdAt: ts, updatedAt: ts, insufficient, snapshot,
  });
  writeJsonAtomic(reviewFileOf(dataDir, id), rv);
  return { review: rv, effect: readEffect(dataDir, {}) };
}

// ---------- 效果页读取（两态：未初始化营销 → initialized:false） ----------

export function readEffect(dataDir, { from, to, channelId, experimentId } = {}) {
  if (!fs.existsSync(profileFile(dataDir))) return { initialized: false };
  requireProfile(dataDir); // 损坏 → 抛错（前端显示读取失败可重试，不静默重建）
  const { definitions } = readMetricDefinitions(dataDir);
  const channels = readCollection(channelsDir(dataDir), normalizeChannel);
  const experiments = readCollection(experimentsDir(dataDir), normalizeExperiment);
  const chLabel = (id) => (id ? (channels.find((c) => c.id === id)?.platform || id) : '未指定归属');
  const fromS = isValidDate(from) ? String(from) : null;
  const toS = isValidDate(to) ? String(to) : null;
  const all = readObservations(dataDir);
  const obs = all
    .filter((o) => o.corrupt !== true)
    .filter((o) => !channelId || o.channelId === channelId)
    .filter((o) => !experimentId || o.experimentId === experimentId)
    .filter((o) => !fromS || o.dateEnd >= fromS)
    .filter((o) => !toS || o.dateStart <= toS);
  const cards = definitions.map((def) => buildEffectCard(def, obs.filter((o) => o.metricKey === def.key), chLabel));
  const derived = DEFAULT_DERIVED.map((d) => buildDerivedRate(d, obs));
  const reviews = listReviews(dataDir)
    .filter((rv) => !experimentId || rv.experimentId === experimentId)
    .filter((rv) => !fromS || rv.periodEnd >= fromS)
    .filter((rv) => !toS || rv.periodStart <= toS);
  const visible = [...obs, ...all.filter((o) => o.corrupt === true)]
    .sort((a, b) => String(b.dateEnd || '').localeCompare(String(a.dateEnd || ''))
      || String(b.dateStart || '').localeCompare(String(a.dateStart || ''))
      || String(a.id).localeCompare(String(b.id)));
  return {
    initialized: true,
    definitions,
    channels: channels.map((c) => ({ id: c.id, platform: c.platform, corrupt: c.corrupt === true })),
    experiments: experiments.map((e) => ({ id: e.id, hypothesis: e.hypothesis, corrupt: e.corrupt === true })),
    cards,
    derived,
    reviews,
    observations: visible,
    filters: { from: fromS, to: toS, channelId: channelId || null, experimentId: experimentId || null },
  };
}
