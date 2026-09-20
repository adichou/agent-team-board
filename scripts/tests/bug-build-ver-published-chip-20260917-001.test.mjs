#!/usr/bin/env node
// BUG-20260917-001 版本计划发布成功后，左侧版本列表卡片显示「已发布」标签——
// P1 数据层（publishedByBld 按 bldId 汇总）；P2 服务接口（真实 spawn /api/build/state 附
// release 汇总与读取降级）；P3~P5 vm 行为（假 DOM 口径同 build-ui.test.mjs：标签替换、
// 未发布不误显、按钮规则不变、发布动作后刷新联动）+ 静态契约。
// 用法：node scripts/tests/bug-build-ver-published-chip-20260917-001.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as bpStore from '../lib/build-publish-store.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);

/* ---------- P1 数据层：publishedByBld ---------- */

const mkDir = (p) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

// 种一条发布运行：createRun 后按需改终态；createdAt 显式赋值保证「最新成功」判定确定性
function seedRun(dataDir, bldId, version, status, at) {
  const r = bpStore.createRun(dataDir, { bldId, version, frozen: {}, productId: 'demo' });
  if (status && status !== 'draft') bpStore.updateRun(dataDir, r.id, (x) => { x.status = status; x.createdAt = at; });
  return r;
}

t('P1 publishedByBld：无运行为空；未成功状态不上标识；succeeded 上标识；多次成功取最新；成功后再失败仍视为已发布；bldId 隔离', () => {
  const dir = mkDir('atb-pub-chip-');
  // 无任何运行
  assert.deepEqual([...bpStore.publishedByBld(dir).entries()], [], '无运行 → 空汇总');
  // 未成功状态：draft / failed / canceled 不产生标识
  seedRun(dir, 'BLD-B', '1.0.0', 'draft', '2026-09-17T01:00:00.000Z');
  seedRun(dir, 'BLD-B', '1.1.0', 'failed', '2026-09-17T02:00:00.000Z');
  seedRun(dir, 'BLD-B', '1.2.0', 'canceled', '2026-09-17T03:00:00.000Z');
  assert.equal(bpStore.publishedByBld(dir).get('BLD-B'), undefined, '未成功状态不上标识');
  // succeeded → 标识（published / version / runId）
  const ok1 = seedRun(dir, 'BLD-A', '1.2.0', 'succeeded', '2026-09-17T04:00:00.000Z');
  assert.deepEqual(bpStore.publishedByBld(dir).get('BLD-A'), { published: true, version: '1.2.0', runId: ok1.id }, 'succeeded 上标识');
  // 多次成功：取最新一条成功运行
  const ok2 = seedRun(dir, 'BLD-A', '1.3.0', 'succeeded', '2026-09-17T05:00:00.000Z');
  assert.deepEqual(bpStore.publishedByBld(dir).get('BLD-A'), { published: true, version: '1.3.0', runId: ok2.id }, '多次成功取最新');
  // 成功后再建新发行版本失败运行 → 仍视为已发布（成功不可逆，标识不撤下）
  seedRun(dir, 'BLD-A', '1.4.0', 'failed', '2026-09-17T06:00:00.000Z');
  assert.deepEqual(bpStore.publishedByBld(dir).get('BLD-A'), { published: true, version: '1.3.0', runId: ok2.id }, '成功后再失败仍视为已发布');
  // bldId 隔离
  assert.equal(bpStore.publishedByBld(dir).get('BLD-C'), undefined, '其他版本不受影响');
});

/* ---------- P2 服务接口：/api/build/state 附 release 汇总 ---------- */

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return r.stdout.trim();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(port, method, pathname) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port, path: pathname, method, timeout: 10000 }, (rs) => {
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
    r.end();
  });
}

