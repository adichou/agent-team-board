#!/usr/bin/env node
// REQ-20260910-022 project-growth 工作流 —— 前端契约 + 行为测试（U1~U5）
// U1 为源码静态契约（marketing.js / style.css），U2~U5 为 vm 行为
// （加载实际 marketing.js，fetch stub 返回营销档案 + growth 列表 / 任务创建 / 运行详情 / 候选采纳）。
// 用法：node scripts/tests/marketing-growth-ui.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const mktJs = fs.readFileSync(path.join(webRoot, 'marketing.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- vm 接缝（marketing-metrics-ui.test.mjs 同法） ---------- */
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {}, click() {},
    closest() { return null; },
    get scrollTop() { return 0; }, set scrollTop(v) {},
  };
}

function statePayload() {
  return {
    initialized: true,
    profile: {
      id: 'mp-1', revision: 3, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-10T01:00:00.000Z',
      positioning: { intro: '一句话介绍', stage: 'validating', markets: '', audience: '', scenarios: '', painPoints: '', alternatives: '', differentiators: '', links: '', stageGoal: '', primaryMetric: '', budget: null, weeklyHours: null },
      evidence: [], currentPricing: 'v2',
    },
    versions: [
      { version: 'v1', createdAt: '2026-09-08T02:00:00.000Z', model: 'onetime', currency: 'CNY', cycle: '', packages: [{ name: '买断', benefits: '', price: 19 }], costBasis: '', competitorBasis: '', validationMethod: '' },
      { version: 'v2', createdAt: '2026-09-09T02:00:00.000Z', model: 'subscription', currency: 'CNY', cycle: 'monthly', packages: [{ name: '标准', benefits: '', price: 29 }], costBasis: '', competitorBasis: '', validationMethod: '' },
    ],
    current: 'v2',
  };
}

const RUN_WAITING = {
  id: 'ar-w1', type: 'positioning', typeLabel: '梳理定位', status: 'waiting', session: null,
  inputs: [{ ref: 'profile.json', revision: 3 }, { ref: 'README.md', revision: null }],
  continueOf: null, observation: null, summary: null, draftRef: null,
  receiptAt: null, createdAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z',
  insufficient: false, candidateCounts: null, result: 'waiting', lastReceiptReason: null,
};
const RUN_RECEIVED = {
  id: 'ar-r1', type: 'pricing', typeLabel: '分析定价', status: 'received', session: 'ext-session-a',
  inputs: [{ ref: 'profile.json', revision: 3 }, { ref: 'pricing/v1.json', revision: null }, { ref: 'pricing/v2.json', revision: null }],
  continueOf: null, observation: null,
  summary: '输出 2 条事实、1 条假设；候选 2 项待逐项处理。',
  draftRef: 'agent-runs/ar-r1/draft.md', receiptAt: '2026-09-10T10:20:00.000Z',
  createdAt: '2026-09-10T09:30:00.000Z', updatedAt: '2026-09-10T10:20:00.000Z',
  insufficient: false, candidateCounts: { total: 2, adopted: 0, kept: 0, pending: 2 }, result: 'success', lastReceiptReason: null,
};
const RUN_STALE = {
  ...RUN_WAITING, id: 'ar-s1', result: 'rejected:stale',
  lastReceiptReason: '输入基线过期：profile.json 任务输入 r3 < 当前 r4。未写入草稿，请按当前版本重建任务',
};

function growthPayload(runs = [RUN_RECEIVED, RUN_WAITING]) {
  return {
    initialized: true,
    skills: {
      installed: false, source: 'https://github.com/coreyhaines31/marketingskills',
      note: '外部 skill 未安装：仅记录候选与来源',
      byType: { positioning: ['product-marketing'], pricing: ['pricing', 'product-marketing'], channels: ['marketing-plan', 'social'], content: ['content-strategy', 'copywriting'], review: ['analytics', 'attribution'] },
    },
    runs,
  };
}

