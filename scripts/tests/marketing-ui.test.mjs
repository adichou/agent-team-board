#!/usr/bin/env node
// REQ-20260910-019 营销档案 / 定位与定价版本管理 —— 前端契约 + 行为测试（U1~U8）
// U1/U2/U7/U8 为源码静态契约（index.html / app.js / marketing.js / style.css），
// U3~U6 为 vm 行为（加载实际 marketing.js，fetch stub 返回空态 / 档案 / 冲突 / 校验错误）。
// 用法：node scripts/tests/marketing-ui.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const mktJs = fs.readFileSync(path.join(webRoot, 'marketing.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- vm 接缝（discussion-ui.test.mjs 同法） ---------- */
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
  intro: '一句话介绍', stage: 'validating', markets: '中文、英文', audience: '独立开发者',
  scenarios: '需求跟踪', painPoints: '工具割裂', alternatives: 'Trello', differentiators: '本地优先',
  links: 'https://example.com', stageGoal: '验证首次使用价值', primaryMetric: '激活人数',
  budget: 100, weeklyHours: 6,
};

function statePayload(over = {}) {
  const { profile: profileOver = {}, ...restOver } = over;
  const { positioning: posOver = {}, ...profileRest } = profileOver;
  return {
    initialized: true,
    profile: {
      id: 'mp-1', revision: 2, createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T01:00:00.000Z',
      positioning: { ...BASE_POSITIONING, ...posOver },
      evidence: [{ id: 'ev-1', type: 'fact', content: '4/5 愿付费', source: '访谈', collectedAt: '2026-09-10' }],
      currentPricing: 'v1',
      ...profileRest,
    },
    versions: restOver.versions || [
      { version: 'v1', model: 'subscription', currency: 'CNY', cycle: 'monthly', packages: [{ name: '专业版', benefits: '全部功能', price: 29 }], costBasis: 'c', competitorBasis: 'k', validationMethod: 'm', createdAt: '2026-09-10T00:00:00.000Z' },
      { version: 'v2', model: 'onetime', currency: 'CNY', cycle: '', packages: [{ name: '买断', benefits: '全部', price: null }], costBasis: 'c', competitorBasis: 'k', validationMethod: 'm', createdAt: '2026-09-10T02:00:00.000Z' },
    ],
    current: restOver.current !== undefined ? restOver.current : 'v1',
  };
}

