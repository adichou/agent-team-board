#!/usr/bin/env node
// BUG-20260913-005 版本回填弹窗（AI 完善）上段补「去新建 Zcode / Codex 会话」入口——
// 参照任务面板头部口径（BUG-20260910-005 / REQ-20260911-008）：先复制本弹窗版本提示词
// （buildPrompt(v)）再跳深链；状态机同款（检测中 / 失败可重试 / 未检测到禁用 / 未选项目禁用）；
// 失败不静默、深链打开不依赖复制成败、busy 防重复点击；既有复制 / 解析回填流程零回归。
// S1~S15 vm 行为 + 静态契约 + i18n（假 DOM 口径同 build-ui.test.mjs）。
// 用法：node scripts/tests/bug-build-session-entry-20260913-005.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const PROJECT = '/Users/x/我的 项目/atb';

/* ---------- 假 DOM（同 build-ui.test.mjs） ---------- */

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
  };
}

const H1 = 'a'.repeat(40);

function statePayload() {
  return {
    initialized: true,
    isRepo: true,
    currentBranch: 'dev',
    versions: [
      { id: 'BLD-20260913-005', name: 'v1.0', description: '首个版本', status: 'draft', targetBranch: 'main',
        items: [{ itemId: 'REQ-20260913-001', commit: H1, title: '演示需求', mergedAt: null, mergeError: null }],
        createdAt: '2026-09-13T01:00:00.000Z', updatedAt: '2026-09-13T02:00:00.000Z', merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' } },
    ],
  };
}

function setup({
  project = PROJECT,
  appsImpl,          // () => ({ zcode, codex })（可 throw / 返回挂起 Promise）；不传默认双端可用
  writeText,         // async (text) => {}（剪贴板桩；不传默认记录并成功）
} = {}) {
  const st = statePayload();
  const document = element();
  document.createElement = element;
  document.body = element();
  document.addEventListener = () => {};
  const view = element();
  document.nodes.set('#buildView', view);
  let htmlSets = 0;
  let htmlVal = '';
  Object.defineProperty(view, 'innerHTML', {
    get() { return htmlVal; },
    set(v) { htmlVal = String(v); htmlSets++; },
  });

  const requests = [];
  const copiedTexts = [];
  const navEvents = [];
  const toasts = [];
  let navUrl = '';
  let clipboardGate = null; // 置为 () => Promise 可挂起复制，模拟在途
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    navigator: {
      clipboard: {
        writeText: async (text) => {
          if (clipboardGate) await clipboardGate();
          if (writeText) return writeText(text);
          copiedTexts.push(text);
        },
      },
    },
    location: {},
    toast: (msg, isErr) => toasts.push({ msg: String(msg), isErr: !!isErr }),
    fetch: async (url) => {
      const up = new URL(String(url), 'http://local');
      requests.push({ path: up.pathname });
      if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(st)) };
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (up.pathname === '/api/workspace/apps') {
        if (!appsImpl) return { ok: true, json: async () => ({ zcode: true, codex: true, loaded: true, probing: false, failed: false }) };
        return { ok: true, json: async () => appsImpl() };
      }
      return { ok: true, json: async () => ({}) };
    },
  };
  Object.defineProperty(sandbox.location, 'href', {
    set(v) { navEvents.push(String(v)); navUrl = String(v); },
    get() { return navUrl; },
  });
  sandbox.window = sandbox;
  sandbox.window.location = sandbox.location;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  // 假 DOM 契约：bindCommon 以 view.querySelectorAll('[data-bld-new-session]') 循环绑定，
  // 并读 el.dataset.bldNewSession（真实 DOM 由属性解析而来）——桩在此模拟两链接节点与 dataset
  view.querySelectorAll = (sel) => {
    if (sel === '[data-bld-new-session]') {
      return ['zcode', 'codex'].map((a) => {
        const el = view.querySelector(`[data-bld-new-session="${a}"]`);
        el.dataset.bldNewSession = a;
        return el;
      });
    }
    return [];
  };
  // 假 DOM 无真实树结构：querySelector 按 selector 在单节点内扁平缓存——
  // 辅助函数统一直接在 #buildView 上查询，与 bindCommon 的绑定落在同一（缓存）节点
  const run = (code) => vm.runInContext(code, sandbox);
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
  const link = (agent) => run(`document.querySelector('#buildView').querySelector('[data-bld-new-session="${agent}"]')`);
  const click = async (el) => { assert.ok(el, '应渲染目标入口'); el.listeners.click({ preventDefault() {} }); await flush(); };
  return {
    sandbox, run, flush, requests, copiedTexts, navEvents, toasts,
    get navUrl() { return navUrl; },
    set gate(fn) { clipboardGate = fn; },
    inner: () => run(`document.querySelector('#buildView').innerHTML`),
    htmlSets: () => htmlSets,
    appsCalls: () => requests.filter((r) => r.path === '/api/workspace/apps').length,
    lastToast: () => toasts[toasts.length - 1] || { msg: '', isErr: false },
    enter: async () => { await run(`window.ATBBuild.enter(${JSON.stringify(project)})`); await flush(); },
    openModal: (verId = 'BLD-20260913-005') => run(`window.ATBBuild.openAnswerModal(${JSON.stringify(verId)})`),
    clickLink: (agent) => click(link(agent)),
    clickRetry: () => click(run(`document.querySelector('#buildView').querySelector('[data-bld-ws-retry]')`)),
    clickCopyPrompt: () => click(run(`document.querySelector('#buildView').querySelector('#bldCopyPrompt')`)),
  };
}

