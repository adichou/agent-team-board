#!/usr/bin/env node
// REQ-20260911-006 回退批量 commit「提交目录范围」（整体撤销 004 实施）—— 防再引入回归测试
// 覆盖 test-cases.md U1–U4、S1、E1、R1（W1 由 run-all 全量回归承载）
// 说明：残留扫描 token 以片段拼接构造，避免本文件自身成为 scripts/ 的标记残留。
// 用法：node scripts/tests/commit-rollback-20260911-006.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as taskSettings from '../lib/task-settings.mjs';
import * as commitStore from '../lib/commit-store.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');
const readSrc = (p) => fs.readFileSync(path.join(pluginRoot, p), 'utf8');
const APP_JS = readSrc('scripts/web/app.js');
const SERVER_JS = readSrc('scripts/server.mjs');
const CSS_SRC = readSrc('scripts/web/style.css');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- 脚手架（CLI / git / server / vm，沿 commit-batch-20260910-013 与 agent-generic-20260909-011 同法） ----------

function atb(args, cwd) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function atbJson(root, args) {
  const r = atb([...args, '--json'], root);
  if (r.code !== 0) throw new Error(`atb ${args.join(' ')} 失败：${r.err || r.out}`);
  return JSON.parse(r.out.split('\n').filter(Boolean).pop());
}

function git(root, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout || '';
}

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-commit-rb-')));
  git(root, ['init', '-q']);
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化测试仓库']);
  core.initData(root);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化看板数据']);
  return root;
}

function mkItem(dataDir, title) {
  const x = core.createItem(dataDir, { type: 'requirement', title });
  core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, x.id, 'planned', { by: 'human' });
  core.claim(dataDir, x.id, 'dev');
  core.report(dataDir, x.id, { summary: '实施完成', by: 'dev' });
  core.setStatus(dataDir, x.id, 'done', { by: 'human' });
  return x;
}

function commitPaths(root, paths, message) {
  git(root, ['add', '--', ...paths]);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']).trim();
}

async function startServer(root, tmp) {
  const port = 34000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const req = (method, pth, body) => new Promise((resolve, reject) => {
    const u = new URL(`http://127.0.0.1:${port}${pth}`);
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request(u, { method, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data || '{}') }); } catch (e) { reject(e); }
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try { await req('GET', '/api/health'); return { server, req, port }; } catch {}
  }
  throw new Error('服务未启动');
}

// ---------- U1 数据层 ----------

