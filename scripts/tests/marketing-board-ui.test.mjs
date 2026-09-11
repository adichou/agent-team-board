#!/usr/bin/env node
// REQ-20260910-020 渠道 / 实验 / 内容行动看板 —— 前端契约 + 行为测试（W1~W8）
// W1 为源码静态契约（marketing.js / style.css），W2~W8 为 vm 行为
// （加载实际 marketing.js，fetch stub 返回营销档案 + 渠道/实验/行动看板数据）。
// 用法：node scripts/tests/marketing-board-ui.test.mjs

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

/* ---------- vm 接缝（marketing-ui.test.mjs 同法） ---------- */
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
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {},
    closest() { return null; },
    get scrollTop() { return 0; }, set scrollTop(v) {},
  };
}

const BASE_POSITIONING = {
  intro: '一句话介绍', stage: 'validating', markets: '中文', audience: '独立开发者',
  scenarios: '需求跟踪', painPoints: '工具割裂', alternatives: 'Trello', differentiators: '本地优先',
  links: 'https://example.com', stageGoal: '验证首次使用价值', primaryMetric: '激活人数',
  budget: 100, weeklyHours: 6,
};

function statePayload() {
  return {
    initialized: true,
    profile: {
      id: 'mp-1', revision: 2, createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T01:00:00.000Z',
      positioning: { ...BASE_POSITIONING },
      evidence: [],
      currentPricing: 'v1',
    },
    versions: [
      { version: 'v1', model: 'subscription', currency: 'CNY', cycle: 'monthly', packages: [], costBasis: '', competitorBasis: '', validationMethod: '', createdAt: '2026-09-10T00:00:00.000Z' },
    ],
    current: 'v1',
  };
}

