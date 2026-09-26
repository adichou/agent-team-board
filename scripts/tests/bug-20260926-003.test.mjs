#!/usr/bin/env node
// BUG-20260926-003 发布隔离分析将标题引用单号误判为混合归属，祖先提交统称依赖导致一键纳入受阻。
// 后端（B*）：/api/build/version/add-dependencies 归因改为证据链——（a）提交账本 →（b）主题归属
// 单号（括号外最后一个单号，正文引用不算）→（c）实际变更路径（单一条目目录兜底）；仅账本多单号
// 或变更同时触及多个条目目录才判混合提交，标题引用型不再误判；无法归属仍跳过不静默。
// 前端（F*）：合并页隔离分析不再把未选祖先统称「依赖」（汇总 / 明细 / 按钮 / 跳过清单 / toast）。
// 静态（S*）：i18n 中英词典随文案同步（BUG-20260912-001 口径）；subjectAttributionItemId 单元用例。
// 用法：node scripts/tests/bug-20260926-003.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as gitFlow from '../lib/git-flow.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return r.stdout.trim();
}

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 10000,
    }, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString() || '{}'); } catch {}
        resolve({ status: rs.statusCode, json, text: buf.toString() });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ================= 后端：add-dependencies 归因证据链 ================= */

// 场景仓库脚手架（同 req-20260921-015 口径）：main(init) → dev；prepare(ctx) 自定条目 / 提交 / 账本。
async function setupServer(prepare) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug20260926-003-')));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  git(proj, ['init', '-b', 'main']);
  git(proj, ['config', 'user.email', 't@e.co']);
  git(proj, ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base\n');
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-m', 'init']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  git(proj, ['switch', 'dev']);
  let ledgerSeq = 0;
  const ctx = {
    proj, dataDir,
    mkItem: (type, title) => core.createItem(dataDir, { type, title, by: 'test' }),
    markDone: (id) => { for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, id, s, { by: 'test' }); },
    commit: (file, subject) => {
      fs.writeFileSync(path.join(proj, file), `${subject}\n`);
      git(proj, ['add', '-A']);
      git(proj, ['commit', '-m', subject]);
      return git(proj, ['rev-parse', 'HEAD']);
    },
    // 提交落在指定相对路径（如条目目录内文档），模拟 doc 组收口提交 / 讨论文档提交
    commitPaths: (files, subject) => {
      for (const f of files) {
        const full = path.join(proj, f);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, `${subject}\n`);
      }
      git(proj, ['add', '-A']);
      git(proj, ['commit', '-m', subject]);
      return git(proj, ['rev-parse', 'HEAD']);
    },
    // 建条目后把挂起的看板数据（条目目录基线）单独提交，避免混入后续场景提交污染变更路径证据
    boardBaseline: () => ctx.commitPaths([], 'chore: 看板条目基线'),
    // 只提交指定路径（git add 定向）：工作区其余脏改动（如后建条目目录）不卷入场景提交
    commitOnly: (files, subject) => {
      for (const f of files) {
        const full = path.join(proj, f);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, `${subject}\n`);
      }
      git(proj, ['add', '--', ...files]);
      git(proj, ['commit', '-m', subject]);
      return git(proj, ['rev-parse', 'HEAD']);
    },
    // 账本登记（committedItemIndex 数据源：<dataDir>/runtime/commits/runs/<runId>/run.json）
    recordLedger: (itemId, hash) => {
      const runId = `run-ledger-${++ledgerSeq}`;
      const dir = path.join(dataDir, 'runtime', 'commits', 'runs', runId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
        version: 1, runId, itemId, phase: 'committed', batchId: 'batch-test',
        createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        commits: [{ hash, subject: `test: ${itemId}` }],
      }));
    },
    createVersion: (items, name = '测试版本') => buildStore.createVersion(dataDir, { name, items }),
  };
  const ids = prepare ? (await prepare(ctx)) : {};
  const reg = path.join(tmp, 'reg.json');
  const spawnOnPort = async (port) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: proj,
      env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try {
        const hh = await req(port, 'GET', '/api/health');
        if (hh.json && hh.json.port === port) return child;
      } catch {}
      if (child.exitCode !== null) break;
    }
    child.kill('SIGTERM');
    return null;
  };
  let server = null;
  let port = 0;
  for (let i = 0; i < 6 && !server; i++) {
    port = 34000 + Math.floor(Math.random() * 16000);
    server = await spawnOnPort(port);
  }
  assert.ok(server, `服务应启动（最后端口 ${port}）`);
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    try { await req(port, 'GET', '/api/health'); break; } catch {}
  }
  return {
    port, dataDir, proj, ...ids,
    P: `?project=${encodeURIComponent(proj)}`,
    close: async () => { server.kill('SIGTERM'); await sleep(200); },
  };
}

