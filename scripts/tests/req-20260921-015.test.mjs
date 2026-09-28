#!/usr/bin/env node
// REQ-20260921-015 「合并入 main」页：去掉隔离分析红色长文 + 一键加入所有依赖提交。
// 后端（B*）：POST /api/build/version/add-dependencies —— 服务端现算隔离分析、按
// itemCommitStatusIndex 反查归属、沿用 addItems 校验与 scopeStale 联动；跳过项有清单不静默。
// 前端（F*）：合并页简洁隔离分析（一行汇总 + 明细 details + 单行状态条）与一键加入交互。
// 静态（S*）：renderMergePane 不再输出红色长文（仅读取失败态保留）；mergeBlockReason 增补
// blocked 档；i18n 新词条中英同步。
// 用法：node scripts/tests/req-20260921-015.test.mjs

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

/* ================= 后端：POST /api/build/version/add-dependencies ================= */

// 场景仓库脚手架：main(init) → dev 分支；prepare(ctx) 在服务启动前自定条目 / 提交 / 数据层版本。
async function setupServer(prepare) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req20260921-015-')));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  git(proj, ['init', '-b', 'main']);
  git(proj, ['config', 'user.email', 't@e.co']);
  git(proj, ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base\n');
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-m', 'init']);
  core.initData(proj); // 内部 ensureDevWorkflow：按需创建 dev 并切到 dev
  const dataDir = core.dataDirFrom(proj);
  git(proj, ['switch', 'dev']);
  const ctx = {
    proj, dataDir,
    mkItem: (type, title) => core.createItem(dataDir, { type, title, by: 'test' }),
    markDone: (id) => { for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, id, s, { by: 'test' }); },
    commit: (file, subject) => {
      fs.writeFileSync(path.join(proj, file), `${subject}\n`);
      // BUG-20260926-003：定向 add——只提交场景文件本身；条目目录（core.createItem 落盘）
      // 不提交、不卷入场景提交的变更路径证据（路径归属证据按真实 diff 判定）
      git(proj, ['add', '--', file]);
      git(proj, ['commit', '-m', subject]);
      return git(proj, ['rev-parse', 'HEAD']);
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

/* REQ-20260926-002：条目与提交多对多组版、共享提交按 hash 去重只执行一次——
// 「一键加入所有依赖提交」引导整体下线（不将未选祖先认定为必须加入的功能依赖），
// POST /api/build/version/add-dependencies 端点不再注册（未知接口统一 404）。
// 原 B1~B4 端点行为用例随端点下线移除；未选祖先在隔离分析中降级为只读明细（F 区用例）。 */
t('B1 add-dependencies 端点已随 REQ-20260926-002 下线：请求返回 404（未知接口），版本范围不变', async () => {
  const h = await setupServer((c) => {
    const A = c.mkItem('requirement', '未选需求A');
    const B = c.mkItem('requirement', '所选需求B');
    c.markDone(A.id);
    c.markDone(B.id);
    const cA = c.commit('a.txt', `feat: A ${A.id}`);
    const cB = c.commit('b.txt', `feat: B ${B.id}`);
    return { A, B, cA, cB };
  });
  try {
    const created = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.B.id, commit: h.cB }] });
    assert.equal(created.status, 201, `创建版本应成功：${created.text}`);
    const vid = created.json.version.id;
    // 前置：隔离分析仍如实给出未选祖先明细（只读参考，不再引导一键纳入）
    const plan = await req(h.port, 'GET', `/api/build/publish-plan${h.P}&id=${encodeURIComponent(vid)}`);
    assert.ok((plan.json.mergeAnalysis.perItem || []).some((x) => (x.intermediates || []).length >= 1), '前置：隔离分析含未选祖先明细');
    assert.equal(plan.json.mergeAnalysis.blocked, undefined, '混合提交阻断随流程移除');
    const r = await req(h.port, 'POST', `/api/build/version/add-dependencies${h.P}`, { id: vid });
    assert.equal(r.status, 404, `一键加入端点应已下线（404）：${r.text}`);
    assert.match(r.json.error || '', /未知接口/, '错误说明为未知接口');
    const version = (await req(h.port, 'GET', `/api/build/state${h.P}`)).json.versions.find((x) => x.id === vid);
    assert.equal(version.items.length, 1, '版本只含所选条目（未选祖先不自动纳入）');
  } finally {
    await h.close();
  }
});