const RUN_DETAIL = {
  ...RUN_RECEIVED,
  prompt: '# project-growth 任务提示词（分析定价）…',
  receipts: [{ at: '2026-09-10T10:20:00.000Z', result: 'success', reason: '' }],
  draft: {
    facts: ['付费人数 0（真实零，metrics@r2）', '竞品 A 订阅 $9/月'],
    assumptions: ['价格可能不是唯一阻碍'],
    toConfirm: ['¥29 是否高于心理价位'],
    evidence: ['pricing/v2.json', 'profile.json@r3'],
    missing: ['付费转化漏斗中间数据未采集'],
    advice: [],
    insufficient: false,
    candidates: [
      { id: 'c1', kind: 'pricing', title: '候选定价 v3：订阅 ¥19/月', reason: '贴近访谈心理价位', verify: '半流量 A/B 观察付费转化', adoptTo: 'pricing/v3.json（候选版本）', data: { model: 'subscription', currency: 'CNY', cycle: 'monthly', packages: [{ name: '标准', benefits: '全功能', price: 19 }] }, state: 'pending', resultRef: '' },
      { id: 'c2', kind: 'positioning', title: '受众假设：小团队负责人', reason: '访谈样本集中', verify: '问卷 20 份复核', adoptTo: '档案证据（假设）', data: { content: '受众假设：小团队负责人' }, state: 'pending', resultRef: '' },
    ],
  },
};

const RUN_DETAIL_INSUFFICIENT = {
  ...RUN_RECEIVED, id: 'ar-x1', type: 'review', typeLabel: '复盘', observation: { from: '2026-09-08', to: '2026-09-14' },
  summary: '数据不足：仅输出补采建议，未生成结论。',
  draft: {
    facts: ['该观察期无任何观察记录（未录入 ≠ 0）'], assumptions: [], toConfirm: ['观察是否已开始'],
    evidence: ['metrics/observations（该周期无记录）'], missing: ['订阅新增 / 激活 / 访客均无数据'],
    advice: ['先补采：订阅新增、激活、访客（分母）', '录入后再生成复盘，本周期不输出结论'],
    insufficient: true, candidates: [],
  },
};