t('U1 数据层回退：默认/读取无 commit 分区；patch.commit 按未知键忽略（不报错不落盘）；存量残留 commit 分区读取忽略、保存不写回；scope 导出移除', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-rb-u1-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  try {
    const s0 = taskSettings.loadTaskSettings(dataDir);
    assert.equal(s0.commit, undefined, '默认设置无 commit 分区');

    const r1 = taskSettings.saveTaskSettings(dataDir, {
      commit: { dirs: [], rootFiles: false },
      refine: { autoPlanAfterDone: true },
    });
    assert.equal(r1.commit, undefined, '保存返回无 commit 分区（patch.commit 被忽略）');
    assert.equal(r1.refine.autoPlanAfterDone, true, 'refine 分区正常生效');
    const sp = path.join(dataDir, 'tasks', 'settings.json');
    const disk1 = JSON.parse(fs.readFileSync(sp, 'utf8'));
    assert.equal(disk1.commit, undefined, '落盘无 commit 分区');
    assert.equal(disk1.refine.autoPlanAfterDone, true, 'refine 落盘正常');

    // 存量残留（过渡期保存过）：读取侧按未知字段忽略，保存侧不再写回
    disk1.commit = { dirs: ['legacy/'], rootFiles: false, configured: true };
    fs.writeFileSync(sp, JSON.stringify(disk1, null, 2));
    const s2 = taskSettings.loadTaskSettings(dataDir);
    assert.equal(s2.commit, undefined, '读取忽略残留 commit 分区');
    assert.equal(s2.refine.autoPlanAfterDone, true, 'refine 读取不受残留影响');
    const r2 = taskSettings.saveTaskSettings(dataDir, { refine: { autoPlanAfterDone: false } });
    assert.equal(r2.commit, undefined);
    assert.equal(JSON.parse(fs.readFileSync(sp, 'utf8')).commit, undefined, '保存后不写回 commit 分区');

    // 004 的导出（函数与目录清单常量）全部移除
    const fns = ['default' + 'Commit' + 'Scope', 'normalize' + 'Commit' + 'ScopeToken', 'normalize' + 'Commit' + 'Scope',
      'commit' + 'Scope' + 'Of', 'commit' + 'Scope' + 'AllowsFile', 'commit' + 'Scope' + 'Text'];
    for (const name of fns) assert.equal(taskSettings[name], undefined, 'scope 函数导出已移除');
    const consts = ['COMMIT_' + 'SCOPE_SRC_DIRS', 'COMMIT_' + 'SCOPE_DEFAULT_DIRS',
      'COMMIT_' + 'SCOPE_OPTIONAL_DIRS', 'COMMIT_' + 'SCOPE_DIR_LABEL'];
    for (const name of consts) assert.equal(taskSettings[name], undefined, '目录清单常量导出已移除');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- U2/U3/U4 提示词/领取/核验 ----------
// REQ-20260911-010：人工触发的批量 commit 流程（buildCommitPrompt / createCommitBatch /
// atb commit next / done 核验 validateItemCommits）已整体回退移除，本组用例随之删除；
// 回退后契约（旧命令明确报错、零 git 副作用、内核保留）由 commit-rollback-20260911-010.test.mjs 覆盖。

// ---------- S1 服务端 ----------

t('S1 API 回退：GET /api/tasks/settings 无 commit 分区；POST 携带 commit 键 200 且不落盘不报错；refine 读写不回归', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-rb-s1-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root, { recursive: true });
  core.initData(root);
  const { server, req } = await startServer(root, tmp);
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    const g = await req('GET', `/api/tasks/settings${P}`);
    assert.equal(g.status, 200);
    assert.equal(g.json.settings.commit, undefined, 'GET 返回无 commit 分区');

    const p = await req('POST', `/api/tasks/settings${P}`, {
      commit: { dirs: ['x/'], rootFiles: false },
      refine: { autoPlanAfterDone: true },
    });
    assert.equal(p.status, 200, 'POST 携带 commit 键不报错（按 agents/models 先例忽略）');
    assert.equal(p.json.settings.commit, undefined, '保存返回无 commit 分区');
    assert.equal(p.json.settings.refine.autoPlanAfterDone, true, 'refine 开关仍生效');

    const g2 = await req('GET', `/api/tasks/settings${P}`);
    assert.equal(g2.json.settings.commit, undefined, 'GET 复核无 commit 分区（未落盘）');
    assert.equal(g2.json.settings.refine.autoPlanAfterDone, true, 'refine 持久化正常');
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- E1 设置页契约（app.js vm） ----------

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', title: '', value: '', disabled: false, checked: false,
    tagName: 'DIV', __match: null, children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll(selector) { return Array.from(nodes.values()).filter((el) => el.__match && el.__match(selector)); },
    appendChild() {}, prepend() {}, replaceChildren() {}, setAttribute() {}, removeAttribute() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

function setupUi() {
  const document = element();
  document.createElement = element;
  const seed = (selector, el) => document.nodes.set(selector, el);
  const posted = [];
  const resp = (ok, body, status = ok ? 200 : 500) => ({ ok, status, statusText: ok ? 'OK' : 'ERR', json: async () => body });
  const saved = {
    version: 1,
    agents: { refine: ['zcode', 'codex'], develop: ['zcode', 'codex'] },
    models: {
      refine: { zcode: { source: 'follow', model: '', level: 'high' }, codex: { source: 'follow', model: '', level: 'high' } },
      develop: { zcode: { source: 'follow', model: '', level: 'medium' }, codex: { source: 'follow', model: '', level: 'medium' } },
    },
    refine: { autoPlanAfterDone: false },
  };
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, confirm: () => true },
    fetch: async (url, opts) => {
      const p = String(url).split('?')[0];
      const method = opts && opts.method;
      if (method === 'POST') posted.push({ url: p, body: JSON.parse(opts.body || '{}') });
      if (p === '/api/tasks/settings') {
        if (method === 'POST') return resp(true, { ok: true, settings: saved });
        return resp(true, { settings: saved });
      }
      if (p === '/api/dispatch/settings') return resp(true, { settings: { codex: { cliPath: null, timeoutMin: 60, retries: 2 } } });
      return resp(true, {});
    },
  };
  sandbox.__posted = posted;
  vm.createContext(sandbox);
  vm.runInContext(APP_JS.split('/* ---------- 启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  run('toast = () => {}; poll = async () => {}; refreshDrawer = async () => {}; refreshBatch = async () => {}; renderBatchDrawer = () => {};');
  return { sandbox, document, state, run, seed, posted };
}

t('E1 设置页回退：就绪态为「官网仓库 + 批量任务 + Git 工作流」三个分区（无批量 Commit 分区/目录复选框/恢复默认/空范围警示）；保存载荷仅含 refine', async () => {
  const h = setupUi();
  const view = element();
  view.nodes.set('#tsStatus', element());
  const saveBtn = element();
  view.nodes.set('#tsSave', saveBtn);
  const autoPlan = element();
  autoPlan.checked = true;
  view.nodes.set('#tsAutoPlan', autoPlan);
  h.seed('#settingsView', view);
  await h.run('renderSettingsView()');

  const out = view.innerHTML;
  assert.match(out, /<h4>批量任务<\/h4>/, '「批量任务」分区保留');
  assert.match(out, /<h4>Git 工作流<\/h4>/, '「Git 工作流」分区保留（REQ-20260911-009）');
  // BUG-20260916-001：设置页新增全局共享的「官网仓库」分区（构建发布独立配置），分区数 2 → 3
  assert.match(out, /<h4>官网仓库<\/h4>/, '「官网仓库」分区保留（BUG-20260916-001）');
  assert.ok((out.match(/<section/g) || []).length === 3, `就绪态应恰有三个分区（当前 ${out.match(/<section/g)?.length} 个）`);
  assert.ok(!out.includes('批量 Commit'), '不再渲染「批量 Commit」分区');
  assert.ok(!out.includes('dir-group') && !out.includes('dir-list'), '无目录清单控件');
  assert.ok(!out.includes('恢复默认'), '无恢复默认按钮');
  assert.ok(!out.includes('提交目录范围'), '无目录范围文案');
  assert.ok(!out.includes('未配置 · 默认生效'), '无未配置空态条');
  assert.match(out, /id="tsAutoPlan"/, '流转开关保留');
  assert.match(out, /id="tsSave"/, '保存按钮保留');

  // 保存绑定：仅提交 refine 开关（无 commit 载荷）
  autoPlan.fire('change');
  h.posted.length = 0;
  await saveBtn.fire('click').result;
  const post = h.posted.find((p) => p.url === '/api/tasks/settings');
  assert.ok(post, '应发起任务设置保存请求');
  assert.deepEqual(post.body, { refine: { autoPlanAfterDone: true } }, '保存载荷仅含 refine 开关');
  assert.equal(saveBtn.textContent, '保存批量任务设置', '完成后按钮文案恢复');
});

// ---------- R1 源码残留扫描 ----------

t('R1 源码残留扫描：五个实现文件无 004 标记与 scope 命名', () => {
  const src = {
    'task-settings.mjs': readSrc('scripts/lib/task-settings.mjs'),
    'commit-store.mjs': readSrc('scripts/lib/commit-store.mjs'),
    'server.mjs': SERVER_JS,
    'app.js': APP_JS,
    'style.css': CSS_SRC,
  };
  // token 以片段拼接（避免本文件成为 grep 残留）；含验收清单全部标记
  const gone = [
    'REQ-' + '20260911-004',
    'commit' + 'Scope', 'Commit' + 'Scope', 'COMMIT_' + 'SCOPE',
    'commit-' + 'settings',
    'cs' + 'Save', 'cs' + 'Reset', 'cs' + 'Status', 'cs' + 'EmptyWarn',
    'data-' + 'cdir', '__' + 'root__',
  ];
  for (const [name, text] of Object.entries(src)) {
    for (const tok of gone) {
      assert.ok(!text.includes(tok), `${name} 残留标记：${tok}`);
    }
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