// REQ-20260926-002：条目与提交多对多组版、共享提交按 hash 去重只执行一次——
// 「一键加入所有依赖提交」引导整体下线（不将未选祖先认定为必须加入的功能依赖），
// POST /api/build/version/add-dependencies 端点不再注册（未知接口统一 404）。
// 原 B1~B5 归因证据链端点用例随端点下线移除；归因辅助函数口径由 U1 承接。
t('B1 add-dependencies 端点已随 REQ-20260926-002 下线：请求返回 404（未知接口）', async () => {
  const h = await setupServer(async (c) => {
    const SEL = c.mkItem('requirement', '所选C');
    c.markDone(SEL.id);
    c.boardBaseline();
    const cSel = c.commit('sel.txt', `feat: 所选 ${SEL.id}`);
    return { SEL, cSel };
  });
  try {
    const created = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.SEL.id, commit: h.cSel }] });
    assert.equal(created.status, 201, `创建版本应成功：${created.text}`);
    const r = await req(h.port, 'POST', `/api/build/version/add-dependencies${h.P}`, { id: created.json.version.id });
    assert.equal(r.status, 404, `一键加入端点应已下线（404）：${r.text}`);
    assert.match(r.json.error || '', /未知接口/, '错误说明为未知接口');
    // 版本范围不受影响（未发生一键纳入）
    const version = (await req(h.port, 'GET', `/api/build/state${h.P}`)).json.versions.find((x) => x.id === created.json.version.id);
    assert.equal(version.items.length, 1, '版本只含所选条目（未选祖先不自动纳入）');
  } finally {
    await h.close();
  }
});

/* ================= 单元：主题归属单号提取 ================= */

t('U1 subjectAttributionItemId：括号外最后一个单号为归属候选，正文 / 括号内引用不算', () => {
  assert.equal(gitFlow.subjectAttributionItemId('doc: 讨论REQ-20260921-012「泛化」（正文引用 REQ-20260921-010）'), 'REQ-20260921-012', '81bec844 型：括号内引用不算');
  assert.equal(gitFlow.subjectAttributionItemId('fix: BUG-20260920-006 的问题还是没有修复 BUG-20260921-003'), 'BUG-20260921-003', '176c37c2 型：末尾归属优先于开头引用');
  assert.equal(gitFlow.subjectAttributionItemId('fix: 一键加入按钮防重复触发 REQ-20260921-015（关联 BUG-20260920-006）'), 'REQ-20260921-015', '括号补充说明前的单号为归属');
  assert.equal(gitFlow.subjectAttributionItemId('feat: 所选需求 REQ-20260921-001'), 'REQ-20260921-001', '规范主题末尾单号');
  assert.equal(gitFlow.subjectAttributionItemId('chore: 无单号提交'), null, '无单号返回 null');
  assert.equal(gitFlow.subjectAttributionItemId(''), null, '空主题返回 null');
  assert.equal(gitFlow.subjectAttributionItemId('doc: 括号在后（引用 REQ-20260921-009）'), null, '括号内单号被剥除后无归属候选');
});

/* ================= 前端：合并页不再统称「依赖」 ================= */

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false, open: false,
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
const H2 = 'b'.repeat(40);

function ver(id, name, status = 'draft', extra = {}) {
  return {
    id, name, description: `描述 ${name}`, status, targetBranch: 'main', pushed: false,
    items: [{ itemId: 'REQ-20260921-013', commit: H1, title: '演示需求', mergedAt: null, mergeError: null }],
    createdAt: '2026-09-26T01:00:00.000Z', updatedAt: '2026-09-26T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
    ...extra,
  };
}

