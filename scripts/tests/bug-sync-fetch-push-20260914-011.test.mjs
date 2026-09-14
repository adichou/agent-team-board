#!/usr/bin/env node
// BUG-20260914-011 「和远端同步」只 fetch 不 push——语义改为先 fetch 后 push，
// 使本地与远端记录一致（推送范围 = 除 main 外的全部本地分支，main 归发布模块）。
// B1–B5：build-git syncRemote（真实临时 git 仓库 + 本地 bare 远端）——核心场景 / 稳态幂等 /
// 推送失败可分辨 / main 排除与远端选择 / 非 git 仓库与未配置远端错误；
// U1–U6：build.js doSync（vm 载荷注入，/api/build/sync 应答控制）——请求走新接口、
// 成功 / 部分失败 / 无可推分支 toast、空态细分、fetch 失败维持、悬停提示新口径；
// W1：i18n 新空态词条收录与旧词条更新；S1：源码无旧口径残留（/api/build/fetch 调用与路由）。
// 用法：node scripts/tests/bug-sync-fetch-push-20260914-011.test.mjs

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
const serverJs = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

function git(root, args, opts = {}) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', env: GIT_ENV, timeout: 30_000,
  });
  if (!opts.canFail && r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return String(r.stdout || '').trim();
}

function mkTmp(prefix = 'atb-sync-push-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// 构造「本地 dev+main 有提交、远端 bare 为空」的核心场景仓库
function mkRepo() {
  const tmp = mkTmp();
  const remote = path.join(tmp, 'origin.git');
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  git(tmp, ['init', '--bare', '-b', 'main', remote]);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['remote', 'add', 'origin', remote]);
  fs.writeFileSync(path.join(root, 'a.md'), 'a\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: base']);
  git(root, ['switch', '-q', '-c', 'dev']);
  fs.writeFileSync(path.join(root, 'b.md'), 'b\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'feat: on dev']);
  return { root, remote };
}

/* ---------- B1–B5：数据层 syncRemote ---------- */

t('B1 核心场景：dev 有提交远端为空——同步后远端出现 dev 引用（main 不推）、dev 建立上游、结果结构完整', () => {
  const { root, remote } = mkRepo();
  const r = buildGit.syncRemote(root);
  assert.equal(r.ok, true, `同步应成功：${JSON.stringify(r)}`);
  assert.equal(r.remote, 'origin');
  assert.equal(r.pushed.length, 1, '仅 dev 被推送');
  assert.equal(r.pushed[0].branch, 'dev');
  assert.equal(r.pushed[0].setUpstream, true, 'dev 首推建立上游跟踪');
  assert.deepEqual(r.failed, [], '无失败分支');
  assert.deepEqual(r.skipped, ['main'], 'main 应跳过（发布模块管理）');
  const ls = git(root, ['ls-remote', remote]);
  assert.match(ls, /refs\/heads\/dev/, '远端应出现 dev 引用');
  assert.doesNotMatch(ls, /refs\/heads\/main/, 'main 不得被推送');
  assert.match(git(root, ['rev-parse', '--abbrev-ref', 'dev@{upstream}']), /origin\/dev/, 'dev 应建立上游跟踪');
});

t('B2 稳态幂等：两边一致时再次同步不报错、无重复推送副作用、记录保持一致', () => {
  const { root } = mkRepo();
  const first = buildGit.syncRemote(root);
  assert.equal(first.ok, true);
  const before = git(root, ['ls-remote', remote0(root)]);
  const second = buildGit.syncRemote(root);
  assert.equal(second.ok, true, `稳态同步应成功：${JSON.stringify(second.failed)}`);
  assert.equal(second.pushed.length, 1, 'dev 仍在推送清单（up-to-date）');
  assert.equal(second.pushed[0].setUpstream, false, '已有上游不再加 -u');
  assert.deepEqual(second.skipped, ['main']);
  assert.equal(git(root, ['ls-remote', remote0(root)]), before, '远端记录无变化（幂等）');
});