/* ================= 前端：合并页简洁隔离分析 + 一键加入 ================= */

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
  const merged = status === 'merged';
  return {
    id, name, description: `描述 ${name}`, status, targetBranch: 'main', released: false,
    items: [{ itemId: 'REQ-20260921-013', commit: H1, title: '演示需求', mergedAt: merged ? '2026-09-21T03:00:00.000Z' : null, mergeError: status === 'failed' ? 'conflict' : null }],
    createdAt: '2026-09-21T01:00:00.000Z', updatedAt: '2026-09-21T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: status === 'failed' ? '模拟合并失败' : null, baseBranch: 'dev', ...(merged ? { mainSha: H2, replays: [] } : {}) },
    ...extra,
  };
}

function plan({ currentBranch = 'dev', docsHash = null, mergeLocked = false, reason = '', perItem = null, sharedList = null, notes = null } = {}) {
  return {
    currentBranch, mainBranch: 'main',
    steps: [
      { key: 'plan', label: '选择条目与提交', locked: false, reason: '' },
      { key: 'merge', label: '挑选合并', locked: mergeLocked, reason },
      { key: 'docs', label: '文档与翻译', locked: false, reason: '' },
      { key: 'docmerge', label: '文档合并', locked: false, reason: '' },
      { key: 'release', label: '发布', locked: false, reason: '' },
    ],
    docs: { files: [], overall: docsHash ? 'committed' : 'none', commitHash: docsHash, reasons: [] },
    mergeAnalysis: {
      perItem: perItem || [],
      shared: sharedList || [],
      notes: notes || (perItem && perItem.some((x) => (x.intermediates || []).length)
        ? ['所选提交存在 3 个未选祖先提交：普通 merge 会一并带入 main，隔离合并不带入；若所选改动依赖这些内容，执行时将冲突阻止并说明原因']
        : []),
    },
  };
}