/* ---------- S1/S2 渲染契约 ---------- */

t('S1 渲染契约：弹窗上段渲染「去新建 Zcode 会话」「去新建 Codex 会话」（文案同任务面板），「复制提示词」按钮保留', async () => {
  const h = await setup();
  await h.enter(); // 选定项目 + 宿主探测完成后打开弹窗
  h.openModal();
  const inner = h.inner();
  assert.match(inner, /class="bld-session-entry"/, '应有会话入口区');
  assert.match(inner, />去新建 Zcode 会话</, 'zcode 链接文案与任务面板一致');
  assert.match(inner, />去新建 Codex 会话</, 'codex 链接文案与任务面板一致');
  assert.match(inner, /id="bldCopyPrompt">复制提示词</, '既有「复制提示词」按钮保留');
  assert.match(inner, /zcode:\/\/workspace\/open\?path=/, 'zcode 链接 href 为 workspace/open 深链');
  assert.match(inner, /codex:\/\/threads\/new\?path=/, 'codex 链接 href 为 threads/new 深链');
  assert.match(inner, new RegExp(encodeURIComponent(PROJECT)), '深链带当前项目路径');
  assert.doesNotMatch(inner, /自动新建|自动创建/, '不宣称自动新建/自动创建会话');
});

t('S2 title 口径：含「自动复制本弹窗版本提示词」+ 项目路径；zcode 保留手动新建口径、codex 保留不自动发送口径', async () => {
  const h = await setup();
  await h.enter();
  h.openModal();
  const inner = h.inner();
  const z = inner.match(/<a[^>]*data-bld-new-session="zcode"[^>]*>/)[0];
  const c = inner.match(/<a[^>]*data-bld-new-session="codex"[^>]*>/)[0];
  assert.match(z, /title="[^"]*自动复制本弹窗版本提示词[^"]*Zcode[^"]*\/Users\/x\/我的 项目\/atb[^"]*"/, 'zcode title 自动复制口径 + agent + 项目');
  assert.match(c, /title="[^"]*自动复制本弹窗版本提示词[^"]*Codex[^"]*\/Users\/x\/我的 项目\/atb[^"]*"/, 'codex title 自动复制口径 + agent + 项目');
  assert.match(z, /手动新建/, 'zcode title 保留会话需手动新建口径');
  assert.match(c, /不会自动发送/, 'codex title 保留不自动发送口径');
});