function setup({ state, initResponse, profileResponse } = {}) {
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
  const documentEventListener = () => {};
  document.addEventListener = documentEventListener;
  const sandbox = {
    document, console, URLSearchParams, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async (url, opts) => {
      calls.push({ url: String(url), method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : null });
      if (String(url).includes('/api/marketing/init')) {
        return { ok: !!initResponse?.ok, status: initResponse?.ok ? 201 : 400, json: async () => initResponse?.json || {} };
      }
      if (String(url).includes('/api/marketing/profile') && (opts?.method || '').toUpperCase() === 'POST') {
        const r = profileResponse ? (typeof profileResponse === 'function' ? profileResponse(calls) : profileResponse) : { ok: true, status: 200, json: statePayload() };
        return { ok: !!r.ok, status: r.status, json: async () => r.json || {} };
      }
      if (String(url).includes('/api/marketing/pricing/current')) {
        return { ok: true, status: 200, json: statePayload() };
      }
      if (String(url).includes('/api/marketing/pricing')) {
        return { ok: true, status: 201, json: { version: { version: 'v3' }, state: statePayload() } };
      }
      return { ok: true, status: 200, json: async () => (typeof state === 'function' ? state() : (state || { initialized: false })) };
    },
    navigator: {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(mktJs, sandbox, { filename: 'marketing.js' });
  return { ...sandbox, calls };
}

const viewHtml = (h) => h.document.querySelector('#marketingView').innerHTML;
const node = (h, sel) => h.document.querySelector('#marketingView').querySelector(sel) || h.document.nodes.get(sel);

/* ---------- 静态契约 ---------- */

t('U1 骨架：营销入口随 REQ-20260911-002 暂态隐藏（导航无 data-view="marketing"）；容器 / 脚本 / 四页签机制保留；四页签后两页禁用并标注暂不可用', () => {
  const navMatch = html.match(/<nav class="module-nav"[\s\S]*?<\/nav>/);
  assert.ok(navMatch, '应存在模块导航');
  const nav = navMatch[0];
  // REQ-20260911-002：营销入口暂态隐藏（恢复步骤见条目 design.md）；恢复后原序为 任务 → 营销 → 发布 → 设置
  assert.doesNotMatch(nav, /data-view="marketing"/, '营销页签随入口暂态隐藏（REQ-20260911-002，模块代码保留）');
  assert.ok(html.includes('id="marketingView"'), '应存在营销视图容器');
  assert.match(mktJs, /概览/, '营销内页签：概览');
  assert.match(mktJs, /定位与定价/, '营销内页签：定位与定价');
  assert.match(mktJs, /渠道与行动/, '营销内页签：渠道与行动');
  assert.match(mktJs, /效果与复盘/, '营销内页签：效果与复盘');
  assert.match(mktJs, /暂不可用/, '后两页标注暂不可用');
  assert.match(mktJs, /disabled/, '后两页为禁用态');
  assert.match(html, /marketing\.js/, 'index.html 引入 marketing.js');
  const scriptIdx = html.indexOf('<script src="/marketing.js">');
  const appIdx = html.indexOf('<script src="/app.js">');
  assert.ok(scriptIdx > -1 && appIdx > scriptIdx, 'marketing.js 在 app.js 之前加载');
});

t('U2 app.js 契约：VIEWS 注册、setView 容器切换、快照节、项目切换守卫', () => {
  assert.match(app, /VIEWS = \[[^\]]*'marketing'/, 'VIEWS 含 marketing');
  assert.match(app, /\$\('#marketingView'\)\.classList\.toggle\('hidden', v !== 'marketing'\)/, 'setView 切换营销容器');
  assert.match(app, /ATBMarketing\?\.enter\(/, '进入营销视图时激活模块');
  assert.match(app, /marketing: window\.ATBMarketing\?\.snapshot\?\.\(\)/, '刷新快照含 marketing 节');
  assert.match(app, /ATBMarketing\?\.restoreView\?/, '快照恢复委托营销模块');
  assert.match(app, /ATBMarketing\?\.reset\?\.\(/, '切换项目重置营销模块');
  assert.match(app, /ATBMarketing\?\.hasUnsaved\?\.\(\)/, '项目切换前询问未保存状态');
  assert.match(app, /保存并切换/, '守卫提供「保存并切换」');
  assert.match(app, /放弃/, '守卫提供「放弃」');
  assert.match(app, /回弹|renderProjectSel\(\)/, '取消后回弹项目选择器');
});

t('U7 未保存切换项目：确认弹窗三选项（保存并切换 / 放弃 / 取消）', async () => {
  const h = setup({ state: statePayload() });
  await h.ATBMarketing.enter('/p');
  node(h, '#mktIntro').value = '改过的简介';
  node(h, '#mktIntro').listeners.input();
  assert.equal(h.ATBMarketing.hasUnsaved(), true, '编辑后应视为未保存');

  let applied = false;
  let cancelled = false;
  h.ATBMarketing.guardProjectSwitch('/next', () => { applied = true; }, () => { cancelled = true; });
  assert.equal(h.document.querySelector('#mktSwitchWrap').classList.contains('hidden'), false, '应弹出确认弹窗');
  assert.ok(h.document.querySelector('#mktSwitchText').textContent, '弹窗应说明有未保存内容');

  // 取消：不切换、弹窗关闭、回调回弹
  h.document.querySelector('#mktSwitchCancel').listeners.click();
  assert.equal(applied, false);
  assert.equal(cancelled, true, '取消应回调回弹');
  assert.equal(h.document.querySelector('#mktSwitchWrap').classList.contains('hidden'), true, '弹窗关闭');

  // 保存并切换：先保存成功再切换
  h.ATBMarketing.guardProjectSwitch('/next', () => { applied = true; }, () => { cancelled = true; });
  await h.document.querySelector('#mktSwitchSave').listeners.click();
  const saveCall = h.calls.find((c) => c.url.includes('/api/marketing/profile'));
  assert.ok(saveCall, '保存并切换应先提交保存');
  assert.equal(saveCall.body.revision, 2, '按当前 revision 保存');
  assert.equal(applied, true, '保存成功后执行切换');

  // 放弃：丢弃草稿直接切换
  node(h, '#mktIntro').value = '再次修改';
  node(h, '#mktIntro').listeners.input();
  let applied2 = false;
  h.ATBMarketing.guardProjectSwitch('/next2', () => { applied2 = true; }, () => {});
  await h.document.querySelector('#mktSwitchDiscard').listeners.click();
  assert.equal(applied2, true, '放弃后直接切换');
  assert.equal(h.ATBMarketing.hasUnsaved(), false, '草稿已丢弃');
});

t('U8 样式：容器样式存在；窄屏媒体查询上下排列；深浅色沿用 CSS 变量', () => {
  assert.match(css, /\.marketing-view\s*\{/, '.marketing-view 容器样式');
  assert.match(css, /@media[^{]*max-width[^{]*\{[\s\S]*?\.mkt-split\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/, '窄屏断点内分栏改上下排列');
  assert.match(css, /\.marketing-tabs|\.mkt-tabs\s*\{/, '营销页签样式');
  const mktCss = css.slice(css.indexOf('.marketing-view'));
  assert.match(mktCss, /var\(--panel\)/, '营销样式使用主题变量（深浅色自动适配）');
});

/* ---------- vm 行为 ---------- */

t('U3 未初始化渲染「建立营销档案」引导；点击 init 后进入表单并明示 README 草稿来源', async () => {
  const h = setup({ state: { initialized: false } });
  await h.ATBMarketing.enter('/p');
  let v = viewHtml(h);
  assert.match(v, /建立营销档案/, '空态引导按钮');
  assert.match(v, /尚未建立营销档案|未配置/, '空态说明');

  // 点击初始化 → POST init → 表单
  node(h, '#mktInit').listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  const initCall = h.calls.find((c) => c.url.includes('/api/marketing/init'));
  assert.ok(initCall, '应显式调用初始化接口');

  const h2 = setup({
    state: { initialized: false },
    initResponse: { ok: true, json: statePayload({ profile: { revision: 1, positioning: { intro: 'README 草稿简介', stage: 'exploring' } }, current: null }) },
  });
  await h2.ATBMarketing.enter('/p');
  node(h2, '#mktInit').listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  const v2 = viewHtml(h2);
  assert.match(v2, /README 草稿/, '表单应明示草稿来源为 README');
  assert.equal(node(h2, '#mktIntro').value, 'README 草稿简介', '草稿回填表单');
});

t('U4 编辑脏标记；保存成功展示保存时间并清脏；409 冲突保留本地草稿，重新载入更新 revision 后可再保存', async () => {
  const h = setup({ state: statePayload() });
  await h.ATBMarketing.enter('/p');
  assert.equal(h.ATBMarketing.hasUnsaved(), false, '初始无未保存内容');

  node(h, '#mktIntro').value = '新简介';
  node(h, '#mktIntro').listeners.input();
  assert.equal(h.ATBMarketing.hasUnsaved(), true);

  // 保存成功
  await h.ATBMarketing.saveNow();
  const save = h.calls.find((c) => c.url.includes('/api/marketing/profile'));
  assert.equal(save.body.positioning.intro, '新简介', '保存提交本地编辑');
  assert.equal(h.ATBMarketing.hasUnsaved(), false, '保存成功清脏');
  assert.match(node(h, '#mktSaveState').textContent, /已保存|保存于/, '成功展示保存时间');

  // 冲突：本地草稿保留 + 提示重新载入 + 载入后可再保存（服务端此时已推进到 revision 7）
  let serverState = statePayload();
  const hh = setup({ state: () => serverState, profileResponse: { ok: false, status: 409, json: { error: '并发修改', conflict: true, currentRevision: 7 } } });
  await hh.ATBMarketing.enter('/p');
  node(hh, '#mktIntro').value = '冲突版简介';
  node(hh, '#mktIntro').listeners.input();
  await hh.ATBMarketing.saveNow();
  assert.match(node(hh, '#mktSaveState').textContent, /并发修改|冲突/, '冲突应提示重新载入');
  assert.equal(node(hh, '#mktIntro').value, '冲突版简介', '冲突不丢本地草稿');
  assert.ok(hh.ATBMarketing.hasUnsaved(), '冲突后草稿仍在');
  assert.match(viewHtml(hh), /重新载入/, '提供重新载入入口');

  serverState = statePayload({ profile: { revision: 7 } }); // 其他窗口保存后的最新服务端状态
  node(hh, '#mktReload').listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(node(hh, '#mktIntro').value, '冲突版简介', '重新载入保留本地草稿（不静默覆盖）');
  assert.equal(hh.ATBMarketing.draftRevision(), 7, '载入后本地基线更新为服务端 revision');
});

t('U5 校验失败字段级错误且内容不丢；保存中按钮禁用', async () => {
  const h = setup({ state: statePayload() });
  await h.ATBMarketing.enter('/p');

  node(h, '#mktBudget').value = '-5';
  node(h, '#mktBudget').listeners.input();
  await h.ATBMarketing.saveNow();
  assert.match(node(h, '[data-err-for="positioning.budget"]').textContent, /预算|金额|大于等于 0|非负/, '预算错误定位字段');
  assert.equal(node(h, '#mktBudget').value, '-5', '校验失败不丢编辑内容');
  assert.equal(h.calls.filter((c) => c.url.includes('/api/marketing/profile')).length, 0, '客户端拦截非法提交');

  // 服务端字段校验回显
  const hh = setup({
    state: statePayload(),
    profileResponse: { ok: false, status: 400, json: { error: '字段非法', fields: { 'positioning.budget': '预算必须 ≥ 0' } } },
  });
  await hh.ATBMarketing.enter('/p');
  node(hh, '#mktBudget').value = 'abc';
  node(hh, '#mktBudget').listeners.input();
  await hh.ATBMarketing.saveNow();
  assert.equal(node(hh, '[data-err-for="positioning.budget"]').textContent, '预算必须 ≥ 0', '服务端字段错误回显');

  // 保存中禁用重复提交
  const h3 = setup({ state: statePayload() });
  await h3.ATBMarketing.enter('/p');
  node(h3, '#mktIntro').value = 'x';
  node(h3, '#mktIntro').listeners.input();
  const p = h3.ATBMarketing.saveNow();
  assert.equal(node(h3, '#mktSave').disabled, true, '保存进行中禁重复提交');
  await p;
  assert.equal(node(h3, '#mktSave').disabled, false, '完成后恢复');
});

t('U6 版本：历史版本只读查看；「设为当前方案」显式提交；保存新版本不改当前指针', async () => {
  const h = setup({ state: statePayload() });
  await h.ATBMarketing.enter('/p');

  node(h, '#mktVerBtn-v2').listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(viewHtml(h), /只读/, '历史版本只读查看');
  assert.ok(node(h, '#mktVerDetail').innerHTML.includes('v2'), '展示所选版本');

  node(h, '#mktSetCurrent-v2').listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  const cur = h.calls.find((c) => c.url.includes('/api/marketing/pricing/current'));
  assert.ok(cur, '设为当前方案应显式提交');
  assert.equal(cur.body.version, 'v2');

  // 保存新定价版本：不自动设当前
  node(h, '#mktPriceSave').listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  const save = h.calls.find((c) => c.url.includes('/api/marketing/pricing') && !c.url.includes('/current'));
  assert.ok(save, '保存定价新版本应提交');
  assert.equal(save.body.version, undefined, '版本号由服务端分配（保存恒新建）');
});

t('U2b 快照：页签与选中版本可恢复（snapshot / restoreView）', async () => {
  const h = setup({ state: statePayload() });
  await h.ATBMarketing.enter('/p');
  h.ATBMarketing.setTab('overview');
  let snap = h.ATBMarketing.snapshot();
  assert.equal(snap.tab, 'overview', '快照记录营销页签');
  assert.equal(snap.view, 'v1', '快照记录选中版本');

  const h2 = setup({ state: statePayload() });
  await h2.ATBMarketing.restoreView({ tab: 'overview', view: 'v2' });
  await h2.ATBMarketing.enter('/p');
  snap = h2.ATBMarketing.snapshot();
  assert.equal(snap.tab, 'overview', '恢复营销页签');
  assert.equal(snap.view, 'v2', '恢复选中版本');
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