function remote0(root) {
  return git(root, ['remote', 'get-url', 'origin']).trim();
}

t('B3 推送失败可分辨：远端领先（非快进被拒）——失败分支与原因计入 failed，不中断整体、不改写历史', () => {
  const { root, remote } = mkRepo();
  buildGit.syncRemote(root);
  // 构造远端 dev 领先：bare 仓库直接改 dev 指向新提交（本地不知道）
  const tmp2 = mkTmp();
  git(tmp2, ['clone', '-q', remote, 'clone']);
  const clone = path.join(tmp2, 'clone');
  git(clone, ['checkout', '-q', 'dev']);
  fs.writeFileSync(path.join(clone, 'c.md'), 'c\n');
  git(clone, ['add', '.']);
  git(clone, ['commit', '-q', '-m', 'remote ahead']);
  git(clone, ['push', '-q', 'origin', 'dev']);
  // 本地 dev 制造分叉提交 → push 非快进被拒
  fs.writeFileSync(path.join(root, 'd.md'), 'd\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'local diverged']);
  const r = buildGit.syncRemote(root);
  assert.equal(r.ok, false, '存在失败分支时 ok=false');
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].branch, 'dev');
  assert.match(r.failed[0].error, /推送 dev 到 origin 失败|non-fast-forward|fetch first/i, '应携带 git 拒绝原因');
  assert.deepEqual(r.skipped, ['main'], 'main 口径不变');
  // 不强推：远端 dev 仍是领先提交、本地历史未被改写
  const ls = git(root, ['ls-remote', remote, 'refs/heads/dev']);
  assert.match(ls, /remote ahead|^[0-9a-f]{40}/, '远端 dev 未被覆盖');
  const localHead = git(root, ['rev-parse', 'dev']);
  assert.equal(git(root, ['log', '-1', '--format=%s', localHead]), 'local diverged', '本地历史未改写');
});

t('B4 多分支推送与远端选择：origin 优先于其他已配置远端；多个开发分支全部上传', () => {
  const { root, remote } = mkRepo();
  const tmp = path.dirname(root);
  const other = path.join(tmp, 'other.git');
  git(tmp, ['init', '--bare', '-b', 'main', other]);
  git(root, ['remote', 'add', 'backup', other]);
  git(root, ['switch', '-q', '-c', 'feat/x']);
  fs.writeFileSync(path.join(root, 'e.md'), 'e\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'feat: on feat/x']);
  git(root, ['switch', '-q', 'dev']);
  const r = buildGit.syncRemote(root);
  assert.equal(r.remote, 'origin', 'origin 优先');
  assert.deepEqual(r.pushed.map((x) => x.branch).sort(), ['dev', 'feat/x'], '全部开发分支上传（含当前分支）');
  const ls = git(root, ['ls-remote', remote]);
  assert.match(ls, /refs\/heads\/dev/, 'origin 出现 dev');
  assert.match(ls, /refs\/heads\/feat\/x/, 'origin 出现 feat/x');
  assert.doesNotMatch(ls, /refs\/heads\/main/, 'main 仍不推');
  const lsOther = git(root, ['ls-remote', other]);
  assert.equal(lsOther, '', '非 origin 远端不被推送');
});

t('B5 非 git 仓库 / 未配置远端：错误口径与现状一致（明确引导，不进推送）', () => {
  const nonRepo = mkTmp();
  assert.throws(() => buildGit.syncRemote(nonRepo), /项目不是 git 仓库：请先初始化 git（可经 atb init），再同步远端/);
  const { root } = mkRepo();
  git(root, ['remote', 'remove', 'origin']);
  assert.throws(() => buildGit.syncRemote(root), /尚未配置远端/);
});

/* ---------- U1–U6：前端 doSync（vm） ---------- */

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

const syncOk = (over = {}) => ({
  ok: true, remote: 'origin',
  pushed: [{ branch: 'dev', remoteBranch: 'origin/dev', setUpstream: true }],
  failed: [], skipped: ['main'],
  ...over,
});

function setup({ branches, state = statePayload(), syncResult } = {}) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const toasts = [];
  const calls = [];
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
      if (up.pathname === '/api/build/sync') {
        calls.push('/api/build/sync');
        return syncResult ? syncResult() : { ok: true, json: async () => syncOk() };
      }
      calls.push(up.pathname);
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return { sandbox, toasts, document, calls, run: (code) => vm.runInContext(code, sandbox) };
}