/* ---------- S3/S4 点击行为：先复制本弹窗提示词后跳转 ---------- */

t('S3 点击成功：复制 buildPrompt(v)（本弹窗版本提示词，非批量调度提示词）后跳深链；深链不带 prompt；toast 已复制 + 回答仍粘贴回本弹窗', async () => {
  const h = await setup();
  await h.enter();
  h.openModal();
  await h.clickLink('zcode');
  assert.equal(h.copiedTexts.length, 1, '复制一次');
  assert.ok(h.copiedTexts[0].includes('请为看板版本 BLD-20260913-005'), '复制的是版本提示词（含版本号）');
  assert.ok(h.copiedTexts[0].includes('REQ-20260913-001'), '复制的是版本提示词（含关联条目）');
  assert.ok(!h.copiedTexts[0].includes('主调度'), '不是批量调度提示词');
  assert.equal(h.navUrl, `zcode://workspace/open?path=${encodeURIComponent(PROJECT)}`, '复制后跳 zcode workspace/open 深链');
  assert.ok(!h.navUrl.includes('prompt='), '深链不携带 prompt');
  const tz = h.lastToast();
  assert.match(tz.msg, /已复制提示词并请求打开 Zcode 工作区/, 'toast 说明已复制并请求打开');
  assert.match(tz.msg, /粘贴发送/, 'toast 指引粘贴发送');
  assert.match(tz.msg, /回答仍粘贴回本弹窗/, 'toast 指引回答仍粘贴回本弹窗');
  assert.ok(!tz.isErr, '成功不是错误 toast');
  // codex：threads/new?path= 深链
  await h.clickLink('codex');
  assert.equal(h.navUrl, `codex://threads/new?path=${encodeURIComponent(PROJECT)}`, 'codex 深链 threads/new');
  assert.ok(!h.navUrl.includes('prompt='), 'codex 深链不携带 prompt');
});

t('S4 顺序与路径统一：剪贴板写入先于 location.href；preventDefault 被调用（单一触发路径）', async () => {
  let navSeenAtCopy = -1;
  const h = await setup({ writeText: async () => { navSeenAtCopy = h.navEvents.length; } });
  await h.enter();
  h.openModal();
  await h.clickLink('codex');
  assert.equal(navSeenAtCopy, 0, '复制时还未导航（先复制后跳转）');
  assert.equal(h.navEvents.length, 1, '导航一次');
  const h2 = await setup();
  await h2.enter();
  h2.openModal();
  let prevented = false;
  const el = h2.run(`document.querySelector('#buildView').querySelector('[data-bld-new-session="zcode"]')`);
  el.listeners.click({ preventDefault() { prevented = true; } });
  await h2.flush();
  assert.equal(prevented, true, '应 preventDefault（统一走 location.href）');
});

/* ---------- S5 复制失败不静默 ---------- */

t('S5 复制失败：深链照常打开（不依赖复制成败），错误 toast「复制失败」+「复制提示词」手动补救指引，不谎称已复制', async () => {
  const h = await setup({ writeText: async () => { throw new Error('denied'); } });
  await h.enter();
  h.openModal();
  await h.clickLink('codex');
  assert.ok(h.navUrl.startsWith('codex://threads/new?path='), '复制失败深链仍打开');
  const toast = h.lastToast();
  assert.match(toast.msg, /复制失败/, 'toast 应明确复制失败');
  assert.match(toast.msg, /复制提示词/, 'toast 指引点弹窗内「复制提示词」手动补救');
  assert.match(toast.msg, /回答仍粘贴回本弹窗/, 'toast 指引回答仍粘贴回本弹窗');
  assert.equal(toast.isErr, true, '复制失败为错误 toast');
  assert.doesNotMatch(toast.msg, /已复制提示词/, '不得谎称已复制');
});

/* ---------- S6/S7/S8 宿主探测状态机 ---------- */

