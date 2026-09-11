#!/usr/bin/env node
// BUG-20260911-003 发布模块空态「＋ 新建发布」点击无反应（右上角正常）—— 行为 + 静态契约测试。
// 引入来源：REQ-20260910-029（发布模块前端首版在工具栏与空态卡重复输出 id="relNewBtn"，
//   bindCommon 用 view.querySelector('#relNewBtn') 只绑文档序首个——真实浏览器即工具栏按钮，
//   空态入口因此无监听；经 atb list 核验 REQ-20260910-029 真实存在。REQ-20260910-030 仅在
//   空态追加 Electron 指引文案，未触及入口渲染与绑定）。
// 与 release-ui.test.mjs 的接缝差异：本测试的模拟 DOM 按 innerHTML 内 id 出现顺序登记节点，
// querySelector 只返回文档序首个、querySelectorAll 返回全部——与真实浏览器语义一致，
// 从而复现「重复 id 只绑首个」的缺陷路径（旧接缝按选择器惰性建单点，掩盖了该缺陷）。
// 覆盖用例 T1–T5：
//   T1 空态两入口均渲染；点击空态入口打开右侧新建面板（缺陷复现点：修复前空态入口无监听）
//   T2 两入口等价：同一面板/默认 Git；关闭后可重开；切换筛选重渲染后空态入口仍有效；
//      单纯打开/关闭面板不产生任何 POST（无创建/预检/启动副作用）
//   T3 静态契约：id 唯一——工具栏保留 id="relNewBtn"（一次），空态入口独立 id="relEmptyNewBtn"，
//      bindCommon 对两个入口绑定同一打开动作，行内标注 BUG-20260911-003 溯源
//   T4 回归：有发布记录时不渲染空态卡，工具栏入口仍正常打开面板
//   T5 条目目录 ui-demo.html 离线自包含且提供缺陷/修复对比与状态切换
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const relSrc = fs.readFileSync(path.join(root, 'scripts', 'web', 'release.js'), 'utf8');
const itemDir = path.join(root, 'docs', 'agent-team-board', 'bugs', 'BUG-20260911-003');
const demoSrc = fs.readFileSync(path.join(itemDir, 'ui-demo.html'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- 忠实模拟 DOM：innerHTML 重建后按 id 出现顺序登记节点 ---------- */

function domNode() {
  return {
    listeners: {}, dataset: {}, value: '', checked: false, disabled: false, _html: '',
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    setAttribute() {}, removeAttribute() {},
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
  };
}

function makeView() {
  const nodes = new Map(); // '#id' -> 按文档序的节点数组
  return {
    nodes,
    _html: '',
    set innerHTML(html) {
      this._html = html;
      nodes.clear();
      for (const m of html.matchAll(/id="([^"]+)"/g)) {
        const sel = `#${m[1]}`;
        if (!nodes.has(sel)) nodes.set(sel, []);
        nodes.get(sel).push(domNode());
      }
    },
    get innerHTML() { return this._html; },
    querySelector(sel) { const a = nodes.get(sel); return a && a.length ? a[0] : null; }, // 文档序首个
    querySelectorAll(sel) { return nodes.has(sel) ? [...nodes.get(sel)] : []; },
    addEventListener() {},
  };
}

const GIT_RUN = {
  id: 'REL-20260911-091', target: 'git', status: 'succeeded', label: 'main',
  createdAt: '2026-09-11T00:00:00.000Z',
  config: { remote: 'origin', sourceBranch: 'main', targetBranch: 'main', tagName: null, checkCommand: 'npm test' },
  stages: [{ key: 'plan', label: '推送计划', status: 'done', result: { commits: [] } }],
  history: [],
};

function statePayload(runs, env = { git: { repo: true, remotes: ['origin'], currentBranch: 'main' }, apple: { ascConfigured: true }, electron: {} }) {
  return { initialized: true, runs, env };
}

function setup({ state } = {}) {
  const view = makeView();
  const document = { querySelector: () => view, addEventListener() {} };
  const calls = [];
  const sandbox = {
    document, console, URLSearchParams, CustomEvent: class {},
    setTimeout: () => 0, clearTimeout() {},
    fetch: async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      calls.push({ url: String(url), method, body: opts.body ? JSON.parse(opts.body) : null });
      const payload = typeof state === 'function' ? state() : (state || statePayload([]));
      return { ok: true, status: 200, json: async () => payload };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(relSrc, sandbox, { filename: 'release.js' });
  return { view, calls, ATBRelease: sandbox.ATBRelease };
}

/** 在渲染 HTML 的指定段（marker 起始）内定位「＋ 新建发布」按钮并取对应节点（段内文档序首个） */
function entryButton(view, marker) {
  const html = view.innerHTML;
  const at = html.indexOf(marker);
  assert.ok(at > -1, `渲染应包含 ${marker}`);
  const seg = html.slice(at);
  const m = seg.match(/<button[^>]*id="([^"]+)"[^>]*>＋ 新建发布<\/button>/);
  assert.ok(m, `${marker} 段内应有「＋ 新建发布」按钮`);
  const all = view.querySelectorAll(`#${m[1]}`);
  // 重复 id 时按文档序定位段内节点：空态段取最后一个，工具栏段取第一个
  const btn = marker === 'rel-empty' ? all[all.length - 1] : all[0];
  assert.ok(btn, '按钮应有对应节点');
  return btn;
}

/* ---------- 行为用例 ---------- */

t('T1 空态两入口均渲染；点击空态入口打开新建面板（修复前该入口无监听 → 跑红）', async () => {
  const h = setup({ state: statePayload([]) });
  await h.ATBRelease.enter('/p');
  const html = h.view.innerHTML;
  assert.ok(html.includes('release-toolbar'), '应渲染工具栏');
  assert.ok(html.includes('rel-empty'), '空态应渲染引导卡');
  assert.ok((html.match(/＋ 新建发布/g) || []).length >= 2, '空态下两处新建入口都在 DOM 中');

  const emptyBtn = entryButton(h.view, 'rel-empty');
  assert.ok(typeof emptyBtn.listeners.click === 'function',
    '空态入口应绑定 click（缺陷：与工具栏重复 id，querySelector 只绑文档序首个）');
  emptyBtn.listeners.click();
  assert.ok(h.view.innerHTML.includes('rel-panel'), '点击空态入口应打开右侧新建面板');
  assert.ok(h.view.querySelectorAll('#relNewClose').length === 1, '面板提供关闭按钮');
});

t('T2 两入口等价：同一面板默认 Git；可关闭重开；筛选重渲染后空态入口仍有效；打开/关闭无 POST 副作用', async () => {
  const h = setup({ state: statePayload([]) });
  await h.ATBRelease.enter('/p');

  // 工具栏入口 → 面板（默认 Git，保持既有默认，不随筛选联动）
  entryButton(h.view, 'release-toolbar').listeners.click();
  assert.ok(h.view.innerHTML.includes('rel-panel'), '工具栏入口打开面板');
  assert.ok(h.view.innerHTML.includes('relNewRemote'), '面板默认 Git 字段');
  h.view.querySelector('#relNewClose').listeners.click();
  assert.ok(!h.view.innerHTML.includes('rel-panel-mask'), '关闭后面板收起');

  // 空态入口重开同一面板
  entryButton(h.view, 'rel-empty').listeners.click();
  assert.ok(h.view.innerHTML.includes('rel-panel'), '空态入口重开面板');
  assert.equal((h.view.innerHTML.match(/class="rel-panel"/g) || []).length, 1, '一次点击只出现一个面板');
  h.view.querySelector('#relNewClose').listeners.click();

  // 切换筛选（目标类型）触发重渲染后，空态入口仍可打开
  const selT = h.view.querySelector('#relFilterTarget');
  selT.value = 'electron';
  selT.listeners.change();
  assert.ok(h.view.innerHTML.includes('rel-empty'), '筛选后空态仍在（无运行记录）');
  entryButton(h.view, 'rel-empty').listeners.click();
  assert.ok(h.view.innerHTML.includes('rel-panel'), '重渲染后空态入口有效');

  // 单纯打开/关闭面板不产生任何写请求（不创建记录、不预检、不启动）
  assert.equal(h.calls.filter((c) => c.method === 'POST').length, 0, '打开/关闭面板不得产生 POST 副作用');
});

/* ---------- 静态契约 ---------- */

t('T3 id 唯一 + 双入口绑定：工具栏 id="relNewBtn" 仅一次；空态入口 id="relEmptyNewBtn"；两 id 绑定同一打开动作并标注溯源', () => {
  assert.equal((relSrc.match(/id="relNewBtn"/g) || []).length, 1, '工具栏 id="relNewBtn" 应唯一（空态不得重复输出）');
  assert.equal((relSrc.match(/id="relEmptyNewBtn"/g) || []).length, 1, '空态入口应使用独立 id="relEmptyNewBtn"');
  // 空态按钮文案随独立 id 输出
  assert.match(relSrc, /id="relEmptyNewBtn"[^>]*>＋ 新建发布/);
  // bindCommon 对两个入口绑定同一打开动作；行内标注本单溯源
  const bind = relSrc.match(/function bindCommon\(view\)[\s\S]*?\n  \}/);
  assert.ok(bind, '应存在 bindCommon 函数');
  assert.match(bind[0], /q\('#relNewBtn'\)\?\.addEventListener\('click', openNewPanel\)/, '工具栏入口绑定');
  assert.match(bind[0], /q\('#relEmptyNewBtn'\)\?\.addEventListener\('click', openNewPanel\)/, '空态入口绑定（BUG-20260911-003）');
  assert.match(bind[0], /BUG-20260911-003/, '行内注释标注溯源');
});

t('T4 回归：有发布记录时不渲染空态卡，工具栏入口仍正常打开面板', async () => {
  const h = setup({ state: statePayload([GIT_RUN]) });
  await h.ATBRelease.enter('/p');
  assert.ok(!h.view.innerHTML.includes('rel-empty'), '非空态不渲染空态卡');
  const tb = entryButton(h.view, 'release-toolbar');
  assert.ok(typeof tb.listeners.click === 'function', '工具栏入口保持绑定');
  tb.listeners.click();
  assert.ok(h.view.innerHTML.includes('rel-panel'), '工具栏入口打开面板');
});

t('T5 ui-demo.html 离线自包含且覆盖缺陷/修复对比与状态切换', () => {
  const external = demoSrc.match(/(?:src|href)\s*=\s*["']https?:\/\//gi) || [];
  assert.equal(external.length, 0, `演示不应有外部资源引用：${external.join(', ')}`);
  for (const kw of ['缺陷现象', '期望修复', '＋ 新建发布', '加载中', '读取失败', '重试']) {
    assert.ok(demoSrc.includes(kw), `演示应包含「${kw}」`);
  }
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