t('P2 /api/build/state 附各版本 release 汇总：已发布版本 { published, version, runId }；未发布 null；发布记录损坏降级不阻塞', async () => {
  const tmp = mkDir('atb-pub-chip-srv-');
  const projA = path.join(tmp, 'projA');
  fs.mkdirSync(projA);
  git(projA, ['init', '-b', 'main']);
  git(projA, ['config', 'user.email', 't@e.co']);
  git(projA, ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(projA, 'a.txt'), 'a\n');
  git(projA, ['add', '-A']);
  git(projA, ['commit', '-m', 'init']);
  core.initData(projA);
  const dataDirA = core.dataDirFrom(projA);
  // 种版本：BLD-A 走合并状态机到 merged；BLD-B 保持 draft
  const vA = buildStore.createVersion(dataDirA, { name: 'v1.0', items: [{ itemId: 'REQ-20260917-001', title: '需求一', commit: H1 }] });
  buildStore.beginMerge(dataDirA, vA.id, { baseBranch: 'dev' });
  buildStore.finishMerge(dataDirA, vA.id, { results: [{ itemId: 'REQ-20260917-001', ok: true }] });
  const vB = buildStore.createVersion(dataDirA, { items: [{ itemId: 'BUG-20260917-002', title: '缺陷二', commit: H2 }] });
  // 种发布运行：BLD-A 一条 succeeded；BLD-B 一条 failed（不上标识）
  const runA = seedRun(dataDirA, vA.id, '1.2.0', 'succeeded', '2026-09-17T04:00:00.000Z');
  seedRun(dataDirA, vB.id, '2.0.0', 'failed', '2026-09-17T05:00:00.000Z');

  const reg = path.join(tmp, 'reg.json');
  const spawnOnPort = async (port) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: projA,
      env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try {
        const h = await req(port, 'GET', '/api/health');
        if (h.json && h.json.port === port) return child;
      } catch {}
      if (child.exitCode !== null) break;
    }
    child.kill('SIGTERM');
    return null;
  };
  let server = null;
  let port = 0;
  for (let i = 0; i < 6 && !server; i++) {
    port = 31000 + Math.floor(Math.random() * 20000);
    server = await spawnOnPort(port);
  }
  assert.ok(server, `服务应启动（最后尝试端口 ${port}）`);
  try {
    const P = `?project=${encodeURIComponent(projA)}`;
    let r = await req(port, 'GET', `/api/build/state${P}`);
    assert.equal(r.status, 200, `state 应 200：${r.text}`);
    const gotA = r.json.versions.find((v) => v.id === vA.id);
    const gotB = r.json.versions.find((v) => v.id === vB.id);
    assert.ok(gotA && gotB, '两个版本都在列表');
    assert.deepEqual(gotA.release, { published: true, version: '1.2.0', runId: runA.id }, '已发布版本附带 release 汇总');
    assert.equal(gotB.release, null, '未发布成功版本 release 为 null');
    assert.equal(gotA.status, 'merged', '版本自身合并状态不受影响');
    // 降级：发布记录损坏 → state 仍 200、release 回落 null、构建模块不受阻
    fs.writeFileSync(path.join(bpStore.runDir(dataDirA, runA.id), 'run.json'), '{broken json');
    r = await req(port, 'GET', `/api/build/state${P}`);
    assert.equal(r.status, 200, '发布记录损坏不阻塞构建 state');
    assert.equal(r.json.versions.length, 2, '版本列表完整');
    assert.equal(r.json.versions.find((v) => v.id === vA.id).release, null, '读取异常降级为无标识');
  } finally {
    server.kill('SIGTERM');
    await sleep(200);
  }
});

/* ---------- P3~P4 vm 行为（假 DOM 口径同 build-ui.test.mjs） ---------- */

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

function ver(id, name, status = 'merged', release = null) {
  return {
    id, name, description: `描述 ${name}`, status, release,
    items: [{ itemId: 'REQ-20260917-001', title: '条目一', commit: H1, mergedAt: status === 'merged' ? '2026-09-17T03:00:00.000Z' : null, mergeError: null }],
    createdAt: '2026-09-17T01:00:00.000Z', updatedAt: '2026-09-17T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
  };
}

function bpubRun(o = {}) {
  return {
    id: 'BPUB-20260917-0a1', bldId: 'BLD-A', bldName: 'v1.0', version: '1.2.0', status: 'succeeded',
    createdAt: '2026-09-17T08:00:00.000Z', updatedAt: '2026-09-17T09:00:00.000Z',
    targets: { webapp: { status: 'done' }, site: { status: 'done' } },
    ...o,
  };
}