t('S6 检测中：先显示「正在检测本机 Agent 客户端…」不渲染链接；探测结束自动刷出最终态（不把未知当未检测到）', async () => {
  let release;
  const gate = () => new Promise((res) => { release = res; });
  const h = await setup({ appsImpl: gate });
  await h.enter(); // enter 触发探测（挂起）
  h.openModal();   // 弹窗打开时探测未完成 → 检测态
  let inner = h.inner();
  assert.match(inner, /正在检测本机 Agent 客户端…/, '检测态说明');
  assert.doesNotMatch(inner, /data-bld-new-session/, '未知时不渲染链接');
  assert.doesNotMatch(inner, /（未检测到）/, '不把未知当未检测到');
  release({ zcode: true, codex: true });
  await h.flush();
  inner = h.inner();
  assert.match(inner, /data-bld-new-session="zcode"/, '探测结束自动刷出 zcode 链接');
  assert.match(inner, /data-bld-new-session="codex"/, '探测结束自动刷出 codex 链接');
});

t('S7 检测失败：说明 +「重新检测」+ 手动指引，入口不消失；重试 force 成功后刷出链接；失败期间打开弹窗不自动重试', async () => {
  let calls = 0;
  const h = await setup({ appsImpl: () => { calls++; if (calls === 1) throw new Error('通道故障'); return { zcode: true, codex: true }; } });
  await h.enter(); // 第一次探测失败
  h.openModal();   // 打开弹窗：failed && !force → 不自动重试
  await h.flush();
  assert.equal(h.appsCalls(), 1, '失败后打开弹窗不自动重试');
  let inner = h.inner();
  assert.match(inner, /客户端检测失败：无法确认本机 Zcode \/ Codex 是否可用/, '失败说明');
  assert.match(inner, /data-bld-ws-retry/, '应有「重新检测」入口');
  assert.match(inner, /重新检测/, '重新检测文案');
  assert.match(inner, /或直接打开 ZCode \/ ChatGPT 手动新建会话并粘贴提示词/, '手动打开指引');
  assert.doesNotMatch(inner, /data-bld-new-session/, '失败未知态不渲染链接（留重试口，不砍入口区）');
  await h.clickRetry(); // force 重试 → 成功
  inner = h.inner();
  assert.match(inner, /data-bld-new-session="zcode"/, '重试成功刷出 zcode 链接');
  assert.match(inner, /data-bld-new-session="codex"/, '重试成功刷出 codex 链接');
  assert.equal(h.appsCalls(), 2, '重试恰好再探测一次');
});

t('S8 探测缓存：模块级 loaded 后再次打开弹窗不重复探测 /api/workspace/apps', async () => {
  const h = await setup();
  await h.enter();
  h.openModal();
  await h.flush();
  h.openModal(); // 再次打开
  await h.flush();
  assert.equal(h.appsCalls(), 1, '整个流程只探测一次（模块级缓存）');
});

/* ---------- S9/S10 守卫态 ---------- */

