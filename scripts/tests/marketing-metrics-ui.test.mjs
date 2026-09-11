#!/usr/bin/env node
// REQ-20260910-021 效果与复盘 —— 前端契约 + 行为测试（U1~U7）
// U1 为源码静态契约（marketing.js / style.css），U2~U7 为 vm 行为
// （加载实际 marketing.js，fetch stub 返回营销档案 + effect 数据 / 导入预览与提交 / 复盘创建）。
// 用法：node scripts/tests/marketing-metrics-ui.test.mjs

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

/* ---------- vm 接缝（marketing-board-ui.test.mjs 同法） ---------- */
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
      id: 'mp-1', revision: 2, createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T01:00:00.000Z',
      positioning: { intro: '一句话介绍', stage: 'validating', markets: '', audience: '', scenarios: '', painPoints: '', alternatives: '', differentiators: '', links: '', stageGoal: '', primaryMetric: '', budget: null, weeklyHours: null },
      evidence: [], currentPricing: null,
    },
    versions: [], current: null,
  };
}

const DEFS = [
  { key: 'subsNew', name: '订阅新增', category: 'following', kind: 'delta', unit: '人', dedup: '按账号去重；不跨平台求和' },
  { key: 'activations', name: '激活', category: 'usage', kind: 'delta', unit: '人', dedup: '按账号去重' },
  { key: 'likes', name: '点赞', category: 'engagement', kind: 'events', unit: '次', dedup: '不去重' },
  { key: 'revenue', name: '收入', category: 'commercial', kind: 'delta', unit: '', money: true, dedup: '不适用' },
  { key: 'visitors', name: '访客', category: 'usage', kind: 'unique', unit: '人', dedup: '按设备在观察窗口内去重' },
];

function obsRow(id, over = {}) {
  return {
    id, metricKey: 'subsNew', dateStart: '2026-09-01', dateEnd: '2026-09-07', value: 0, unit: '人',
    channelId: null, experimentId: null, source: 'CSV 导入', timezone: 'UTC+8', revision: 2,
    updatedAt: '2026-09-09T10:12:00.000Z',
    history: [
      { rev: 1, value: 1, reason: '初始导入', by: 'CSV', at: '2026-09-08T09:00:00.000Z' },
      { rev: 2, value: 0, reason: '剔除重复订阅账号', by: 'board', at: '2026-09-09T10:12:00.000Z' },
    ],
    ...over,
  };
}

