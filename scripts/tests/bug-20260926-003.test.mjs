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

const skipByReason = (r, re) => (r.json.skipped || []).filter((s) => re.test(s.reason || ''));

t('B1 标题引用单号不再误判混合：提交只触及单一条目目录且主题归属单号唯一 → 按真实归属纳入', async () => {
  const h = await setupServer(async (c) => {
    const A = c.mkItem('requirement', '归属需求A');
    const SEL = c.mkItem('requirement', '所选需求C');
    for (const it of [A, SEL]) c.markDone(it.id);
    c.boardBaseline();
    // 81bec844 场景：doc 提交只修改 A 的条目文档，主题正文引用 REF（REF 为已存在的 done 条目，
    // 在所选提交之后建条目并单独提交基线，其提交不进入本次分析范围）
    const REF = c.mkItem('requirement', '仅被标题引用的B');
    c.markDone(REF.id);
    const cA = c.commitOnly(
      [`agent-team-board/data/requirements/${A.id}/notes.md`],
      `doc: 讨论 ${A.id} 默认语言泛化（正文引用 ${REF.id}）`,
    );
    const cSel = c.commitOnly(['sel.txt'], `feat: 所选 ${SEL.id}`);
    c.boardBaseline(); // REF 条目基线：在 cSel 之后提交，不成为 cSel 的未选祖先
    return { A, REF, SEL, cA, cSel };
  });
  try {
    const created = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.SEL.id, commit: h.cSel }] });
    assert.equal(created.status, 201, `创建版本应成功：${created.text}`);
    const vid = created.json.version.id;
    const r = await req(h.port, 'POST', `/api/build/version/add-dependencies${h.P}`, { id: vid });
    assert.equal(r.status, 200, `一键加入应成功：${r.text}`);
    assert.ok(!(r.json.skipped || []).some((s) => s.commit === h.cA), `标题引用型不得判混合，实际跳过：${JSON.stringify(r.json.skipped)}`);
    assert.deepEqual((r.json.added || []).map((x) => x.itemId), [h.A.id], '按真实归属（主题末尾单号 + 变更路径）纳入条目 A');
    assert.ok(!(r.json.added || []).some((x) => x.itemId === h.REF.id), '被引用条目不因标题出现而被纳入');
    const version = (await req(h.port, 'GET', `/api/build/state${h.P}`)).json.versions.find((x) => x.id === vid);
    assert.equal(version.items.length, 2, '版本含所选 C + 新入 A');
  } finally {
    await h.close();
  }
});

t('B2 真实混合提交保护不回退：一个提交变更同时触及两个条目目录 → 仍判混合并阻断', async () => {
  const h = await setupServer((c) => {
    const A = c.mkItem('requirement', '条目A');
    const B = c.mkItem('requirement', '条目B');
    const SEL = c.mkItem('requirement', '所选C');
    for (const it of [A, B, SEL]) c.markDone(it.id);
    c.boardBaseline();
    // 真实混合反例：一个提交同时写 A、B 两个条目目录（主题归属单号只写了 A 也不放行）
    const cMix = c.commitPaths(
      [`agent-team-board/data/requirements/${A.id}/x.md`, `agent-team-board/data/requirements/${B.id}/y.md`],
      `doc: 双条目联动 ${A.id}（同时调整 ${B.id}）`,
    );
    const cSel = c.commit('sel.txt', `feat: 所选 ${SEL.id}`);
    return { A, B, SEL, cMix, cSel };
  });
  try {
    const created = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.SEL.id, commit: h.cSel }] });
    assert.equal(created.status, 201);
    const vid = created.json.version.id;
    const r = await req(h.port, 'POST', `/api/build/version/add-dependencies${h.P}`, { id: vid });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.added, [], '真实混合提交不得纳入');
    const mixed = skipByReason(r, /混合提交/);
    assert.ok(mixed.some((s) => s.commit === h.cMix), `混合提交进跳过清单：${JSON.stringify(r.json.skipped)}`);
    const mixRow = mixed.find((s) => s.commit === h.cMix);
    assert.ok(mixRow.reason.includes(h.A.id) && mixRow.reason.includes(h.B.id), `原因含两个条目：${mixRow.reason}`);
    assert.match(mixRow.reason, /无法安全归因/, '保护文案保留');
    const version = (await req(h.port, 'GET', `/api/build/state${h.P}`)).json.versions.find((x) => x.id === vid);
    assert.equal(version.items.length, 1, '版本范围不变（cMix 未被归属给任何条目）');
    assert.ok(!version.items.some((it) => (it.commits || [it.commit]).includes(h.cMix)), 'cMix 不进入任何条目的提交集合');
  } finally {
    await h.close();
  }
});