function plan({ currentBranch = 'dev', docsHash = null, perItem = null } = {}) {
  return {
    currentBranch, mainBranch: 'main',
    steps: [
      { key: 'plan', label: '选择条目与提交', locked: false, reason: '' },
      { key: 'merge', label: '挑选合并', locked: false, reason: '' },
      { key: 'docs', label: '文档与翻译', locked: false, reason: '' },
      { key: 'docmerge', label: '文档合并', locked: false, reason: '' },
      { key: 'release', label: '发布', locked: false, reason: '' },
    ],
    docs: { files: [], overall: docsHash ? 'committed' : 'none', commitHash: docsHash, reasons: [] },
    mergeAnalysis: { perItem: perItem || [], shared: [], notes: [] },
  };
}

const DEP_PER_ITEM = [
  { itemId: 'REQ-20260921-013', commit: H1, count: 2, intermediates: [
    { hash: '9ab3cdef'.padEnd(40, '0'), subject: 'feat: 优化 REQ-20260920-018', date: '2026-09-25T10:00:00+08:00' },
    { hash: 'c45d9911'.padEnd(40, '0'), subject: 'dev: 修复 BUG-20260920-017', date: '2026-09-25T11:00:00+08:00' },
  ] },
];

function setup({ versions, plans = {}, addDeps = null } = {}) {
  const state = { initialized: true, isRepo: true, currentBranch: 'dev', versions };
  const calls = { addDeps: [], state: 0, plan: 0 };
  const toasts = [];
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const planOf = (id) => (typeof plans === 'function' ? plans(id, calls.plan) : plans[id] || plan());
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    toast: () => {},
    fetch: async (url, opts) => {
      const up = new URL(String(url), 'http://local');
      if (up.pathname === '/api/build/state') { calls.state++; return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) }; }
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (up.pathname === '/api/build/publish-plan') { calls.plan++; return { ok: true, json: async () => JSON.parse(JSON.stringify(planOf(up.searchParams.get('id')))) }; }
      if (up.pathname === '/api/build/version/add-dependencies') {
        calls.addDeps.push(JSON.parse(String(opts?.body || '{}')));
        const r = typeof addDeps === 'function' ? addDeps(calls.addDeps.length) : addDeps;
        return { ok: !(r && r.__error), status: r && r.__error ? 409 : 200, json: async () => (r && r.__error ? { error: r.error } : JSON.parse(JSON.stringify(r || { version: null, added: [], skipped: [] }))) };
      }
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  sandbox.toast = (m, isErr) => toasts.push([m, !!isErr]);
  const tick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    sandbox, state, calls, toasts,
    run: (code) => vm.runInContext(code, sandbox),
    inner: () => vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox),
    enter: async () => { await vm.runInContext(`window.ATBBuild.enter('/p/a')`, sandbox); },
    tick,
    detailAt: async (id, step = 'merge') => {
      vm.runInContext(`window.ATBBuild.selectVersion(${JSON.stringify(id)})`, sandbox);
      vm.runInContext(`window.ATBBuild.setStep(${JSON.stringify(step)})`, sandbox);
      await tick();
    },
  };
}

function mergePaneHtml(inner) {
  const i = inner.indexOf('bld-merge-pane');
  assert.ok(i >= 0, '应渲染合并步面板');
  return inner.slice(i, i + 12000);
}

t('F1 隔离分析不再把未选祖先统称「依赖」：汇总 / 按钮 / 明细 / 归属标注全部改为未选祖先措辞', async () => {
  const h = setup({ versions: [ver('BLD-ANC', '祖先措辞')], plans: { 'BLD-ANC': plan({ docsHash: H2, perItem: DEP_PER_ITEM }) } });
  await h.enter();
  await h.detailAt('BLD-ANC', 'merge');
  const pane = mergePaneHtml(h.inner());
  assert.match(pane, /发现 2 个未选祖先提交 · 影响 1 个所选条目/, '汇总行不统称「依赖」');
  assert.ok(!pane.includes('未选祖先（依赖）'), '不再出现「未选祖先（依赖）」旧措辞');
  // REQ-20260926-002：一键纳入引导随流程简化下线（未选祖先明细降级为只读参考）
  assert.ok(!pane.includes('一键加入所有未选祖先提交') && !pane.includes('data-iso-add-deps'), '一键加入按钮与行为标记移除');
  assert.match(pane, /查看未选祖先明细/, '未选祖先明细折叠保留（只读参考）');
  assert.match(pane, /为 REQ-20260921-013 的未选祖先/, '归属标注保持未选祖先措辞');
  assert.ok(!pane.includes('的依赖'), '明细不以「依赖」标注归属');
  assert.ok(!pane.includes('所选提交无未选祖先：变更可独立进入主分支。'), '有未选祖先时不渲染空态');
});

