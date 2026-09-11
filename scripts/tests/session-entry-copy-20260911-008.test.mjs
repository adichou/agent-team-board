#!/usr/bin/env node
// REQ-20260911-008 去新建 Zcode / Codex 会话自动拷贝最新提示词 —— 点击行为两步并一步测试
// 覆盖 README 期望行为（交互 1-7 / 状态反馈）：复制取材随面板、先复制后跳转、失败/空态
// 不静默、守卫不回退、防重复点击、零回归（详见条目 test-cases.md C1-C15）。
// 用法：node scripts/tests/session-entry-copy-20260911-008.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function fnSrc(name) {
  const m = js.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}`, 'm'));
  assert.ok(m, `应存在 ${name} 函数`);
  return m[0];
}

// 已知态（探测完成）下的宿主探测结果
const knownApps = (zcode = true, codex = true) => ({ zcode, codex, loaded: true, probing: false, failed: false });

function element() {
  return { dataset: {}, listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; } };
}

// 点击行为沙箱：提取 bindBatchDrawer + copyPromptAndOpenSession 真实源码，
// 桩掉 api / copyDispatchText / 渲染刷新，记录事件顺序（copy → nav）与 toast。
function setupClick({
  project = '/Users/x/我的 项目/atb',
  apps = knownApps(),
  mode = 'refine',
  refineData = { batch: { prompt: '完善面板主调度提示词' } },
  apiImpl = async () => ({ prompt: '开发面板主调度提示词' }),
  copyImpl = async () => true,
} = {}) {
  const bindSrc = fnSrc('bindBatchDrawer');
  const copySrc = fnSrc('copyPromptAndOpenSession');
  const els = [element(), element()];
  els[0].dataset.newSession = 'zcode';
  els[1].dataset.newSession = 'codex';
  const drawer = {
    els,
    querySelectorAll(sel) { return sel === '[data-new-session]' ? this.els : []; },
    querySelector() { return null; },
  };
  const events = [];
  const calls = { api: 0, copy: 0, rendered: 0, refreshed: 0, copyTexts: [] };
  let navUrl = '';
  const location = {};
  Object.defineProperty(location, 'href', {
    set(v) { events.push('nav'); navUrl = v; },
    get() { return navUrl; },
  });
  const sandboxState = {
    project,
    workspaceApps: apps,
    batch: { mode },
    refine: { data: refineData },
  };
  const sandbox = {
    $: (s) => (s === '#batchDrawer' ? drawer : null),
    state: sandboxState,
    location,
    api: async (...a) => { calls.api++; events.push('api'); return apiImpl(...a); },
    copyDispatchText: async (text) => { calls.copy++; calls.copyTexts.push(text); events.push('copy'); return copyImpl(text); },
    toast: (msg, isErr) => { sandbox.__toast = msg; sandbox.__err = isErr; },
    saveViewSnapshot: () => {}, activateTaskPane: () => {},
    renderBatchDrawer: () => { calls.rendered++; },
    refreshBatch: async () => { calls.refreshed++; },
    refreshWorkspaceApps: async () => {},
    createBatchAndCopy: async () => {}, copyBatchPrompt: async () => {}, toggleBatchPause: async () => {},
    deleteBatchById: async () => {}, retryRunFromRecord: async () => {}, createRefineBatchAndCopy: async () => {},
    toggleRefinePause: async () => {}, abortRefineTask: async () => {}, abortDevTask: async () => {},
    bindCommitWidgets: () => {}, openDrawer: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(`let sessionEntryBusy = false;\n${copySrc}\n${bindSrc}\nbindBatchDrawer();`, sandbox);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const flush = async () => { for (let i = 0; i < 8; i++) await tick(); };
  const elOf = (agent) => els[agent === 'codex' ? 1 : 0];
  const click = async (agent, ev) => {
    sandbox.__toast = ''; sandbox.__err = undefined;
    let prevented = false;
    const e = ev ?? { preventDefault() { prevented = true; } };
    elOf(agent).listeners.click(e);
    await flush();
    return { nav: navUrl, toast: sandbox.__toast || '', err: sandbox.__err, prevented, events: [...events] };
  };
  const clickSync = (agent) => { sandbox.__toast = ''; elOf(agent).listeners.click(); };
  return { click, clickSync, tick, flush, calls, events, state: sandboxState, setProject: (p) => { sandboxState.project = p; } };
}

// ---------- C1 成功：批量完善面板取材 ----------

t('C1 成功-完善：点击 codex 链接先复制 refine 当前任务提示词原文，再跳深链；toast「已复制提示词并请求打开…粘贴发送」', async () => {
  const h = setupClick();
  const r = await h.click('codex');
  assert.equal(h.calls.api, 0, '完善面板不得请求 /api/batch/prompt');
  assert.deepEqual(h.calls.copyTexts, ['完善面板主调度提示词'], '复制的应为 refine 当前任务提示词原文');
  assert.equal(r.nav, `codex://threads/new?path=${encodeURIComponent('/Users/x/我的 项目/atb')}`, '复制后触发 codex 深链');
  assert.ok(!r.nav.includes('prompt='), '深链不携带 prompt');
  assert.match(r.toast, /已复制提示词并请求打开 Codex 新会话/, 'toast 应明确已复制并请求打开');
  assert.match(r.toast, /粘贴发送/, 'toast 应指引粘贴发送');
  assert.ok(!r.err, '成功不是错误 toast');
});