const CH_A = { id: 'ch-a1', revision: 1, platform: 'Reddit', link: '', audience: '', languages: '', formats: '', priority: 'high', reason: '', weeklyEffort: 3, dataAccess: '', capabilities: '', createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z' };
const CH_B = { ...CH_A, id: 'ch-b2', platform: 'Product Hunt', createdAt: '2026-09-09T01:00:00.000Z' };
const EXP1 = {
  id: 'exp-e1', revision: 1, channelId: 'ch-a1', hypothesis: '两周 8 帖带来 100 次访问', primaryMetric: '访问数',
  observationStart: '2026-09-01', observationEnd: '2026-09-14', successCriteria: '≥100 次',
  currency: 'CNY', budgetPlanned: 0, budgetActual: null, hoursPlanned: 6, hoursActual: null,
  pricingVersion: 'v1', decision: null, decisionBasis: '', copiedFrom: null,
  createdAt: '2026-09-09T02:00:00.000Z', updatedAt: '2026-09-09T02:00:00.000Z',
};
function act(id, over = {}) {
  return {
    id, revision: 1, channelId: 'ch-a1', experimentId: 'exp-e1', title: `内容 ${id}`,
    contentDraft: '', materialRefs: '', plannedAt: '', timezone: '', owner: '李四', nextStep: '',
    status: 'draft', publishUrl: '', publishedAt: '', publishCredential: '',
    reviewBasis: '', decision: null, stoppedReason: '', linkedReqs: [], statusHistory: [], copiedFrom: null,
    createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', ...over,
  };
}

function boardPayload(over = {}) {
  return {
    initialized: true,
    channels: over.channels !== undefined ? over.channels : [CH_A, CH_B],
    experiments: over.experiments !== undefined ? over.experiments : [EXP1],
    activities: over.activities !== undefined ? over.activities : [act('act-1', { title: '演示视频', plannedAt: '2020-01-01T09:00', timezone: 'Asia/Shanghai' }), act('act-2', { channelId: 'ch-b2', experimentId: null })],
  };
}

function setup({ board, statusResponse, reqResponses, copied } = {}) {
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
  const reqQueue = Array.isArray(reqResponses) ? [...reqResponses] : null;
  let boardNow = board || boardPayload();
  let clipboard = null;
  const sandbox = {
    document, console, URLSearchParams, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener: (type, fn) => { windowEvents.push([type, fn]); },
    dispatchEvent: (ev) => { for (const [type, fn] of windowEvents) if (type === ev.type) fn(ev); return true; },
    fetch: async (url, opts) => {
      const u = String(url);
      calls.push({ url: u, method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : null });
      if (u.includes('/api/marketing/board')) {
        return { ok: true, status: 200, json: async () => (typeof boardNow === 'function' ? boardNow() : boardNow) };
      }
      if (u.includes('/api/marketing/activity/status')) {
        const r = statusResponse ? (typeof statusResponse === 'function' ? statusResponse(calls) : statusResponse) : { ok: true, status: 200, json: { activity: null, board: boardPayload() } };
        return { ok: !!r.ok, status: r.status, json: async () => r.json || {} };
      }
      if (u.includes('/api/marketing/activity/req')) {
        const r = reqQueue ? reqQueue.shift() : { ok: true, status: 201, json: { created: true, link: { id: 'REQ-20260910-099', key: 'k', title: '落地页埋点' }, board: boardPayload() } };
        return { ok: !!r.ok, status: r.status, json: async () => r.json || {} };
      }
      if (u.includes('/api/marketing/experiment/copy')) {
        copied?.();
        return { ok: true, status: 201, json: { experiment: { id: 'exp-new', copiedFrom: 'exp-e1' }, board: boardPayload() } };
      }
      if (u.includes('/api/marketing/state')) {
        return { ok: true, status: 200, json: async () => statePayload() };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    navigator: {
      clipboard: { writeText: async (text) => { clipboard = text; } },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(mktJs, sandbox, { filename: 'marketing.js' });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    ...sandbox, calls, tick,
    setBoard: (b) => { boardNow = b; },
    clipboardRef: () => clipboard,
  };
}

const viewHtml = (h) => h.document.querySelector('#marketingView').innerHTML;
const node = (h, sel) => h.document.querySelector('#marketingView').querySelector(sel) || h.document.nodes.get(sel);

async function enterBoard(h) {
  await h.ATBMarketing.enter('/p');
  h.ATBMarketing.setTab('channels');
  await h.ATBMarketing.refreshBoard();
}

/* ---------- 静态契约 ---------- */

t('W1 静态契约：六状态列 / 工具栏 / 抽屉三节 / 动作按钮 / 窄屏样式', () => {
  for (const s of ['草稿', '待发布', '已发布', '观察中', '已复盘', '已停止']) {
    assert.ok(mktJs.includes(s), `看板状态列应包含「${s}」`);
  }
  for (const id of ['mktChanFilter', 'mktExpFilter', 'mktAddChannel', 'mktAddExperiment', 'mktAddActivity']) {
    assert.ok(mktJs.includes(id), `工具栏应包含 #${id}`);
  }
  for (const sec of ['基本信息', '内容素材', '结果与关联']) {
    assert.ok(mktJs.includes(sec), `详情抽屉应分节「${sec}」`);
  }
  for (const btn of ['复制文案', '登记发布结果', '创建开发需求', '复制为新实验']) {
    assert.ok(mktJs.includes(btn), `应提供「${btn}」入口`);
  }
  assert.match(css, /\.mkt-board/, '看板容器样式');
  assert.match(css, /\.mkt-col\s*\{/, '状态列样式');
  assert.match(css, /\.mkt-drawer/, '抽屉样式');
  assert.match(css, /@media[^{]*max-width[^{]*\{[\s\S]*?\.mkt-board/, '窄屏断点内看板改列表布局');
});

/* ---------- vm 行为 ---------- */

t('W2 看板渲染：拉取 board；卡片显示渠道 / 计划时间 / 主指标 / 负责人；逾期只提示', async () => {
  const h = setup({ board: boardPayload() });
  await enterBoard(h);
  const v = viewHtml(h);
  assert.ok(h.calls.some((c) => c.url.includes('/api/marketing/board')), '进入渠道与行动页应拉取看板数据');
  assert.match(v, /Reddit/, '卡片显示渠道');
  assert.match(v, /演示视频/, '卡片显示内容标题');
  assert.match(v, /访问数/, '卡片显示实验主指标');
  assert.match(v, /李四/, '卡片显示负责人');
  assert.match(v, /2020-01-01/, '卡片显示计划时间');
  assert.match(v, /逾期/, '过期未发布显示逾期提示');
});

t('W3 筛选：按渠道 / 按实验过滤；无匹配可清除；空态引导新建', async () => {
  const h = setup({ board: boardPayload() });
  await enterBoard(h);

  // 按渠道筛选
  const chan = node(h, '#mktChanFilter');
  chan.value = 'ch-b2';
  chan.listeners.input();
  let v = viewHtml(h);
  assert.ok(v.includes('Product Hunt'), '保留所选渠道的卡片');
  assert.ok(!v.includes('演示视频'), '其他渠道卡片被过滤');

  // 渠道 + 不匹配实验 → 无匹配 + 清除筛选
  const exp = node(h, '#mktExpFilter');
  exp.value = 'exp-e1';
  exp.listeners.input();
  v = viewHtml(h);
  assert.match(v, /无匹配|没有符合/, '无匹配结果提示');
  node(h, '#mktClearFilters').listeners.click();
  v = viewHtml(h);
  assert.ok(v.includes('演示视频'), '清除筛选后恢复');

  // 空态：无渠道 → 引导新建渠道 / 实验
  const h2 = setup({ board: boardPayload({ channels: [], experiments: [], activities: [] }) });
  await enterBoard(h2);
  const v2 = viewHtml(h2);
  assert.match(v2, /新建渠道/, '空态引导新建渠道');
  assert.match(v2, /新建实验/, '空态引导新建实验');
});

t('W4 推进校验：待发布需内容草稿（缺失报错且不发请求）；发布需登记凭据；标记待发布不发送内容正文', async () => {
  const h = setup({
    board: boardPayload({ activities: [act('act-1', { title: '演示视频', contentDraft: '' })] }),
    statusResponse: (calls) => {
      const body = calls[calls.length - 1].body;
      const activities = [act('act-1', { title: '演示视频', status: body?.to === 'published' ? 'published' : 'pending', publishedAt: body?.payload?.publishedAt || '', publishUrl: body?.payload?.publishUrl || '' })];
      return { ok: true, status: 200, json: { activity: activities[0], board: boardPayload({ activities }) } };
    },
  });
  await enterBoard(h);
  node(h, '#mktCard-act-1').listeners.click();
  assert.match(viewHtml(h), /基本信息[\s\S]*内容素材[\s\S]*结果与关联|内容素材/, '抽屉打开');

  // 待发布缺内容草稿：客户端拦截
  node(h, '#mktAdvance').listeners.click();
  assert.match(node(h, '[data-err-for="contentDraft"]').textContent, /内容|草稿/, '缺失草稿给出字段错误');
  assert.equal(h.calls.filter((c) => c.url.includes('/api/marketing/activity/status')).length, 0, '不发推进请求');

  // 填入内容 → 推进请求不含正文
  const content = node(h, '#mktContent');
  content.value = '正式文案';
  content.listeners.input();
  node(h, '#mktAdvance').listeners.click();
  await h.tick();
  const st = h.calls.find((c) => c.url.includes('/api/marketing/activity/status'));
  assert.ok(st, '补齐草稿后可推进');
  assert.equal(st.body.to, 'pending');
  assert.equal('contentDraft' in st.body, false, '推进请求不携带内容正文（不发送内容）');
  assert.equal('payload' in st.body && 'contentDraft' in (st.body.payload || {}), false, 'payload 也不含正文');

  // 已发布：缺登记信息被拦；补齐后提交凭据
  node(h, '#mktAdvance').listeners.click();
  assert.match(node(h, '[data-err-for="publishedAt"]').textContent, /发布时间/, '缺发布时间定位字段');
  node(h, '#mktPubAt').value = '2026-09-10T09:30';
  node(h, '#mktPubAt').listeners.input();
  node(h, '#mktAdvance').listeners.click();
  assert.match(node(h, '[data-err-for="publishUrl"]').textContent, /链接|凭据/, '缺链接或凭据说明定位字段');
  node(h, '#mktPubUrl').value = 'https://x.com/p1';
  node(h, '#mktPubUrl').listeners.input();
  node(h, '#mktAdvance').listeners.click();
  await h.tick();
  const pub = h.calls.filter((c) => c.url.includes('/api/marketing/activity/status')).pop();
  assert.equal(pub.body.to, 'published');
  assert.equal(pub.body.payload.publishedAt, '2026-09-10T09:30');
  assert.equal(pub.body.payload.publishUrl, 'https://x.com/p1');

  // 复制文案只写剪贴板，不发任何请求
  const before = h.calls.length;
  node(h, '#mktContent').value = '要复制的文案';
  node(h, '#mktContent').listeners.input();
  node(h, '#mktCopyText').listeners.click();
  await h.tick();
  assert.equal(h.calls.length, before, '复制文案不发送网络请求');
  assert.equal(h.clipboardRef(), '要复制的文案', '文案写入剪贴板');
});

t('W5 复盘与停止：复盘需依据与决策，「暂不能判断」为独立选项；停止需原因', async () => {
  const h = setup({
    board: boardPayload({ activities: [act('act-1', { status: 'observing', contentDraft: 'x', reviewBasis: '' })] }),
    statusResponse: { ok: true, status: 200, json: { activity: act('act-1', { status: 'reviewed' }), board: boardPayload({ activities: [act('act-1', { status: 'reviewed' })] }) } },
  });
  await enterBoard(h);
  node(h, '#mktCard-act-1').listeners.click();

  // 缺依据拦截
  node(h, '#mktReviewDecision').value = 'continue';
  node(h, '#mktReviewDecision').listeners.input();
  node(h, '#mktAdvance').listeners.click();
  assert.match(node(h, '[data-err-for="reviewBasis"]').textContent, /依据|结果/, '缺复盘依据定位字段');
  assert.equal(h.calls.filter((c) => c.url.includes('/api/marketing/activity/status')).length, 0, '不发请求');

  // 暂不能判断是独立选项
  const decisionSel = viewHtml(h);
  assert.match(decisionSel, /暂不能判断/, '决策含「暂不能判断」选项');

  node(h, '#mktReviewBasis').value = '仅 3 天数据';
  node(h, '#mktReviewBasis').listeners.input();
  node(h, '#mktReviewDecision').value = 'undetermined';
  node(h, '#mktReviewDecision').listeners.input();
  node(h, '#mktAdvance').listeners.click();
  await h.tick();
  const rev = h.calls.find((c) => c.url.includes('/api/marketing/activity/status'));
  assert.equal(rev.body.to, 'reviewed');
  assert.equal(rev.body.payload.reviewBasis, '仅 3 天数据');
  assert.equal(rev.body.payload.decision, 'undetermined');

  // 停止需原因
  const h2 = setup({
    board: boardPayload({ activities: [act('act-2', { channelId: 'ch-b2', experimentId: null })] }),
    statusResponse: { ok: true, status: 200, json: {} },
  });
  await enterBoard(h2);
  node(h2, '#mktCard-act-2').listeners.click();
  node(h2, '#mktStopBtn').listeners.click();
  assert.match(node(h2, '[data-err-for="stopReason"]').textContent, /原因/, '缺停止原因定位字段');
  node(h2, '#mktStopReason').value = '优先级下调';
  node(h2, '#mktStopReason').listeners.input();
  node(h2, '#mktStopBtn').listeners.click();
  await h2.tick();
  const stop = h2.calls.find((c) => c.url.includes('/api/marketing/activity/status'));
  assert.equal(stop.body.to, 'stopped');
  assert.equal(stop.body.payload.stopReason, '优先级下调');
});

t('W6 创建开发需求：提交携带 key；失败重试复用同一 key；创建后可跳转（atb:open-item）', async () => {
  const h = setup({
    reqResponses: [
      { ok: false, status: 500, json: { error: '服务器错误' } },
      { ok: true, status: 201, json: { created: true, link: { id: 'REQ-20260910-099', key: 'k1', title: '落地页埋点' }, board: boardPayload() } },
    ],
  });
  await enterBoard(h);
  node(h, '#mktCard-act-1').listeners.click();
  node(h, '#mktCreateReq').listeners.click();

  node(h, '#mktReqTitle').value = '落地页埋点';
  node(h, '#mktReqTitle').listeners.input();
  node(h, '#mktReqDesc').value = '补充转化埋点';
  node(h, '#mktReqDesc').listeners.input();
  node(h, '#mktReqSubmit').listeners.click();
  await h.tick();
  assert.ok(h.calls.some((c) => c.url.includes('/api/marketing/activity/req')), '首次提交');

  // 失败后重试：同一 key，不换
  node(h, '#mktReqSubmit').listeners.click();
  await h.tick();
  const reqCalls = h.calls.filter((c) => c.url.includes('/api/marketing/activity/req'));
  assert.equal(reqCalls.length, 2);
  assert.ok(reqCalls[0].body.key, '请求携带幂等 key');
  assert.equal(reqCalls[1].body.key, reqCalls[0].body.key, '重试复用同一 key');
  assert.equal(reqCalls[1].body.title, '落地页埋点');

  // 创建成功后展示编号并可跳转
  assert.match(viewHtml(h), /REQ-20260910-099/, '展示关联 REQ 编号');
  let opened = null;
  h.addEventListener('atb:open-item', (e) => { opened = e.detail && e.detail.id; });
  node(h, '#mktReqLink-REQ-20260910-099').listeners.click();
  assert.equal(opened, 'REQ-20260910-099', '跳转派发 atb:open-item');
});

t('W7 复制为新实验：已复盘行动抽屉提供入口，提交携带 fromActivityId', async () => {
  const h = setup({
    board: boardPayload({ activities: [act('act-1', { status: 'reviewed', contentDraft: 'x', reviewBasis: 'b', decision: 'continue' })] }),
  });
  await enterBoard(h);
  node(h, '#mktCard-act-1').listeners.click();
  assert.match(viewHtml(h), /复制为新实验/, '终态行动提供复制为新实验');
  node(h, '#mktCopyExp').listeners.click();
  await h.tick();
  const copy = h.calls.find((c) => c.url.includes('/api/marketing/experiment/copy'));
  assert.ok(copy, '提交复制实验请求');
  assert.equal(copy.body.id, 'exp-e1', '复制来源实验');
  assert.equal(copy.body.fromActivityId, 'act-1', '携带来源行动');
});

t('W8 快照与未保存守卫：筛选与抽屉可恢复；抽屉编辑计入 hasUnsaved', async () => {
  const h = setup({ board: boardPayload() });
  await enterBoard(h);
  node(h, '#mktChanFilter').value = 'ch-a1';
  node(h, '#mktChanFilter').listeners.input();
  node(h, '#mktCard-act-1').listeners.click();
  const snap = h.ATBMarketing.snapshot();
  assert.equal(snap.tab, 'channels');
  assert.equal(snap.board.channel, 'ch-a1', '快照记录渠道筛选');
  assert.equal(snap.board.drawer, 'act-1', '快照记录打开的抽屉');

  const h2 = setup({ board: boardPayload() });
  h2.ATBMarketing.restoreView(snap);
  await enterBoard(h2);
  const snap2 = h2.ATBMarketing.snapshot();
  assert.equal(snap2.board.channel, 'ch-a1', '恢复渠道筛选');
  assert.equal(snap2.board.drawer, 'act-1', '恢复打开的抽屉');

  // 抽屉编辑 → 未保存守卫
  assert.equal(h2.ATBMarketing.hasUnsaved(), false);
  node(h2, '#mktContent').value = '新文案';
  node(h2, '#mktContent').listeners.input();
  assert.equal(h2.ATBMarketing.hasUnsaved(), true, '抽屉编辑计入未保存');
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