function setup({
  growth = growthPayload(), detail = RUN_DETAIL, adoptResponses, keepResponses, runCreate,
} = {}) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.querySelector = (sel) => document.nodes.get(sel) ?? null;
  document.nodes.set('#marketingView', element());
  document.nodes.set('#mktSwitchWrap', element());
  document.nodes.set('#mktSwitchText', element());
  document.nodes.set('#mktSwitchSave', element());
  document.nodes.set('#mktSwitchDiscard', element());
  document.nodes.set('#mktSwitchCancel', element());
  document.addEventListener = () => {};
  const calls = [];
  const windowEvents = [];
  const clipboard = [];
  const adoptQueue = Array.isArray(adoptResponses) ? [...adoptResponses] : null;
  const keepQueue = Array.isArray(keepResponses) ? [...keepResponses] : null;
  let growthNow = growth;
  let detailNow = detail;
  let createCount = 0;
  const sandbox = {
    document, console, URLSearchParams, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener: (type, fn) => { windowEvents.push([type, fn]); },
    dispatchEvent: (ev) => { for (const [type, fn] of windowEvents) if (type === ev.type) fn(ev); return true; },
    navigator: { clipboard: { writeText: async (text) => { clipboard.push(text); } } },
    fetch: async (url, opts) => {
      const u = String(url);
      calls.push({ url: u, method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : null });
      if (u.includes('/api/marketing/growth/run/adopt')) {
        const r = adoptQueue ? adoptQueue.shift() : { ok: true, status: 200, json: { already: false, run: RUN_DETAIL, result: { version: 'v3', ref: 'pricing/v3.json' } } };
        return { ok: !!r.ok, status: r.status, json: async () => r.json || {} };
      }
      if (u.includes('/api/marketing/growth/run/keep')) {
        const r = keepQueue ? keepQueue.shift() : { ok: true, status: 200, json: { already: false, run: RUN_DETAIL } };
        return { ok: !!r.ok, status: r.status, json: async () => r.json || {} };
      }
      if (u.includes('/api/marketing/growth/run/edit')) {
        return { ok: true, status: 200, json: { run: RUN_DETAIL } };
      }
      if (/\/api\/marketing\/growth\/run\/[^/?]+(\?|$)/.test(u)) {
        return { ok: true, status: 200, json: async () => detailNow };
      }
      if (u.includes('/api/marketing/growth/run')) {
        createCount++;
        const r = typeof runCreate === 'function' ? runCreate(createCount) : {
          ok: true, status: 201,
          json: { run: { ...RUN_WAITING, id: `ar-new${createCount}` }, prompt: '# project-growth 任务提示词（梳理定位）\n- 保存协议：node /x/atb.mjs growth receipt ar-new' + createCount + ' --file draft.json --dir /p' },
        };
        return { ok: !!r.ok, status: r.status, json: async () => r.json || {} };
      }
      if (u.includes('/api/marketing/growth/inputs')) {
        return { ok: true, status: 200, json: async () => ({ initialized: true, inputs: [{ ref: 'profile.json', revision: 3 }, { ref: 'README.md', revision: null }] }) };
      }
      if (u.includes('/api/marketing/growth')) {
        const payload = typeof growthNow === 'function' ? growthNow() : growthNow;
        return { ok: true, status: 200, json: async () => payload };
      }
      if (u.includes('/api/marketing/state')) {
        return { ok: true, status: 200, json: async () => statePayload() };
      }
      if (u.includes('/api/marketing/board')) {
        return { ok: true, status: 200, json: { initialized: true, channels: [], experiments: [], activities: [] } };
      }
      if (u.includes('/api/marketing/effect')) {
        return { ok: true, status: 200, json: async () => ({ initialized: true, definitions: [], channels: [], experiments: [], cards: [], derived: [], reviews: [], observations: [], filters: {} }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    navigator2: null,
  };
  sandbox.window = sandbox;
  sandbox.navigator = sandbox.navigator; // 保持单例
  vm.createContext(sandbox);
  vm.runInContext(mktJs, sandbox, { filename: 'marketing.js' });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    ...sandbox, calls, clipboard, tick,
    setGrowth: (g) => { growthNow = g; },
    setDetail: (d) => { detailNow = d; },
  };
}

const viewHtml = (h) => h.document.querySelector('#marketingView').innerHTML;
const node = (h, sel) => h.document.querySelector('#marketingView').querySelector(sel) || h.document.nodes.get(sel);

/* ---------- 静态契约 ---------- */

t('U1 静态契约：四页签 AI 入口按钮（五类）与效果页「生成复盘草稿」；growth 样式', () => {
  assert.ok(mktJs.includes('data-ai-type="${ty}"') || mktJs.includes('data-ai-type='), '按钮携带 data-ai-type');
  for (const ty of ['positioning', 'pricing', 'channels', 'content', 'review']) {
    assert.ok(mktJs.includes(`'${ty}', '`) || mktJs.includes(`['${ty}',`), `五类入口覆盖 ${ty}`);
  }
  assert.ok(mktJs.includes('生成复盘草稿'), '效果页生成复盘草稿入口');
  assert.ok(mktJs.includes('梳理定位') && mktJs.includes('分析定价') && mktJs.includes('制定渠道计划') && mktJs.includes('生成内容'), '入口文案齐备');
  for (const w of ['尚未收到结果', '复制任务提示词', '复制继续任务提示词', '保留草稿', '数据不足', '补采建议', '不自动成为当前方案']) {
    assert.ok(mktJs.includes(w), `应包含「${w}」文案`);
  }
  assert.match(css, /\.mkt-ai-btn/, 'AI 按钮样式');
  assert.match(css, /\.mkt-ai-pre/, '提示词留档样式');
  assert.match(css, /\.mkt-ai-cand/, '候选卡片样式');
});

/* ---------- vm 行为 ---------- */

t('U2 任务面板：资料引用及版本 + 技能缺口；复制提示词仅写剪贴板并登记任务，显示「尚未收到结果」', async () => {
  const h = setup();
  await h.ATBMarketing.enter('/p');
  assert.ok(h.calls.some((c) => c.url.includes('/api/marketing/growth')), '进入营销模块拉取运行记录');

  node(h, '[data-ai-type="positioning"]').listeners.click();
  await h.tick();
  const panel = viewHtml(h);
  assert.match(panel, /将使用的项目资料/, '面板显示项目资料');
  assert.match(panel, /profile\.json/, '资料引用含档案');
  assert.match(panel, /技能缺失|未安装/, '技能缺失提示');
  assert.match(panel, /兜底/, '手工提示词兜底说明（不假称已运行外部 skill）');

  node(h, '#mktAiCopy').listeners.click();
  await h.tick();
  const create = h.calls.find((c) => c.url.includes('/api/marketing/growth/run') && c.method === 'POST' && !c.url.includes('/adopt') && !c.url.includes('/keep') && !c.url.includes('/edit'));
  assert.ok(create, '复制时登记任务');
  assert.equal(create.body.type, 'positioning');
  assert.equal(h.clipboard.length, 1, '仅写剪贴板（不执行任务）');
  assert.match(h.clipboard[0], /project-growth/, '剪贴板为任务提示词');
  assert.match(h.clipboard[0], /growth receipt/, '提示词含统一保存协议 CLI');
  const after = viewHtml(h);
  assert.match(after, /尚未收到结果/, '登记后显示等待回执');
});

t('U3 草稿面板：分区展示事实 / 假设 / 待确认、证据与缺失信息；候选逐项操作；数据不足显示补采建议', async () => {
  const h = setup();
  await h.ATBMarketing.enter('/p');
  node(h, '[data-ai-type="positioning"]').listeners.click();
  node(h, '#mktAiRun-ar-r1')?.listeners.click();
  // 运行记录入口打开草稿
  const btn = node(h, '#mktAiRun-ar-r1');
  if (!btn) {
    assert.fail('运行记录应提供查看入口');
  }
  await h.tick();
  const d = viewHtml(h);
  assert.match(d, /事实/, '事实分区');
  assert.match(d, /假设/, '假设分区');
  assert.match(d, /待确认/, '待确认分区');
  assert.match(d, /证据引用/, '证据引用');
  assert.match(d, /缺失信息/, '缺失信息');
  assert.match(d, /候选定价 v3/, '候选展示');
  assert.match(d, /验证方法/, '候选含验证方法');
  assert.ok(node(h, '#mktAiCandAdopt-c1'), '采纳按钮');
  assert.ok(node(h, '#mktAiCandKeep-c1'), '保留草稿按钮');
  assert.ok(node(h, '#mktAiCandEdit-c1'), '编辑按钮');

  // 数据不足：补采建议、无候选操作
  h.setDetail(RUN_DETAIL_INSUFFICIENT);
  node(h, '#mktAiRun-ar-r1').listeners.click();
  await h.tick();
  const d2 = viewHtml(h);
  assert.match(d2, /数据不足/, '数据不足提示');
  assert.match(d2, /补采建议/, '补采建议展示');
  assert.match(d2, /本周期不输出结论/, '不生成虚构结论');
  assert.ok(!d2.includes('id="mktAiCandAdopt-'), '无候选可采纳');
});

t('U4 运行记录：任务 ID / 输入引用及版本 / 状态 / 写入时间 / 执行结果；等待回执与过期标识', async () => {
  const h = setup({ growth: growthPayload([RUN_STALE, RUN_RECEIVED, RUN_WAITING]) });
  await h.ATBMarketing.enter('/p');
  const v = viewHtml(h);
  assert.match(v, /AI 运行记录|运行记录/, '运行记录区块');
  assert.match(v, /ar-r1/, '任务 ID');
  assert.match(v, /profile\.json/, '输入引用及版本');
  assert.match(v, /ext-session-a/, '来源会话');
  assert.match(v, /尚未收到结果/, '等待回执显示');
  assert.match(v, /输入基线过期/, '过期输入标识（未写入，可重建）');
});

t('U5 采纳与反馈：定价采纳提示不自动成为当前方案；失败保留草稿；继续任务提示词含历史引用', async () => {
  const h = setup({
    adoptResponses: [
      { ok: true, status: 200, json: { already: false, run: RUN_DETAIL, result: { version: 'v3', ref: 'pricing/v3.json' } } },
      { ok: false, status: 400, json: { error: '定价方案字段校验失败', fields: { currency: '收费定价必须填写币种' } } },
    ],
  });
  await h.ATBMarketing.enter('/p');
  node(h, '[data-ai-type="positioning"]').listeners.click();
  node(h, '#mktAiRun-ar-r1').listeners.click();
  await h.tick();

  node(h, '#mktAiCandAdopt-c1').listeners.click();
  await h.tick();
  const adoptCall = h.calls.find((c) => c.url.includes('/api/marketing/growth/run/adopt'));
  assert.ok(adoptCall, '采纳请求发出');
  assert.deepEqual(adoptCall.body, { id: 'ar-r1', candidateId: 'c1', data: null });
  assert.match(viewHtml(h), /不自动成为当前方案/, '候选定价采纳后提示');

  // 校验失败：错误回显、草稿面板保留
  node(h, '#mktAiCandAdopt-c1').listeners.click();
  await h.tick();
  const v = viewHtml(h);
  assert.match(v, /币种|校验失败/, '错误回显');
  assert.match(v, /候选定价 v3/, '草稿面板保留（未丢失）');

  // 继续任务提示词：POST 带 continueOf，剪贴板含历史引用
  node(h, '#mktAiContinue-ar-r1').listeners.click();
  await h.tick();
  const contCall = h.calls.filter((c) => c.url.includes('/api/marketing/growth/run') && c.method === 'POST' && !c.url.includes('/adopt') && !c.url.includes('/keep') && !c.url.includes('/edit')).at(-1);
  assert.ok(contCall, '接续任务请求');
  assert.equal(contCall.body.continueOf, 'ar-r1', '接续历史任务');
  assert.ok(h.clipboard.at(-1).includes('growth receipt'), '接续提示词同样携带保存协议');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