t('S9 未选项目：两端 is-off 禁用 + title 说明；点击不复制不导航，toast 与任务面板同口径', async () => {
  const h = await setup({ project: null });
  await h.enter();
  h.openModal();
  const inner = h.inner();
  const z = inner.match(/<a[^>]*data-bld-new-session="zcode"[^>]*>/)[0];
  assert.match(z, /is-off/, '未选项目链接禁用态');
  assert.match(z, /title="未选择项目：请先在顶栏选择项目后再新建会话"/, 'title 说明先选项目');
  assert.ok(!/href="zcode:\/\//.test(z), '禁用态无深链 href');
  await h.clickLink('zcode');
  assert.equal(h.navUrl, '', '未选项目不导航');
  assert.equal(h.copiedTexts.length, 0, '未选项目不复制');
  assert.equal(h.lastToast().msg, '未选择项目：请先在顶栏选择项目后再新建会话', 'toast 与任务面板口径一致');
  assert.equal(h.lastToast().isErr, true, '守卫 toast 为错误提示');
});

t('S10 未检测到宿主：对应端 is-off +（未检测到）+ missingTitle；点击不复制不导航，toast 与任务面板同口径；另一端正常可用', async () => {
  const h = await setup({ appsImpl: () => ({ zcode: false, codex: true }) });
  await h.enter();
  h.openModal();
  const inner = h.inner();
  const z = inner.match(/<a[^>]*data-bld-new-session="zcode"[^>]*>/)[0];
  const c = inner.match(/<a[^>]*data-bld-new-session="codex"[^>]*>/)[0];
  assert.match(z, /is-off/, 'zcode 禁用态');
  assert.match(inner, /data-bld-new-session="zcode"[^>]*>去新建 Zcode 会话<span class="ws-entry-note">（未检测到）<\/span><\/a>/, 'zcode 可见说明');
  assert.match(z, /未检测到 ZCode\.app（zcode:\/\/ 深链宿主）/, 'zcode missingTitle');
  assert.ok(!/is-off/.test(c), 'codex 正常可用');
  assert.match(c, /href="codex:\/\//, 'codex 正常态有深链');
  await h.clickLink('zcode');
  assert.equal(h.navUrl, '', '未检测到宿主不导航');
  assert.equal(h.copiedTexts.length, 0, '未检测到宿主不复制');
  assert.equal(h.lastToast().msg, '未检测到 ZCode.app：可能未安装或装在非默认路径，可直接打开 Zcode 手动新建会话并粘贴提示词', 'toast 与任务面板口径一致');
  // codex 端仍可正常复制 + 跳转
  await h.clickLink('codex');
  assert.equal(h.copiedTexts.length, 1, 'codex 正常复制');
  assert.ok(h.navUrl.startsWith('codex://threads/new?path='), 'codex 正常跳转');
});

/* ---------- S11 busy 防重复 ---------- */

t('S11 防重复：在途点击被忽略（只复制一次、只导航一次）；busy 复位后可再次触发', async () => {
  let release;
  const gate = () => new Promise((res) => { release = res; });
  const h = await setup();
  await h.enter();
  h.openModal();
  h.gate = gate;
  const el = h.run(`document.querySelector('#buildView').querySelector('[data-bld-new-session="zcode"]')`);
  el.listeners.click({ preventDefault() {} });
  await h.flush();
  h.run(`document.querySelector('#buildView').querySelector('[data-bld-new-session="zcode"]')`).listeners.click({ preventDefault() {} });
  h.run(`document.querySelector('#buildView').querySelector('[data-bld-new-session="codex"]')`).listeners.click({ preventDefault() {} });
  await h.flush();
  assert.equal(h.copiedTexts.length, 0, '在途未完成不重复复制');
  release();
  await h.flush();
  assert.equal(h.copiedTexts.length, 1, '整轮只复制一次');
  assert.equal(h.navEvents.length, 1, '整轮只导航一次');
  // busy 复位后可再次触发
  h.gate = null;
  await h.clickLink('zcode');
  assert.equal(h.copiedTexts.length, 2, 'busy 复位后再次复制');
  assert.equal(h.navEvents.length, 2, 'busy 复位后再次导航');
});

/* ---------- S12 点击不重渲染 / 不动弹窗 ---------- */

t('S12 点击不重渲染、不关闭弹窗：innerHTML 赋值次数不变，入口区保持', async () => {
  const h = await setup();
  await h.enter();
  h.openModal();
  await h.flush();
  const setsBefore = h.htmlSets();
  await h.clickLink('zcode');
  assert.equal(h.htmlSets(), setsBefore, '点击不得触发重渲染');
  assert.match(h.inner(), /class="bld-session-entry"/, '弹窗保持打开（入口区仍在）');
});

/* ---------- S13 零回归：复制提示词按钮与降级路径 ---------- */

t('S13 零回归：「复制提示词」成功 → 既有 toast +「已复制 ✓」；剪贴板不可用 → 降级指引 toast；探测不阻断复制', async () => {
  const h = await setup();
  await h.enter();
  h.openModal();
  await h.clickCopyPrompt();
  assert.equal(h.copiedTexts.length, 1, '复制一次');
  assert.ok(h.copiedTexts[0].includes('请为看板版本 BLD-20260913-005'), '复制的是版本提示词');
  assert.match(h.lastToast().msg, /✓ 提示词已复制，去 Agent 粘贴执行后把回答粘贴到下方/, '既有成功 toast 原样保留');
  assert.match(h.inner(), /已复制 ✓/, '既有「已复制 ✓」标记保留');
  // 剪贴板不可用降级
  const h2 = await setup({ writeText: async () => { throw new Error('denied'); } });
  await h2.enter();
  h2.openModal();
  await h2.clickCopyPrompt();
  assert.match(h2.lastToast().msg, /剪贴板不可用：请在提示词文本框中全选（⌘A）并手动复制/, '降级指引 toast 保留');
  assert.match(h2.inner(), /id="bldCopyPrompt"/, '弹窗保持可用');
});

/* ---------- S14 探测重渲染保留草稿 ---------- */

t('S14 探测结束重渲染保留用户已粘贴未解析的回答草稿', async () => {
  let release;
  const gate = () => new Promise((res) => { release = res; });
  const h = await setup({ appsImpl: gate });
  await h.enter();
  h.openModal();
  // 模拟在回答框输入（未解析）
  h.run(`(function () {
    var input = document.querySelector('#buildView').querySelector('.bld-answer-input');
    input.value = '版本名称：v2.0 草稿\\n版本描述：草稿内容';
  })()`);
  release({ zcode: true, codex: true });
  await h.flush();
  assert.match(h.inner(), /v2\.0 草稿/, '重渲染后回答草稿保留在 textarea');
});

/* ---------- S15 i18n ---------- */

t('S15 i18n：新入口 / toast 文案入词典（EN / EN_DYNAMIC），动态词条含 ASCII 锚点，zh 反复 t() 幂等', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  const dynKeys = [
    '✓ 已复制提示词并请求打开 ◇（◇）：请在新建会话中粘贴发送；回答仍粘贴回本弹窗',
    '复制失败：已请求打开 ◇（◇），请点弹窗内「复制提示词」手动复制后再粘贴；回答仍粘贴回本弹窗',
    '自动复制本弹窗版本提示词后打开 Zcode（◇）：深链只打开工作区，会话需手动新建并粘贴提示词',
    '自动复制本弹窗版本提示词后打开 Codex 新会话（◇）：深链不传提示词，不会自动发送，请粘贴发送',
  ];
  const missing = dynKeys.filter((k) => !(k in EN_DYNAMIC));
  assert.deepEqual(missing, [], `以下动态文案未入 EN_DYNAMIC：${missing.join(' / ')}`);
  for (const [k, v] of Object.entries(EN_DYNAMIC)) {
    assert.ok(/[A-Za-z]/.test(String(v)), `动态词条英文模板必须含 ASCII 锚点：${k}`);
  }
  for (const k of ['去新建 Zcode 会话', '去新建 Codex 会话', '✓ 提示词已复制，去 Agent 粘贴执行后把回答粘贴到下方', '剪贴板不可用：请在提示词文本框中全选（⌘A）并手动复制']) {
    assert.ok(k in EN, `静态词条缺失：${k}`);
  }
  // en 翻译命中 + zh 幂等（防 BUG-20260912-004 自匹配类回归）
  I.setLang('en');
  assert.match(I.t('✓ 已复制提示词并请求打开 Codex 新会话（/p）：请在新建会话中粘贴发送；回答仍粘贴回本弹窗'), /Prompt copied and requested opening/);
  I.setLang('zh');
  const zh = '✓ 已复制提示词并请求打开 Zcode 工作区（/p）：请在新建会话中粘贴发送；回答仍粘贴回本弹窗';
  let cur = zh;
  for (let i = 0; i < 6; i++) cur = I.t(cur);
  assert.equal(cur, zh, 'zh 模式反复 t() 不得变形');
});

/* ---------- 运行器 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