// ---------- C2 批量 Commit 面板取材（REQ-20260911-010 已回退） ----------

t('C2 回退后：copyPromptAndOpenSession 无 commit 取材分支（mode=commit 按 develop 口径走 GET /api/batch/prompt）', async () => {
  // 存量快照可能残留 batch.mode=commit：取材回落开发口径（GET /api/batch/prompt），不读已删除的 state.commit
  const h = setupClick({ mode: 'commit', apiImpl: async () => ({ prompt: '开发面板主调度提示词' }) });
  const r = await h.click('zcode');
  assert.equal(h.calls.api, 1, 'commit 残留模式应按开发口径请求 /api/batch/prompt');
  assert.deepEqual(h.calls.copyTexts, ['开发面板主调度提示词'], '复制的是接口返回提示词');
  assert.equal(r.nav, `zcode://workspace/open?path=${encodeURIComponent('/Users/x/我的 项目/atb')}`, 'zcode 深链仍为 workspace/open');
  assert.doesNotMatch(js, /state\.commit\b/, '取材不得再读已删除的 commit 面板状态');
});

// ---------- C3 成功：批量开发面板取材（GET /api/batch/prompt，不新建批次） ----------

t('C3 成功-开发：取材 GET /api/batch/prompt（同「重新复制」口径），复制返回 prompt 后跳深链', async () => {
  let asked = '';
  const h = setupClick({ mode: 'develop', apiImpl: async (p) => { asked = p; return { prompt: '开发面板主调度提示词' }; } });
  const r = await h.click('zcode');
  assert.equal(h.calls.api, 1, '开发面板应请求一次提示词接口');
  assert.equal(asked, '/api/batch/prompt', '取材走 GET /api/batch/prompt（不新建批次）');
  assert.deepEqual(h.calls.copyTexts, ['开发面板主调度提示词'], '复制接口返回的提示词');
  assert.match(r.toast, /已复制提示词并请求打开 Zcode 工作区/);
  // 存量 codex 深链面板（待确认项定案：同批量开发口径）→ 同样走 GET
  const h2 = setupClick({ mode: 'codex' });
  const r2 = await h2.click('codex');
  assert.equal(h2.calls.api, 1, '存量 codex 面板同批量开发口径取材');
  assert.deepEqual(h2.calls.copyTexts, ['开发面板主调度提示词']);
  assert.ok(r2.nav.startsWith('codex://threads/new?path='));
});

// ---------- C4 先复制后跳转 ----------

t('C4 顺序：同一次点击内剪贴板写入先于 location.href 赋值（先复制后跳转）', async () => {
  const h = setupClick();
  const r = await h.click('zcode');
  assert.ok(r.events.includes('copy') && r.events.includes('nav'), '应既有复制又有导航');
  assert.ok(r.events.indexOf('copy') < r.events.indexOf('nav'), '剪贴板写入必须先于深链跳转');
});