function setup({ versions = [ver('BLD-A', 'v1.0', 'merged'), ver('BLD-B', 'v2.0', 'draft')], relRuns = [bpubRun()] } = {}) {
  const live = { versions: JSON.parse(JSON.stringify(versions)), rel: JSON.parse(JSON.stringify(relRuns)) };
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const calls = [];
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async (url, opts = {}) => {
      const u = new URL(String(url), 'http://local');
      calls.push({ path: u.pathname, method: (opts.method || 'GET').toUpperCase() });
      if (u.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: JSON.parse(JSON.stringify(live.versions)) }) };
      if (u.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (u.pathname === '/api/build-publish/state') return { ok: true, json: async () => ({ runs: JSON.parse(JSON.stringify(live.rel)), config: {} }) };
      const m = u.pathname.match(/^\/api\/build-publish\/run\/([^/]+)\/?([a-z]*)$/);
      if (m) {
        const [, id, action] = m;
        if (action) return { ok: true, json: async () => ({ run: bpubRun({ id }) }) };
        const sum = live.rel.find((r) => r.id === id) || bpubRun({ id });
        return { ok: true, json: async () => ({
          run: {
            ...sum, frozen: { mainSha: H1, devSha: H2, remote: 'origin', remoteUrl: '/tmp/r.git', extraCommits: [], homepage: { repoRoot: '/tmp/hp', branch: 'main' } },
            stages: [{ key: 'sync-source', label: '源码同步', status: 'done' }], precheck: null, logs: [], history: [],
          },
          logs: [], directories: {},
        }) };
      }
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  const tick = async (n = 2) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    sandbox, live, calls,
    run: (code) => vm.runInContext(code, sandbox),
    inner: () => vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox),
    enter: async () => vm.runInContext(`window.ATBBuild.enter('/p/proj')`, sandbox),
    tick,
  };
}

// 截取某版本卡片的 HTML 片段（卡片起至下一卡片或右侧详情区为止，不越界到详情）
function cardOf(inner, id) {
  const start = inner.indexOf(`data-ver-id="${id}"`);
  assert.ok(start >= 0, `卡片 ${id} 应存在`);
  let end = inner.length;
  const nextCard = inner.indexOf('data-ver-id="', start + 10);
  const detail = inner.indexOf('<div class="rel-detail', start);
  if (nextCard !== -1) end = Math.min(end, nextCard);
  if (detail !== -1) end = Math.min(end, detail);
  return inner.slice(start, end);
}

t('P3 发布成功版本：左侧卡片标签替换为绿色「已发布」（st-ok），原「已合并」不在卡片；title 带成功运行编号', async () => {
  const h = setup({ versions: [
    ver('BLD-A', 'v1.0', 'merged', { published: true, version: '1.2.0', runId: 'BPUB-20260917-0a1' }),
  ] });
  await h.enter();
  const card = cardOf(h.inner(), 'BLD-A');
  assert.match(card, /class="st st-ok"[^>]*>已发布<\/span>/, '卡片标签替换为绿色「已发布」');
  assert.match(card, /title="[^"]*BPUB-20260917-0a1[^"]*"/, 'title 提示成功运行编号');
  assert.match(card, /1\.2\.0/, 'title / 提示含发行版本号');
  assert.doesNotMatch(card, /已合并(?!入 main)/, '卡片标题行不再显示「已合并」标签（按钮 disabled title 除外）');
  assert.match(card, /title="已合并入 main"/, '按钮禁用规则不变（合并键仍按 merged 禁用）');
  assert.match(card, /data-ver-release="BLD-A"(?![^>]*disabled)/, '创建发布键仍可用（merged 未锁）');
});

t('P3b 未发布成功版本不误显「已发布」：无运行（release null / 缺省）与各中间态保持原四态标签；防御 published 非真值', async () => {
  const h = setup({ versions: [
    ver('BLD-B', 'v2.0', 'merged', null),
    ver('BLD-C', 'v3.0', 'draft'),
    ver('BLD-D', 'v4.0', 'merging'),
    ver('BLD-E', 'v5.0', 'failed'),
    ver('BLD-F', 'v6.0', 'merged', { published: false, version: '0.9.0', runId: 'BPUB-20260917-0f1' }),
  ], relRuns: [] });
  await h.enter();
  const inner = h.inner();
  assert.doesNotMatch(cardOf(inner, 'BLD-B'), /已发布/, 'release=null 的 merged 版本不显示已发布');
  assert.match(cardOf(inner, 'BLD-B'), />已合并<\/span>/, '保持「已合并」');
  assert.match(cardOf(inner, 'BLD-C'), />计划中<\/span>/, 'draft 保持「计划中」');
  assert.match(cardOf(inner, 'BLD-D'), />合并中<\/span>/, 'merging 保持「合并中」');
  assert.match(cardOf(inner, 'BLD-E'), />失败<\/span>/, 'failed 保持「失败」');
  assert.doesNotMatch(cardOf(inner, 'BLD-F'), /已发布/, 'published 非真值（防御旧数据）不显示已发布');
  assert.match(cardOf(inner, 'BLD-F'), />已合并<\/span>/, '防御回落原标签');
  assert.equal((inner.match(/已发布/g) || []).length, 0, '整页无「已发布」误显');
});