t('F2 一键加入交互已移除：合并页无一键加入入口与行为标记（REQ-20260926-002 端点下线的界面配套）', async () => {
  const h = setup({ versions: [ver('BLD-FB', '反馈')], plans: { 'BLD-FB': plan({ docsHash: H2, perItem: DEP_PER_ITEM }) } });
  await h.enter();
  await h.detailAt('BLD-FB', 'merge');
  const pane = mergePaneHtml(h.inner());
  assert.ok(!pane.includes('data-iso-add-deps'), '无一键加入行为标记');
  assert.ok(!pane.includes('一键加入'), '无一键加入文案入口');
  assert.ok(h.calls.addDeps.length === 0, '未发起 add-dependencies 请求');
  // 未选祖先明细保留为只读参考，不引导纳入
  assert.match(pane, /查看未选祖先明细/, '未选祖先明细折叠保留');
});

/* ================= 静态：i18n 词典中英同步 ================= */

t('S1 i18n 词条随措辞同步（REQ-20260926-002 修订）：未选祖先只读措辞词条保留，一键纳入与旧「依赖」词条移除', async () => {
  await import('../web/i18n.js');
  const { EN, EN_DYNAMIC } = globalThis.ATBI18N._dict;
  // 保留：隔离分析只读措辞（明细折叠入口 / 空态 / 汇总行 / 归属标注）
  for (const k of [
    '查看未选祖先明细',
    '所选提交无未选祖先：变更可独立进入主分支。',
    '正在加载合并分析…',
  ]) {
    assert.ok(k in EN, `EN 词典缺词条：${k}`);
  }
  for (const k of [
    '发现 ◇ 个未选祖先提交 · 影响 ◇ 个所选条目',
    '为 ◇ 的未选祖先',
    '共享提交 ◇ 处按提交 hash 去重，挑选合并只执行一次（各关联条目展示一致的合入结果）',
  ]) {
    assert.ok(k in EN_DYNAMIC, `EN_DYNAMIC 词典缺词条：${k}`);
  }
  // 移除：一键纳入按钮 / title / toast 词条（端点 404、前端无入口）
  for (const k of [
    '一键加入所有未选祖先提交',
    '加入中…',
    '正在执行一键加入，请稍候',
    '⚠ 未能加入任何未选祖先提交（原因见隔离分析清单）',
    '把未选祖先提交经归因核验后确属所选条目的条目与提交纳入本版本发布范围；加入后发布范围变化，文档需重新核对 / 提交',
    '⚠ 以下 ◇ 个未选祖先提交未能纳入：',
    '✓ 已加入 ◇ 个条目：发布范围已变化，文档需重新核对 / 提交',
    '✓ 已加入 ◇ 个条目，跳过 ◇ 个（原因见隔离分析清单）',
    '✓ 已加入 ◇ 个条目、补入 ◇ 个未选祖先提交，跳过 ◇ 个（原因见隔离分析清单）',
    '✓ 已加入 ◇ 个条目、补入 ◇ 个未选祖先提交：发布范围已变化，文档需重新核对 / 提交',
    '✓ 已补入 ◇ 个未选祖先提交，跳过 ◇ 个（原因见隔离分析清单）',
    '✓ 已补入 ◇ 个未选祖先提交：发布范围已变化，文档需重新核对 / 提交',
    '✕ 一键加入失败：◇',
  ]) {
    assert.ok(!(k in EN) && !(k in EN_DYNAMIC), `一键纳入词条应随下线移除：${k}`);
  }
  // 旧「依赖」措辞词条保持移除（BUG-20260926-003 口径不回退）
  for (const k of [
    '一键加入所有依赖提交',
    '查看依赖明细',
    '⚠ 未能加入任何依赖提交（原因见隔离分析清单）',
    '发现 ◇ 个未选祖先（依赖）提交 · 影响 ◇ 个所选条目',
    '为 ◇ 的依赖',
    '⚠ 以下 ◇ 个依赖未能纳入：',
  ]) {
    assert.ok(!(k in EN) && !(k in EN_DYNAMIC), `旧「依赖」词条应移除：${k}`);
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