t('B3 变更路径兜底归属：无单号提交仅触及单一条目目录 → 归属该条目；无任何证据 → 无法归属跳过', async () => {
  const h = await setupServer((c) => {
    const A = c.mkItem('requirement', '路径归属A');
    const SEL = c.mkItem('requirement', '所选B');
    c.markDone(A.id);
    c.markDone(SEL.id);
    c.boardBaseline();
    const cDoc = c.commitPaths([`agent-team-board/data/requirements/${A.id}/design-notes.md`], 'doc: 更新条目设计说明');
    const cU = c.commit('u.txt', 'chore: 杂项调整');
    const cSel = c.commit('sel.txt', `feat: 所选 ${SEL.id}`);
    return { A, SEL, cDoc, cU, cSel };
  });
  try {
    const created = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.SEL.id, commit: h.cSel }] });
    assert.equal(created.status, 201);
    const vid = created.json.version.id;
    const r = await req(h.port, 'POST', `/api/build/version/add-dependencies${h.P}`, { id: vid });
    assert.equal(r.status, 200);
    assert.ok(!(r.json.skipped || []).some((s) => s.commit === h.cDoc), `变更路径兜底归属不得判混合：${JSON.stringify(r.json.skipped)}`);
    assert.deepEqual((r.json.added || []).map((x) => x.itemId), [h.A.id], '无单号提交按变更路径兜底归属条目 A');
    const orphan = skipByReason(r, /无法归属/);
    assert.equal(orphan.length, 1, '无账本 / 无归属单号 / 无条目目录路径的提交以「无法归属」跳过');
    assert.equal(orphan[0].commit, h.cU, '跳过清单含 commit hash');
    const version = (await req(h.port, 'GET', `/api/build/state${h.P}`)).json.versions.find((x) => x.id === vid);
    assert.equal(version.items.length, 2, '版本含所选 B + 新入 A');
  } finally {
    await h.close();
  }
});

t('B4 提交账本优先：正文引用他条目 + 账本核验归属 → 按账本纳入，不再被正文引用判混合', async () => {
  const h = await setupServer((c) => {
    const A = c.mkItem('requirement', '账本归属A');
    const REF = c.mkItem('requirement', '被正文引用B');
    const SEL = c.mkItem('requirement', '所选C');
    for (const it of [A, REF, SEL]) c.markDone(it.id);
    c.boardBaseline();
    const cX = c.commit('x.txt', `doc: 同步 ${REF.id} 进展`);
    c.recordLedger(A.id, cX); // 账本（收口核验）归属 A；主题正文引用 REF 不参与归属
    const cSel = c.commit('sel.txt', `feat: 所选 ${SEL.id}`);
    return { A, REF, SEL, cX, cSel };
  });
  try {
    const created = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.SEL.id, commit: h.cSel }] });
    assert.equal(created.status, 201);
    const vid = created.json.version.id;
    const r = await req(h.port, 'POST', `/api/build/version/add-dependencies${h.P}`, { id: vid });
    assert.equal(r.status, 200);
    assert.ok(!(r.json.skipped || []).some((s) => s.commit === h.cX), `账本单证据归属不得判混合：${JSON.stringify(r.json.skipped)}`);
    assert.deepEqual((r.json.added || []).map((x) => x.itemId), [h.A.id], '按账本核验归属纳入 A');
  } finally {
    await h.close();
  }
});