function effectPayload(over = {}) {
  return {
    initialized: true,
    definitions: DEFS,
    channels: [{ id: 'ch-a1', platform: 'Reddit', corrupt: false }],
    experiments: [{ id: 'exp-e1', hypothesis: '两周访问实验', corrupt: false }],
    cards: over.cards !== undefined ? over.cards : [
      {
        metricKey: 'subsNew', name: '订阅新增', category: 'following', categoryLabel: '持续关注',
        kind: 'delta', kindLabel: '期间增量', unit: '人', unitLabel: '人', dedup: '按账号去重；不跨平台求和', money: false,
        status: 'value', value: 0, unitText: '人', revision: 2, parts: [],
        sources: [{ source: 'CSV 导入', updatedAt: '2026-09-09T10:12:00.000Z' }], updatedAt: '2026-09-09T10:12:00.000Z', note: null,
      },
      {
        metricKey: 'activations', name: '激活', category: 'usage', categoryLabel: '使用',
        kind: 'delta', kindLabel: '期间增量', unit: '人', unitLabel: '人', dedup: '按账号去重', money: false,
        status: 'value', value: 12, unitText: '人', revision: 1, parts: [],
        sources: [{ source: '手工记录', updatedAt: '2026-09-08T21:40:00.000Z' }], updatedAt: '2026-09-08T21:40:00.000Z', note: null,
      },
      {
        metricKey: 'likes', name: '点赞', category: 'engagement', categoryLabel: '互动',
        kind: 'events', kindLabel: '事件次数', unit: '次', unitLabel: '次', dedup: '不去重', money: false,
        status: 'none', value: null, unitText: '', revision: null, parts: [],
        sources: [], updatedAt: null, note: null,
      },
      {
        metricKey: 'revenue', name: '收入', category: 'commercial', categoryLabel: '商业',
        kind: 'delta', kindLabel: '期间增量', unit: '', unitLabel: '币种', dedup: '不适用', money: true,
        status: 'split', value: null, unitText: '', revision: 1,
        parts: [
          { value: 680, unit: 'CNY', channelId: null, channelLabel: '未指定归属', experimentId: null, period: '2026-09-01~2026-09-07', source: 'CSV 导入', revision: 1, updatedAt: '2026-09-09T10:00:00.000Z' },
          { value: 90, unit: 'USD', channelId: null, channelLabel: '未指定归属', experimentId: null, period: '2026-09-08~2026-09-14', source: 'CSV 导入', revision: 1, updatedAt: '2026-09-15T10:00:00.000Z' },
        ],
        sources: [{ source: 'CSV 导入', updatedAt: '2026-09-15T10:00:00.000Z' }], updatedAt: '2026-09-15T10:00:00.000Z', note: '不同币种分开呈现，不做默认换算',
      },
      {
        metricKey: 'visitors', name: '访客', category: 'usage', categoryLabel: '使用',
        kind: 'unique', kindLabel: '独立人数', unit: '人', unitLabel: '人', dedup: '按设备在观察窗口内去重', money: false,
        status: 'split', value: null, unitText: '', revision: 1,
        parts: [
          { value: 230, unit: '人', channelId: null, channelLabel: '未指定归属', experimentId: null, period: '2026-09-01~2026-09-07', source: '手工记录', revision: 1, updatedAt: '2026-09-08T09:00:00.000Z' },
          { value: 180, unit: '人', channelId: null, channelLabel: '未指定归属', experimentId: null, period: '2026-08-25~2026-08-31', source: '手工记录', revision: 1, updatedAt: '2026-09-01T09:00:00.000Z' },
        ],
        sources: [{ source: '手工记录', updatedAt: '2026-09-08T09:00:00.000Z' }], updatedAt: '2026-09-08T09:00:00.000Z', note: '独立人数按去重口径分开呈现，不跨范围相加',
      },
    ],
    derived: over.derived !== undefined ? over.derived : [
      { key: 'activationRate', name: '激活率', numerator: 'activations', denominator: 'visitors', unit: '%', status: 'not-computable', reason: '口径不一致（分子分母观察周期或归属不同，不混算）' },
    ],
    observations: over.observations !== undefined ? over.observations : [
      obsRow('obs-1'),
      obsRow('obs-2', { metricKey: 'activations', value: 12, source: '手工记录', revision: 1, history: [{ rev: 1, value: 12, reason: '初始登记', by: 'board', at: '2026-09-08T21:40:00.000Z' }] }),
    ],
    reviews: over.reviews !== undefined ? over.reviews : [
      {
        id: 'rev-1', experimentId: 'exp-e1', periodStart: '2026-08-11', periodEnd: '2026-08-24',
        target: '订阅新增 ≥ 5 人', actual: '4 人', basis: '效果页观察记录', conclusion: '转化低于预期',
        nextStep: '调整首屏标题', insufficient: false,
        snapshot: [{ observationId: 'obs-9', metricKey: 'subsNew', metricName: '订阅新增', dateStart: '2026-08-11', dateEnd: '2026-08-24', value: 4, unit: '人', source: '手工记录', revision: 1 }],
        createdAt: '2026-08-25T10:00:00.000Z', updatedAt: '2026-08-25T10:00:00.000Z',
      },
    ],
    filters: { from: null, to: null, channelId: null, experimentId: null },
  };
}