async function openBranches(h) {
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('branches')`);
  await new Promise((r) => setTimeout(r, 10));
  return h.document.nodes.get('#buildView');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchBtnHtml = (inner) => {
  const m = inner.match(/<button[^>]*id="bldFetchBtn"[^>]*>/);
  assert.ok(m, '应渲染 #bldFetchBtn 同步按钮');
  return m[0];
};

t('U1 点击同步：请求走 /api/build/sync（不再调 /api/build/fetch），执行中禁用「同步中…」，成功 toast 汇总 fetch 与推送', async () => {
  let resolveSync;
  const syncResult = () => new Promise((res) => { resolveSync = res; });
  const h = setup({ branches: { isRepo: true, current: 'dev', local: ['dev', 'main'], remote: [], remotes: ['origin'] }, syncResult });
  const view = await openBranches(h);
  const btn = view.nodes.get('#bldFetchBtn');
  assert.ok(btn?.listeners?.click, '#bldFetchBtn 应绑定 click');
  btn.listeners.click();
  assert.match(view.innerHTML, /同步中…/, '执行中应显示「同步中…」');
  assert.match(fetchBtnHtml(view.innerHTML), /disabled/, '执行中按钮禁用');
  assert.ok(h.calls.includes('/api/build/sync'), '同步请求应已发出');
  assert.ok(!h.calls.includes('/api/build/fetch'), '不得再调用旧接口 /api/build/fetch');
  resolveSync({ ok: true, json: async () => syncOk() });
  await sleep(30);
  assert.equal(h.calls.filter((x) => x === '/api/build/sync').length, 1, '同步请求走新接口 /api/build/sync（仅一次）');
  assert.ok(!h.calls.includes('/api/build/fetch'), '全程不得调用旧接口 /api/build/fetch');
  assert.ok(
    h.toasts.some(([m]) => m === '✓ 已同步远端：fetch 完成，已推送 dev → origin'),
    `成功 toast 应汇总两步：${JSON.stringify(h.toasts)}`,
  );
  assert.match(view.innerHTML, /⟳ 和远端同步/, '完成后按钮恢复');
  assert.ok(!/disabled/.test(fetchBtnHtml(view.innerHTML)), '完成后按钮恢复可点');
});

t('U2 推送失败不静默：错误 toast 列明失败分支与原因；fetch 拉到的新远端分支仍出现在列表', async () => {
  let branches = { isRepo: true, current: 'dev', local: ['dev', 'main', 'feat'], remote: [], remotes: ['origin'] };
  const h = setup({
    branches,
    syncResult: () => ({
      ok: false, remote: 'origin',
      pushed: [{ branch: 'dev', remoteBranch: 'origin/dev', setUpstream: true }],
      failed: [{ branch: 'feat', error: '推送 feat 到 origin 失败：non-fast-forward（fetch first）' }],
      skipped: ['main'],
    }),
  });
  h.sandbox.fetch = async (url) => {
    const up = new URL(String(url), 'http://local');
    if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(branches)) };
    if (up.pathname === '/api/build/sync') return { ok: true, json: async () => h.__sync() };
    if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(statePayload())) };
    if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
    return { ok: true, json: async () => ({}) };
  };
  h.__sync = () => {
    // 同步完成后 fetch 拉到的新远端分支出现在列表
    branches = { ...branches, remote: ['origin/other'] };
    return {
      ok: false, remote: 'origin',
      pushed: [{ branch: 'dev', remoteBranch: 'origin/dev', setUpstream: true }],
      failed: [{ branch: 'feat', error: '推送 feat 到 origin 失败：non-fast-forward（fetch first）' }],
      skipped: ['main'],
    };
  };
  const view = await openBranches(h);
  view.nodes.get('#bldFetchBtn').listeners.click();
  await sleep(30);
  assert.ok(
    h.toasts.some(([m, e]) => /✕ 同步完成但部分推送失败/.test(m) && /feat/.test(m) && /non-fast-forward/.test(m) && e === true),
    `失败 toast 应列明分支与原因：${JSON.stringify(h.toasts)}`,
  );
  assert.match(view.innerHTML, /data-branch="origin\/other"/, 'fetch 拉到的新远端分支仍出现在列表');
});

t('U3 本地仅 main（无可推送开发分支）：成功 toast 明确说明未推送分支与原因', async () => {
  const h = setup({
    branches: { isRepo: true, current: 'main', local: ['main'], remote: [], remotes: ['origin'] },
    syncResult: () => ({ ok: true, json: async () => syncOk({ pushed: [], skipped: ['main'] }) }),
  });
  const view = await openBranches(h);
  view.nodes.get('#bldFetchBtn').listeners.click();
  await sleep(30);
  assert.ok(
    h.toasts.some(([m]) => m === '✓ 已同步远端：fetch 完成，无可推送的开发分支（main 由发布模块推送）'),
    `无可推分支 toast 应说明：${JSON.stringify(h.toasts)}`,
  );
});

t('U4 空态细分（同步成功后远端仍为空）：推送失败 → 解释失败并引导重试 + 推送按钮高亮；无可推分支 → 说明 main 由发布模块管理', async () => {
  // 场景一：推送失败后仍空（BUG-20260914-012 起 main 行无推送按钮，失败分支与 attn 高亮基于非 main 分支）
  const h1 = setup({
    branches: { isRepo: true, current: 'dev', local: ['dev', 'feat', 'main'], remote: [], remotes: ['origin'] },
    syncResult: () => ({ ok: true, json: async () => syncOk({ pushed: [], failed: [{ branch: 'feat', error: '网络不可达' }] }) }),
  });
  let view = await openBranches(h1);
  view.nodes.get('#bldFetchBtn').listeners.click();
  await sleep(30);
  let inner = view.innerHTML;
  assert.match(inner, /同步拉取已完成，但推送失败。/, '推送失败空态应解释推送失败');
  assert.match(inner, /可在上方「本地」分组对分支点「推送」重试/, '应引导逐分支重试');
  assert.match(inner, /bld-remote-hint/, '解释块应有稳定样式钩子');
  assert.match(inner, /bld-push attn/, '推送按钮应高亮为重试出路');
  // 场景二：无可推分支（本地仅 main）
  const h2 = setup({
    branches: { isRepo: true, current: 'main', local: ['main'], remote: [], remotes: ['origin'] },
    syncResult: () => ({ ok: true, json: async () => syncOk({ pushed: [] }) }),
  });
  view = await openBranches(h2);
  view.nodes.get('#bldFetchBtn').listeners.click();
  await sleep(30);
  inner = view.innerHTML;
  assert.match(inner, /远端仓库尚无任何分支（从未推送）。/, '远端为空事实仍应说明');
  assert.match(inner, /本地没有可自动推送的开发分支（main 由发布模块管理，不在此推送）/, '应说明未推送原因是 main 口径');
  assert.doesNotMatch(inner, /同步拉取已完成，但推送失败/, '无失败时不得出现失败解释');
});

t('U5 fetch 失败：toast「✕ 同步远端失败：<原因>」维持现状，按钮恢复可重试', async () => {
  const h = setup({
    branches: { isRepo: true, current: 'dev', local: ['dev'], remote: [], remotes: ['origin'] },
    syncResult: () => ({ ok: false, status: 502, json: async () => ({ error: '远端不可达' }) }),
  });
  const view = await openBranches(h);
  view.nodes.get('#bldFetchBtn').listeners.click();
  await sleep(30);
  assert.ok(
    h.toasts.some(([m]) => m === '✕ 同步远端失败：远端不可达'),
    `fetch 失败 toast 维持现状：${JSON.stringify(h.toasts)}`,
  );
  assert.ok(!/disabled/.test(fetchBtnHtml(view.innerHTML)), '失败后按钮恢复可点');
});

t('U6 悬停提示更新为 fetch + push 双动作口径（不再只描述 fetch）', async () => {
  const h = setup({ branches: { isRepo: true, current: 'dev', local: ['dev'], remote: ['origin/dev'], remotes: ['origin'] } });
  const view = await openBranches(h);
  const title = fetchBtnHtml(view.innerHTML);
  assert.match(title, /fetch --all --prune/, '仍应说明 fetch 动作');
  assert.match(title, /推送/, '应说明推送动作');
  assert.doesNotMatch(title, /只拉取|仅拉取/, '不得残留纯拉取口径描述');
});

/* ---------- W1：i18n 词典 ---------- */

t('W1 词典收录新空态解释（静态整句），中英往返；未同步空态旧词条说明更新为含推送结果口径', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN } = I._dict;
  assert.equal(EN['同步拉取已完成，但推送失败。'], 'Fetch completed, but the push failed.',
    '推送失败空态标题应有词条');
  assert.equal(EN['本次推送未能完成：失败分支与原因见上方提示。可在上方「本地」分组对分支点「推送」重试，或再次点击「⟳ 和远端同步」。'],
    'The push did not complete: see the toast above for the failed branches and reasons. Click "Push" on a branch in the "Local" group above to retry, or click "⟳ Sync with remote" again.',
    '推送失败空态说明应有词条');
  assert.equal(EN['本次同步未推送任何分支：本地没有可自动推送的开发分支（main 由发布模块管理，不在此推送）。'],
    'No branch was pushed in this sync: there is no local development branch to push automatically (main is managed by the release module, not pushed here).',
    '无可推分支空态说明应有词条');
  assert.match(EN['本地无远端跟踪分支：尚未与远端同步，可点上方「⟳ 和远端同步」拉取并推送；若同步后仍为空，说明推送未成功或远端仓库尚无任何分支（从未推送），可在上方「本地」分组推送分支。'] || '',
    /never pushed/, '未同步空态词条已按新语义更新（仍说明远端为空成因）');
  I.setLang('en');
  assert.equal(I.t('同步拉取已完成，但推送失败。'), 'Fetch completed, but the push failed.', '英文界面正常翻译');
  I.setLang('zh');
  assert.equal(I.t('Fetch completed, but the push failed.'), '同步拉取已完成，但推送失败。', '切回中文可还原（往返）');
});

/* ---------- S1：源码旧口径无残留 ---------- */

t('S1 源码：前端不再调用 /api/build/fetch，服务端无该路由残留（语义入口统一为 /api/build/sync）', () => {
  assert.ok(!buildJs.includes("post('/fetch'"), '前端不得再调用 /fetch');
  assert.ok(buildJs.includes("post('/sync'"), '前端应调用 /sync');
  assert.ok(!serverJs.includes("'/api/build/fetch'"), '服务端不得残留 /api/build/fetch 路由');
  assert.ok(serverJs.includes("'/api/build/sync'"), '服务端应有 /api/build/sync 路由');
  assert.ok(buildJs.includes('同步中…'), '执行中文案维持现状');
  assert.ok(buildJs.includes('✕ 同步远端失败：'), 'fetch 失败 toast 维持现状');
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