t('P3c 详情「概况」名称行仍显示合并状态；右侧「发布」页签行为不受影响（仍可见运行记录与已发布状态）', async () => {
  const h = setup({ versions: [
    ver('BLD-A', 'v1.0', 'merged', { published: true, version: '1.2.0', runId: 'BPUB-20260917-0a1' }),
  ] });
  await h.enter();
  const inner = h.inner();
  // 详情概况区（右侧）名称行保留合并状态标签
  const detail = inner.slice(inner.indexOf('bld-name'));
  assert.match(detail, />已合并<\/span>/, '详情概况名称行保留「已合并」');
  // 发布页签仍正常：打开后可见运行与已发布状态
  h.run(`window.ATBBuild.setStep('release')`);
  await h.tick(4);
  const rel = h.inner();
  assert.match(rel, /data-rel-run="BPUB-20260917-0a1"/, '发布页签运行记录不受影响');
  assert.match(rel, /class="st st-ok"[^>]*>已发布<\/span>/, '发布页签运行状态仍为「已发布」');
});

t('P4 发布动作 / 刷新状态完成后重取构建 state：卡片标识随最新发布状态更新（无需手动刷新页面）', async () => {
  // 初始 state：BLD-A 尚未带上发布汇总（发布运行刚成功、state 未刷新）
  const h = setup({ versions: [ver('BLD-A', 'v1.0', 'merged', null)] });
  await h.enter();
  assert.doesNotMatch(cardOf(h.inner(), 'BLD-A'), /已发布/, '刷新前卡片无「已发布」');
  h.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await h.tick(4);
  // 服务端已汇总为已发布（下一次 /api/build/state 返回带 release）
  h.live.versions[0].release = { published: true, version: '1.2.0', runId: 'BPUB-20260917-0a1' };
  // 「刷新状态」入口 → 重取发布记录 + 重取构建 state
  const before = h.calls.filter((c) => c.path === '/api/build/state').length;
  await h.run(`window.ATBBuild.refreshReleasePane()`);
  await h.tick(4);
  assert.ok(h.calls.filter((c) => c.path === '/api/build/state').length > before, '刷新状态后重取了构建 state');
  assert.match(cardOf(h.inner(), 'BLD-A'), /class="st st-ok"[^>]*>已发布<\/span>/, '卡片标签随之更新为「已发布」');
  // 发布动作（relAction）完成后同样联动
  h.live.versions[0].release = null;
  await h.run(`window.ATBBuild.relAction('BPUB-20260917-0a1', 'cancel')`);
  await h.tick(4);
  assert.doesNotMatch(cardOf(h.inner(), 'BLD-A'), /已发布/, 'state 回落后卡片标签随之还原（以实际数据为准）');
});

/* ---------- P5 静态契约 ---------- */

t('P5 静态契约：卡片标签经 versionChip（发布成功替换）；发布动作与刷新状态完成后刷新构建 state；发布页签既有绑定不回归', () => {
  const listFn = buildJs.match(/function renderVersionList\(\) \{[\s\S]*?\n  \}/);
  assert.ok(listFn, '缺少 renderVersionList');
  assert.ok(listFn[0].includes('versionChip(v)'), '卡片标题行标签应经 versionChip(v) 渲染');
  const relFn = buildJs.match(/async function relAction\(id, action, payload = \{\}\) \{[\s\S]*?\n  \}/);
  assert.ok(relFn, '缺少 relAction');
  assert.match(relFn[0], /await refresh\(\)/, 'relAction 完成后应刷新构建 state');
  const paneFn = buildJs.match(/function refreshReleasePane\(\) \{[\s\S]*?\n  \}/);
  assert.ok(paneFn, '缺少 refreshReleasePane');
  assert.match(paneFn[0], /refresh\(\)/, '刷新状态入口应一并刷新构建 state');
  assert.match(buildJs, /view\.querySelectorAll\('\[data-rel-act\]'\)/, '发布动作绑定不回归');
  assert.match(buildJs, /view\.querySelectorAll\('\[data-ver-release-view\]'\)/, '查看发布记录绑定不回归');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e && e.stack ? e.stack : e}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