t('B5 门禁与不在看板原因如实：submitted / 已不存在条目的提交仍拦截且原因准确（无「依赖」措辞）', async () => {
  const h = await setupServer((c) => {
    const S = c.mkItem('requirement', '未完成条目S'); // 保持 submitted
    const SEL = c.mkItem('requirement', '所选C');
    c.markDone(SEL.id);
    c.boardBaseline();
    const cS = c.commit('s.txt', `doc: 讨论 ${S.id} 草案`);
    const cGone = c.commit('g.txt', 'doc: 早期方案讨论 REQ-19900101-999');
    const cSel = c.commit('sel.txt', `feat: 所选 ${SEL.id}`);
    return { S, SEL, cS, cGone, cSel };
  });
  try {
    const created = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.SEL.id, commit: h.cSel }] });
    assert.equal(created.status, 201);
    const vid = created.json.version.id;
    const r = await req(h.port, 'POST', `/api/build/version/add-dependencies${h.P}`, { id: vid });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.added, [], 'submitted / 不存在条目对应提交均不纳入');
    const gate = skipByReason(r, /尚未完成/);
    assert.equal(gate.length, 1, 'submitted 条目提交被 done 门禁拦截');
    assert.ok(gate[0].reason.includes(h.S.id) && gate[0].reason.includes('submitted'), `原因含条目与状态：${gate[0].reason}`);
    const gone = skipByReason(r, /不在本看板中/);
    assert.equal(gone.length, 1, '已不存在条目的提交如实说明不在看板');
    assert.ok(gone[0].reason.includes('REQ-19900101-999'), `原因含条目号：${gone[0].reason}`);
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
      { key: 'plan', label: '版本计划', locked: false, reason: '' },
      { key: 'link', label: '关联条目与提交', locked: false, reason: '' },
      { key: 'docs', label: '文档编写', locked: false, reason: '' },
      { key: 'merge', label: '合并入 main', locked: false, reason: '' },
      { key: 'release', label: '正式发布', locked: false, reason: '' },
    ],
    docs: { files: [], overall: docsHash ? 'committed' : 'none', commitHash: docsHash, reasons: [] },
    mergeAnalysis: { perItem: perItem || [], blocked: [], notes: [] },
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
  assert.match(pane, /发现 2 个未选祖先提交 · 影响 1 个所选条目/, '汇总行不再带「（依赖）」统称');
  assert.ok(!pane.includes('未选祖先（依赖）'), '不再出现「未选祖先（依赖）」旧措辞');
  assert.match(pane, /一键加入所有未选祖先提交/, '按钮改为未选祖先措辞');
  assert.ok(!pane.includes('一键加入所有依赖提交'), '旧按钮文案不再渲染');
  assert.match(pane, /查看未选祖先明细/, '明细折叠入口改为未选祖先措辞');
  assert.match(pane, /为 REQ-20260921-013 的未选祖先/, '归属标注改为未选祖先措辞');
  assert.ok(!pane.includes('的依赖'), '明细不再以「依赖」标注归属');
  assert.ok(pane.includes('data-iso-add-deps'), '行为标记 data-iso-add-deps 保留');
  assert.ok(!pane.includes('所选提交无未选祖先：变更可独立进入主分支。'), '有未选祖先时不渲染空态（空态措辞基线另测）');
});

t('F2 一键加入反馈同步：跳过清单与 toast 均为未选祖先 / 条目措辞（不再「依赖条目 / 依赖提交」）', async () => {
  const skipped = [{ commit: '77d0e2ff'.padEnd(40, '0'), subject: 'docs: 发布文档 REQ-20260920-016', reason: '条目 REQ-20260920-016 尚未完成（当前状态：submitted）：仅已完成（done）条目可纳入' }];
  const h = setup({
    versions: [ver('BLD-FB', '反馈')],
    plans: (id, n) => (n >= 2 ? plan({ docsHash: H2, perItem: [] }) : plan({ docsHash: H2, perItem: DEP_PER_ITEM })),
    addDeps: () => ({ version: null, added: [], appended: [], skipped }),
  });
  await h.enter();
  await h.detailAt('BLD-FB', 'merge');
  await h.run('window.ATBBuild.addDependencies()');
  await h.tick(5);
  const pane = mergePaneHtml(h.inner());
  assert.match(pane, /⚠ 以下 1 个未选祖先提交未能纳入：/, '跳过清单头改为未选祖先措辞');
  assert.ok(!pane.includes('个依赖未能纳入'), '旧「依赖」措辞不再渲染');
  assert.ok(h.toasts.some(([m]) => m.includes('未能加入任何未选祖先提交') && m.includes('隔离分析清单')), `全跳过 toast 措辞，实际：${JSON.stringify(h.toasts)}`);
  assert.ok(!h.toasts.some(([m]) => m.includes('依赖')), 'toast 不再出现「依赖」措辞');
});