const DEP_PER_ITEM = [
  { itemId: 'REQ-20260921-013', commit: H1, count: 2, intermediates: [
    { hash: '9ab3cdef'.padEnd(40, '0'), subject: 'feat: 优化 REQ-20260920-018', date: '2026-09-20T10:00:00+08:00' },
    { hash: 'c45d9911'.padEnd(40, '0'), subject: 'dev: 修复 BUG-20260920-017', date: '2026-09-20T11:00:00+08:00' },
  ] },
  { itemId: 'BUG-20260921-002', commit: H2, count: 1, intermediates: [
    { hash: '77d0e2ff'.padEnd(40, '0'), subject: 'docs: 发布文档 REQ-20260920-016', date: '2026-09-20T12:00:00+08:00' },
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

t('F1 有依赖（REQ-20260926-002 重排）：一行汇总 + 只读明细 details，无一键加入入口；红色长文与逐条目重复长句不再渲染', async () => {
  const h = setup({ versions: [ver('BLD-DEP', '有依赖')], plans: { 'BLD-DEP': plan({ docsHash: H2, perItem: DEP_PER_ITEM }) } });
  await h.enter();
  await h.detailAt('BLD-DEP', 'merge');
  const pane = mergePaneHtml(h.inner());
  // REQ-20260927-004：汇总行合并为一句完整文案（X 只统计源码祖先，Y 为受影响所选条目数）
  assert.match(pane, /发现 2 个所选条目的共 3 个未选祖先提交。/, '一行汇总（受影响条目数 + 提交数）');
  // REQ-20260926-002：未选祖先不认定为必须加入的功能依赖——一键加入入口整体移除
  assert.ok(!pane.includes('data-iso-add-deps') && !pane.includes('一键加入'), '一键加入按钮与行为标记移除');
  assert.match(pane, /查看未选祖先明细/, '明细折叠入口保留（只读参考）');
  assert.ok(pane.includes('9ab3cdef'), '明细含未选祖先提交短 hash');
  assert.match(pane, /为 REQ-20260921-013 的未选祖先/, '明细标注归属所选条目');
  // 红色长文移除：无 rel-form-err、无旧长句
  assert.ok(!pane.includes('rel-form-err'), '合并页不再输出红色 rel-form-err 长段');
  assert.ok(!pane.includes('普通 merge 会一并带入 main'), '逐条目重复长句不再渲染');
  assert.ok(!pane.includes('所选提交存在 3 个未选祖先提交'), 'notes 灰色长句不再渲染（汇总行替代）');
  // 主按钮与顺序保留
  assert.ok(pane.includes('data-ver-merge="BLD-DEP"'), '合并主按钮仍在');
  assert.ok(pane.indexOf('隔离分析') < pane.indexOf('当前分支 dev · 目标主分支 main'), '隔离分析先于分支提示');
});

t('F2 共享提交：单行说明按 hash 去重只执行一次（不再阻断）；点击主按钮仍有原因（不回退点击必反馈）', async () => {
  const shared = [{ commit: 'abc123'.padEnd(40, '0'), itemIds: ['REQ-20260921-010', 'REQ-20260921-011'] }];
  const h = setup({ versions: [ver('BLD-MIX', '共享提交')], plans: { 'BLD-MIX': plan({ docsHash: H2, sharedList: shared }) } });
  await h.enter();
  await h.detailAt('BLD-MIX', 'merge');
  const pane = mergePaneHtml(h.inner());
  assert.match(pane, /共享提交 1 处按提交 hash 去重，挑选合并只执行一次/, '共享提交单行说明（不阻断）');
  assert.ok(pane.includes('abc123'), 'title 含提交明细');
  assert.ok(pane.includes('REQ-20260921-010') && pane.includes('REQ-20260921-011'), 'title 含关联条目明细');
  assert.ok(!pane.includes('rel-form-err'), '不再输出红色长段');
  assert.ok(!pane.includes('混合提交') && !pane.includes('豁免'), '不再出现混合提交 / 豁免措辞（机制已移除）');
  // 点击必反馈：门禁锁定（本夹具 merge 未锁）→ 不 toast、确认弹窗照常打开
  h.run(`window.ATBBuild.openMergeConfirm('BLD-MIX')`);
  assert.ok(h.toasts.length === 0, `可合并版本点击主按钮不误报原因，实际：${JSON.stringify(h.toasts)}`);
});

t('F3 无依赖：保持简洁空态，无一键加入入口', async () => {
  const h = setup({ versions: [ver('BLD-CLEAN', '无依赖')], plans: { 'BLD-CLEAN': plan({ docsHash: H2 }) } });
  await h.enter();
  await h.detailAt('BLD-CLEAN', 'merge');
  const pane = mergePaneHtml(h.inner());
  assert.match(pane, /所选提交无未选祖先：变更可独立进入主分支。/, '简洁空态保留');
  assert.ok(!pane.includes('data-iso-add-deps'), '无一键加入行为标记');
  assert.ok(!pane.includes('查看依赖明细'), '无依赖不渲染明细入口');
});

t('F4 阻止性信息单行化：门禁锁定 / 不在 dev / 合并失败均非红色长文且文本保留（BUG-20260921-014 契约不破）', async () => {
  const h = setup({
    versions: [ver('BLD-GATE', '门禁'), ver('BLD-BR', '不在dev', 'draft'), ver('BLD-FAIL', '失败', 'failed'), ver('BLD-OK', '已合并', 'merged')],
    plans: {
      'BLD-GATE': plan({ mergeLocked: true, reason: '暂无关联条目：请先在「关联条目与提交」步骤关联' }),
      'BLD-BR': plan({ currentBranch: 'feature-x' }),
      'BLD-FAIL': plan(),
      'BLD-OK': plan({ docsHash: H2 }),
    },
  });
  await h.enter();
  await h.detailAt('BLD-GATE', 'merge');
  let pane = mergePaneHtml(h.inner());
  assert.match(pane, /⚠ 暂不可合并：暂无关联条目：请先在「关联条目与提交」步骤关联/, '门禁原因文本保留');
  assert.ok(!pane.includes('rel-form-err'), '门禁行不再是红色 rel-form-err');
  await h.detailAt('BLD-BR', 'merge');
  pane = mergePaneHtml(h.inner());
  assert.match(pane, /当前分支是 feature-x，不在 dev：请自行切换回 dev 后重试/, '不在 dev 文本保留');
  assert.ok(!pane.includes('rel-form-err'), '不在 dev 行不再是红色 rel-form-err');
  await h.detailAt('BLD-FAIL', 'merge');
  pane = mergePaneHtml(h.inner());
  assert.match(pane, /⚠ 合并失败：模拟合并失败（可重试，只补未合并条目）/, '合并失败文本保留');
  assert.match(pane, /重试挑选合并/, '重试主按钮保留');
  assert.ok(!pane.includes('rel-form-err'), '失败行不再是红色 rel-form-err');
  await h.detailAt('BLD-OK', 'merge');
  pane = mergePaneHtml(h.inner());
  assert.match(pane, /合并完成：主分支头/, '合并完成结果保留');
});

t('F5 一键加入交互已移除：合并页不再发起 add-dependencies 请求（REQ-20260926-002）', async () => {
  const h = setup({
    versions: [ver('BLD-ACT', '交互')],
    plans: { 'BLD-ACT': plan({ docsHash: H2, perItem: DEP_PER_ITEM }) },
  });
  await h.enter();
  await h.detailAt('BLD-ACT', 'merge');
  assert.equal(h.calls.addDeps.length, 0, '合并页不再发起一键加入请求');
  // 界面无入口也无行为接缝：addDependencies 不再导出
  assert.equal(h.run('typeof window.ATBBuild.addDependencies'), 'undefined', 'addDependencies 行为接缝已移除');
  const pane = mergePaneHtml(h.inner());
  assert.ok(!pane.includes('data-iso-add-deps'), '无一键加入行为标记');
  assert.match(pane, /发现 2 个所选条目的共 3 个未选祖先提交。/, '未选祖先明细仍如实展示（只读；REQ-20260927-004 汇总句）');
});

t('F6 合并主按钮锁定态沿用：merging / 已正式发布 aria-disabled + title 真实原因（一键加入锁定态词条随入口移除）', async () => {
  const h = setup({
    versions: [
      ver('BLD-MRG', '合并中', 'merging'),
      ver('BLD-PUSH', '已推送', 'merged', { released: true, release: { pushedAt: '2026-09-21T09:00:00.000Z', pushRemote: 'origin', pushedSha: H2, site: { status: 'waiting' } } }),
    ],
    plans: { 'BLD-MRG': plan({ perItem: DEP_PER_ITEM }), 'BLD-PUSH': plan({ perItem: DEP_PER_ITEM }) },
  });
  await h.enter();
  await h.detailAt('BLD-MRG', 'merge');
  let pane = mergePaneHtml(h.inner());
  assert.match(pane, /data-ver-merge="BLD-MRG"[^>]*aria-disabled="true" title="合并中，请勿重复触发"/, 'merging 态合并主按钮禁用并说明');
  await h.detailAt('BLD-PUSH', 'merge');
  pane = mergePaneHtml(h.inner());
  assert.match(pane, /data-ver-merge="BLD-PUSH"[^>]*aria-disabled="true" title="已正式发布，不可再合并（如需调整请新建版本）"/, '已正式发布态合并主按钮禁用并说明');
  assert.ok(!pane.includes('合并中，条目不可增删'), '一键加入锁定 title 词条随入口移除');
});

t('S1 静态契约（REQ-20260926-002 修订）：renderMergePane 仅读取失败态保留 rel-form-err；混合阻断 / 一键加入源码清理；i18n 中英同步', async () => {
  const mergePane = buildJs.match(/function renderMergePane\(v\) \{[\s\S]*?\n  \}/);
  assert.ok(mergePane, '缺少 renderMergePane');
  assert.equal((mergePane[0].match(/rel-form-err/g) || []).length, 1, 'rel-form-err 仅保留读取失败态一处');
  assert.ok(!mergePane[0].includes('普通 merge 会一并带入 main'), '源码不再含逐条目重复长句');
  assert.ok(!mergePane[0].includes('blocked') && !mergePane[0].includes('exempted'), '混合阻断 / 豁免渲染随流程移除');
  assert.ok(!mergePane[0].includes('data-iso-add-deps'), '一键加入行为标记随流程移除');
  assert.ok(mergePane[0].includes('an.shared'), '共享提交说明保留（按 hash 去重只执行一次）');
  const reasonFn = buildJs.match(/function mergeBlockReason\(v\) \{[\s\S]*?\n  \}/);
  assert.ok(reasonFn, '缺少 mergeBlockReason');
  assert.ok(!reasonFn[0].includes('blocked'), 'mergeBlockReason 的 blocked 档随混合阻断移除');
  // i18n：隔离分析只读措辞词条保留、一键纳入与混合阻断词条移除（BUG-20260912-001 口径）
  await import('../web/i18n.js');
  const { EN, EN_DYNAMIC } = globalThis.ATBI18N._dict;
  for (const k of ['查看未选祖先明细', '所选提交无未选祖先：变更可独立进入主分支。']) {
    assert.ok(k in EN, `EN 词典缺词条：${k}`);
  }
  for (const k of [
    '发现 ◇ 个所选条目的共 ◇ 个未选祖先提交。未选的祖先提交不随隔离合并进入 main；若所选改动依赖其内容，执行时将冲突阻止并说明原因。',
    '共享提交 ◇ 处按提交 hash 去重，挑选合并只执行一次（各关联条目展示一致的合入结果）',
    '⚠ 暂不可合并：◇',
    '⚠ 合并失败：◇（可重试，只补未合并条目）',
    '为 ◇ 的未选祖先',
  ]) {
    assert.ok(k in EN_DYNAMIC, `EN_DYNAMIC 词典缺词条：${k}`);
  }
  for (const k of [
    '一键加入所有未选祖先提交',
    '⚠ ◇ 处混合提交无法安全拆分，合并将被阻止',
    '已豁免 ◇ 处共享提交的混合判定（提交已在 ◇ 上，合并时幂等记成功）',
    '⚠ 以下 ◇ 个未选祖先提交未能纳入：',
    '✕ 一键加入失败：◇',
  ]) {
    assert.ok(!(k in EN) && !(k in EN_DYNAMIC), `一键纳入 / 混合阻断词条应移除：${k}`);
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