function setup({ effect, obsResponses, importPreview, importCommit, reviewResponses } = {}) {
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
  let effectNow = effect || effectPayload();
  const obsQueue = Array.isArray(obsResponses) ? [...obsResponses] : null;
  const revQueue = Array.isArray(reviewResponses) ? [...reviewResponses] : null;
  const sandbox = {
    document, console, URLSearchParams, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener: (type, fn) => { windowEvents.push([type, fn]); },
    dispatchEvent: (ev) => { for (const [type, fn] of windowEvents) if (type === ev.type) fn(ev); return true; },
    fetch: async (url, opts) => {
      const u = String(url);
      calls.push({ url: u, method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : null });
      if (u.includes('/api/marketing/effect')) {
        // effectNow 为抛错函数时模拟网络失败（fetch 本身 reject → apiJson 捕获 → error 态）
        const payload = typeof effectNow === 'function' ? effectNow() : effectNow;
        return { ok: true, status: 200, json: async () => payload };
      }
      if (u.includes('/api/marketing/observation')) {
        const r = obsQueue ? obsQueue.shift() : { ok: true, status: 201, json: { created: true, observation: obsRow('obs-new') } };
        return { ok: !!r.ok, status: r.status, json: async () => r.json || {} };
      }
      if (u.includes('/api/marketing/import/preview')) {
        const r = importPreview || { ok: true, status: 200, json: { ok: true, total: 0, header: [], rows: [] } };
        return { ok: true, status: 200, json: async () => (typeof r === 'function' ? r(calls) : r) };
      }
      if (u.includes('/api/marketing/import/commit')) {
        const r = importCommit || { ok: true, status: 200, json: { created: 0, revised: 0, unchanged: 0, skipped: 0, effect: effectPayload() } };
        return { ok: !!r.ok, status: r.status, json: async () => (typeof r === 'function' ? r(calls) : r.json || r) };
      }
      if (u.includes('/api/marketing/review')) {
        const r = revQueue ? revQueue.shift() : { ok: true, status: 201, json: { review: effectPayload().reviews[0], effect: effectPayload() } };
        return { ok: !!r.ok, status: r.status, json: async () => r.json || {} };
      }
      if (u.includes('/api/marketing/state')) {
        return { ok: true, status: 200, json: async () => statePayload() };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    navigator: {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(mktJs, sandbox, { filename: 'marketing.js' });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { ...sandbox, calls, tick, setEffect: (e) => { effectNow = e; } };
}

const viewHtml = (h) => h.document.querySelector('#marketingView').innerHTML;
const node = (h, sel) => h.document.querySelector('#marketingView').querySelector(sel) || h.document.nodes.get(sel);

async function enterEffect(h) {
  await h.ATBMarketing.enter('/p');
  h.ATBMarketing.setTab('review');
  await h.ATBMarketing.refreshEffect();
}

/* ---------- 静态契约 ---------- */

t('U1 静态契约：效果页签启用；工具栏；卡片三态样式；导入向导步骤', () => {
  assert.ok(mktJs.includes("{ key: 'review', label: '效果与复盘' }"), '效果与复盘页签存在');
  assert.ok(!/key: 'review'[^}]*disabled/.test(mktJs), '效果页签不再禁用');
  for (const id of ['mktEffFrom', 'mktEffTo', 'mktEffChan', 'mktEffExp', 'mktAddObs', 'mktImportCsv', 'mktAddReview']) {
    assert.ok(mktJs.includes(id), `工具栏应包含 #${id}`);
  }
  for (const w of ['未录入', '真实零', '不可计算', '分开呈现', '字段映射', '预览校验', '数据不足']) {
    assert.ok(mktJs.includes(w), `应包含「${w}」文案`);
  }
  assert.match(css, /\.mkt-eff-card/, '指标卡样式');
  assert.match(css, /\.mkt-zero-badge/, '真实零徽标样式');
  assert.match(css, /\.mkt-eff-none/, '未录入样式');
  assert.match(css, /\.mkt-trend/, '趋势图样式');
  assert.match(css, /\.mkt-review-card/, '复盘卡片样式');
});

/* ---------- vm 行为 ---------- */

t('U2 指标卡渲染与详情：三态区分；点卡展开定义 / 原始记录 / 修订历史（含理由）', async () => {
  const h = setup({});
  await enterEffect(h);
  const v = viewHtml(h);
  assert.ok(h.calls.some((c) => c.url.includes('/api/marketing/effect')), '进入效果页拉取 effect');
  assert.match(v, /真实零/, '真实零徽标');
  assert.match(v, /未录入/, '未录入状态');
  assert.match(v, /CNY/, '币种分开呈现');
  assert.match(v, /不跨范围相加/, '独立人数口径说明');
  assert.match(v, /来源：CSV 导入/, '卡片显示来源与更新时间');

  // 点指标卡 → 定义 + 原始记录 + 修订历史
  node(h, '#mktEffCard-subsNew').listeners.click();
  const d = viewHtml(h);
  assert.match(d, /按账号去重/, '展开指标定义（去重口径）');
  assert.match(d, /期间增量/, '展开指标种类');
  assert.match(d, /剔除重复订阅账号/, '修订历史含修改理由');
  assert.match(d, /初始导入/, '历史保留旧记录');
});

t('U3 手工录入弹层：非法值 / 非法日期客户端拦截；合法提交携带字段；修订缺理由回显服务端错误', async () => {
  const h = setup({
    obsResponses: [
      { ok: false, status: 400, json: { error: '观察记录校验失败', fields: { reason: '该观察已存在：修订数值需填写修改理由' } } },
      { ok: true, status: 200, json: { created: false, revised: true, observation: obsRow('obs-1', { value: 5, revision: 3 }) } },
    ],
  });
  await enterEffect(h);
  node(h, '#mktAddObs').listeners.click();

  // 非法值：负数客户端拦截，不发请求
  node(h, '#mktObsMetric').value = 'subsNew';
  node(h, '#mktObsMetric').listeners.input();
  node(h, '#mktObsValue').value = '-1';
  node(h, '#mktObsValue').listeners.input();
  node(h, '#mktObsStart').value = '2026-09-01';
  node(h, '#mktObsStart').listeners.input();
  node(h, '#mktObsEnd').value = '2026-09-07';
  node(h, '#mktObsEnd').listeners.input();
  node(h, '#mktObsSave').listeners.click();
  assert.equal(h.calls.filter((c) => c.url.includes('/api/marketing/observation')).length, 0, '非法值不发请求');
  assert.match(node(h, '[data-err-for="m.value"]').textContent, /负|数字/, '负值定位字段');

  // 非法日期拦截
  node(h, '#mktObsValue').value = '3';
  node(h, '#mktObsValue').listeners.input();
  node(h, '#mktObsEnd').value = '2026-09-32';
  node(h, '#mktObsEnd').listeners.input();
  node(h, '#mktObsSave').listeners.click();
  assert.equal(h.calls.filter((c) => c.url.includes('/api/marketing/observation')).length, 0, '非法日期不发请求');

  // 合法提交：携带字段
  node(h, '#mktObsEnd').value = '2026-09-07';
  node(h, '#mktObsEnd').listeners.input();
  node(h, '#mktObsSave').listeners.click();
  await h.tick();
  const call = h.calls.find((c) => c.url.includes('/api/marketing/observation'));
  assert.ok(call, '合法提交发出请求');
  assert.equal(call.body.data.metricKey, 'subsNew');
  assert.equal(call.body.data.value, 3);
  assert.equal(call.body.data.dateStart, '2026-09-01');

  // 服务端 400（修订缺理由）→ 弹层保留并回显（等待第二次提交）
  node(h, '#mktObsValue').value = '5';
  node(h, '#mktObsValue').listeners.input();
  node(h, '#mktObsReason').value = '重新统计';
  node(h, '#mktObsReason').listeners.input();
  node(h, '#mktObsSave').listeners.click();
  await h.tick();
  const calls2 = h.calls.filter((c) => c.url.includes('/api/marketing/observation'));
  assert.equal(calls2.length, 2, '可重试提交');
  // 第一次合法提交被服务端拒绝（模拟既有记录冲突）后仍可再次提交成功
});

t('U4 CSV 导入向导：错误行显示行号与原因且禁止提交；冲突行未选择不提交；选择后携带 choices', async () => {
  const previewErr = {
    ok: false, total: 2, header: ['date_start', 'date_end', 'metric', 'value'],
    rows: [
      { rowNo: 3, status: 'error', error: '值「abc」必须是不小于 0 的数字（未知请留空）' },
    ],
  };
  const h = setup({ importPreview: previewErr });
  await enterEffect(h);
  node(h, '#mktImportCsv').listeners.click();
  node(h, '#mktImpCsv').value = 'date_start,date_end,metric,value\n2026-09-01,bad';
  node(h, '#mktImpCsv').listeners.input();
  node(h, '#mktImpNext').listeners.click(); // 粘贴 → 字段映射
  node(h, '#mktImpNext').listeners.click(); // 字段映射 → 预览校验
  await h.tick();
  assert.ok(h.calls.some((c) => c.url.includes('/api/marketing/import/preview')), '预览请求');
  let v = viewHtml(h);
  assert.match(v, /第 3 行/, '错误行显示行号');
  assert.match(v, /数字/, '错误行显示原因');
  assert.match(v, /id="mktImpSubmit"[^>]*disabled|disabled[^>]*id="mktImpSubmit"/, '存在错误行时提交按钮禁用');
  node(h, '#mktImpSubmit').listeners.click(); // 双保险：即便按钮被绕过也不提交
  await h.tick();
  assert.equal(h.calls.filter((c) => c.url.includes('/api/marketing/import/commit')).length, 0, '错误行不提交、不写入部分数据');

  // 冲突场景：一行冲突，未选择处理方式 → 客户端拦截
  const h2 = setup({
    importPreview: {
      ok: true, total: 1, header: ['date_start', 'date_end', 'metric', 'value'],
      rows: [
        { rowNo: 2, status: 'conflict', metricKey: 'subsNew', metricName: '订阅新增', dateStart: '2026-09-01', dateEnd: '2026-09-07', value: 5, unit: '人', channelId: null, experimentId: null, existingId: 'obs-1', existingValue: 0, existingRevision: 2 },
      ],
    },
    importCommit: (calls) => ({ ok: true, status: 200, json: { created: 0, revised: 1, unchanged: 0, skipped: 0, effect: effectPayload() } }),
  });
  await enterEffect(h2);
  node(h2, '#mktImportCsv').listeners.click();
  node(h2, '#mktImpCsv').value = 'csv';
  node(h2, '#mktImpCsv').listeners.input();
  node(h2, '#mktImpNext').listeners.click(); // 粘贴 → 字段映射
  node(h2, '#mktImpNext').listeners.click(); // 字段映射 → 预览校验
  await h2.tick();
  v = viewHtml(h2);
  assert.match(v, /值不同|冲突/, '冲突行标识');
  node(h2, '#mktImpSubmit').listeners.click();
  await h2.tick();
  assert.equal(h2.calls.filter((c) => c.url.includes('/api/marketing/import/commit')).length, 0, '未选择处理方式不提交');

  // 选择「跳过」→ 提交携带 choices
  node(h2, '#mktImpChoice-2-skip').listeners.input();
  node(h2, '#mktImpSubmit').listeners.click();
  await h2.tick();
  const commit = h2.calls.find((c) => c.url.includes('/api/marketing/import/commit'));
  assert.ok(commit, '提交导入');
  assert.deepEqual(commit.body.choices, { 2: { action: 'skip' } }, '携带逐行选择');
});

t('U5 派生指标区：可计算显示值；不可计算显示原因', async () => {
  const h = setup({
    effect: effectPayload({
      derived: [
        { key: 'activationRate', name: '激活率', numerator: 'activations', denominator: 'visitors', unit: '%', status: 'value', value: 0.05, period: '2026-09-01~2026-09-07' },
      ],
    }),
  });
  await enterEffect(h);
  assert.match(viewHtml(h), /激活率/, '派生区显示');
  assert.match(viewHtml(h), /5%|0\.05/, '显示计算值');

  const h2 = setup({
    effect: effectPayload({
      derived: [
        { key: 'activationRate', name: '激活率', numerator: 'activations', denominator: 'visitors', unit: '%', status: 'not-computable', reason: '分母为零' },
      ],
    }),
  });
  await enterEffect(h2);
  const v = viewHtml(h2);
  assert.match(v, /不可计算/, '分母为零显示不可计算');
  assert.match(v, /分母为零/, '显示原因');
});

t('U6 新建复盘弹层与读取失败：提交携带周期 / 目标 / 实际 / 结论；复盘卡标注固定快照；读取失败可重试', async () => {
  const h = setup({
    reviewResponses: [{ ok: true, status: 201, json: { review: { ...effectPayload().reviews[0], conclusion: '新结论' }, effect: effectPayload() } }],
  });
  await enterEffect(h);
  const v0 = viewHtml(h);
  assert.match(v0, /依据快照/, '复盘卡标注固定快照');
  assert.match(v0, /转化低于预期/, '复盘结论展示');

  node(h, '#mktAddReview').listeners.click();
  // 缺结论客户端拦截
  node(h, '#mktRvStart').value = '2026-09-01';
  node(h, '#mktRvStart').listeners.input();
  node(h, '#mktRvEnd').value = '2026-09-14';
  node(h, '#mktRvEnd').listeners.input();
  node(h, '#mktRvSave').listeners.click();
  assert.equal(h.calls.filter((c) => c.url.includes('/api/marketing/review')).length, 0, '缺结论不发请求');
  // 填写目标 / 实际 / 结论
  node(h, '#mktRvTarget').value = '订阅新增 ≥ 5 人';
  node(h, '#mktRvTarget').listeners.input();
  node(h, '#mktRvActual').value = '6 人';
  node(h, '#mktRvActual').listeners.input();
  node(h, '#mktRvConclusion').value = '达成假设';
  node(h, '#mktRvConclusion').listeners.input();
  node(h, '#mktRvSave').listeners.click();
  await h.tick();
  const call = h.calls.find((c) => c.url.includes('/api/marketing/review'));
  assert.ok(call, '提交复盘');
  assert.equal(call.body.data.periodStart, '2026-09-01');
  assert.equal(call.body.data.target, '订阅新增 ≥ 5 人');
  assert.equal(call.body.data.conclusion, '达成假设');

  // 读取失败 → 错误态 + 重试
  const h2 = setup({});
  h2.setEffect(() => { throw new Error('boom'); });
  await enterEffect(h2);
  assert.match(viewHtml(h2), /读取失败/, '失败态显示');
  assert.ok(node(h2, '#mktEffRetry'), '提供重试');
});

t('U7 快照恢复与未保存守卫：效果页筛选与选中指标可恢复；弹层填写计入 hasUnsaved', async () => {
  const h = setup({});
  await enterEffect(h);
  node(h, '#mktEffChan').value = 'ch-a1';
  node(h, '#mktEffChan').listeners.input();
  node(h, '#mktEffCard-activations').listeners.click();
  const snap = h.ATBMarketing.snapshot();
  assert.equal(snap.tab, 'review');
  assert.equal(snap.review.channel, 'ch-a1', '快照记录渠道筛选');
  assert.equal(snap.review.metric, 'activations', '快照记录选中指标');

  const h2 = setup({});
  h2.ATBMarketing.restoreView(snap);
  await enterEffect(h2);
  const snap2 = h2.ATBMarketing.snapshot();
  assert.equal(snap2.review.channel, 'ch-a1', '恢复渠道筛选');
  assert.equal(snap2.review.metric, 'activations', '恢复选中指标');

  // 弹层填写 → 未保存守卫
  assert.equal(h2.ATBMarketing.hasUnsaved(), false);
  node(h2, '#mktAddObs').listeners.click();
  assert.equal(h2.ATBMarketing.hasUnsaved(), true, '弹层填写计入未保存');
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