// ---------- C5 复制失败不静默 ----------

t('C5 复制失败：深链照常打开（打开不依赖复制），toast「复制失败」+ 回面板「重新复制」指引', async () => {
  const h = setupClick({ copyImpl: async () => false });
  const r = await h.click('zcode');
  assert.equal(r.nav, `zcode://workspace/open?path=${encodeURIComponent('/Users/x/我的 项目/atb')}`, '复制失败深链仍打开');
  assert.match(r.toast, /复制失败/, 'toast 应明确复制失败');
  assert.match(r.toast, /重新复制/, 'toast 应指引回面板重新复制');
  assert.equal(r.err, true, '复制失败为错误 toast');
  assert.doesNotMatch(r.toast, /已复制提示词/, '不得谎称已复制');
});

// ---------- C6 提示词获取失败 ----------

t('C6 获取失败：深链照常打开，toast「提示词获取失败（原因）」+「重新复制」指引；不出现已复制', async () => {
  const h = setupClick({ mode: 'develop', apiImpl: async () => { throw new Error('服务暂不可用'); } });
  const r = await h.click('codex');
  assert.ok(r.nav.startsWith('codex://threads/new?path='), '获取失败深链仍打开');
  assert.match(r.toast, /提示词获取失败（服务暂不可用）/, 'toast 应含失败原因');
  assert.match(r.toast, /重新复制/, 'toast 应指引补救');
  assert.equal(r.err, true, '获取失败为错误 toast');
  assert.equal(h.calls.copy, 0, '获取失败不得调用剪贴板');
  assert.doesNotMatch(r.toast, /已复制/, '不得谎称已复制');
});

// ---------- C7 面板无任务 / 无提示词 ----------

t('C7 空态：面板无任务/提示词缺失（存量批次）不复制不报错，深链照常打开，toast 提示先创建任务', async () => {
  const h = setupClick({ refineData: null });
  const r = await h.click('zcode');
  assert.equal(h.calls.copy, 0, '无提示词不得调剪贴板');
  assert.ok(r.nav.startsWith('zcode://workspace/open?path='), '深链照常打开');
  assert.match(r.toast, /当前面板暂无任务提示词/, 'toast 应说明面板暂无提示词');
  assert.match(r.toast, /请先创建任务/, 'toast 应指引先创建任务');
  // 存量批次 prompt 缺失（batch 存在但 prompt 为空）同样按空态处理
  const h2 = setupClick({ refineData: { batch: { prompt: '' } } });
  const r2 = await h2.click('zcode');
  assert.equal(h2.calls.copy, 0, 'prompt 为空串按无提示词处理');
  assert.match(r2.toast, /当前面板暂无任务提示词/);
});

// ---------- C8 守卫状态不回退 ----------

t('C8 守卫不回退：未选项目 / 未检测到宿主 → 不复制、不导航，toast 与 BUG-20260910-005 现状一致', async () => {
  const h = setupClick({ project: null });
  const r = await h.click('zcode');
  assert.equal(r.nav, '', '未选项目不得导航');
  assert.equal(h.calls.copy, 0, '未选项目不得复制');
  assert.match(r.toast, /未选择项目：请先在顶栏选择项目后再新建会话/, 'toast 文案与现状一致');
  const h2 = setupClick({ apps: knownApps(true, false) });
  const r2 = await h2.click('codex');
  assert.equal(r2.nav, '', '未检测到宿主不得导航');
  assert.equal(h2.calls.copy, 0, '未检测到宿主不得复制');
  assert.match(r2.toast, /未检测到 ChatGPT\.app：可能未安装或装在非默认路径，可直接打开 ChatGPT 手动新建会话并粘贴提示词/, 'toast 文案与现状一致');
});

// ---------- C9 防重复点击 ----------

