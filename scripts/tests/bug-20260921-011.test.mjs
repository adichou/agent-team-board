#!/usr/bin/env node
// BUG-20260921-011 刷新时顶栏项目选择器空数据塌缩、模块页签跳动 —— TDD 分层测试。
// 根因：#projectSel 初始无选项，boot() 要等 /api/health + 首轮 poll + 快照恢复后才
//   renderProjectSel()；.project-sel 只有 max-width 无稳定宽度，空 select 塌缩；
//   列表为空时 renderProjectSel 直接 hidden，健康检查失败也伪装成空态（无失败反馈与重试）。
// 引入来源：REQ-20260830-001（多项目项目选择器自始为「数据到达后才渲染 + 空即隐藏」）；
//   REQ-20260910-012 模块页签并入顶栏后塌缩开始连带页签位移（放大而非引入）。
// 修复：四态渲染（loading/ok/empty/error）+ 首帧占位 + 固定宽度 + 失败态选择器即重试入口。
// —— 用例（vm 提取真实 app.js 函数 + 假 DOM；源码/样式/i18n 断言走真实文件）：
//   T1 首帧加载占位：无已知项目显示「加载项目中…」并禁用；不隐藏（不塌缩）；
//   T2 加载中已知项目（URL/上次选择）：显示项目名 +（加载中…）标注，仍禁用，title 指向全路径；
//   T3 加载成功：选项列表与选中项正确、恢复可交互、title 为当前项目全路径；
//   T4 空态：显示「暂无项目」占位、可见不隐藏、禁用（管理项目入口不受影响）；
//   T5 失败态：显示「加载失败，点此重试」、可交互（不冒充空态、不隐藏）；
//   T6 失败态重试：change 触发 refreshHealth 重拉；仍失败回到失败态且不切换项目；
//   T7 重试成功：恢复列表渲染（ok），期间不调用 switchProject；
//   T8 refreshHealth 状态机：成功非空→ok、成功空→empty、失败→error，全程选择器不隐藏；
//   T9 setProjectList 统一入口：非空→ok、空→empty；app.js 不再绕过（无 state.projects = 裸赋值）；
//   T10 boot 首帧时序：health await 之前已置 loading 并 renderProjectSel；catch 置 error；
//   T11 静态首帧占位：index.html #projectSel 内置「加载项目中…」option 且初始 disabled；
//   T12 样式稳定宽度：.project-sel 固定 200px（原 max-width 移除）；≤640px 沿用自适应 + 最小占位；
//   T13 i18n：新增占位词条双语齐备（静态 + 动态「◇（加载中…）」）；
//   T14 回归：常态 change 仍走营销未保存守卫 / 直切 switchProject。
// 用法：node scripts/tests/bug-20260921-011.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webDir = path.join(pluginRoot, 'scripts', 'web');
const appJs = fs.readFileSync(path.join(webDir, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(webDir, 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- vm 提取真实函数（顶函数体：列 0 起止） ---------- */

function extractFn(source, name) {
  const m = source.match(new RegExp(`^(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`, 'm'));
  assert.ok(m, `app.js 中应存在顶函数 ${name}`);
  return m[0];
}

const FNS = [
  extractFn(appJs, 'shortProject'),
  extractFn(appJs, 'setProjectList'),
  extractFn(appJs, 'renderProjectSel'),
  extractFn(appJs, 'refreshHealth'),
  extractFn(appJs, 'onProjectSelChange'),
].join('\n');

/* ---------- 假 DOM：select / option 最小实现 ---------- */

function makeOption() {
  return { textContent: '', title: '', value: '', selected: false };
}

function makeSelect() {
  const sel = {
    children: [], disabled: false, title: '', _value: '',
    listeners: {},
    classList: {
      _s: new Set(),
      add: (v) => sel.classList._s.add(v),
      remove: (v) => sel.classList._s.delete(v),
      contains: (v) => sel.classList._s.has(v),
      toggle: (v, on) => (on ? sel.classList._s.add(v) : sel.classList._s.delete(v)),
    },
    appendChild(o) { sel.children.push(o); },
    addEventListener(ev, fn) { sel.listeners[ev] = fn; },
  };
  Object.defineProperty(sel, 'innerHTML', {
    configurable: true,
    get: () => sel.children.map((o) => o.textContent).join(''),
    set: () => { sel.children = []; sel._value = ''; },
  });
  Object.defineProperty(sel, 'value', {
    configurable: true,
    get() {
      const hit = sel.children.find((o) => o.selected) ||
        sel.children.find((o) => o.value !== '' && o.value === sel._value);
      return hit ? hit.value : '';
    },
    set(v) {
      sel._value = v;
      for (const o of sel.children) o.selected = o.value === v;
    },
  });
  return sel;
}

/* ---------- 沙箱：fresh state + 可控 api / switchProject ---------- */

function makeCtx({ apiImpl } = {}) {
  const sel = makeSelect();
  const ctx = {
    state: { project: null, projects: [], projectsState: 'loading' },
    $: () => sel,
    document: { createElement: () => makeOption() },
    window: {},
    api: apiImpl || (async () => { throw new Error('api 未注入'); }),
    switchProjectCalls: [],
    guarded: [],
  };
  ctx.switchProject = async (p) => { ctx.switchProjectCalls.push(p); };
  vm.createContext(ctx);
  vm.runInContext(FNS, ctx);
  ctx.sel = sel;
  return ctx;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

const texts = () => ctxSel().children.map((o) => o.textContent);
let CTX = null;
const ctxSel = () => CTX.sel;

/* ---------- T1 首帧加载占位（未知项目） ---------- */

t('T1 加载中（未知项目）：显示「加载项目中…」占位并禁用，不隐藏', () => {
  CTX = makeCtx();
  vm.runInContext('state.projectsState = "loading"; renderProjectSel();', CTX);
  assert.equal(CTX.sel.children.length, 1, '加载中应只有一个占位选项');
  assert.equal(texts()[0], '加载项目中…');
  assert.equal(CTX.sel.disabled, true, '尚不能确认项目时必须禁用选择');
  assert.equal(CTX.sel.classList.contains('hidden'), false, '加载中不得隐藏选择器（塌缩即页签跳动根源）');
});

/* ---------- T2 加载中已知项目 ---------- */

t('T2 加载中（已知项目）：显示项目名+（加载中…），仍禁用，title 为全路径', () => {
  CTX = makeCtx();
  vm.runInContext('state.project = "/w/agent-team-board"; state.projectsState = "loading"; renderProjectSel();', CTX);
  assert.equal(texts()[0], 'agent-team-board（加载中…）', '已知项目显示其名并标明加载中');
  assert.equal(CTX.sel.disabled, true);
  assert.equal(CTX.sel.title, '/w/agent-team-board', '加载中 title 指向全路径，可辨识当前项目');
  assert.equal(CTX.sel.classList.contains('hidden'), false);
});

/* ---------- T3 加载成功 ---------- */

t('T3 加载成功：列表与选中项正确、恢复可交互、title 为当前项目全路径', () => {
  CTX = makeCtx();
  vm.runInContext(
    'setProjectList(["/w/alpha", "/w/beta"]); state.project = "/w/beta"; renderProjectSel();',
    CTX,
  );
  assert.deepEqual(texts(), ['alpha', 'beta']);
  assert.equal(CTX.sel.children[1].selected, true, '选中当前项目');
  assert.equal(CTX.sel.children[1].title, '/w/beta', '选项 title 保留全路径');
  assert.equal(CTX.sel.disabled, false, '加载完成后恢复可切换');
  assert.equal(CTX.sel.title, '/w/beta', '长名截断时悬浮可看完整路径');
});

/* ---------- T4 空态 ---------- */

t('T4 空态：显示「暂无项目」占位、可见不隐藏、禁用', () => {
  CTX = makeCtx();
  vm.runInContext('setProjectList([]); renderProjectSel();', CTX);
  assert.equal(texts()[0], '暂无项目');
  assert.equal(CTX.sel.disabled, true, '空态无可选项，禁用但不隐藏');
  assert.equal(CTX.sel.classList.contains('hidden'), false, '空态保留占位（原实现隐藏导致塌缩）');
  assert.match(CTX.sel.title, /管理项目/, '空态 title 指引管理项目入口');
});

/* ---------- T5 失败态 ---------- */

t('T5 失败态：显示「加载失败，点此重试」，可交互、与空态可区分', () => {
  CTX = makeCtx();
  vm.runInContext('state.projectsState = "error"; renderProjectSel();', CTX);
  assert.equal(texts()[0], '加载失败，点此重试');
  assert.notEqual(texts()[0], '暂无项目', '失败不得冒充空态');
  assert.equal(CTX.sel.disabled, false, '失败态保留交互：选择器即重试入口');
  assert.equal(CTX.sel.classList.contains('hidden'), false);
});

/* ---------- T6/T7 失败态重试 ---------- */

t('T6 失败态重试：change 触发重拉；仍失败回到失败态且不切换项目', async () => {
  let calls = 0;
  CTX = makeCtx({ apiImpl: async () => { calls += 1; throw new Error('网络错误'); } });
  vm.runInContext('state.project = "/w/keep"; state.projectsState = "error"; renderProjectSel();', CTX);
  vm.runInContext('onProjectSelChange({ target: { value: "__retry__" } });', CTX);
  await tick();
  assert.equal(calls, 1, '失败态 change 应重新请求 /api/health');
  assert.equal(CTX.state.projectsState, 'error', '重试失败仍为失败态');
  assert.equal(CTX.state.project, '/w/keep', '失败重试不得切换项目');
  assert.deepEqual(CTX.switchProjectCalls, [], '失败重试不触发 switchProject');
});

t('T7 重试成功：恢复 ok 列表渲染，期间不调用 switchProject', async () => {
  CTX = makeCtx({ apiImpl: async () => ({ projects: ['/w/alpha', '/w/beta'] }) });
  vm.runInContext('state.project = "/w/beta"; state.projectsState = "error"; renderProjectSel();', CTX);
  vm.runInContext('onProjectSelChange({ target: { value: "__retry__" } });', CTX);
  await tick();
  assert.equal(CTX.state.projectsState, 'ok');
  assert.deepEqual(texts(), ['alpha', 'beta']);
  assert.equal(CTX.sel.children[1].selected, true);
  assert.deepEqual(CTX.switchProjectCalls, [], '重试只恢复列表，不当成一次项目切换');
});

/* ---------- T8 refreshHealth 状态机 ---------- */

t('T8 refreshHealth 状态机：成功非空→ok、成功空→empty、失败→error，全程不隐藏', async () => {
  CTX = makeCtx({ apiImpl: async () => ({ projects: ['/w/a'] }) });
  await vm.runInContext('refreshHealth();', CTX);
  assert.equal(CTX.state.projectsState, 'ok');
  assert.deepEqual(texts(), ['a']);

  CTX = makeCtx({ apiImpl: async () => ({ projects: [] }) });
  await vm.runInContext('refreshHealth();', CTX);
  assert.equal(CTX.state.projectsState, 'empty', '确认没有项目是空态，不是失败');

  CTX = makeCtx({ apiImpl: async () => { throw new Error('down'); } });
  vm.runInContext('state.project = "/w/keep";', CTX);
  await vm.runInContext('refreshHealth();', CTX);
  assert.equal(CTX.state.projectsState, 'error', '请求失败是失败态，不伪装空态');
  assert.equal(CTX.state.project, '/w/keep');
  assert.equal(CTX.sel.classList.contains('hidden'), false);
  assert.equal(texts()[0], '加载失败，点此重试');
});

/* ---------- T9 setProjectList 统一入口 ---------- */

t('T9 setProjectList：非空→ok、空→empty；app.js 无 state.projects 裸赋值', () => {
  CTX = makeCtx();
  vm.runInContext('setProjectList(["/w/x"]);', CTX);
  assert.equal(CTX.state.projectsState, 'ok');
  vm.runInContext('setProjectList(null);', CTX);
  assert.equal(CTX.state.projects.length, 0);
  assert.equal(CTX.state.projectsState, 'empty');
  const bare = appJs.match(/state\.projects\s*=[^=]/g) || [];
  assert.equal(bare.length, 1, '项目注册表赋值只允许出现在 setProjectList 内（防局部路径残留旧状态）');
});

/* ---------- T10 boot 首帧时序（源码断言） ---------- */

t('T10 boot 首帧：health await 前已置 loading 并 renderProjectSel；catch 置 error', () => {
  const boot = extractFn(appJs, 'boot');
  const firstRender = boot.indexOf('renderProjectSel()');
  const healthAwait = boot.indexOf("await api('/api/health')");
  assert.ok(firstRender >= 0 && healthAwait >= 0, 'boot 应包含 health 请求与选择器渲染');
  assert.ok(firstRender < healthAwait, '首帧占位渲染必须先于健康检查等待（否则刷新期间空白塌缩）');
  assert.ok(
    boot.indexOf("state.projectsState = 'loading'") < healthAwait,
    'boot 应在等待数据前进入 loading 态',
  );
  assert.match(boot, /state\.projectsState = 'error'/, 'health 失败应置 error（与空态区分）');
  assert.match(boot, /setProjectList\(h\.projects \|\| \[\]\)/, '成功后走统一入口按列表区分 ok/empty');
});

/* ---------- T11 静态首帧占位（index.html） ---------- */

t('T11 index.html：#projectSel 内置「加载项目中…」占位 option 且初始 disabled', () => {
  const m = indexHtml.match(/<select id="projectSel"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(m, 'index.html 应有 #projectSel');
  assert.match(m[0], /disabled/, 'JS 就绪前禁用，不允许选择未加载的选项');
  assert.match(m[1], /加载项目中…/, '静态首帧占位：无 JS / 脚本失败时也不呈现空选择器');
});

/* ---------- T12 样式稳定宽度 ---------- */

t('T12 style.css：.project-sel 固定 200px（移除 max-width 依赖）；≤640px 自适应 + 最小占位', () => {
  const m = styleCss.match(/\.project-sel \{[\s\S]*?\n\}/);
  assert.ok(m, '.project-sel 规则应存在');
  assert.match(m[0], /width:\s*200px/, '固定宽度：加载/空/失败/常态同宽，页签不随数据到达横移');
  assert.doesNotMatch(m[0], /max-width:\s*200px/, '原 max-width 无下限（空选项塌缩）应被固定宽度替代');
  assert.match(m[0], /text-overflow:\s*ellipsis/, '长名截断沿用 ellipsis');
  const medias = [...styleCss.matchAll(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/g)].map((m) => m[0]);
  assert.ok(
    medias.some((b) => /\.project-sel \{[^}]*min-width:/.test(b)),
    '竖屏沿用内容自适应但保最小占位防塌缩',
  );
});

/* ---------- T13 i18n 词条 ---------- */

t('T13 i18n：新增占位词条双语齐备（静态 + 动态）', () => {
  const { EN, EN_DYNAMIC } = globalThis.ATBI18N._dict;
  for (const k of ['加载项目中…', '正在加载项目列表…', '加载失败，点此重试', '项目列表加载失败，点击本选择器重试']) {
    assert.ok(EN[k], `静态词条缺 EN：${k}`);
    assert.ok(typeof EN[k] === 'string' && EN[k].length > 0);
  }
  assert.ok(EN_DYNAMIC['◇（加载中…）'], '动态词条缺 EN：◇（加载中…）');
  assert.ok(EN['暂无项目'], '空态词条沿用既有「暂无项目」');
});

/* ---------- T14 回归：常态切换链路 ---------- */

t('T14 回归：常态 change 直切 switchProject；营销未保存时仍走守卫', async () => {
  CTX = makeCtx();
  vm.runInContext('setProjectList(["/w/a", "/w/b"]); state.project = "/w/a"; renderProjectSel();', CTX);
  await vm.runInContext('onProjectSelChange({ target: { value: "/w/b" } });', CTX);
  assert.deepEqual(CTX.switchProjectCalls, ['/w/b'], '常态切换行为不变');

  CTX = makeCtx();
  vm.runInContext('setProjectList(["/w/a", "/w/b"]); state.project = "/w/a"; renderProjectSel();', CTX);
  vm.runInContext(
    'window.ATBMarketing = { hasUnsaved: () => true, guardProjectSwitch: (n, go) => { guarded.push(n); go(); } };',
    CTX,
    'guard-stub',
  );
  vm.runInContext('onProjectSelChange({ target: { value: "/w/b" } });', CTX);
  await tick();
  assert.deepEqual(CTX.guarded, ['/w/b'], '营销未保存守卫链路保持（REQ-20260910-019）');
});

/* ---------- 汇总 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}
if (failed) {
  console.error(`\n${failed}/${cases.length} 用例失败`);
  process.exit(1);
}
console.log(`\n全部通过：${cases.length} 用例`);
