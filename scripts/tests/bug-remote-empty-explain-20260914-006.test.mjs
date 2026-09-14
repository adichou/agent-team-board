#!/usr/bin/env node
// BUG-20260914-006 分支浏览「无远端分支」空态缺解释：远端仓库为空与本地未同步不可区分。
// B1–B2：build-git listBranches 返回已配置远端名 remotes（真实临时 git 仓库，本地读非网络）；
// U1–U5：build.js 远端分组空态三分支（未配置远端 / 已配置未同步 / 同步成功后仍为空）与
// 推送按钮 attn 高亮、正常远端分支不出现提示（vm 行为，载荷注入 + fetch 应答控制）。
// 用法：node scripts/tests/bug-remote-empty-explain-20260914-006.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as buildGit from '../lib/build-git.mjs';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function git(root, args, opts = {}) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (!opts.canFail && r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-remote-empty-')));
}

/* ---------- B1–B2：数据层 remotes 字段（本地读，非网络） ---------- */

t('B1 listBranches 返回已配置远端名：git remote add 后 remotes 含该名；既有字段口径不变', () => {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'a.md'), 'a\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: base']);
  git(root, ['remote', 'add', 'origin', 'https://example.com/x/y.git']);
  git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']); // 模拟远端跟踪引用（等同 fetch 结果）

  const r = buildGit.listBranches(root);
  assert.equal(r.isRepo, true);
  assert.equal(r.current, 'main');
  assert.deepEqual(r.local, ['main']);
  assert.deepEqual(r.remote, ['origin/main'], '远端跟踪分支口径不变（branch -r，排除 */HEAD）');
  assert.deepEqual(r.remotes, ['origin'], '应返回已配置远端名列表');
});

t('B2 未配置远端 / 非 git 仓库：remotes 为空数组（不误报远端仓库为空）', () => {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'a.md'), 'a\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: base']);
  assert.deepEqual(buildGit.listBranches(root).remotes, [], '未配置远端：remotes=[]');
  const nonRepo = mkTmp();
  const r2 = buildGit.listBranches(nonRepo);
  assert.equal(r2.isRepo, false);
  assert.deepEqual(r2.remotes, [], '非 git 仓库分支形状补 remotes=[]');
});

/* ---------- U1–U5：前端空态三分支（vm） ---------- */

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

function statePayload(over = {}) {
  return { initialized: true, isRepo: true, currentBranch: 'dev', versions: [], ...over };
}

function setup({ branches, state = statePayload(), fetchResult } = {}) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const toasts = [];
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    toast: (m, isErr) => toasts.push([m, isErr]),
    fetch: async (url) => {
      const up = new URL(String(url), 'http://local');
      if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) };
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(branches)) };
      if (up.pathname === '/api/build/fetch') return fetchResult ? fetchResult() : { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return { sandbox, toasts, document, run: (code) => vm.runInContext(code, sandbox) };
}