t('C9 防重复：在途点击被忽略（只取一次提示词、只导航一次）；完成后 busy 复位可再次触发', async () => {
  let release;
  const gate = () => new Promise((res) => { release = res; });
  const h = setupClick({ mode: 'develop', copyImpl: gate });
  h.clickSync('zcode'); // 第一次点击：发起取材 → 停在等待剪贴板结果（在途）
  await h.tick();
  h.clickSync('zcode'); // 在途期间重复点击（同端）
  h.clickSync('codex'); // 在途期间另一端点击：同样忽略
  await h.tick();
  assert.equal(h.calls.api, 1, '在途期间重复点击不得再次取提示词');
  release(true); // 放行第一次复制
  await h.flush();
  assert.equal(h.calls.copy, 1, '整轮只复制一次');
  assert.equal(h.events.filter((e) => e === 'nav').length, 1, '整轮只导航一次');
  // busy 已复位：再次点击可正常触发新一轮（取材 + 复制 + 导航）
  h.clickSync('zcode');
  await h.tick();
  assert.equal(h.calls.api, 2, 'busy 复位后可再次点击触发');
  release(true);
  await h.flush();
  assert.equal(h.events.filter((e) => e === 'nav').length, 2, '第二次点击正常导航');
});

// ---------- C10 不干扰页签 / 批次 / 队列 ----------