t('F3 部分成功 toast：新增条目 + 补入提交的混合反馈使用「条目 / 未选祖先提交」措辞', async () => {
  const added = [{ itemId: 'REQ-20260920-018', commit: '9ab3cdef'.padEnd(40, '0'), title: '依赖需求' }];
  const appended = [{ itemId: 'REQ-20260921-013', commits: ['c45d9911'.padEnd(40, '0')] }];
  const h = setup({
    versions: [ver('BLD-MIX-OK', '混合成功')],
    plans: (id, n) => (n >= 2 ? plan({ docsHash: H2, perItem: [] }) : plan({ docsHash: H2, perItem: DEP_PER_ITEM })),
    addDeps: () => ({ version: null, added, appended, skipped: [] }),
  });
  await h.enter();
  await h.detailAt('BLD-MIX-OK', 'merge');
  await h.run('window.ATBBuild.addDependencies()');
  await h.tick(5);
  assert.ok(
    h.toasts.some(([m]) => m.includes('✓ 已加入 1 个条目、补入 1 个未选祖先提交：发布范围已变化')),
    `混合成功 toast 措辞，实际：${JSON.stringify(h.toasts)}`,
  );
  assert.ok(!h.toasts.some(([m]) => m.includes('依赖')), '成功 toast 不再出现「依赖」措辞');
});

/* ================= 静态：i18n 词典中英同步 ================= */

t('S1 i18n 词条随措辞同步：新增未选祖先词条中英齐备，旧「依赖」词条移除', async () => {
  await import('../web/i18n.js');
  const { EN, EN_DYNAMIC } = globalThis.ATBI18N._dict;
  for (const k of [
    '一键加入所有未选祖先提交',
    '查看未选祖先明细',
    '所选提交无未选祖先：变更可独立进入主分支。',
    '⚠ 未能加入任何未选祖先提交（原因见隔离分析清单）',
    '把未选祖先提交经归因核验后确属所选条目的条目与提交纳入本版本发布范围；加入后发布范围变化，文档需重新核对 / 提交',
  ]) {
    assert.ok(k in EN, `EN 词典缺词条：${k}`);
  }
  for (const k of [
    '发现 ◇ 个未选祖先提交 · 影响 ◇ 个所选条目',
    '为 ◇ 的未选祖先',
    '⚠ 以下 ◇ 个未选祖先提交未能纳入：',
    '✓ 已加入 ◇ 个条目：发布范围已变化，文档需重新核对 / 提交',
    '✓ 已加入 ◇ 个条目，跳过 ◇ 个（原因见隔离分析清单）',
    '✓ 已加入 ◇ 个条目、补入 ◇ 个未选祖先提交，跳过 ◇ 个（原因见隔离分析清单）',
    '✓ 已加入 ◇ 个条目、补入 ◇ 个未选祖先提交：发布范围已变化，文档需重新核对 / 提交',
    '✓ 已补入 ◇ 个未选祖先提交，跳过 ◇ 个（原因见隔离分析清单）',
    '✓ 已补入 ◇ 个未选祖先提交：发布范围已变化，文档需重新核对 / 提交',
  ]) {
    assert.ok(k in EN_DYNAMIC, `EN_DYNAMIC 词典缺词条：${k}`);
  }
  for (const k of [
    '一键加入所有依赖提交',
    '查看依赖明细',
    '⚠ 未能加入任何依赖提交（原因见隔离分析清单）',
    '发现 ◇ 个未选祖先（依赖）提交 · 影响 ◇ 个所选条目',
    '为 ◇ 的依赖',
    '⚠ 以下 ◇ 个依赖未能纳入：',
    '✓ 已加入 ◇ 个依赖条目：发布范围已变化，文档需重新核对 / 提交',
    '✓ 已加入 ◇ 个依赖条目，跳过 ◇ 个（原因见隔离分析清单）',
    '✓ 已加入 ◇ 个依赖条目、补入 ◇ 个依赖提交，跳过 ◇ 个（原因见隔离分析清单）',
    '✓ 已加入 ◇ 个依赖条目、补入 ◇ 个依赖提交：发布范围已变化，文档需重新核对 / 提交',
    '✓ 已补入 ◇ 个依赖提交，跳过 ◇ 个（原因见隔离分析清单）',
    '✓ 已补入 ◇ 个依赖提交：发布范围已变化，文档需重新核对 / 提交',
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