async function openBranches(h) {
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('branches')`);
  await new Promise((r) => setTimeout(r, 10));
  return h.document.nodes.get('#buildView');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

t('U1 已配置远端 + 未同步（初始空态）：解释「本地无远端跟踪分支」并引导「和远端同步」，同时说明同步后仍空=远端为空、可推送', async () => {
  const h = setup({ branches: { isRepo: true, current: 'dev', local: ['dev', 'main'], remote: [], remotes: ['origin'] } });
  const view = await openBranches(h);
  const inner = view.innerHTML;
  assert.match(inner, /本地无远端跟踪分支/, '初始空态应解释成因（本地无跟踪引用）');
  assert.match(inner, /和远端同步/, '应引导先同步（与按钮名一致）');
  assert.match(inner, /远端仓库尚无任何分支（从未推送）/, '应说明同步后仍为空的含义（远端为空）');
  assert.match(inner, /推送/, '应说明推送出路');
  assert.doesNotMatch(inner, /bld-remote-hint/, '未同步时不得断言「远端仓库为空」（确定性解释块仅同步后出现）');
  assert.doesNotMatch(inner, /attn/, '未同步时不做推送高亮');
});

t('U2 已配置远端 + 同步成功后仍为空：解释块断言「远端仓库尚无任何分支（从未推送）」并说明未推送成因；推送按钮 attn 高亮', async () => {
  // BUG-20260914-011 后同步含推送——「推送成功 ⇒ 远端必非空」，仍空场景走「无可推分支」
  // 细分解释（本地仅 main 时 main 由发布模块管理，不在此推送）。
  // BUG-20260914-012 起 main 行不再渲染推送按钮——attn 高亮断言基于非 main 开发分支（feat）
  const h = setup({
    branches: { isRepo: true, current: 'dev', local: ['dev', 'feat', 'main'], remote: [], remotes: ['origin'] },
    fetchResult: () => ({ ok: true, json: async () => ({ ok: true, remote: 'origin', pushed: [], failed: [], skipped: ['main'] }) }),
  });
  const view = await openBranches(h);
  const btn = view.nodes.get('#bldFetchBtn');
  assert.ok(btn?.listeners?.click, '#bldFetchBtn 应绑定 click（doSync）');
  btn.listeners.click();
  await sleep(30);
  const inner = view.innerHTML;
  assert.match(inner, /远端仓库尚无任何分支（从未推送）。/, '同步成功后仍为空应断言远端仓库为空');
  assert.match(inner, /刚才的同步已成功/, '应说明未推送成因（main 口径）');
  assert.match(inner, /bld-remote-hint/, '解释块应有稳定样式钩子');
  assert.match(inner, /role="note"/, '解释块 role=note');
  assert.match(inner, /bld-push attn/, '本地分支「推送」按钮应高亮为出路');
  assert.doesNotMatch(inner, /（无远端分支：先「和远端同步」或推送本地分支）/, '旧笼统文案不得残留（本场景被新解释取代）');
});

t('U3 未配置远端（git remote 为空）：保持既有空态文案，不出现「远端仓库为空（从未推送）」类误导断言', async () => {
  const h = setup({ branches: { isRepo: true, current: 'dev', local: ['dev'], remote: [], remotes: [] } });
  const view = await openBranches(h);
  const inner = view.innerHTML;
  assert.match(inner, /（无远端分支：先「和远端同步」或推送本地分支）/, '未配置远端既有空态不受影响（README 验收 4 / 范围外）');
  assert.doesNotMatch(inner, /远端仓库尚无任何分支/, '不得断言远端仓库为空');
  assert.doesNotMatch(inner, /本地无远端跟踪分支：尚未与远端同步/, '未配置远端不引导同步拉取');
});

t('U4 远端有分支（正常已同步）：正常列 origin/*，不出现空态解释与推送高亮', async () => {
  const h = setup({ branches: { isRepo: true, current: 'dev', local: ['dev', 'main'], remote: ['origin/dev'], remotes: ['origin'] } });
  const view = await openBranches(h);
  const inner = view.innerHTML;
  assert.match(inner, /data-branch="origin\/dev"/, '远端分支正常渲染');
  assert.doesNotMatch(inner, /远端仓库尚无任何分支/, '有远端分支不得出现「远端为空」解释');
  assert.doesNotMatch(inner, /本地无远端跟踪分支/, '有远端分支不得出现空态解释');
  assert.doesNotMatch(inner, /attn/, '不得出现推送高亮');
});

t('U5 同步成功后远端出现分支（本地未同步场景）：空态解释消失，分支正常列出', async () => {
  const emptyBranches = { isRepo: true, current: 'dev', local: ['dev', 'main'], remote: [], remotes: ['origin'] };
  const synced = { ...emptyBranches, remote: ['origin/dev', 'origin/main'] };
  let branches = emptyBranches;
  const h = setup({ branches, fetchResult: () => ({ ok: true, json: async () => ({}) }) });
  h.sandbox.fetch = async (url) => {
    const up = new URL(String(url), 'http://local');
    if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(branches)) };
    if (up.pathname === '/api/build/fetch') return { ok: true, json: async () => ({ ok: true, remote: 'origin', pushed: [{ branch: 'dev', remoteBranch: 'origin/dev', setUpstream: true }], failed: [], skipped: ['main'] }) };
    if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(statePayload())) };
    if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
    return { ok: true, json: async () => ({}) };
  };
  const view = await openBranches(h);
  assert.match(view.innerHTML, /本地无远端跟踪分支/, '前置：初始为未同步空态');
  branches = synced; // 同步成功后远端跟踪分支出现
  view.nodes.get('#bldFetchBtn').listeners.click();
  await sleep(30);
  const inner = view.innerHTML;
  assert.match(inner, /data-branch="origin\/dev"/, '同步后远端分支出现');
  assert.doesNotMatch(inner, /本地无远端跟踪分支|远端仓库尚无任何分支/, '任一空态解释不得残留');
  assert.doesNotMatch(inner, /attn/, '不得残留推送高亮');
});

/* ---------- W1：i18n 词典收录新文案 ---------- */

t('W1 词典收录新空态文案（文本节点全文为键），中英往返，旧笼统文案词条不新增', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN } = I._dict;
  assert.equal(EN['本地无远端跟踪分支：尚未与远端同步，可点上方「⟳ 和远端同步」拉取；若同步后仍为空，说明远端仓库尚无任何分支（从未推送），可在上方「本地」分组推送分支。'],
    'No remote-tracking branches yet: the list is not synced with the remote — click "⟳ Sync with remote" above to fetch; if it is still empty after syncing, the remote repository has no branches (never pushed), and you can push branches in the "Local" group above.',
    '初始空态整句应有词条（BUG-20260914-011 后含推送口径）');
  assert.equal(EN['远端仓库尚无任何分支（从未推送）。'], 'The remote repository has no branches yet (never pushed).', '解释块标题应有词条');
  assert.equal(EN['刚才的同步已成功——列表仍为空说明远端仓库本身就是空的。可在上方「本地」分组对分支点「推送」，首推将建立上游跟踪。'],
    'The sync just succeeded — an empty list means the remote repository itself is empty. Click "Push" on a branch in the "Local" group above; the first push will set up upstream tracking.',
    '解释块说明应有词条');
  I.setLang('en');
  assert.equal(I.t('远端仓库尚无任何分支（从未推送）。'), 'The remote repository has no branches yet (never pushed).', '英文界面正常翻译');
  I.setLang('zh');
  assert.equal(I.t('The remote repository has no branches yet (never pushed).'), '远端仓库尚无任何分支（从未推送）。', '切回中文可还原（往返）');
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${String(e && e.message ? e.message : e).split('\n').join('\n  ')}`);
  }
}
console.log(`\n${cases.length} 用例，失败 ${failed}`);
process.exit(failed ? 1 : 0);