t('C10 不干扰：点击不切页签（state.batch.mode 不变）、不重渲染、不刷新批次/队列', async () => {
  const h = setupClick();
  await h.click('zcode');
  assert.equal(h.state.batch.mode, 'refine', '不得改变任务页签选中');
  assert.equal(h.calls.rendered, 0, '不得重渲染面板');
  assert.equal(h.calls.refreshed, 0, '不得触发批次刷新');
  // 源码契约：bind 内点击处理器不含页签切换/刷新调用；取材逻辑在 copyPromptAndOpenSession
  const bind = fnSrc('bindBatchDrawer');
  const handler = bind.slice(bind.indexOf('[data-new-session]'), bind.indexOf('data-ws-retry'));
  assert.ok(handler, '应存在会话链接绑定');
  assert.doesNotMatch(handler, /state\.batch\.mode|data-bmode|refreshBatch\(|refreshRefine\(|refreshCommit\(|renderBatchDrawer\(/, '点击处理器不得切换页签或触发刷新');
  const helper = fnSrc('copyPromptAndOpenSession');
  assert.doesNotMatch(helper, /renderBatchDrawer\(|refreshBatch\(|refreshRefine\(|refreshCommit\(|createBatchAndCopy|createRefineBatchAndCopy|createCommitBatchAndCopy/, '自动复制流程不得重渲染/刷新/创建任务');
});

// ---------- C11 单一触发路径与键盘一致 ----------

t('C11 键盘一致：preventDefault 被调用，统一走 location.href 单一路径（Enter 触发 click 同路径）', async () => {
  const h = setupClick();
  const ev = { prevented: false, preventDefault() { this.prevented = true; } };
  const r = await h.click('zcode', ev);
  assert.equal(ev.prevented, true, '应阻止默认导航（统一走 location.href）');
  assert.ok(r.nav.startsWith('zcode://workspace/open?path='), '深链由 location.href 触发');
  // 无 ev 对象（防御路径）不抛错
  const h2 = setupClick();
  h2.clickSync('codex');
  await h2.flush();
  assert.ok(h2.events.includes('nav'), 'ev 缺省同样完成复制与导航');
});

// ---------- C12 title 口径更新 ----------

t('C12 title：正常态 title 更新为「自动复制提示词后打开」口径且含项目路径；不宣称自动新建/自动创建', () => {
  const html = renderLinks();
  const z = html.match(/<a[^>]*data-new-session="zcode"[^>]*>/)[0];
  const c = html.match(/<a[^>]*data-new-session="codex"[^>]*>/)[0];
  assert.match(z, /title="[^"]*自动复制[^"]*主调度提示词[^"]*Zcode[^"]*\/Users\/x\/我的 项目\/atb[^"]*"/, 'zcode title 含自动复制口径、Agent 与项目路径');
  assert.match(c, /title="[^"]*自动复制[^"]*主调度提示词[^"]*Codex[^"]*\/Users\/x\/我的 项目\/atb[^"]*"/, 'codex title 含自动复制口径、Agent 与项目路径');
  assert.match(z, /打开工作区/, 'zcode title 保留只打开工作区口径');
  assert.match(z, /手动新建/, 'zcode title 保留会话需手动新建口径');
  assert.match(c, /不会自动发送/, 'codex title 保留不自动发送口径');
  assert.ok(!/自动新建|自动创建/.test(z + c), '不得宣称自动新建/自动创建会话');
});

// ---------- C13 既有复制入口零回归 ----------

t('C13 零回归：面板「重新复制」绑定与 copyDispatchText 保留，提示词分区不受影响', () => {
  const bind = fnSrc('bindBatchDrawer');
  // REQ-20260911-010：commitRecopy 随批量 Commit 面板回退移除
  for (const id of ['batchRecopy', 'batchResumeCopy', 'refineRecopy']) {
    assert.ok(bind.includes(`'#${id}'`), `既有复制绑定 ${id} 保留`);
  }
  assert.ok(!bind.includes(`'#commitRecopy'`), 'commitRecopy 应随面板回退移除');
  assert.match(js, /function copyDispatchText\(/, 'copyDispatchText 工具保留');
});

// ---------- C14 不自动发送口径 ----------

t('C14 不自动发送：zcode 仍 workspace/open、codex 仍 threads/new?path=，深链一律不携带 prompt', async () => {
  const h = setupClick();
  const rz = await h.click('zcode');
  const rc = await h.click('codex');
  assert.equal(rz.nav, `zcode://workspace/open?path=${encodeURIComponent('/Users/x/我的 项目/atb')}`);
  assert.equal(rc.nav, `codex://threads/new?path=${encodeURIComponent('/Users/x/我的 项目/atb')}`);
  assert.ok(!rz.nav.includes('prompt=') && !rc.nav.includes('prompt='), '深链不携带 prompt 参数');
  const helper = fnSrc('copyPromptAndOpenSession');
  assert.ok(!helper.includes('prompt='), '自动复制流程不得给深链追加 prompt 参数');
});

// ---------- C15 i18n 覆盖 ----------

t('C15 i18n：新增中文文案均入 EN_DYNAMIC 词典（无缺失，可切英文）', async () => {
  await import('../web/i18n.js');
  const { EN_DYNAMIC } = globalThis.ATBI18N._dict;
  const need = [
    '✓ 已复制提示词并请求打开 ◇（◇）：请在新建会话中粘贴发送',
    '复制失败：已请求打开 ◇（◇），请回任务面板点「重新复制」后再粘贴',
    '提示词获取失败（◇）：已请求打开 ◇，请回任务面板点「重新复制」后再粘贴',
    '当前面板暂无任务提示词，请先创建任务；已请求打开 ◇（◇），可稍后从提示词分区「重新复制」',
    '自动复制当前面板最新主调度提示词后打开 Zcode（◇）：深链只打开工作区，会话需手动新建并粘贴提示词',
    '自动复制当前面板最新主调度提示词后打开 Codex 新会话（◇）：深链不传提示词，不会自动发送，请粘贴发送',
  ];
  const missing = need.filter((k) => !(k in EN_DYNAMIC));
  assert.deepEqual(missing, [], `以下新增文案未入 EN_DYNAMIC：\n${missing.join('\n')}`);
});

/* ---------- 全量渲染沙箱（C12 用，同 session-entry-20260910-005 模式） ---------- */

function renderLinks() {
  function el() {
    const nodes = new Map();
    const classes = new Set();
    return {
      nodes, dataset: {}, innerHTML: '', textContent: '', title: '', value: '', disabled: false, checked: false,
      children: [], listeners: {},
      classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
      addEventListener(event, fn) { this.listeners[event] = fn; },
      querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, el()); return nodes.get(selector); },
      querySelectorAll() { return []; },
      appendChild(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      setAttribute() {}, removeAttribute() {},
    };
  }
  const document = el();
  document.createElement = el;
  document.querySelector = (selector) => { if (!document.nodes.has(selector)) document.nodes.set(selector, el()); return document.nodes.get(selector); };
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    fetch: async () => ({ ok: true, json: async () => ({}) }) };
  vm.createContext(sandbox);
  vm.runInContext(js.split('\nboot();')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/Users/x/我的 项目/atb';
  state.workspaceApps = knownApps();
  return run('newSessionLinksHtml()');
}

// ---------- 运行器 ----------

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
